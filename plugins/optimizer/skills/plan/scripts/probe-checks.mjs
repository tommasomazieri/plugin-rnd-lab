#!/usr/bin/env node
/**
 * probe-checks.mjs — prove every DoD check actually works, in BOTH directions, before a run
 * is fired.
 *
 * Usage:
 *   node probe-checks.mjs <testenvRoot> <runDir> [--arm control|test] [--ids a,b,c]
 *                         [--fixtures <dir>] [--json]
 *
 * The problem this exists for: /optimizer:plan AUTHORS check code, and that code's first ever
 * execution used to be inside a live arm. A bug there became `fail` (blocks the arm,
 * contaminates the run) or `error` (never blocks, silently ungraded) — and neither showed up
 * until analyze, a whole run later.
 *
 * ── The negative side (original behaviour) ────────────────────────────────────────────────
 * A check that PASSES against an untouched seed passes for BOTH arms no matter what they did.
 * It is green, it is meaningless, and nothing about the report says so. So every check declares
 * what it should report against a pristine seed (`seed_expectation`, default `fail`), and this
 * runs them all against exactly that.
 *
 * ── The positive side (added after run-007) ───────────────────────────────────────────────
 * The seed probe proves a check can FAIL. It cannot prove a check can ever PASS, and a check
 * that fails on everything is worse than no check: it looks like a strict criterion, it grades
 * both arms identically, and it reads as a real result.
 *
 * run-007 shipped three such checks. `status-rules-applied` failed BOTH arms on the run's
 * central trap while both decks in fact carried all seven correct statuses — it was reading a
 * "Lead's own view" column as the deck's own assertion. `escalation-cap-honoured` failed the
 * control arm, which had escalated exactly the right four items, because it read the arm's
 * *working* slide (the one showing which items were rejected) and counted the rejects as
 * escalations. `movement-explained` failed on its own inability to open a .pptx.
 *
 * Hand-built fixtures existed for that run and caught none of it, because they modelled the
 * artifact shape the author imagined rather than the shapes the arms produce. One correct
 * answer, two renderings, one check, both misread.
 *
 * So: fixtures are no longer advisory and no longer hand-verified. At least one `pass*` fixture
 * is REQUIRED, every check must PASS on every `pass*` fixture and FAIL on every `fail*` one,
 * and there is no flag to skip it.
 *
 * Cost is real and deliberate: one seed clone, one workspace per fixture, and N×(1+fixtures)
 * executions — prompt checks being that many genuine `claude -p` calls. That is the price of
 * knowing your instrument works before you spend a run on it, and it is two orders of magnitude
 * cheaper than one contaminated run.
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

const DEFAULT_PROMPT_TIMEOUT_MS = 180_000;
const PROBE_HARD_CAP_MS = 600_000;

/**
 * The probe must give a prompt check the SAME budget the run will give it.
 *
 * This was hardcoded at 180s while `.dod/config.json` carried the timeout the arms
 * actually run under. An experiment that had raised `prompt_timeout_ms` — because it
 * measured a grader needing longer, which is the only reason anyone raises it — got a
 * correctly-configured check killed at 180s and rejected as BROKEN. Since
 * `/optimizer:fire` re-runs this same probe and refuses to launch on a rejection, that
 * mismatch does not merely warn: it blocks the run, and it does so more often the
 * closer the grader sits to 180s, so it presents as flaky rather than as a bug.
 *
 * The failure mode is already in one experiment's ledger from the other direction:
 * a 180s default killed a prompt check mid-run and produced no verdict in either arm.
 * The timeout is a property of the experiment, not of the probe.
 */
function promptTimeoutMs(testenvRoot) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(testenvRoot, '.dod', 'config.json'), 'utf8'));
    if (Number.isFinite(cfg.prompt_timeout_ms) && cfg.prompt_timeout_ms > 0) {
      return Math.min(cfg.prompt_timeout_ms, PROBE_HARD_CAP_MS);
    }
  } catch {
    // No config, or unreadable — the default is the documented behaviour.
  }
  return DEFAULT_PROMPT_TIMEOUT_MS;
}

