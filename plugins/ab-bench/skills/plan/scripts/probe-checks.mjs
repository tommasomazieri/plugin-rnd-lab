#!/usr/bin/env node
/**
 * probe-checks.mjs — prove every DoD check actually discriminates, before a run is fired.
 *
 * Usage:
 *   node probe-checks.mjs <testenvRoot> <runDir> [--arm control|test] [--ids a,b,c] [--json]
 *
 * The problem this exists for: /ab-bench:plan AUTHORS check code, and that code's first
 * ever execution used to be inside a live arm. A bug there became `fail` (blocks the arm,
 * contaminates the run) or `error` (never blocks, silently ungraded) — and neither showed
 * up until analyze, a whole run later.
 *
 * The quieter failure is the worse one. A check that passes against an untouched seed
 * passes for BOTH arms no matter what they did. It is green, it is meaningless, and
 * nothing about the report says so.
 *
 * So every check declares what it should report against a pristine seed workspace
 * (`seed_expectation`, default `fail` — it asserts work that hasn't happened yet; `pass`
 * marks a deliberate regression guard). This runs them all against exactly that and
 * refuses the run if reality disagrees:
 *
 *   error                -> the check is broken; it would have graded nothing
 *   result != declaration -> the check cannot discriminate, or is inverted
 *
 * Cost is real and deliberate: one seed clone plus N executions, and prompt checks are N
 * genuine `claude -p` calls. That is the price of knowing your instrument works before
 * you spend a run on it.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  loadCheckDefs,
  seedExpectation,
  runScriptCheck,
  runPromptCheck,
  runWithConcurrency,
  loadSystemPrompt,
  validateCheckerModel,
} from '../../../../dod-lite/hooks/dod-check.mjs';
import { loadRunners } from '../../../../dod-lite/hooks/lib.mjs';

const PROBE_CONCURRENCY = 4;

function fail(msg) {
  console.error(`[probe-checks] ERROR: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { testenvRoot: null, runDir: null, arm: null, ids: null, json: false };
  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--arm') args.arm = argv[++i];
    else if (a === '--ids') args.ids = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--json') args.json = true;
    else positional.push(a);
  }
  if (positional.length < 2) fail('usage: node probe-checks.mjs <testenvRoot> <runDir> [--arm control|test] [--ids a,b,c] [--json]');
  args.testenvRoot = path.resolve(positional[0]);
  args.runDir = path.resolve(positional[1]);
  return args;
}

/** Which check ids to probe: explicit, or the union of both arms from dod-checks.json. */
function resolveIds(runDir, arm, explicit) {
  if (explicit) return explicit;
  const p = path.join(runDir, 'dod-checks.json');
  if (!fs.existsSync(p)) {
    fail(`no dod-checks.json in ${runDir} and no --ids given — nothing to probe. (A run with no DoD checks is legitimate; just skip this step.)`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    fail(`dod-checks.json is not valid JSON: ${e.message}`);
  }
  const arms = arm ? [arm] : ['control', 'test'];
  const ids = new Set();
  for (const a of arms) for (const c of parsed.checks?.[a] || []) ids.add(c.id);
  return [...ids];
}

/**
 * A throwaway copy of seed/ with the real checks alongside it. Checks resolve .dod as a
 * direct child of cwd, so the probe needs its own — copied, not junctioned, so a
 * misbehaving check cannot reach the shared checks folder it is being graded from.
 */
function makeProbeWorkspace(testenvRoot) {
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-bench-probe-'));
  const seed = path.join(testenvRoot, 'seed');
  if (fs.existsSync(seed) && fs.readdirSync(seed).length > 0) {
    fs.cpSync(seed, probe, { recursive: true });
  }
  const checks = path.join(testenvRoot, '.dod', 'checks');
  if (!fs.existsSync(checks)) fail(`no checks folder at ${checks}`);
  fs.mkdirSync(path.join(probe, '.dod'), { recursive: true });
  fs.cpSync(checks, path.join(probe, '.dod', 'checks'), { recursive: true });
  return probe;
}

/**
 * A crashing check exits non-zero, which is indistinguishable from an honest "not done"
 * by exit code alone — so a check with a syntax error looks exactly like a check that
 * correctly reported failure, and used to pass this gate. These are the ways the common
 * runners announce that they never got as far as evaluating anything.
 */
const CRASH_SIGNATURES = [
  /\bSyntaxError\b/,
  /\bReferenceError\b/,
  /Cannot find module/,
  /Cannot find package/,
  /ERR_MODULE_NOT_FOUND/,
  /^\s*Traceback \(most recent call last\)/m,
  /\bModuleNotFoundError\b/,
  /\bImportError\b/,
  /\bIndentationError\b/,
  /ParserError/,
  /is not recognized as an internal or external command/,
  /command not found/,
  /\bLoadError\b/,
];

function looksLikeCrash(output) {
  return CRASH_SIGNATURES.some((re) => re.test(output || ''));
}

function verdictFor(result, expected, def) {
  if (def && def.type === 'missing') {
    return { ok: false, why: 'MISSING — referenced in dod-checks.json but no such file in .dod/checks/. It would be recorded as a failure every turn for reasons that have nothing to do with the arm.' };
  }
  if (result.result === 'error') {
    return { ok: false, why: `BROKEN — the check errored and graded nothing: ${result.output.split('\n')[0]}` };
  }
  if (looksLikeCrash(result.output)) {
    return {
      ok: false,
      why: `CRASHED — it exited non-zero because it broke, not because the criterion failed: ${String(result.output).split('\n').find((l) => l.trim()) || ''}`.trim(),
    };
  }
  if (result.result !== expected) {
    return expected === 'fail'
      ? {
        ok: false,
        why: 'CANNOT DISCRIMINATE — it already passes on an untouched seed, so it will pass for both arms no matter what they do. Tighten it, or declare `seed_expectation: pass` if it is genuinely a regression guard.',
      }
      : {
        ok: false,
        why: 'DECLARED A REGRESSION GUARD but fails on an untouched seed — the seed is already broken, or the declaration is wrong.',
      };
  }
  return { ok: true, why: '' };
}

async function main() {
  const { testenvRoot, runDir, arm, ids: explicitIds, json } = parseArgs(process.argv);
  const ids = resolveIds(runDir, arm, explicitIds);
  if (ids.length === 0) {
    console.log('[probe-checks] no checks to probe — nothing to verify.');
    return;
  }

  const probe = makeProbeWorkspace(testenvRoot);
  const defs = await loadCheckDefs(probe, ids);
  const runners = await loadRunners(probe);
  const systemPrompt = await loadSystemPrompt();
  const rows = [];

  try {
    // Model ids are validated up front so a typo costs nothing instead of N subprocesses.
    for (const id of ids) {
      const bad = validateCheckerModel(defs[id]?.meta?.model);
      if (!bad.ok) rows.push({ id, tier: defs[id].type, expected: seedExpectation(defs[id]), actual: 'error', ok: false, why: `invalid \`model:\` — ${bad.reason}` });
    }
    const preflightFailed = new Set(rows.map((r) => r.id));

    const scriptIds = ids.filter((id) => !preflightFailed.has(id) && ['script', 'missing', 'ambiguous'].includes(defs[id].type));
    const promptIds = ids.filter((id) => !preflightFailed.has(id) && defs[id].type === 'prompt');
    const humanIds = ids.filter((id) => !preflightFailed.has(id) && defs[id].type === 'human');

    for (const id of scriptIds) {
      const expected = seedExpectation(defs[id]);
      const r = await runScriptCheck(probe, runners, id, defs[id]);
      rows.push({ id, tier: defs[id].type, expected, actual: r.result, output: r.output, ...verdictFor(r, expected, defs[id]) });
    }

    await runWithConcurrency(promptIds, PROBE_CONCURRENCY, async (id) => {
      const expected = seedExpectation(defs[id]);
      const r = await runPromptCheck(probe, id, defs[id], systemPrompt, 180_000, 600_000);
      const v = verdictFor(r, expected, defs[id]);
      // A grader that reaches the right verdict while citing nothing reached it by luck.
      if (v.ok && r.result === 'pass' && r.grounded === false) {
        rows.push({ id, tier: 'prompt', expected, actual: r.result, output: r.output, ok: false, why: 'UNGROUNDED — passed while citing no evidence. Rewrite the question so it is answerable from files.' });
        return;
      }
      rows.push({ id, tier: 'prompt', expected, actual: r.result, output: r.output, ...v });
    });

    // A human check has no seed verdict to probe — only its shape can be checked here.
    for (const id of humanIds) {
      const hasQuestion = Boolean((defs[id].body || '').trim());
      rows.push({
        id,
        tier: 'human',
        expected: 'n/a',
        actual: 'n/a',
        ok: hasQuestion,
        why: hasQuestion ? '' : 'EMPTY — a human check with no question text cannot be answered, and will block the arm forever.',
      });
    }
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
  }

  rows.sort((a, b) => a.id.localeCompare(b.id));
  const failures = rows.filter((r) => !r.ok);

  if (json) {
    console.log(JSON.stringify({ probed: rows.length, failures: failures.length, rows }, null, 2));
  } else {
    console.log(`[probe-checks] probed ${rows.length} check(s) against a pristine seed:\n`);
    const w = Math.max(6, ...rows.map((r) => r.id.length));
    console.log(`  ${'check'.padEnd(w)}  tier    expect  actual  status`);
    for (const r of rows) {
      console.log(`  ${r.id.padEnd(w)}  ${String(r.tier).padEnd(6)}  ${String(r.expected).padEnd(6)}  ${String(r.actual).padEnd(6)}  ${r.ok ? 'OK' : 'REJECTED'}`);
    }
    if (failures.length > 0) {
      console.log('');
      for (const r of failures) console.log(`  - "${r.id}": ${r.why}`);
    }
  }

  if (failures.length > 0) {
    console.error(`\n[probe-checks] ERROR: ${failures.length} of ${rows.length} check(s) rejected. Fix them before firing — a check that cannot discriminate makes the run's DoD data worthless.`);
    process.exit(1);
  }
  if (!json) console.log(`\n[probe-checks] all ${rows.length} check(s) behave as declared against the seed.`);
}

main().catch((err) => {
  console.error(`[probe-checks] ERROR: ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});
