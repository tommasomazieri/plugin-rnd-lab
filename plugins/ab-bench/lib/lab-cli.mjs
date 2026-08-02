#!/usr/bin/env node
/**
 * lab-cli.mjs — the command surface /ab-bench:plan and /ab-bench:analyze drive lab/ through.
 *
 * Everything here is deliberately small and deterministic. Judgement (what to hypothesise,
 * which pillar to prioritise, whether a finding is real) belongs to the skill and the
 * human; bookkeeping belongs here, so it cannot drift or be quietly skipped.
 *
 * Usage:
 *   node lab-cli.mjs init            <testenvRoot>
 *   node lab-cli.mjs objective       <testenvRoot> --priority <pillar> [--guard pillar=pct]... [--why "..."]
 *   node lab-cli.mjs add             <testenvRoot> --statement "..." --pillars a,b [--magnitude 15]
 *                                    [--confidence 0.6] [--cost 2] [--why "..."] [--run run-NNN]
 *   node lab-cli.mjs rank            <testenvRoot> [--json]
 *   node lab-cli.mjs classify        <testenvRoot> --deltas '<json>' [--contaminated]
 *   node lab-cli.mjs resolve         <testenvRoot> --id H-001 --run run-NNN --outcome <o> [--note "..."]
 *   node lab-cli.mjs finding         <testenvRoot> --text "..." --run run-NNN [--hypothesis H-001]
 *   node lab-cli.mjs regression      <testenvRoot> --run run-NNN --arms '<json>' [--rubric-version v2]
 *   node lab-cli.mjs status          <testenvRoot>
 */

import {
  PILLARS,
  ensureLab,
  declarePriority,
  readObjective,
  addHypothesis,
  rankHypotheses,
  classifyOutcome,
  resolveHypothesis,
  appendFinding,
  recordRegressionPoint,
  regressionSeries,
  readHypotheses,
} from './lab.mjs';