function fail(msg) {
  console.error(`[probe-checks] ERROR: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { testenvRoot: null, runDir: null, arm: null, ids: null, fixtures: null, json: false };
  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--arm') args.arm = argv[++i];
    else if (a === '--ids') args.ids = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--fixtures') args.fixtures = argv[++i];
    else if (a === '--json') args.json = true;
    else positional.push(a);
  }
  if (positional.length < 2) fail('usage: node probe-checks.mjs <testenvRoot> <runDir> [--arm control|test] [--ids a,b,c] [--fixtures <dir>] [--json]');
  args.testenvRoot = path.resolve(positional[0]);
  args.runDir = path.resolve(positional[1]);
  args.fixtures = args.fixtures ? path.resolve(args.fixtures) : path.join(args.runDir, 'fixtures');
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
 * `fixtures/pass`, `fixtures/pass-alt`, `fixtures/fail`, `fixtures/fail-anything` — matched by
 * prefix so a run can add as many renderings of "correct" as its criteria need.
 *
 * Prefix rather than an index file on purpose: an index is one more thing that can say a
 * fixture exists when it does not.
 */
function discoverFixtures(fixturesDir) {
  const found = { pass: [], fail: [] };
  if (!fs.existsSync(fixturesDir)) return found;
  for (const entry of fs.readdirSync(fixturesDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const kind = /^pass(-|$)/.test(entry.name) ? 'pass' : /^fail(-|$)/.test(entry.name) ? 'fail' : null;
    if (!kind) continue;
    found[kind].push({ name: entry.name, dir: path.join(fixturesDir, entry.name), scope: fixtureScope(path.join(fixturesDir, entry.name)) });
  }
  return found;
}

/**
 * An optional `expect.json` in a fixture dir naming which checks that fixture is ABOUT:
 *
 *     { "checks": ["status-rules-applied", "escalation-cap-honoured"] }
 *
 * Scoping matters in different directions on each side, because the two sides guard different
 * things.
 *
 * A `pass*` fixture is strict by default — every check must pass on correct work, and needing
 * an exemption is a claim about the fixture that should be written down. Declare `checks` only
 * when the fixture genuinely cannot satisfy something (no rendered images to score, say).
 *
 * A `fail*` fixture is informational by default, because "wrong" is per-criterion. run-007's
 * fail fixture is semantically wrong on all four traps and still a perfectly valid .pptx, so
 * `deck-file-valid` passes on it and should. Requiring every check to fail on every fail
 * fixture would force one fixture per check, which is busywork that buys nothing: the seed
 * probe already rejects any check that can never fail (`CANNOT DISCRIMINATE`). Declare `checks`
 * on a fail fixture to make it a hard gate for exactly the checks it was built to trip.
 */
function fixtureScope(dir) {
  const p = path.join(dir, 'expect.json');
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    const list = Array.isArray(parsed.checks) ? parsed.checks.filter((s) => typeof s === 'string') : null;
    return list && list.length > 0 ? new Set(list) : null;
  } catch (e) {
    fail(`${p} is not valid JSON: ${e.message}`);
  }
  return null;
}

/**
 * A throwaway workspace with the real checks alongside the content under test. Checks resolve
 * .dod as a direct child of cwd, so each workspace needs its own — copied, not junctioned, so a
 * misbehaving check cannot reach the shared checks folder it is being graded from.
 */
function makeWorkspace(testenvRoot, contentDir, tag) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `optimizer-probe-${tag}-`));
  if (contentDir && fs.existsSync(contentDir) && fs.readdirSync(contentDir).length > 0) {
    fs.cpSync(contentDir, ws, { recursive: true });
  }
  const checks = path.join(testenvRoot, '.dod', 'checks');
  if (!fs.existsSync(checks)) fail(`no checks folder at ${checks}`);
  fs.mkdirSync(path.join(ws, '.dod'), { recursive: true });
  fs.cpSync(checks, path.join(ws, '.dod', 'checks'), { recursive: true });
  return ws;
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

/**
 * Run every applicable check against one workspace. Returns a map id -> {result, output}.
 * Shared by the seed probe and every fixture run so a check cannot behave differently
 * depending on which side of the gate is calling it.
 */
async function runAgainst(workspace, ids, defsByWorkspace, systemPrompt, promptTimeout) {
  const defs = await loadCheckDefs(workspace, ids);
  const runners = await loadRunners(workspace);
  defsByWorkspace.push(defs);
  const out = {};

  const scriptIds = ids.filter((id) => ['script', 'missing', 'ambiguous'].includes(defs[id].type));
  const promptIds = ids.filter((id) => defs[id].type === 'prompt');

  for (const id of scriptIds) {
    out[id] = await runScriptCheck(workspace, runners, id, defs[id]);
  }
  await runWithConcurrency(promptIds, PROBE_CONCURRENCY, async (id) => {
    out[id] = await runPromptCheck(workspace, id, defs[id], systemPrompt, promptTimeout, PROBE_HARD_CAP_MS);
  });
  return { results: out, defs };
}

function cleanup(ws) {
  // Failing to delete a disposable temp dir must never discard a completed probe. The report
  // prints after this, so an exception here destroys every verdict the probe just paid for —
  // on a real run, several `claude -p` calls at up to the configured prompt timeout each.
  // Windows raises EPERM here routinely when an indexer, a scanner or a lingering child handle
  // still holds the directory, which has nothing to do with whether the checks discriminate.
  try {
    fs.rmSync(ws, { recursive: true, force: true });
  } catch (err) {
    console.error(`[probe-checks] WARN: could not remove probe workspace ${ws} (${err.code || err.message}). It is disposable — delete it by hand. Results are unaffected.`);
  }
}

async function main() {
  const { testenvRoot, runDir, arm, ids: explicitIds, fixtures: fixturesDir, json } = parseArgs(process.argv);
  const ids = resolveIds(runDir, arm, explicitIds);
  if (ids.length === 0) {
    console.log('[probe-checks] no checks to probe — nothing to verify.');
    return;
  }

  const promptTimeout = promptTimeoutMs(testenvRoot);
  if (promptTimeout !== DEFAULT_PROMPT_TIMEOUT_MS) {
    console.log(`[probe-checks] prompt timeout ${promptTimeout} ms, from .dod/config.json`);
  }
  const systemPrompt = await loadSystemPrompt();
  const fixtures = discoverFixtures(fixturesDir);
  const rows = [];
  const workspaces = [];

  try {
    // ── Preflight: model ids, so a typo costs nothing instead of N subprocesses ──────────
    const seedWs = makeWorkspace(testenvRoot, path.join(testenvRoot, 'seed'), 'seed');
    workspaces.push(seedWs);
    const seedDefs = await loadCheckDefs(seedWs, ids);

    for (const id of ids) {
      const bad = validateCheckerModel(seedDefs[id]?.meta?.model);
      if (!bad.ok) {
        rows.push({ id, tier: seedDefs[id].type, expected: seedExpectation(seedDefs[id]), actual: 'error', fixtures: {}, ok: false, why: `invalid \`model:\` — ${bad.reason}` });
      }
    }
    const preflightFailed = new Set(rows.map((r) => r.id));

    // The human tier no longer exists — these checks observe a session, they never ask it for
    // anything. Rejected outright rather than probed: at run time it would record as an
    // ungraded error on every single turn, which is a silently missing criterion.
    for (const id of ids) {
      if (preflightFailed.has(id) || seedDefs[id].type !== 'human') continue;
      rows.push({
        id,
        tier: 'human',
        expected: 'n/a',
        actual: 'n/a',
        fixtures: {},
        ok: false,
        why:
          'UNSUPPORTED — the human tier was removed. Blocking an arm to make it ask the user ' +
          'manufactured the autonomy signal this harness measures. Re-author as a script or ' +
          'prompt check, or drop it and give that judgement yourself at /optimizer:analyze.',
      });
    }
    const skip = new Set(rows.map((r) => r.id));
    const liveIds = ids.filter((id) => !skip.has(id));

    if (liveIds.length > 0) {
      // ── Negative side: the pristine seed ──────────────────────────────────────────────
      const seedRun = await runAgainst(seedWs, liveIds, [], systemPrompt, promptTimeout);

      // ── Positive side: every pass*/fail* fixture ──────────────────────────────────────
      const fixtureRuns = [];
      for (const kind of ['pass', 'fail']) {
        for (const fx of fixtures[kind]) {
          const ws = makeWorkspace(testenvRoot, fx.dir, `${kind}-${fx.name}`);
          workspaces.push(ws);
          const r = await runAgainst(ws, liveIds, [], systemPrompt, promptTimeout);
          fixtureRuns.push({ kind, name: fx.name, scope: fx.scope, results: r.results });
        }
      }

      for (const id of liveIds) {
        const expected = seedExpectation(seedDefs[id]);
        const seedResult = seedRun.results[id];
        const row = {
          id,
          tier: seedDefs[id].type,
          expected,
          actual: seedResult.result,
          output: seedResult.output,
          fixtures: {},
        };

        const seedVerdict = verdictFor(seedResult, expected, seedDefs[id]);
        // A grader that reaches the right verdict while citing nothing reached it by luck.
        const ungrounded = seedDefs[id].type === 'prompt'
          && seedVerdict.ok && seedResult.result === 'pass' && seedResult.grounded === false;

        const badPass = [];
        const badFail = [];
        for (const fr of fixtureRuns) {
          const res = fr.results[id];
          const inScope = !fr.scope || fr.scope.has(id);
          // `~` marks a result that was observed but is not being graded, so the table never
          // hides a surprising cell behind a blank.
          row.fixtures[fr.name] = inScope ? res.result : `~${res.result}`;
          if (!inScope) continue;
          // pass* is strict by default; fail* only where the fixture declares its targets.
          if (fr.kind === 'pass' && res.result !== 'pass') badPass.push(`${fr.name} -> ${res.result}: ${String(res.output || '').replace(/\s+/g, ' ').slice(0, 220)}`);
          if (fr.kind === 'fail' && fr.scope && res.result !== 'fail') badFail.push(`${fr.name} -> ${res.result}`);
        }

        if (!seedVerdict.ok) {
          rows.push({ ...row, ...seedVerdict });
        } else if (ungrounded) {
          rows.push({ ...row, ok: false, why: 'UNGROUNDED — passed while citing no evidence. Rewrite the question so it is answerable from files.' });
        } else if (fixtures.pass.length === 0) {
          rows.push({
            ...row,
            ok: false,
            why:
              'NO PASS FIXTURE — the seed probe proves this check can FAIL; nothing proves it can ever PASS. '
              + `Build at least one correct workspace under ${path.relative(runDir, fixturesDir) || 'fixtures'}/pass/ `
              + '(and where a prior run delivered a real artifact, build a variant from THAT file rather than an invented one). '
              + 'A check that fails on everything grades both arms identically while looking like a criterion.',
          });
        } else if (badPass.length > 0) {
          rows.push({
            ...row,
            ok: false,
            why:
              'FALSE NEGATIVE — failed on work declared correct. This is the run-007 defect: the check is '
              + 'reading the artifact wrongly, not the artifact being wrong. Fix the CHECK first; only edit '
              + `the fixture if the fixture is genuinely not correct work. [${badPass.join(' | ')}]`,
          });
        } else if (badFail.length > 0) {
          rows.push({
            ...row,
            ok: false,
            why: `FALSE POSITIVE — passed on a fixture built to be wrong, so it does not detect the thing it exists for. [${badFail.join(' | ')}]`,
          });
        } else {
          rows.push({ ...row, ok: true, why: '' });
        }
      }
    }
  } finally {
    for (const ws of workspaces) cleanup(ws);
  }

  rows.sort((a, b) => a.id.localeCompare(b.id));
  const failures = rows.filter((r) => !r.ok);
  const passNames = fixtures.pass.map((f) => f.name);
  const failNames = fixtures.fail.map((f) => f.name);

  if (json) {
    console.log(JSON.stringify({ probed: rows.length, failures: failures.length, fixtures: { pass: passNames, fail: failNames }, rows }, null, 2));
  } else {
    console.log(`[probe-checks] probed ${rows.length} check(s) against a pristine seed + ${passNames.length} pass fixture(s) + ${failNames.length} fail fixture(s).`);
    if (passNames.length) console.log(`  pass fixtures: ${passNames.join(', ')}`);
    if (failNames.length) console.log(`  fail fixtures: ${failNames.join(', ')}`);
    console.log('');
    const w = Math.max(6, ...rows.map((r) => r.id.length));
    const cols = [...passNames, ...failNames];
    console.log(`  ${'check'.padEnd(w)}  tier    seed          ${cols.map((c) => c.padEnd(10)).join('')}status`);
    for (const r of rows) {
      const cells = cols.map((c) => String(r.fixtures?.[c] ?? '-').padEnd(10)).join('');
      console.log(`  ${r.id.padEnd(w)}  ${String(r.tier).padEnd(6)}  ${String(r.expected)}/${String(r.actual).padEnd(6)}  ${cells}${r.ok ? 'OK' : 'REJECTED'}`);
    }
    if (failures.length > 0) {
      console.log('');
      for (const r of failures) console.log(`  - "${r.id}": ${r.why}`);
    }
  }

  if (failures.length > 0) {
    console.error(`\n[probe-checks] ERROR: ${failures.length} of ${rows.length} check(s) rejected. Fix them before firing — a check that cannot discriminate makes the run's DoD data worthless, and one that fails on correct work fabricates a defect that never existed.`);
    process.exit(1);
  }

  if (!json) {
    console.log(`\n[probe-checks] all ${rows.length} check(s) fail on the seed, pass on every correct fixture, and fail on every incorrect one.`);
    if (passNames.length < 2) {
      console.log(
        '\n[probe-checks] WARNING: only '
        + `${passNames.length} pass fixture. A check that parses structured output (a table, a document, a config) `
        + 'should be proven against at least TWO renderings of the same correct answer — run-007\'s two arms '
        + 'expressed identical correct statuses as overlaid text boxes and as badge cards beside an extra column, '
        + 'and one check misread both. Add a `pass-alt/` variant.',
      );
    }
  }
}

main().catch((err) => {
  console.error(`[probe-checks] ERROR: ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});
