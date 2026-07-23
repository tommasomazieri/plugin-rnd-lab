#!/usr/bin/env node
/**
 * compare-runs.mjs — pair the two arms of a fired run and compute the comparison.
 *
 * Usage:
 *   node compare-runs.mjs <runDir>
 *
 * Reads runs/run-NNN/manifest.json, analyzes each arm's transcript (last session
 * segment of each arm; earlier segments flagged), writes:
 *   analysis/metrics-control.json
 *   analysis/metrics-test.json
 *   analysis/comparison.json
 * and prints a terse summary table.
 *
 * The comparison stays deterministic and honest: raw totals side by side, deltas,
 * and BIAS INDICATORS (user-turn asymmetry, compaction asymmetry, session-segment
 * asymmetry, model parity check). It never fabricates "adjusted" numbers by
 * subtracting estimates — interpretation of the bias indicators belongs to the
 * session-comparator agent and the human.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeFile } from './analyze-jsonl.mjs';

const ARMS = ['control', 'test'];

function fail(msg) {
  console.error(`[ab-bench] ERROR: ${msg}`);
  process.exit(1);
}

function pct(a, b) {
  if (!b) return null;
  return Math.round(((a - b) / b) * 1000) / 10;
}

function readJsonSafe(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

// runDir = <testenvRoot>/runs/run-NNN — same two-levels-up shape regardless of the
// two-root split (only where testenvRoot itself lives moved; this function's logic didn't).
function testenvRootFromRunDir(runDir) {
  return path.dirname(path.dirname(runDir));
}

function summarizeDodState(session) {
  if (!session) return null;
  const ids = session.checks || [];
  const results = ids.map((id) => session.state?.[id]?.last_result || 'pending');
  return {
    total: ids.length,
    pass: results.filter((r) => r === 'pass').length,
    fail: results.filter((r) => r === 'fail').length,
    waived: results.filter((r) => r === 'waived').length,
    pending: results.filter((r) => r === 'pending').length,
    all_passing: ids.length > 0 && results.every((r) => r === 'pass' || r === 'waived'),
  };
}

export function compareRun(runDir) {
  const manifestPath = path.join(runDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) fail(`no manifest.json in ${runDir} — run not fired yet`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const analysisDir = path.join(runDir, 'analysis');
  fs.mkdirSync(analysisDir, { recursive: true });

  const metrics = {};
  const flags = [];

  for (const arm of ARMS) {
    const armData = manifest.arms?.[arm];
    if (!armData) fail(`manifest has no "${arm}" arm`);
    const sessions = armData.sessions || [];
    if (sessions.length === 0) fail(`${arm} arm never linked a session (hook failed or session never started)`);
    const linkEvents = sessions.filter((s) => s.source === 'startup' || s.source === 'clear');
    const segments = linkEvents.length > 0 ? linkEvents : sessions;
    if (segments.length > 1) {
      flags.push(`${arm} arm has ${segments.length} session segments (/clear or relaunch mid-run) — only the last is analyzed`);
    }
    const last = segments[segments.length - 1];
    if (!last.transcript_path || !fs.existsSync(last.transcript_path)) {
      fail(`${arm} arm transcript not found: ${last.transcript_path}`);
    }
    metrics[arm] = analyzeFile(last.transcript_path);
    metrics[arm].session_id = last.session_id;
    fs.writeFileSync(path.join(analysisDir, `metrics-${arm}.json`), JSON.stringify(metrics[arm], null, 2));
  }

  const c = metrics.control;
  const t = metrics.test;

  // parity checks
  const cModels = Object.keys(c.models).sort().join(',');
  const tModels = Object.keys(t.models).sort().join(',');
  if (cModels !== tModels) flags.push(`MODEL PARITY VIOLATION: control=[${cModels}] test=[${tModels}]`);

  // DoD tracking (dod-lite's real schema: .dod/sessions/<session_id>.json at testenv root)
  const testenvRoot = testenvRootFromRunDir(runDir);
  const dodChecksDef = readJsonSafe(path.join(runDir, 'dod-checks.json'));
  const dodSessions = {};
  for (const arm of ARMS) {
    dodSessions[arm] = readJsonSafe(path.join(testenvRoot, '.dod', 'sessions', `${metrics[arm].session_id}.json`));
  }
  let dodNote = 'no runs/run-NNN/dod-checks.json — DoD tracking not used for this run';
  if (dodChecksDef) {
    const cIds = (dodChecksDef.checks?.control || []).map((x) => x.id).sort().join(',');
    const tIds = (dodChecksDef.checks?.test || []).map((x) => x.id).sort().join(',');
    dodNote = cIds === tIds
      ? 'control/test check lists identical'
      : 'control/test check lists differ BY DESIGN (see dod-checks.json "source" per check) — not a parity violation by itself, session-comparator must explain it';
  }

  const comparison = {
    schema: 1,
    experiment: manifest.experiment,
    run: manifest.run,
    control_baseline: manifest.arms?.control?.baseline || { type: 'vanilla' },
    generated_at: new Date().toISOString(),
    totals: {
      control: summarize(c),
      test: summarize(t),
    },
    deltas_test_vs_control: {
      input_tokens_pct: pct(t.tokens.input, c.tokens.input),
      output_tokens_pct: pct(t.tokens.output, c.tokens.output),
      cache_read_pct: pct(t.tokens.cache_read, c.tokens.cache_read),
      assistant_messages_pct: pct(t.turns.assistant_messages, c.turns.assistant_messages),
      tool_calls_pct: pct(t.tool_calls_total, c.tool_calls_total),
      tool_errors: t.tool_errors - c.tool_errors,
      duration_seconds_pct: pct(t.duration.seconds, c.duration.seconds),
    },
    bias_indicators: {
      user_turns: { control: c.user_bias.real_user_turns, test: t.user_bias.real_user_turns },
      user_chars: { control: c.user_bias.user_chars_total, test: t.user_bias.user_chars_total },
      user_turn_asymmetry: t.user_bias.real_user_turns - c.user_bias.real_user_turns,
      user_chars_asymmetry: t.user_bias.user_chars_total - c.user_bias.user_chars_total,
      compactions: {
        control: c.compactions.boundaries + c.compactions.compact_summaries,
        test: t.compactions.boundaries + t.compactions.compact_summaries,
      },
    },
    parity_flags: flags,
    dod_tracking: {
      note: dodNote,
      definitions: dodChecksDef?.checks || null,
      control: summarizeDodState(dodSessions.control),
      test: summarizeDodState(dodSessions.test),
    },
  };

  fs.writeFileSync(path.join(analysisDir, 'comparison.json'), JSON.stringify(comparison, null, 2));
  return comparison;
}

function summarize(m) {
  return {
    session_id: m.session_id,
    tokens: m.tokens,
    cost_usd_reported: m.cost_usd_reported,
    assistant_messages: m.turns.assistant_messages,
    user_real_turns: m.turns.user_real,
    tool_calls_total: m.tool_calls_total,
    tool_errors: m.tool_errors,
    compaction_events: m.compactions,
    duration_seconds: m.duration.seconds,
    models: m.models,
  };
}

function printSummary(cmp) {
  const rows = [
    ['metric', 'control', 'test', 'delta'],
    ['input tokens', cmp.totals.control.tokens.input, cmp.totals.test.tokens.input, fmt(cmp.deltas_test_vs_control.input_tokens_pct)],
    ['output tokens', cmp.totals.control.tokens.output, cmp.totals.test.tokens.output, fmt(cmp.deltas_test_vs_control.output_tokens_pct)],
    ['cache read', cmp.totals.control.tokens.cache_read, cmp.totals.test.tokens.cache_read, fmt(cmp.deltas_test_vs_control.cache_read_pct)],
    ['assistant msgs', cmp.totals.control.assistant_messages, cmp.totals.test.assistant_messages, fmt(cmp.deltas_test_vs_control.assistant_messages_pct)],
    ['tool calls', cmp.totals.control.tool_calls_total, cmp.totals.test.tool_calls_total, fmt(cmp.deltas_test_vs_control.tool_calls_pct)],
    ['tool errors', cmp.totals.control.tool_errors, cmp.totals.test.tool_errors, String(cmp.deltas_test_vs_control.tool_errors)],
    ['duration (s)', cmp.totals.control.duration_seconds, cmp.totals.test.duration_seconds, fmt(cmp.deltas_test_vs_control.duration_seconds_pct)],
    ['user turns', cmp.bias_indicators.user_turns.control, cmp.bias_indicators.user_turns.test, String(cmp.bias_indicators.user_turn_asymmetry)],
    ['user chars', cmp.bias_indicators.user_chars.control, cmp.bias_indicators.user_chars.test, String(cmp.bias_indicators.user_chars_asymmetry)],
    ['compactions', cmp.bias_indicators.compactions.control, cmp.bias_indicators.compactions.test, ''],
  ];
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  for (const r of rows) {
    console.log(r.map((cell, i) => String(cell).padEnd(widths[i] + 2)).join(''));
  }
  if (cmp.parity_flags.length > 0) {
    console.log('\nPARITY FLAGS:');
    for (const f of cmp.parity_flags) console.log(`  ! ${f}`);
  }

  console.log(`\nDoD: ${cmp.dod_tracking.note}`);
  for (const arm of ['control', 'test']) {
    const s = cmp.dod_tracking[arm];
    console.log(s ? `  ${arm}: ${s.pass}/${s.total} pass, ${s.fail} fail, ${s.pending} pending, ${s.waived} waived` : `  ${arm}: no tracker found`);
  }
}

function fmt(p) {
  if (p === null || p === undefined) return 'n/a';
  return `${p > 0 ? '+' : ''}${p}%`;
}

function main() {
  const runDir = process.argv[2];
  if (!runDir) fail('usage: node compare-runs.mjs <runDir>');
  const cmp = compareRun(path.resolve(runDir));
  printSummary(cmp);
  console.log(`\n[ab-bench] full comparison: ${path.join(path.resolve(runDir), 'analysis', 'comparison.json')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
