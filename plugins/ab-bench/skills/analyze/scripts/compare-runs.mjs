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
import { digestFile, renderDigest } from './digest-transcript.mjs';
import { readCounter, counterPath } from '../../fire/scripts/turn-counter.mjs';

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
  // `error` and `pending` are NOT quality signals — they mean the dimension was
  // never graded (checker infrastructure failed, or the tier never ran). Counting
  // either as a fail would read a dod-lite defect as an arm quality difference.
  return {
    total: ids.length,
    pass: results.filter((r) => r === 'pass').length,
    fail: results.filter((r) => r === 'fail').length,
    waived: results.filter((r) => r === 'waived').length,
    pending: results.filter((r) => r === 'pending').length,
    error: results.filter((r) => r === 'error').length,
    ungraded: results.filter((r) => r === 'pending' || r === 'error').length,
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
  const digests = {};
  const flags = [];

  for (const arm of ARMS) {
    const armData = manifest.arms?.[arm];
    if (!armData) fail(`manifest has no "${arm}" arm`);
    const sessions = armData.sessions || [];
    if (sessions.length === 0) fail(`${arm} arm never linked a session (hook failed or session never started)`);
    const linkEvents = sessions.filter((s) => s.source === 'startup' || s.source === 'clear');
    let segments = linkEvents.length > 0 ? linkEvents : sessions;
    // Runs fired before the turn counter existed can carry dod-lite prompt-checker
    // subprocesses in sessions[] (they inherited the arm's settings.json and fired its
    // SessionStart hook), and the last segment is the one analyzed — so a 13-line checker
    // transcript could stand in for the arm's whole run. A counter file only exists for
    // real arm sessions, so prefer counted segments whenever any exist.
    const counted = segments.filter((s) => readCounter(runDir, s.session_id));
    if (counted.length > 0 && counted.length !== segments.length) {
      flags.push(`${arm} arm: ignored ${segments.length - counted.length} unmeasured session segment(s) (dod-lite checker subprocesses or pre-counter sessions)`);
      segments = counted;
    }
    if (segments.length > 1) {
      flags.push(`${arm} arm has ${segments.length} session segments (/clear or relaunch mid-run) — only the last is analyzed`);
    }
    const last = segments[segments.length - 1];
    if (!last.transcript_path || !fs.existsSync(last.transcript_path)) {
      fail(`${arm} arm transcript not found: ${last.transcript_path}`);
    }
    metrics[arm] = analyzeFile(last.transcript_path);
    metrics[arm].session_id = last.session_id;
    // Real turn count, emitted by the arm's own Stop hook (see fire/scripts/turn-counter.mjs).
    // `turns` = stop signals that ended a user turn; `stops_total` also counts the
    // continuations dod-lite forced by blocking a stop on failing checks.
    metrics[arm].turn_counter = readCounter(runDir, last.session_id);
    if (!metrics[arm].turn_counter) {
      flags.push(`${arm} arm has NO turn counter (${counterPath(runDir, last.session_id)}) — turn numbers below fall back to assistant-message counts, which are per tool-call round trip, not per turn`);
    }
    // Bounded, line-anchored narrative of the same transcript. Written here (not left to
    // the analyst) so it always exists, and so its session-shape warnings become parity
    // flags rather than something an analyst has to notice on their own.
    const dig = digestFile(last.transcript_path, arm);
    const digestPath = path.join(analysisDir, `digest-${arm}.md`);
    fs.writeFileSync(digestPath, renderDigest(dig), 'utf8');
    digests[arm] = {
      path: digestPath,
      jsonl_lines: dig.jsonl_lines,
      attribution: dig.attribution,
      warnings: dig.warnings,
      counts: dig.counts,
      is_checker_transcript: Boolean(dig.checker_prompt_line),
    };
    for (const w of dig.warnings) flags.push(`${arm} arm: ${w}`);

    fs.writeFileSync(path.join(analysisDir, `metrics-${arm}.json`), JSON.stringify(metrics[arm], null, 2));
  }

  const c = metrics.control;
  const t = metrics.test;

  // parity checks
  const cModels = Object.keys(c.models).sort().join(',');
  const tModels = Object.keys(t.models).sort().join(',');
  if (cModels !== tModels) flags.push(`MODEL PARITY VIOLATION: control=[${cModels}] test=[${tModels}]`);

  // The single question an A/B run exists to answer is whether the plugin changed anything.
  // If the test arm never invoked it, no delta this run can be credited to it — and that is
  // invisible in token counts, which is exactly why it gets computed rather than eyeballed.
  const testPlugins = Object.keys(digests.test?.attribution?.plugins || {});
  if (testPlugins.length === 0) {
    flags.push('TEST ARM RECORDED NO PLUGIN-ATTRIBUTED ACTIVITY — the plugin under test was never actually invoked; no delta this run is attributable to it. Verify before crediting anything to the plugin.');
  }
  const controlPlugins = Object.keys(digests.control?.attribution?.plugins || {});
  if (controlPlugins.length > 0) {
    flags.push(`CONTROL ARM used plugin(s) [${controlPlugins.join(', ')}] — the control is supposed to be the status-quo setup; this is contamination unless env.json says otherwise.`);
  }
  // A size gap this large is never a real efficiency result; it means the arms did not run
  // the same task (one crashed, restarted, or the wrong session got linked).
  const lineRatio = (a, b) => (a && b ? Math.max(a, b) / Math.min(a, b) : null);
  const ratio = lineRatio(digests.control?.jsonl_lines, digests.test?.jsonl_lines);
  if (ratio && ratio >= 5) {
    flags.push(`TRANSCRIPT SIZE ASYMMETRY ${ratio.toFixed(1)}x (control ${digests.control.jsonl_lines} lines vs test ${digests.test.jsonl_lines}) — the arms did not do comparable amounts of work. Treat every efficiency delta below as suspect until the digests explain the gap.`);
  }

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
    turn_counts: {
      control: c.turn_counter,
      test: t.turn_counter,
      note:
        c.turn_counter && t.turn_counter
          ? 'authoritative: counted by each arm\'s own Stop hook'
          : 'INCOMPLETE — at least one arm has no counter; do not compare turn totals across arms in this run',
    },
    deltas_test_vs_control: {
      turns_pct: pct(t.turn_counter?.turns, c.turn_counter?.turns),
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
    // Paths, not content: the digests are files the session-comparator MUST read. Their
    // warnings are duplicated into parity_flags so nothing depends on the agent opening them
    // — but nothing about WHY a delta happened can be answered without doing so.
    digests: {
      control: digests.control,
      test: digests.test,
      note: 'Bounded line-anchored transcript narratives. Read both in full before asserting any cause. `L<n>` anchors resolve against the source JSONL.',
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
    turns: m.turn_counter?.turns ?? null,
    stops_total: m.turn_counter?.stops_total ?? null,
    blocked_continuations: m.turn_counter?.blocked_continuations ?? null,
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
    ['turns (Stop)', cmp.totals.control.turns ?? 'n/a', cmp.totals.test.turns ?? 'n/a', fmt(cmp.deltas_test_vs_control.turns_pct)],
    ['stops total', cmp.totals.control.stops_total ?? 'n/a', cmp.totals.test.stops_total ?? 'n/a', ''],
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

  console.log(`\nTurns: ${cmp.turn_counts.note}`);
  console.log(`\nDoD: ${cmp.dod_tracking.note}`);
  for (const arm of ['control', 'test']) {
    const s = cmp.dod_tracking[arm];
    console.log(s ? `  ${arm}: ${s.pass}/${s.total} pass, ${s.fail} fail, ${s.pending} pending, ${s.error} error, ${s.waived} waived` : `  ${arm}: no tracker found`);
  }
  console.log('\nTranscript digests (READ BOTH before explaining any delta):');
  for (const arm of ['control', 'test']) {
    const d = cmp.digests?.[arm];
    if (!d) { console.log(`  ${arm}: none`); continue; }
    const plugins = Object.keys(d.attribution?.plugins || {});
    console.log(`  ${arm}: ${d.path}`);
    console.log(`    ${d.jsonl_lines} JSONL lines | ${d.counts.user_real} user turns | ${d.counts.tool_calls} tool calls | ${d.counts.tool_errors} errors | plugins: ${plugins.length ? plugins.join(', ') : 'NONE'}`);
  }

  const ungraded = ['control', 'test'].map((a) => cmp.dod_tracking[a]?.ungraded || 0);
  if (ungraded.some((n) => n > 0)) {
    console.log('  ! ungraded checks present (pending/error) — those dimensions produced NO data this run; treat as a harness defect, not a result.');
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