function fail(msg) {
  console.error(`[ab-bench:lab] ERROR: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const cmd = argv[2];
  const testenvRoot = argv[3];
  const opts = {};
  const guards = {};
  for (let i = 4; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    if (key === 'contaminated' || key === 'json') {
      opts[key] = true;
      continue;
    }
    const val = argv[++i];
    if (key === 'guard') {
      const [p, pctRaw] = String(val).split('=');
      if (!PILLARS.includes(p)) fail(`--guard names unknown pillar "${p}"`);
      guards[p] = { max_regression_pct: Number(pctRaw) };
      continue;
    }
    opts[key] = val;
  }
  if (Object.keys(guards).length) opts.guards = guards;
  return { cmd, testenvRoot, opts };
}

function requireRoot(testenvRoot) {
  if (!testenvRoot || testenvRoot.startsWith('--')) fail('missing <testenvRoot>');
  return testenvRoot;
}

function parseJsonOpt(raw, what) {
  try {
    return JSON.parse(raw);
  } catch (e) {
    fail(`--${what} is not valid JSON: ${e.message}`);
  }
}

const COMMANDS = {
  init(root) {
    console.log(`[ab-bench:lab] lab/ ready at ${ensureLab(root)}`);
  },

  objective(root, o) {
    ensureLab(root);
    if (!o.priority) {
      const obj = readObjective(root);
      if (!obj.priority) fail('no priority declared yet — pass --priority <pillar>');
      console.log(JSON.stringify(obj, null, 2));
      return;
    }
    const obj = declarePriority(root, { priority: o.priority, guards: o.guards, rationale: o.why });
    console.log(`[ab-bench:lab] priority: ${obj.priority}`);
    for (const [p, g] of Object.entries(obj.guards)) console.log(`  guard ${p}: no worse than ${g.max_regression_pct}%`);
    if (obj.prior_priorities.length) {
      const prev = obj.prior_priorities[obj.prior_priorities.length - 1];
      console.log(`  (shifted from "${prev.priority}" — that shift is now part of the record)`);
    }
  },

  add(root, o) {
    ensureLab(root);
    const h = addHypothesis(root, {
      statement: o.statement,
      rationale: o.why,
      target_pillars: String(o.pillars || '').split(',').map((s) => s.trim()).filter(Boolean),
      predicted_magnitude_pct: o.magnitude === undefined ? undefined : Number(o.magnitude),
      confidence: o.confidence === undefined ? undefined : Number(o.confidence),
      est_cost: o.cost === undefined ? undefined : Number(o.cost),
      origin_run: o.run,
    });
    console.log(`[ab-bench:lab] ${h.id}: ${h.statement}`);
  },

  rank(root, o) {
    const { objective, ranked } = rankHypotheses(root);
    if (o.json) {
      console.log(JSON.stringify({ objective, ranked }, null, 2));
      return;
    }
    if (!objective.priority) {
      console.log('[ab-bench:lab] NO PRIORITY PILLAR DECLARED — ranking is arbitrary until one is.');
      console.log('  declare one: lab-cli.mjs objective <testenvRoot> --priority <pillar> --why "..."');
    } else {
      console.log(`[ab-bench:lab] priority: ${objective.priority} (declared ${String(objective.declared_at).slice(0, 10)})`);
    }
    if (ranked.length === 0) {
      console.log('  no open hypotheses. The next run has nothing pre-registered to test — say so before planning one.');
      return;
    }
    console.log('\n  score  on-prio  id      pillars                      statement');
    for (const h of ranked) {
      console.log(
        `  ${String(h.score).padStart(5)}  ${h.on_priority ? '  yes  ' : '  no   '}  ${h.id.padEnd(6)}  ${h.target_pillars.join(',').padEnd(28)}  ${h.statement}`,
      );
    }
    console.log('\n  score = predicted_magnitude_pct x confidence / est_cost. Hypotheses that cannot move');
    console.log('  the priority pillar rank below ones that can, whatever their score.');
  },

  classify(root, o) {
    if (!o.deltas) fail('--deltas <json> is required, e.g. \'{"quality":4,"input_tokens":-12}\'');
    const result = classifyOutcome({
      objective: readObjective(root),
      deltas: parseJsonOpt(o.deltas, 'deltas'),
      contaminated: Boolean(o.contaminated),
    });
    console.log(JSON.stringify(result, null, 2));
  },

  resolve(root, o) {
    if (!o.id || !o.outcome) fail('--id and --outcome are required');
    const h = resolveHypothesis(root, o.id, { run: o.run, outcome: o.outcome, note: o.note });
    console.log(`[ab-bench:lab] ${h.id} -> ${h.outcome}${h.resolving_run ? ` (${h.resolving_run})` : ''}`);
  },

  finding(root, o) {
    if (!o.text || !o.run) fail('--text and --run are required');
    process.stdout.write(`[ab-bench:lab] recorded: ${appendFinding(root, { text: o.text, run: o.run, hypothesis: o.hypothesis })}`);
  },

  regression(root, o) {
    if (!o.run || !o.arms) fail('--run and --arms <json> are required');
    const doc = recordRegressionPoint(root, {
      run: o.run,
      arms: parseJsonOpt(o.arms, 'arms'),
      rubric_version: o['rubric-version'] || null,
    });
    console.log(`[ab-bench:lab] regression point recorded for ${o.run} (${doc.points.length} point(s) total)`);
    const series = regressionSeries(root);
    if (series.length > 1) {
      console.log(`  NOTE: ${series.length} separate series — the rubric version changed, so these are NOT one curve.`);
    }
  },

  status(root) {
    const obj = readObjective(root);
    const { hypotheses } = readHypotheses(root);
    const by = (s) => hypotheses.filter((h) => h.status === s).length;
    console.log(`[ab-bench:lab] priority: ${obj.priority || '(none declared)'}`);
    console.log(`  hypotheses: ${hypotheses.length} total — ${by('open')} open, ${by('confirmed')} confirmed, ${by('won-at-a-cost')} won-at-a-cost, ${by('refuted')} refuted, ${by('inconclusive')} inconclusive`);
    const series = regressionSeries(root);
    const points = series.reduce((n, s) => n + s.points.length, 0);
    console.log(`  regression points: ${points} across ${series.length} rubric series`);
    if (obj.prior_priorities.length) {
      console.log(`  priority shifts: ${[...obj.prior_priorities.map((p) => p.priority), obj.priority].join(' -> ')}`);
    }
  },
};

function main() {
  const { cmd, testenvRoot, opts } = parseArgs(process.argv);
  const fn = COMMANDS[cmd];
  if (!fn) fail(`unknown command "${cmd || ''}". Expected one of: ${Object.keys(COMMANDS).join(', ')}`);
  try {
    fn(requireRoot(testenvRoot), opts);
  } catch (e) {
    fail(e.message);
  }
}

main();
