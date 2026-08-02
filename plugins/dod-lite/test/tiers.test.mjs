// The prompt tier, the human tier, persistence, and the gate. These are the paths that
// produced the reported "checkers don't work" behaviour, so each defect gets a named
// regression test rather than a general smoke test.

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
  buildHumanPendingReason,
  buildFailureReason,
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
  writeAnswer,
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

test('gate: prompt tier is SKIPPED when a script check is red and the gate is on', async () => {
  const cwd = makeWorkspace();
  const restore = stubClaude(verdictStub({ pass: true }));
  try {
    writeScriptCheck(cwd, 'red', 1);
    writeCheck(cwd, 'graded.md', '---\ntype: prompt\n---\nq');
    writeConfig(cwd, { prompt_tier_gate: true });
    writeSessionFile(cwd, 'sess-gate-on', ['red', 'graded']);
    await runHook(cwd, 'sess-gate-on');
    const session = readSessionFile(cwd, 'sess-gate-on');
    assert.equal(session.state.red.last_result, 'fail');
    assert.ok(!session.state.graded, 'this is the documented gate behaviour we are turning OFF by default');
  } finally { restore(); }
});

test('gate: prompt tier RUNS alongside a red script check when the gate is off', async () => {
  // The regression test for the reported symptom. ab-bench scaffolds
  // prompt_tier_gate:false precisely so a red script check cannot silently cost the
  // whole AI-graded tier for the run.
  const cwd = makeWorkspace();
  const restore = stubClaude(verdictStub({ pass: false, reason: 'not done' }));
  try {
    writeScriptCheck(cwd, 'red', 1);
    writeCheck(cwd, 'graded.md', '---\ntype: prompt\n---\nq');
    writeConfig(cwd, { prompt_tier_gate: false });
    writeSessionFile(cwd, 'sess-gate-off', ['red', 'graded']);
    const out = await runHook(cwd, 'sess-gate-off');
    const session = readSessionFile(cwd, 'sess-gate-off');
    assert.equal(session.state.red.last_result, 'fail');
    assert.equal(session.state.graded.last_result, 'fail', 'the prompt check must have been graded');
    assert.equal(session.state.graded.tier, 'prompt');
    assert.equal(out.json.decision, 'block');
  } finally { restore(); }
});

test('human tier: the block instruction points at .dod-answers, never at .dod', () => {
  const cwd = path.join('C:', 'ws');
  const reason = buildHumanPendingReason(['taste'], { taste: { body: 'Does it look right?' } }, cwd);
  assert.match(reason, /\.dod-answers/);
  assert.match(reason, /Does it look right\?/);
  assert.ok(
    !/Edit .*\.dod[\\/]sessions/.test(reason),
    'the old instruction told the arm to edit a path the harness denies it',
  );
  assert.match(reason, /Do NOT edit anything under \.dod\//);
});

test('human tier: an answer file satisfies the check and unblocks the arm', async () => {
  const cwd = makeWorkspace();
  writeCheck(cwd, 'taste.md', '---\ntype: human\n---\nDoes it look right?');
  writeSessionFile(cwd, 'sess-human', ['taste']);

  const blocked = await runHook(cwd, 'sess-human');
  assert.equal(blocked.json.decision, 'block', 'unanswered human check must block');

  writeAnswer(cwd, 'taste', { result: 'pass', note: 'looks good', answered_at: new Date().toISOString() });
  const unblocked = await runHook(cwd, 'sess-human');
  assert.ok(!unblocked.json?.decision, 'answered human check must stop blocking');

  const session = readSessionFile(cwd, 'sess-human');
  assert.equal(session.state.taste.last_result, 'pass');
  assert.equal(session.state.taste.answer_source, 'arm-reported');
  assert.equal(session.state.taste.last_output, 'looks good');
});

test('human tier: waived stops blocking, fail keeps blocking', async () => {
  for (const [result, shouldBlock] of [['waived', false], ['fail', true]]) {
    const cwd = makeWorkspace();
    writeCheck(cwd, 'q.md', '---\ntype: human\n---\nq');
    writeSessionFile(cwd, 's', ['q']);
    writeAnswer(cwd, 'q', { result, note: 'n', answered_at: 'now' });
    const out = await runHook(cwd, 's');
    assert.equal(Boolean(out.json?.decision), shouldBlock, `result=${result}`);
  }
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

test('errors are reported but never block', async () => {
  const cwd = makeWorkspace();
  writeCheck(cwd, 'dup.md', '---\ntype: prompt\n---\nq');
  writeScriptCheck(cwd, 'dup', 0);
  writeSessionFile(cwd, 's', ['dup']);
  const out = await runHook(cwd, 's');
  assert.ok(!out.json?.decision, 'an ambiguous check is harness breakage, not a failed criterion');
  assert.match(out.json.systemMessage, /could not be evaluated/);
  assert.equal(readSessionFile(cwd, 's').state.dup.last_result, 'error');
});

test('buildFailureReason: names every failing check and its output', () => {
  const reason = buildFailureReason('script', [
    { id: 'one', output: 'first problem' },
    { id: 'two', output: 'second problem' },
  ]);
  assert.match(reason, /2 script DoD check\(s\) failing/);
  assert.match(reason, /"one": first problem/);
  assert.match(reason, /"two": second problem/);
});
