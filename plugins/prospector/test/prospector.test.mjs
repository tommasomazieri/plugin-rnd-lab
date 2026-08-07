// Prospector's on-disk model and the Optimizer handoff contract.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  findRoot, paths, scaffold, readState, setStage,
  readHypotheses, addHypothesis, resolveHypothesis, rankHypotheses,
  readNeeds, addNeed, coverNeed, deferNeed, withdrawNeed, reopenNeed, rankNeeds, blockingNeeds,
  addEvidence, addFraming, addDecision, cutPackage,
} from '../lib/prospector.mjs';
import { renderMandate, renderRubric, resolveMandateId, writeHandoff } from '../lib/handoff.mjs';

const CLI = fileURLToPath(new URL('../lib/prospector-cli.mjs', import.meta.url));
const cli = (args, opts = {}) =>
  JSON.parse(execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', ...opts }));

const made = [];
function ws() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'prospector-test-'));
  made.push(d);
  return d;
}
test.after(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

const fresh = async (issue = 'I need a tool that manages my tasks') => {
  const d = ws();
  await scaffold(d, { issue });
  return d;
};

// ---------------------------------------------------------------- layout

test('scaffold creates the tracked record and stores no absolute paths', async () => {
  const d = await fresh();
  const p = paths(d);
  for (const f of [p.state, p.model, p.hypotheses]) assert.ok(fs.existsSync(f), f);
  assert.ok(fs.existsSync(p.evidence));

  // This is the property that lets .prospector/ be committed at all — unlike the Optimizer's
  // .ab-bench/, which is gitignored precisely because its state.json holds machine paths.
  const raw = fs.readFileSync(p.state, 'utf8');
  assert.ok(!raw.includes(d), 'state.json must not embed its own absolute path');
  assert.ok(!/[A-Za-z]:\\\\|\/(home|Users)\//.test(raw), 'no absolute paths anywhere in state');
});

test('the stated issue is preserved verbatim, framed as an entry point', async () => {
  const d = await fresh('I need a tool that automatically manages my tasks');
  const model = fs.readFileSync(paths(d).model, 'utf8');
  assert.match(model, /I need a tool that automatically manages my tasks/);
  assert.match(model, /entry point, not the problem definition/);
  assert.equal((await readState(d)).stated_issue, 'I need a tool that automatically manages my tasks');
});

test('findRoot walks up, the way git resolves .git', async () => {
  const d = await fresh();
  const nested = path.join(d, 'skills', 'deep');
  fs.mkdirSync(nested, { recursive: true });
  assert.equal(findRoot(nested), d);
  assert.equal(findRoot(ws()), null, 'an unrelated dir resolves to nothing, not to a guess');
});

test('scaffold is idempotent and never clobbers existing work', async () => {
  const d = await fresh();
  fs.writeFileSync(paths(d).model, '# heavily edited by the user\n');
  await scaffold(d, { issue: 'different issue' });
  assert.match(fs.readFileSync(paths(d).model, 'utf8'), /heavily edited/);
});

// ---------------------------------------------------------------- hypotheses

test('a hypothesis records what would REFUTE it, not just what would confirm it', async () => {
  const d = await fresh();
  const h = await addHypothesis(d, {
    statement: 'users abandon the tracker at the triage step',
    assumption: 'triage is the friction, not capture',
    validation: 'ship capture-only and see if it is used',
    success: 'daily use for a week',
    failure: 'abandoned within two days',
    confidence: 0.4,
  });
  assert.equal(h.id, 'H-001');
  assert.equal(h.status, 'open');
  assert.equal(h.failure_signal, 'abandoned within two days');
  assert.equal(h.origin_package, 'v0');
  assert.equal((await addHypothesis(d, { statement: 'second' })).id, 'H-002');
});

test('ranking maximises expected LEARNING, so a coin-flip outranks a near-certainty', async () => {
  const d = await fresh();
  await addHypothesis(d, { statement: 'near certain', confidence: 0.95 });
  await addHypothesis(d, { statement: 'coin flip', confidence: 0.5 });
  await addHypothesis(d, { statement: 'near certainly false', confidence: 0.05 });

  const ranked = rankHypotheses(await readHypotheses(d));
  assert.equal(ranked[0].statement, 'coin flip', 'testing what you already believe teaches nothing');
  assert.ok(ranked[0].score > ranked[1].score);
  assert.equal(ranked.at(-1).score, ranked[1].score, 'certain-true and certain-false are equally uninformative');
});

test('resolved hypotheses leave the ranking but keep their outcome', async () => {
  const d = await fresh();
  const h = await addHypothesis(d, { statement: 'x', confidence: 0.5 });
  await resolveHypothesis(d, h.id, 'refuted', 'they went back to the spreadsheet');
  const doc = await readHypotheses(d);
  assert.equal(doc.hypotheses[0].outcome, 'refuted');
  assert.equal(rankHypotheses(doc).length, 0);
});

test('not-testable keeps the hypothesis OPEN and at its old rank', async () => {
  const d = await fresh();
  const h = await addHypothesis(d, { statement: 'coin flip', confidence: 0.5 });
  await addHypothesis(d, { statement: 'near certain', confidence: 0.95 });

  // vN could not be used on real work at all, so nothing was learned about H-001. Retiring it
  // here would let a build defect silently delete the least-understood question in the file.
  const resolved = await resolveHypothesis(d, h.id, 'not-testable', 'v1 was a one-shot interview');
  assert.equal(resolved.status, 'open');
  assert.equal(resolved.outcome, 'not-testable');

  const ranked = rankHypotheses(await readHypotheses(d));
  assert.equal(ranked.length, 2, 'an untested hypothesis stays in the ranking');
  assert.equal(ranked[0].statement, 'coin flip', 'and keeps the rank it had before the failed build');
});

test('every other outcome still retires the hypothesis', async () => {
  for (const outcome of ['confirmed', 'partly-confirmed', 'refuted', 'inconclusive']) {
    const dir = await fresh();
    const h = await addHypothesis(dir, { statement: outcome, confidence: 0.5 });
    assert.equal((await resolveHypothesis(dir, h.id, outcome)).status, 'resolved', outcome);
  }
});

test('an unknown outcome is rejected rather than recorded', async () => {
  const d = await fresh();
  const h = await addHypothesis(d, { statement: 'x' });
  await assert.rejects(() => resolveHypothesis(d, h.id, 'kinda worked'), /outcome must be one of/);
  await assert.rejects(() => resolveHypothesis(d, 'H-999', 'refuted'), /no hypothesis/);
});

// ---------------------------------------------------------------- evidence

test('evidence carries a status label and back-links to its hypotheses', async () => {
  const d = await fresh();
  const h = await addHypothesis(d, { statement: 'triage is the friction' });
  const e = await addEvidence(d, {
    text: 'went back to the spreadsheet on day 2',
    status: 'confirmed', source: 'mvp-use', hypotheses: [h.id],
  });
  assert.equal(e.id, 'E-001');

  const body = fs.readFileSync(path.join(paths(d).evidence, 'E-001.md'), 'utf8');
  assert.match(body, /status: confirmed/);
  assert.match(body, /went back to the spreadsheet/);
  assert.equal((await readHypotheses(d)).hypotheses[0].evidence_refs[0], 'E-001');
});

test('an invented confidence label is rejected — inference must not become fact', async () => {
  const d = await fresh();
  await assert.rejects(() => addEvidence(d, { text: 'x', status: 'pretty sure' }), /status must be one of/);
  await assert.rejects(() => addEvidence(d, { text: '' }), /evidence needs text/);
});

test('evidence defaults to tentative, never to confirmed', async () => {
  const d = await fresh();
  await addEvidence(d, { text: 'an inference I drew' });
  assert.match(fs.readFileSync(path.join(paths(d).evidence, 'E-001.md'), 'utf8'), /status: tentative/);
});

// ---------------------------------------------------------------- framings

test('a reframe is append-only and records what killed the previous framing', async () => {
  const d = await fresh();
  await addFraming(d, { statement: 'task capture is too slow', target: 'me', need: 'capture in <5s' });
  assert.equal((await readState(d)).current_framing, 'F1');

  await addFraming(d, {
    statement: 'the real problem is triage, not capture',
    killed_by: 'E-001 — capture-only MVP was abandoned on day 2',
  });
  const state = await readState(d);
  assert.equal(state.current_framing, 'F2');
  assert.equal(state.framings.length, 2);

  const md = fs.readFileSync(paths(d).framings, 'utf8');
  assert.match(md, /## F1 — task capture is too slow/, 'the dead framing survives');
  assert.match(md, /## F2 — the real problem is triage/);
  assert.match(md, /Supersedes F1, killed by:\*\* E-001/);
});

test('a reframe does NOT fork packages — the MVP at root has one git history', async () => {
  const d = await fresh();
  await addFraming(d, { statement: 'F one' });
  await cutPackage(d, { changed: 'first' });
  // A reframe follows real use, so v1 comes back before v2 is cut — see the review gate below.
  await addEvidence(d, { text: 'they used v1 and went back to the spreadsheet', source: 'mvp-use' });
  await addFraming(d, { statement: 'F two', killed_by: 'E-001' });
  const cut = await cutPackage(d, { changed: 'after reframe' });

  assert.equal(cut.version, 2, 'numbering stays monotonic across a reframe');
  assert.ok(fs.existsSync(path.join(paths(d).packages, 'v1')));
  assert.ok(fs.existsSync(path.join(paths(d).packages, 'v2')));
  assert.ok(!fs.existsSync(path.join(paths(d).dir, 'framings')), 'no per-framing package tree');
});

// ---------------------------------------------------------------- needs
//
// The denominator. These tests exist because an engagement once ran a two-hour interview and
// shipped an MVP covering a fraction of one of the several things the user had named.

const need = (d, statement, over = {}) =>
  addNeed(d, { statement, evidence: ['E-001'], kind: 'stated', importance: 'core', ...over });

test('a stated need must cite the evidence it came from', async () => {
  const d = await fresh();
  await assert.rejects(
    () => addNeed(d, { statement: 'do A', kind: 'stated', importance: 'core' }),
    /must cite the evidence/,
  );
  // The whole gate rests on the agent not being able to author its own denominator. If a stated
  // need could be conjured, the build could conjure a small list it already satisfies.
  await assert.rejects(
    () => addNeed(d, { statement: 'do A', kind: 'observed', importance: 'core' }),
    /must cite the evidence/,
  );
});

test('an inferred need needs no evidence — it is the agent\'s own, and says so', async () => {
  const d = await fresh();
  const n = await addNeed(d, { statement: 'recover when it guesses wrong', kind: 'inferred' });
  assert.equal(n.kind, 'inferred');
  assert.deepEqual(n.evidence, []);
  const p = await addNeed(d, { statement: 'batch mode, like the other tool', kind: 'prior-art' });
  assert.equal(p.kind, 'prior-art');
});

test('kinds and importance are closed sets, like every other vocabulary here', async () => {
  const d = await fresh();
  await assert.rejects(() => need(d, 'x', { kind: 'obviously-true' }), /kind must be one of/);
  await assert.rejects(() => need(d, 'x', { importance: 'critical' }), /importance must be one of/);
});

test('deferring requires a reason, and withdrawing records the user\'s', async () => {
  const d = await fresh();
  const n = await need(d, 'do B');
  await assert.rejects(() => deferNeed(d, n.id, null), /requires a reason/);

  await deferNeed(d, n.id, 'needs the A pipeline first');
  let stored = (await readNeeds(d)).needs[0];
  assert.equal(stored.status, 'deferred');
  assert.equal(stored.deferred_reason, 'needs the A pipeline first');

  await withdrawNeed(d, n.id, 'user: I was wrong, I never do that');
  stored = (await readNeeds(d)).needs[0];
  assert.equal(stored.status, 'withdrawn');
});

test('reopen puts a deferred need back in front of the next package', async () => {
  const d = await fresh();
  const n = await need(d, 'do B');
  await deferNeed(d, n.id, 'later');
  assert.equal(blockingNeeds(await readNeeds(d)).length, 0);
  await reopenNeed(d, n.id);
  assert.deepEqual(blockingNeeds(await readNeeds(d)).map((x) => x.id), [n.id]);
});

test('only stated/observed CORE needs block a cut — inferred ones never do', async () => {
  const d = await fresh();
  await need(d, 'core stated');
  await need(d, 'peripheral stated', { importance: 'peripheral' });
  await addNeed(d, { statement: 'core inferred', kind: 'inferred', importance: 'core' });
  await addNeed(d, { statement: 'core prior-art', kind: 'prior-art', importance: 'core' });

  const blocking = blockingNeeds(await readNeeds(d));
  assert.deepEqual(blocking.map((n) => n.statement), ['core stated']);
});

test('needs rank by VALUE — the opposite of the hypothesis learning ranking', async () => {
  const d = await fresh();
  // A need the user stated, marked core, that we are SURE about. Under hypothesis ranking's
  // inverted confidence this would sink to the bottom; here it must win.
  await need(d, 'certain core stated', { confidence: 0.95 });
  await need(d, 'coin-flip core stated', { confidence: 0.5 });
  await addNeed(d, { statement: 'certain core inferred', kind: 'inferred', importance: 'core', confidence: 0.95 });

  const ranked = rankNeeds(await readNeeds(d));
  assert.equal(ranked[0].statement, 'certain core stated');
  assert.ok(ranked[0].score > ranked[1].score, 'confidence is NOT inverted here');
  // Provenance discounts the agent's own contribution below the user's own words.
  const inferred = ranked.find((n) => n.kind === 'inferred');
  const stated = ranked.find((n) => n.statement === 'certain core stated');
  assert.ok(inferred.score < stated.score, 'an inferred need never outranks the same stated one');

  // And the contrast that motivates having two rankings at all.
  await addHypothesis(d, { statement: 'sure thing', failure: 'x', confidence: 0.95 });
  await addHypothesis(d, { statement: 'coin flip', failure: 'x', confidence: 0.5 });
  const hyps = rankHypotheses(await readHypotheses(d));
  assert.equal(hyps[0].statement, 'coin flip', 'hypotheses still rank by expected learning');
});

// ---------------------------------------------------------------- packages

test('a package changelog answers what changed, why, and on what evidence', async () => {
  const d = await fresh();
  await addFraming(d, { statement: 'triage is the problem' });
  const cut = await cutPackage(d, {
    changed: 'dropped capture, added triage', why: 'capture MVP was abandoned',
    evidence: 'E-001', unresolved: 'whether triage needs to be automatic', confidence: 'up on triage',
  });
  const log = fs.readFileSync(path.join(cut.dir, 'changelog.md'), 'utf8');
  for (const s of ['dropped capture', 'capture MVP was abandoned', 'E-001', 'whether triage needs', 'up on triage']) {
    assert.match(log, new RegExp(s));
  }
  assert.match(log, /Framing:\*\* F1/);
  assert.equal((await readState(d)).package_version, 1);
});

// ---- the breadth gate: the reason any of this exists ----

test('a package cannot be cut while a core stated need is unaccounted for', async () => {
  const d = await fresh('I find it difficult to do A and to do B');
  await addEvidence(d, { text: 'user: doing A is hard', status: 'confirmed' });
  const a = await need(d, 'do A without hand-editing');
  await need(d, 'do B without hand-editing');

  // The exact defect: cover a fraction of A, ship, and let B evaporate.
  await coverNeed(d, a.id);
  await assert.rejects(() => cutPackage(d, { changed: 'v1' }), (e) => {
    assert.match(e.message, /do B without hand-editing/, 'the refusal must NAME the dropped need');
    assert.match(e.message, /N-002/);
    return true;
  });

  // Deferring IS the override — there is deliberately no flag that skips the gate.
  await deferNeed(d, 'N-002', 'B depends on the A pipeline landing first');
  const cut = await cutPackage(d, { changed: 'v1' });
  assert.equal(cut.version, 1);
  assert.deepEqual(cut.deferred, ['N-002']);
});

test('a deferral lands in the FROZEN changelog, not only in the living needs file', async () => {
  const d = await fresh();
  await need(d, 'do B');
  await deferNeed(d, 'N-001', 'B depends on the A pipeline landing first');
  const cut = await cutPackage(d, { changed: 'v1' });

  // needs.json is living: a need deferred at v1 and covered at v2 would leave no trace that v1
  // ever skipped it. The frozen record is the only place the user can go back and argue with.
  const log = fs.readFileSync(path.join(cut.dir, 'changelog.md'), 'utf8');
  assert.match(log, /Deliberately not covered by v1/);
  assert.match(log, /N-001/);
  assert.match(log, /B depends on the A pipeline landing first/);
});

test('inferred and prior-art needs never block a cut, however important', async () => {
  const d = await fresh();
  await addNeed(d, { statement: 'core inferred', kind: 'inferred', importance: 'core' });
  await addNeed(d, { statement: 'core prior-art', kind: 'prior-art', importance: 'core' });
  const cut = await cutPackage(d, { changed: 'v1' });
  assert.equal(cut.version, 1, 'the agent may not gate the build on its own inventions');
});

test('the review override does not also override the breadth gate', async () => {
  const d = await fresh();
  await need(d, 'do A');
  await coverNeed(d, 'N-001');
  await cutPackage(d, { changed: 'v1' });

  await need(d, 'do B');
  // --unreviewed-reason forgives an unreviewed v1. It must NOT forgive dropping what they asked
  // for: they are different failures, and conflating them would restore the original defect
  // behind a flag that already has a legitimate use.
  await assert.rejects(
    () => cutPackage(d, { changed: 'v2', unreviewed_reason: 'rejected on sight' }),
    /neither covered by this package nor deferred/,
  );
});

test('a cut package is frozen — it cannot be silently re-cut', async () => {
  const d = await fresh();
  await cutPackage(d, { changed: 'first' });
  const state = await readState(d);
  state.package_version = 0; // simulate a stale writer trying to reuse v1
  fs.writeFileSync(paths(d).state, JSON.stringify(state));
  await assert.rejects(() => cutPackage(d, { changed: 'overwrite' }), /already exists — packages are frozen/);
});

test('v2 cannot be cut while v1 has never come back from the user', async () => {
  const d = await fresh();
  await cutPackage(d, { changed: 'first' });

  // Interview evidence is not a review. Only real use, or a rejection, closes a package.
  await addEvidence(d, { text: 'he said he wants three legs', source: 'user-interview' });
  await addEvidence(d, { text: 'the library has 23 headers', source: 'repo-observation' });
  await assert.rejects(() => cutPackage(d, { changed: 'panic build' }), /never come back from the user/);

  await addEvidence(d, { text: 'he rejected it on sight', source: 'mvp-rejected' });
  assert.equal((await cutPackage(d, { changed: 'aimed at the job this time' })).version, 2);
});

test('a resolved hypothesis also closes the package', async () => {
  const d = await fresh();
  await cutPackage(d, { changed: 'first' });
  const h = await addHypothesis(d, { statement: 'they will use it daily' });
  await resolveHypothesis(d, h.id, 'refuted', 'used twice, then never again');
  assert.equal((await cutPackage(d, { changed: 'second' })).version, 2);
});

test('the review gate can be overridden, and the override lands in the frozen record', async () => {
  const d = await fresh();
  await cutPackage(d, { changed: 'first' });
  const cut = await cutPackage(d, { changed: 'second', unreviewed_reason: 'shipped broken, unusable' });
  assert.match(fs.readFileSync(path.join(cut.dir, 'changelog.md'), 'utf8'),
    /Cut without reviewing v1:\*\* shipped broken, unusable/);
});

test('mvp evidence from an OLDER package does not close the current one', async () => {
  const d = await fresh();
  await cutPackage(d, { changed: 'first' });
  await addEvidence(d, { text: 'v1 got used', source: 'mvp-use' });   // package: v1
  await cutPackage(d, { changed: 'second' });                          // ok
  // v2 now current; the v1 evidence must not be reusable to wave v3 through.
  await assert.rejects(() => cutPackage(d, { changed: 'third' }), /never come back from the user/);
});

test('stage transitions are validated against a closed set', async () => {
  const d = await fresh();
  assert.equal((await setStage(d, 'review')).stage, 'review');
  await assert.rejects(() => setStage(d, 'vibing'), /unknown stage/);
});

test('the decision log is append-only', async () => {
  const d = await fresh();
  await addDecision(d, { text: 'adopted F2', why: 'E-001' });
  await addDecision(d, { text: 'deferred automation', why: 'unvalidated' });
  const md = fs.readFileSync(paths(d).decisions, 'utf8');
  assert.match(md, /adopted F2/);
  assert.match(md, /deferred automation/);
});

// ---------------------------------------------------------------- detect / the loop

test('detect reports post-optimizer only once a full cycle has actually closed', async () => {
  const d = await fresh();

  // A blueprint alone is not a closed cycle — nothing has been measured yet.
  fs.writeFileSync(paths(d).blueprint, '# Blueprint\n');
  assert.equal(cli(['detect', d]).status, 'existing');

  // Nor is a handoff with no analysed run: there is no new evidence to re-enter ON.
  const testenv = ws();
  fs.mkdirSync(path.join(d, '.ab-bench'), { recursive: true });
  fs.writeFileSync(
    path.join(d, '.ab-bench', 'state.json'),
    JSON.stringify({ schema: 1, testenv_root: testenv, current_mandate: 'mandate-1', current_env: 'env-1' }),
  );
  assert.equal(cli(['detect', d]).status, 'existing');

  // A run that fired but was never analysed still has no report to read.
  const runDir = path.join(testenv, 'mandate-1', 'env-1', 'runs', 'run-001');
  fs.mkdirSync(path.join(runDir, 'analysis'), { recursive: true });
  assert.equal(cli(['detect', d]).status, 'existing');

  fs.writeFileSync(path.join(runDir, 'analysis', 'report.md'), '# run-001\n');
  const out = cli(['detect', d]);
  assert.equal(out.status, 'post-optimizer');
  assert.equal(out.optimizer.analyzed_runs.length, 1);
  assert.equal(out.optimizer.analyzed_runs[0].run, 'run-001');
  assert.match(out.optimizer.analyzed_runs[0].fix_list, /fix-list\.md$/);
});

test('detect finds analysed runs across every mandate and env, not just the current one', async () => {
  const d = await fresh();
  fs.writeFileSync(paths(d).blueprint, '# Blueprint\n');
  const testenv = ws();
  fs.mkdirSync(path.join(d, '.ab-bench'), { recursive: true });
  fs.writeFileSync(
    path.join(d, '.ab-bench', 'state.json'),
    JSON.stringify({ schema: 1, testenv_root: testenv, current_mandate: 'mandate-2', current_env: 'env-1' }),
  );
  // state.json's pointer only ever moves forward, so a re-entry that read only the current
  // mandate would silently discard everything learned before the last scope change.
  for (const [m, e, r] of [['mandate-1', 'env-1', 'run-001'], ['mandate-1', 'env-2', 'run-002'], ['mandate-2', 'env-1', 'run-003']]) {
    const a = path.join(testenv, m, e, 'runs', r, 'analysis');
    fs.mkdirSync(a, { recursive: true });
    fs.writeFileSync(path.join(a, 'report.md'), `# ${r}\n`);
  }
  const out = cli(['detect', d]);
  assert.deepEqual(out.optimizer.analyzed_runs.map((x) => x.run), ['run-001', 'run-002', 'run-003']);
});

test('detect survives a missing or unreachable testenv rather than crashing the stage', async () => {
  const d = await fresh();
  fs.mkdirSync(path.join(d, '.ab-bench'), { recursive: true });
  fs.writeFileSync(
    path.join(d, '.ab-bench', 'state.json'),
    JSON.stringify({ schema: 1, testenv_root: path.join(ws(), 'gone') }),
  );
  const out = cli(['detect', d]);
  assert.equal(out.status, 'existing');
  assert.deepEqual(out.optimizer.analyzed_runs, []);
});

test('detect surfaces the breadth gate BEFORE a cut is attempted', async () => {
  const d = await fresh();
  await need(d, 'do A');
  await need(d, 'do B');
  await coverNeed(d, 'N-001');
  // An agent that discovers the gate at package time has already written the MVP against the
  // wrong scope, which is too late for the information to be worth anything.
  const out = cli(['detect', d]);
  assert.deepEqual(out.needs_blocking_a_cut, ['N-002']);
  assert.equal(out.needs_total, 2);
  assert.equal(out.blueprint_written, false);
});

// ---------------------------------------------------------------- handoff

const payload = () => ({
  package_version: 'v2',
  domain: 'Blender add-on development',
  capability_gap: 'Claude cannot see the scene graph without leaving the editor',
  target_user: 'a solo technical artist',
  good_outcome: 'the add-on loads and the operator appears in the N-panel',
  non_goals: 'does not attempt rendering or physics',
  weak_spots: 'untested against Blender 4.x',
  rubric: [
    { dimension: 'Loads cleanly', weight: 0.6, evidence_sources: 'console output',
      anchors: ['0 — traceback on enable', '4 — enables with no warnings'] },
    { dimension: 'Discoverable', weight: 0.4, evidence_sources: 'the N-panel',
      anchors: ['0 — no UI at all', '4 — labelled panel in the right category'] },
  ],
});

test('mandate.md fills six categories and leaves task complexity explicitly open', async () => {
  const md = renderMandate(payload(), { pluginName: 'my-plugin', mandateId: 'mandate-1' });
  assert.match(md, /# my-plugin — plugin mandate \(mandate-1\)/);
  for (const s of ['Blender add-on development', 'cannot see the scene graph', 'solo technical artist',
    'N-panel', 'does not attempt rendering', 'untested against Blender 4']) {
    assert.match(md, new RegExp(s));
  }
  // Category 6 is about A/B signal strength, not about the problem. Guessing it would put a
  // fabricated answer into the doc that /optimizer:plan checks every task against.
  assert.match(md, /## Appropriate task complexity\n\n_NOT ESTABLISHED/);
  assert.match(md, /understand` must ask for this/);
});

test('a rubric whose weights do not sum to 1 is rejected', () => {
  const p = payload();
  p.rubric[0].weight = 0.9;
  assert.throws(() => renderRubric(p, { pluginName: 'x' }), /weights must sum to 1/);
});

test('rubric renders anchors and a rubric_version', () => {
  const r = renderRubric(payload(), { pluginName: 'my-plugin' });
  assert.match(r, /rubric_version: v1/);
  assert.match(r, /## Loads cleanly {3}weight: 0\.6/);
  assert.match(r, /- 4 — enables with no warnings/);
  assert.equal(renderRubric({ rubric: [] }, { pluginName: 'x' }), null, 'no rubric is not an error');
});

test('handoff writes into .ab-bench/ but never state.json or env.json', async () => {
  const d = await fresh();
  const res = await writeHandoff(d, payload());
  assert.equal(res.mandateId, 'mandate-1');
  assert.ok(fs.existsSync(res.mandateFile));
  assert.ok(fs.existsSync(res.rubricFile));

  // Those two need experiments_root, which is the Optimizer's userConfig. Writing them would
  // fabricate an experiment Prospector has no basis to configure.
  assert.ok(!fs.existsSync(path.join(d, '.ab-bench', 'state.json')));
  assert.ok(!fs.existsSync(path.join(d, '.ab-bench', 'mandate-1', 'env.json')));
});

test('handoff honours an existing Optimizer mandate id rather than assuming mandate-1', async () => {
  const d = await fresh();
  fs.mkdirSync(path.join(d, '.ab-bench'), { recursive: true });
  fs.writeFileSync(path.join(d, '.ab-bench', 'state.json'), JSON.stringify({ current_mandate: 'mandate-3' }));
  assert.equal(resolveMandateId(d), 'mandate-3');
  assert.equal((await writeHandoff(d, payload())).mandateId, 'mandate-3');
});

test('handoff refuses to overwrite a live experiment\'s north star', async () => {
  const d = await fresh();
  await writeHandoff(d, payload());
  await assert.rejects(() => writeHandoff(d, payload()), /already exists/);
  // Every past run was planned and analysed against that file, so replacing it is only ever
  // deliberate.
  const forced = await writeHandoff(d, { ...payload(), domain: 'replaced' }, { force: true });
  assert.match(fs.readFileSync(forced.mandateFile, 'utf8'), /replaced/);
});
