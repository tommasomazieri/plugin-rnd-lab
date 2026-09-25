#!/usr/bin/env node
/**
 * build-paper.mjs — assemble lab/paper.md from the record.
 *
 * The paper is GENERATED, never hand-maintained. Anything asserted in it must trace to a
 * run artifact, because the whole point is an account of how the subject got to where it
 * is that cannot drift away from what actually happened. If a claim has no citation it
 * does not belong here — it belongs in a hypothesis, waiting to be tested.
 *
 * Usage: node build-paper.mjs <testenvRoot> [--out <path>]
 */

import fs from 'node:fs';
import path from 'node:path';

import { PILLARS, BETTER_DIRECTION, readObjective, readHypotheses, regressionSeries, labDir } from '../../../lib/lab.mjs';

function fail(msg) {
  console.error(`[optimizer:paper] ERROR: ${msg}`);
  process.exit(1);
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/** Every analysed run, oldest first, with whatever it managed to record. */
function collectRuns(testenvRoot) {
  const runsDir = path.join(testenvRoot, 'runs');
  if (!fs.existsSync(runsDir)) return [];
  return fs
    .readdirSync(runsDir)
    .filter((n) => /^run-\d+$/.test(n))
    .sort()
    .map((name) => {
      const dir = path.join(runsDir, name);
      const comparison = readJsonSafe(path.join(dir, 'analysis', 'comparison.json'));
      const manifest = readJsonSafe(path.join(dir, 'manifest.json'));
      const reportPath = path.join(dir, 'analysis', 'report.md');
      return {
        name,
        dir,
        comparison,
        manifest,
        report: fs.existsSync(reportPath) ? path.relative(testenvRoot, reportPath).replace(/\\/g, '/') : null,
        task: fs.existsSync(path.join(dir, 'task.md'))
          ? fs.readFileSync(path.join(dir, 'task.md'), 'utf8').trim().split('\n')[0].slice(0, 120)
          : null,
      };
    });
}

function fmtPct(v) {
  if (v === null || v === undefined) return '—';
  return `${v > 0 ? '+' : ''}${v}%`;
}

function pinLine(pins, arm) {
  const list = pins?.[arm];
  if (!Array.isArray(list) || list.length === 0) return 'vanilla';
  return list
    .map((p) => `${p.id}@${p.requested_ref || (p.dirty ? `wt-${String(p.hash || '').slice(0, 8)}` : String(p.sha || '').slice(0, 8) || p.kind)}${p.dirty ? '*' : ''}`)
    .join(', ');
}

function section(title, body) {
  return `\n## ${title}\n\n${body}\n`;
}

function build(testenvRoot) {
  const objective = readObjective(testenvRoot);
  const { hypotheses } = readHypotheses(testenvRoot);
  const runs = collectRuns(testenvRoot);
  const series = regressionSeries(testenvRoot);
  const findingsPath = path.join(labDir(testenvRoot), 'findings.md');
  const findings = fs.existsSync(findingsPath)
    ? fs.readFileSync(findingsPath, 'utf8').split('\n').filter((l) => l.startsWith('- '))
    : [];

  const analysed = runs.filter((r) => r.comparison);
  const out = [];

  out.push(`# ${path.basename(testenvRoot)} — development record\n`);
  out.push(
    `_Generated ${new Date().toISOString().slice(0, 10)} from ${runs.length} run(s) (${analysed.length} analysed), ` +
      `${hypotheses.length} hypothesis/es, and ${series.reduce((n, s) => n + s.points.length, 0)} regression point(s). ` +
      'Every claim below traces to a run artifact; nothing here is written by hand._\n',
  );

  // ---- what is being optimised, and how that changed
  {
    const lines = [];
    if (!objective.priority) {
      lines.push('No priority pillar has been declared yet, so there is no gradient and no defensible "what next".');
    } else {
      lines.push(`**Current priority: \`${objective.priority}\`** (${BETTER_DIRECTION[objective.priority] === 'up' ? 'higher is better' : 'lower is better'}), declared ${String(objective.declared_at).slice(0, 10)}.`);
      if (objective.rationale) lines.push(`\n> ${objective.rationale}`);
      const guards = Object.entries(objective.guards || {});
      if (guards.length) {
        lines.push('\nGuards on the other pillars — a change that improves the priority while breaching one of these is recorded as *won-at-a-cost*, not as a win:\n');
        lines.push('| pillar | max tolerated regression |');
        lines.push('|---|---|');
        for (const [p, g] of guards) lines.push(`| \`${p}\` | ${g.max_regression_pct}% |`);
      }
    }
    if (objective.prior_priorities?.length) {
      lines.push('\n### How the objective moved\n');
      lines.push('The sequence of priority shifts, and what forced each, is the spine of this record:\n');
      for (const p of objective.prior_priorities) {
        lines.push(`- \`${p.priority}\` (${String(p.declared_at).slice(0, 10)} → ${String(p.retired_at).slice(0, 10)})${p.rationale ? ` — ${p.rationale}` : ''}`);
      }
      lines.push(`- \`${objective.priority}\` (${String(objective.declared_at).slice(0, 10)} → current)${objective.rationale ? ` — ${objective.rationale}` : ''}`);
    }
    out.push(section('What is being optimised', lines.join('\n')));
  }

  // ---- the only real curve
  {
    const lines = [];
    if (series.length === 0) {
      lines.push(
        'No regression runs yet. **Nothing in this record is a trajectory.** Every run below measures a ' +
          'delta between two arms on its own task; those deltas are not on a common scale and must not be ' +
          'read as progress over time. Run the frozen canonical task to start an actual curve.',
      );
    } else {
      lines.push(
        'These are the only absolute, comparable measurements here: the same frozen task, re-run against ' +
          'the same rubric. Everything else in this document is a per-run delta.\n',
      );
      for (const s of series) {
        lines.push(`\n**Rubric ${s.rubric_version || '(unversioned)'}**\n`);
        lines.push(`| run | ${PILLARS.map((p) => `\`${p}\``).join(' | ')} |`);
        lines.push(`|---|${PILLARS.map(() => '---').join('|')}|`);
        for (const pt of s.points) {
          const a = pt.arms?.test || pt.arms || {};
          lines.push(`| ${pt.run} | ${PILLARS.map((p) => (a[p] ?? '—')).join(' | ')} |`);
        }
      }
      if (series.length > 1) {
        lines.push(
          '\n> **These series are not one curve.** The rubric version changed between them, so quality ' +
            'scores either side are on different scales. Plotting them as a single line would invent a trend.',
        );
      }
    }
    out.push(section('The trajectory', lines.join('\n')));
  }

  // ---- what we know
  {
    const body = findings.length
      ? `${findings.join('\n')}\n`
      : '_Nothing confirmed yet. Findings accumulate as hypotheses resolve._';
    out.push(section('What is established', body));
  }

  // ---- hypotheses
  {
    const lines = [];
    const resolved = hypotheses.filter((h) => h.resolved_at);
    const open = hypotheses.filter((h) => !h.resolved_at);
    if (resolved.length) {
      lines.push('### Tested\n');
      lines.push('| id | outcome | run | pillars | hypothesis |');
      lines.push('|---|---|---|---|---|');
      for (const h of resolved) {
        lines.push(`| ${h.id} | **${h.outcome}** | ${h.resolving_run || '—'} | ${h.target_pillars.join(', ')} | ${h.statement} |`);
      }
      const notes = resolved.filter((h) => h.outcome_note);
      if (notes.length) {
        lines.push('\n');
        for (const h of notes) lines.push(`- **${h.id}** (${h.outcome}): ${h.outcome_note}`);
      }
    }
    if (open.length) {
      lines.push('\n### Open\n');
      lines.push('| id | pillars | predicted | confidence | cost | hypothesis |');
      lines.push('|---|---|---|---|---|---|');
      for (const h of open) {
        lines.push(`| ${h.id} | ${h.target_pillars.join(', ')} | ${h.predicted_magnitude_pct}% | ${h.confidence} | ${h.est_cost} | ${h.statement} |`);
      }
    }
    if (!resolved.length && !open.length) lines.push('_No hypotheses recorded._');
    out.push(section('Hypotheses', lines.join('\n')));
  }

  // ---- the runs
  {
    const lines = [];
    if (analysed.length === 0) {
      lines.push('_No analysed runs yet._');
    } else {
      lines.push('Each row is a delta between that run\'s two arms, on that run\'s own task. **Rows are not comparable to each other.**\n');
      lines.push('| run | control pins | test pins | unique tokens | api calls | turns | autonomy | list cost | report |');
      lines.push('|---|---|---|---|---|---|---|---|---|');
      for (const r of analysed) {
        const d = r.comparison.pillars?.deltas_test_vs_control || {};
        const pins = r.comparison.pins || {};
        lines.push(
          `| ${r.name} | ${pinLine(pins, 'control')} | ${pinLine(pins, 'test')} | ${fmtPct(d.unique_tokens_pct)} | ` +
            `${fmtPct(d.api_calls_pct)} | ${fmtPct(d.turns_pct)} | ${d.autonomy_hitl_elective ?? '—'} | ` +
            `${fmtPct(r.comparison.cost?.delta_pct)} | ${r.report ? `[report](${r.report})` : '—'} |`,
        );
      }
      if (analysed.some((r) => !('api_calls_pct' in (r.comparison.pillars?.deltas_test_vs_control || {})))) {
        lines.push('\nA `—` under unique tokens / api calls: that run was analysed before optimizer 0.9.0. Re-run `compare-runs.mjs` on it to fill them from its transcripts.');
      }
      lines.push('\n`*` on a pin means it was snapshotted from a dirty working tree: replayable from its cached snapshot, but not reconstructible from git history alone.');
      const unanalysed = runs.filter((r) => !r.comparison);
      if (unanalysed.length) {
        lines.push(`\n> ${unanalysed.length} run(s) fired but never analysed (${unanalysed.map((r) => r.name).join(', ')}) — they contribute nothing to this record.`);
      }
    }
    out.push(section('Runs', lines.join('\n')));
  }

  return `${out.join('')}\n`;
}

function main() {
  const testenvRoot = path.resolve(process.argv[2] || '');
  if (!process.argv[2] || !fs.existsSync(testenvRoot)) fail('usage: node build-paper.mjs <testenvRoot> [--out <path>]');
  const outIdx = process.argv.indexOf('--out');
  const outPath = outIdx !== -1 ? path.resolve(process.argv[outIdx + 1]) : path.join(labDir(testenvRoot), 'paper.md');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, build(testenvRoot));
  console.log(`[optimizer:paper] wrote ${outPath}`);
}

main();
