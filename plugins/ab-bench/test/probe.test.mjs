// The falsifiability gate. Each test is a check-authoring mistake that used to survive
// into a live run.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { SCRIPTS, makeEnvPair, makeRun, cleanupAll, write, node, nodeExpectFail } from './helpers.mjs';

test.after(cleanupAll);

function setup(checks, dodChecks) {
  const { testenvRoot } = makeEnvPair(
    { schema: 1, experiment: 'e', model: 'claude-sonnet-5' },
    { seed: { 'existing.txt': 'already here\n' } },
  );
  const runDir = makeRun(testenvRoot);
  for (const [name, contents] of Object.entries(checks)) {
    write(path.join(testenvRoot, '.dod', 'checks'), name, contents);
  }
  fs.writeFileSync(
    path.join(runDir, 'dod-checks.json'),
    JSON.stringify({ schema: 1, run: 'run-001', checks: dodChecks }, null, 2),
  );
  return { testenvRoot, runDir };
}

/** exit 0 iff `rel` exists in the workspace — the archetypal "did they do it" check. */
const existsCheck = (rel) => `import fs from 'node:fs';process.exit(fs.existsSync(${JSON.stringify(rel)}) ? 0 : 1);`;

test('accepts a check that correctly fails on the seed', () => {
  const { testenvRoot, runDir } = setup(
    { 'made-thing.mjs': existsCheck('THING.md') },
    { control: [{ id: 'made-thing' }], test: [{ id: 'made-thing' }] },
  );
  const out = node(SCRIPTS.probeChecks, [testenvRoot, runDir]);
  assert.match(out, /all 1 check\(s\) behave as declared/);
  assert.match(out, /made-thing.*script.*fail.*fail.*OK/s);
});

test('REJECTS a check that already passes on an untouched seed', () => {
  // The silent killer: green for both arms regardless of what either did.
  const { testenvRoot, runDir } = setup(
    { 'vacuous.mjs': existsCheck('existing.txt') },
    { control: [{ id: 'vacuous' }], test: [{ id: 'vacuous' }] },
  );
  const r = nodeExpectFail(SCRIPTS.probeChecks, [testenvRoot, runDir]);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /CANNOT DISCRIMINATE/);
  assert.match(r.stderr, /1 of 1 check\(s\) rejected/);
});

test('REJECTS a check that crashes', () => {
  const { testenvRoot, runDir } = setup(
    { 'broken.mjs': 'this is not valid javascript !!!' },
    { control: [{ id: 'broken' }], test: [{ id: 'broken' }] },
  );
  const r = nodeExpectFail(SCRIPTS.probeChecks, [testenvRoot, runDir]);
  assert.notEqual(r.status, 0);
  // A crash exits non-zero, which by exit code alone is indistinguishable from an honest
  // "not done" — so this used to sail through the gate looking correct.
  assert.match(r.stdout, /CRASHED/);
});

test('REJECTS a check referenced in dod-checks.json but missing on disk', () => {
  const { testenvRoot, runDir } = setup({}, { control: [{ id: 'ghost' }], test: [{ id: 'ghost' }] });
  const r = nodeExpectFail(SCRIPTS.probeChecks, [testenvRoot, runDir]);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /MISSING/);
});

test('REJECTS an ambiguous check id', () => {
  const { testenvRoot, runDir } = setup(
    { 'dup.mjs': existsCheck('THING.md'), 'dup.md': '---\ntype: prompt\n---\nq' },
    { control: [{ id: 'dup' }], test: [{ id: 'dup' }] },
  );
  const r = nodeExpectFail(SCRIPTS.probeChecks, [testenvRoot, runDir]);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /BROKEN/);
});

test('REJECTS a bare model alias without spawning anything', () => {
  const { testenvRoot, runDir } = setup(
    { 'graded.md': '---\ntype: prompt\nmodel: haiku\n---\nIs it good?' },
    { control: [{ id: 'graded' }], test: [{ id: 'graded' }] },
  );
  const r = nodeExpectFail(SCRIPTS.probeChecks, [testenvRoot, runDir]);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /invalid `model:`/);
});

test('ACCEPTS a declared regression guard that passes on the seed', () => {
  const { testenvRoot, runDir } = setup(
    {
      'still-there.mjs': existsCheck('existing.txt'),
      'still-there.meta.json': JSON.stringify({ seed_expectation: 'pass', description: 'seed file survives' }),
    },
    { control: [{ id: 'still-there' }], test: [{ id: 'still-there' }] },
  );
  const out = node(SCRIPTS.probeChecks, [testenvRoot, runDir]);
  assert.match(out, /still-there.*script.*pass.*pass.*OK/s);
});

test('REJECTS a regression guard that does NOT pass on the seed', () => {
  const { testenvRoot, runDir } = setup(
    {
      'guard.mjs': existsCheck('never-existed.txt'),
      'guard.meta.json': JSON.stringify({ seed_expectation: 'pass' }),
    },
    { control: [{ id: 'guard' }], test: [{ id: 'guard' }] },
  );
  const r = nodeExpectFail(SCRIPTS.probeChecks, [testenvRoot, runDir]);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /DECLARED A REGRESSION GUARD/);
});

test('REJECTS a human check with no question text', () => {
  const { testenvRoot, runDir } = setup(
    { 'empty-ask.md': '---\ntype: human\n---\n' },
    { control: [{ id: 'empty-ask' }], test: [{ id: 'empty-ask' }] },
  );
  const r = nodeExpectFail(SCRIPTS.probeChecks, [testenvRoot, runDir]);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /EMPTY/);
});

test('probes the union of both arms, and --ids overrides', () => {
  const { testenvRoot, runDir } = setup(
    { 'a.mjs': existsCheck('A.md'), 'b.mjs': existsCheck('B.md') },
    { control: [{ id: 'a' }], test: [{ id: 'b' }] },
  );
  const out = node(SCRIPTS.probeChecks, [testenvRoot, runDir]);
  assert.match(out, /probed 2 check\(s\)/, 'asymmetric arms are both covered');

  const only = node(SCRIPTS.probeChecks, [testenvRoot, runDir, '--ids', 'a']);
  assert.match(only, /probed 1 check\(s\)/);
});

test('--json emits a machine-readable report', () => {
  const { testenvRoot, runDir } = setup(
    { 'a.mjs': existsCheck('A.md') },
    { control: [{ id: 'a' }], test: [{ id: 'a' }] },
  );
  const parsed = JSON.parse(node(SCRIPTS.probeChecks, [testenvRoot, runDir, '--json']));
  assert.equal(parsed.probed, 1);
  assert.equal(parsed.failures, 0);
  assert.equal(parsed.rows[0].id, 'a');
  assert.equal(parsed.rows[0].expected, 'fail');
});

test('the probe workspace is disposable and the real checks are never touched', () => {
  const { testenvRoot, runDir } = setup(
    { 'nosy.mjs': "import fs from 'node:fs';fs.writeFileSync('.dod/checks/INJECTED.txt','x');process.exit(1);" },
    { control: [{ id: 'nosy' }], test: [{ id: 'nosy' }] },
  );
  node(SCRIPTS.probeChecks, [testenvRoot, runDir]);
  assert.ok(
    !fs.existsSync(path.join(testenvRoot, '.dod', 'checks', 'INJECTED.txt')),
    'a check writing into .dod during the probe must not reach the shared checks folder',
  );
});
