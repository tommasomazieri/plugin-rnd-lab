// The prompt tier, persistence, and the silence contract. These are the paths that
// produced the reported "checkers don't work" behaviour and the reported experiment
// contamination, so each defect gets a named regression test rather than a smoke test.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

import {
  loadCheckDefs,
  runPromptCheck,
  runWithConcurrency,
  makePersister,
} from '../hooks/dod-check.mjs';
import { readSession } from '../hooks/lib.mjs';
import {
  HOOKS_DIR,
  makeWorkspace,
  cleanupAll,
  writeCheck,
  writeScriptCheck,
  writeSessionFile,
  readSessionFile,
  writeConfig,
  stubClaude,
  stubMissingClaude,
  verdictStub,
} from './helpers.mjs';

test.after(cleanupAll);

/** Drives the real hook end-to-end the way Claude Code does: stdin JSON, stdout JSON. */
function runHook(cwd, sessionId, { stopHookActive = false, env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(HOOKS_DIR, 'dod-check.mjs')], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => {
      let parsed = null;
      try { parsed = JSON.parse(stdout); } catch { /* no output is a valid outcome */ }
      resolve({ code, stdout, stderr, json: parsed });
    });
    child.stdin.end(JSON.stringify({ session_id: sessionId, cwd, stop_hook_active: stopHookActive }));
  });
}

test('prompt tier: a well-formed verdict is graded and its evidence is persisted', async () => {
  const cwd = makeWorkspace();
  const restore = stubClaude(verdictStub({ pass: true, reason: 'found it', evidence: [{ path: 'src/a.ts', line: 4, quote: 'export const x' }] }));
  try {
    writeCheck(cwd, 'graded.md', '---\ntype: prompt\nmodel: claude-haiku-4-5-20251001\n---\nIs x exported?');
    const defs = await loadCheckDefs(cwd, ['graded']);
    const r = await runPromptCheck(cwd, 'graded', defs.graded, null, 30_000, 60_000);
    assert.equal(r.result, 'pass');
    assert.equal(r.grounded, true);
    assert.equal(r.confidence, 'high');
    assert.deepEqual(r.evidence, [{ path: 'src/a.ts', line: 4, quote: 'export const x' }]);
    assert.match(r.output, /src\/a\.ts:4/, 'evidence is rendered into the human-readable output too');
  } finally { restore(); }
});

test('prompt tier: a pass citing nothing is recorded as ungrounded', async () => {
  const cwd = makeWorkspace();
  const restore = stubClaude(verdictStub({ pass: true, evidence: [] }));
  try {
    writeCheck(cwd, 'lazy.md', '---\ntype: prompt\n---\nq');
    const defs = await loadCheckDefs(cwd, ['lazy']);
    const r = await runPromptCheck(cwd, 'lazy', defs.lazy, null, 30_000, 60_000);
    assert.equal(r.result, 'pass');
    assert.equal(r.grounded, false, 'analyze needs to be able to distinguish this from a real pass');
  } finally { restore(); }
});

test('prompt tier: bare "haiku" is rejected before any subprocess is spawned', async () => {
  const cwd = makeWorkspace();
  // No stub on PATH at all: if the model were not validated first, this would try to
  // spawn and produce a *different* error. The assertion is that it never gets there.
  writeCheck(cwd, 'aliased.md', '---\ntype: prompt\nmodel: haiku\n---\nq');
  const defs = await loadCheckDefs(cwd, ['aliased']);
  const r = await runPromptCheck(cwd, 'aliased', defs.aliased, null, 30_000, 60_000);
  assert.equal(r.result, 'error');
  assert.match(r.output, /invalid `model:`/);
  assert.match(r.output, /full model id/);
});

test('prompt tier: infrastructure failures record error, never fail', async () => {
  const cases = [
    ['unparseable stdout', 'console.log("not json"); process.exit(0);', /could not parse/],
    ['no structured verdict', 'console.log(JSON.stringify({result:"ok"})); process.exit(0);', /no structured verdict/],
    ['non-zero exit', 'console.error("boom"); process.exit(2);', /exited 2/],
  ];
  for (const [name, script, expected] of cases) {
    const cwd = makeWorkspace();
    const restore = stubClaude(script);
    try {
      writeCheck(cwd, 'c.md', '---\ntype: prompt\n---\nq');
      const defs = await loadCheckDefs(cwd, ['c']);
      const r = await runPromptCheck(cwd, 'c', defs.c, null, 20_000, 40_000);
      assert.equal(r.result, 'error', `${name}: must be error, not fail`);
      assert.match(r.output, expected, name);
      assert.equal(r.retried, true, `${name}: should have retried once before giving up`);
    } finally { restore(); }
  }
});

test('prompt tier: a grader binary that cannot be spawned records error, never fail', async () => {
  const cwd = makeWorkspace();
  const restore = stubMissingClaude();
  try {
    writeCheck(cwd, 'c.md', '---\ntype: prompt\n---\nq');
    const defs = await loadCheckDefs(cwd, ['c']);
    const r = await runPromptCheck(cwd, 'c', defs.c, null, 20_000, 40_000);
    assert.equal(r.result, 'error');
    assert.match(r.output, /could not spawn/);
  } finally { restore(); }
});

test('prompt tier: retry recovers when the second attempt succeeds', async () => {
  const cwd = makeWorkspace();
  const marker = path.join(cwd, 'attempts.txt');
  const restore = stubClaude(`
import fs from 'node:fs';
const marker = ${JSON.stringify(marker)};
let n = 0;
try { n = Number(fs.readFileSync(marker, 'utf8')) || 0; } catch {}
fs.writeFileSync(marker, String(n + 1));
if (n === 0) { console.log('garbage'); process.exit(0); }
console.log(JSON.stringify({ structured_output: { pass: true, reason: 'second time', evidence: [{path:'p',quote:'q'}], confidence: 'high' } }));
process.exit(0);
`);
  try {
    writeCheck(cwd, 'flaky.md', '---\ntype: prompt\n---\nq');
    const defs = await loadCheckDefs(cwd, ['flaky']);
    const r = await runPromptCheck(cwd, 'flaky', defs.flaky, null, 20_000, 40_000);
    assert.equal(r.result, 'pass', 'transient grader noise must not silently cost a graded dimension');
    assert.equal(r.retried, true);
    assert.equal(fs.readFileSync(marker, 'utf8'), '2');
  } finally { restore(); }
});

test('prompt tier: exhausted budget records error and never blocks', async () => {
  const cwd = makeWorkspace();
  writeCheck(cwd, 'late.md', '---\ntype: prompt\n---\nq');
  const defs = await loadCheckDefs(cwd, ['late']);
  const r = await runPromptCheck(cwd, 'late', defs.late, null, 0, 270_000);
  assert.equal(r.result, 'error');
  assert.match(r.output, /budget/);
});

// THE test. Everything else in this workstream exists to make this property true, so
// it is asserted directly, over every combination of verdicts that used to produce a
// different stdout. A regression here silently re-falsifies every future run.
test('SILENCE: the hook writes nothing to stdout, whatever the checks say', async () => {
  const cases = [
    ['all passing', 0, { pass: true, reason: 'done' }],
    ['script red', 1, { pass: true, reason: 'done' }],
    ['prompt red', 0, { pass: false, reason: 'not done' }],
    ['both red', 1, { pass: false, reason: 'not done' }],
  ];
  for (const [name, scriptExit, verdict] of cases) {
    const cwd = makeWorkspace();
    const restore = stubClaude(verdictStub(verdict));
    try {
      writeScriptCheck(cwd, 'scripted', scriptExit);
      writeCheck(cwd, 'graded.md', '---\ntype: prompt\n---\nq');
      writeSessionFile(cwd, 's', ['scripted', 'graded']);
      const out = await runHook(cwd, 's');

      assert.equal(out.stdout, '', `${name}: a Stop hook's stdout is the control channel`);
      assert.equal(out.json, null, `${name}: nothing parseable was emitted`);
      assert.equal(out.code, 0, `${name}: must exit 0`);

      // ...and it still did the work. Silence must mean "observed and recorded",
      // never "gave up early".
      const session = readSessionFile(cwd, 's');
      assert.equal(session.state.scripted.last_result, scriptExit === 0 ? 'pass' : 'fail', name);
      assert.equal(session.state.graded.last_result, verdict.pass ? 'pass' : 'fail', name);
    } finally { restore(); }
  }
});

test('SILENCE: no failing check output can reach the session that produced it', async () => {
  const cwd = makeWorkspace();
  const secret = 'CANARY_ffff_THIS_MUST_NOT_REACH_THE_ARM';
  const restore = stubClaude(verdictStub({ pass: false, reason: secret }));
  try {
    // Both tiers emit the canary: the script check prints it, the grader returns it.
    writeCheck(cwd, 'loud.js', `console.log(${JSON.stringify(secret)}); process.exit(1);`);
    writeCheck(cwd, 'graded.md', '---\ntype: prompt\n---\nq');
    writeSessionFile(cwd, 's', ['loud', 'graded']);
    const out = await runHook(cwd, 's');

    assert.ok(!out.stdout.includes(secret), 'check output leaked into the control channel');
    assert.equal(out.stdout, '');
    // It IS recorded — the point is that analyze can read it and the arm cannot.
    const session = readSessionFile(cwd, 's');
    assert.match(session.state.loud.last_output, new RegExp(secret));
  } finally { restore(); }
});

test('no gate: both tiers run every turn, even with a red script check', async () => {
  // The old prompt_tier_gate skipped the graded tier whenever a script check was red —
  // the normal mid-run state — so the graded tier silently never ran. The gate is gone;
  // a leftover `prompt_tier_gate: true` in a config must no longer do anything.
  const cwd = makeWorkspace();
  const restore = stubClaude(verdictStub({ pass: false, reason: 'not done' }));
  try {
    writeScriptCheck(cwd, 'red', 1);
    writeCheck(cwd, 'graded.md', '---\ntype: prompt\n---\nq');
    writeConfig(cwd, { prompt_tier_gate: true });
    writeSessionFile(cwd, 'sess-gate-ignored', ['red', 'graded']);
    await runHook(cwd, 'sess-gate-ignored');
    const session = readSessionFile(cwd, 'sess-gate-ignored');
    assert.equal(session.state.red.last_result, 'fail');
    assert.equal(session.state.graded.last_result, 'fail', 'the graded tier must have run anyway');
    assert.equal(session.state.graded.tier, 'prompt');
  } finally { restore(); }
});

test('human tier: a leftover human check is recorded as an error, not silently dropped', async () => {
  const cwd = makeWorkspace();
  writeCheck(cwd, 'taste.md', '---\ntype: human\n---\nDoes it look right?');
  writeSessionFile(cwd, 'sess-human', ['taste']);

  const out = await runHook(cwd, 'sess-human');
  assert.equal(out.stdout, '', 'the tier that used to block is the one that must be quietest');

  const session = readSessionFile(cwd, 'sess-human');
  assert.equal(session.state.taste.last_result, 'error', 'ungraded, and visibly so');
  assert.match(session.state.taste.last_output, /no longer supported/);
});

test('persistence: results land as they arrive, not in one write at the end', async () => {
  const cwd = makeWorkspace();
  const session = { session_id: 's', checks: ['a', 'b'], state: {}, history: [] };
  fs.writeFileSync(path.join(cwd, '.dod', 'sessions', 's.json'), JSON.stringify(session));
  const persister = makePersister(cwd, 's', session);

  await persister.record({ id: 'a', tier: 'script', result: 'pass', output: 'ok' });
  // A hook killed at its timeout right here must still leave 'a' on disk.
  const midway = readSessionFile(cwd, 's');
  assert.equal(midway.state.a.last_result, 'pass');
  assert.ok(!midway.state.b, 'b has not run yet');
  assert.equal(midway.history.length, 0, 'history is only appended at finalize');

  await persister.record({ id: 'b', tier: 'script', result: 'fail', output: 'no' });
  await persister.finalize([{ id: 'a', result: 'pass' }, { id: 'b', result: 'fail' }]);
  const final = readSessionFile(cwd, 's');
  assert.equal(final.history.length, 1);
  assert.equal(final.history[0].results.length, 2);
});

test('persistence: parallel writers never interleave into a corrupt session file', async () => {
  const cwd = makeWorkspace();
  const session = { session_id: 's', checks: [], state: {}, history: [] };
  fs.writeFileSync(path.join(cwd, '.dod', 'sessions', 's.json'), JSON.stringify(session));
  const persister = makePersister(cwd, 's', session);

  const ids = Array.from({ length: 24 }, (_, i) => `c${i}`);
  await runWithConcurrency(ids, 4, async (id) => {
    await persister.record({ id, tier: 'prompt', result: 'pass', output: 'x' });
  });

  const final = await readSession(cwd, 's');
  assert.equal(Object.keys(final.state).length, 24, 'every write survived and the file still parses');
});

test('recursion guard: the hook is inert inside a checker subprocess', async () => {
  const cwd = makeWorkspace();
  writeScriptCheck(cwd, 'a', 1);
  writeSessionFile(cwd, 's', ['a']);
  const out = await runHook(cwd, 's', { env: { DOD_LITE_CHECKER: '1' } });
  assert.equal(out.stdout.trim(), '', 'a grader subprocess must not run the grader');
  assert.ok(!readSessionFile(cwd, 's').state.a);
});

test('fail-open: a session file that is not valid JSON exits 0 and blocks nothing', async () => {
  const cwd = makeWorkspace();
  fs.writeFileSync(path.join(cwd, '.dod', 'sessions', 'bad.json'), '{ not json');
  const out = await runHook(cwd, 'bad');
  assert.equal(out.code, 0, 'a dod-lite bug must never take an unrelated session down');
  assert.ok(!out.json?.decision);
});

test('fail-open: no session file at all is a silent no-op', async () => {
  const cwd = makeWorkspace();
  const out = await runHook(cwd, 'never-registered');
  assert.equal(out.code, 0);
  assert.equal(out.stdout.trim(), '');
});

test('errors surface on stderr and in the session file, never on stdout', async () => {
  const cwd = makeWorkspace();
  writeCheck(cwd, 'dup.md', '---\ntype: prompt\n---\nq');
  writeScriptCheck(cwd, 'dup', 0);
  writeSessionFile(cwd, 's', ['dup']);
  const out = await runHook(cwd, 's');
  assert.equal(out.stdout, '', 'harness breakage is still not something the arm may hear');
  assert.match(out.stderr, /could not be evaluated/, 'but the operator must be able to see it');
  assert.equal(readSessionFile(cwd, 's').state.dup.last_result, 'error');
});

test('per-turn audit: each stop appends a full record and never rewrites an earlier one', async () => {
  const cwd = makeWorkspace();
  const restore = stubClaude(verdictStub({ pass: false, reason: 'first pass was wrong' }));
  try {
    writeScriptCheck(cwd, 'scripted', 1);
    writeCheck(cwd, 'graded.md', '---\ntype: prompt\n---\nq');
    writeSessionFile(cwd, 's', ['scripted', 'graded']);
    await runHook(cwd, 's');

    const afterTurn1 = readSessionFile(cwd, 's');
    assert.equal(afterTurn1.history.length, 1);
    assert.equal(afterTurn1.history[0].turn, 1);
    const t1 = afterTurn1.history[0].results.find((r) => r.check === 'graded');
    assert.equal(t1.result, 'fail');
    assert.match(t1.output, /first pass was wrong/, 'full output, not a bare verdict');
    assert.equal(t1.tier, 'prompt');
  } finally { restore(); }

  // Turn two: the work improved. The turn-one record must survive verbatim, because
  // the whole point of the series is reading improvement and regression across turns.
  const restore2 = stubClaude(verdictStub({ pass: true, reason: 'fixed now' }));
  try {
    writeScriptCheck(cwd, 'scripted', 0);
    await runHook(cwd, 's');
    const afterTurn2 = readSessionFile(cwd, 's');

    assert.equal(afterTurn2.history.length, 2, 'appended, not overwritten');
    assert.equal(afterTurn2.history[1].turn, 2);
    assert.match(
      afterTurn2.history[0].results.find((r) => r.check === 'graded').output,
      /first pass was wrong/,
      "turn 1's record must be byte-identical after turn 2 ran",
    );
    assert.equal(afterTurn2.history[0].results.find((r) => r.check === 'scripted').result, 'fail');
    assert.equal(afterTurn2.history[1].results.find((r) => r.check === 'scripted').result, 'pass');
    assert.equal(afterTurn2.state.scripted.last_result, 'pass', 'state tracks only the latest');
  } finally { restore2(); }
});
