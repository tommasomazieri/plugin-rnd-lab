// Prospector's on-disk model and the Optimizer handoff contract.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  findRoot, paths, scaffold, readState, setStage,
  readHypotheses, addHypothesis, resolveHypothesis, rankHypotheses,
  addEvidence, addFraming, addDecision, cutPackage,
} from '../lib/prospector.mjs';
import { renderMandate, renderRubric, resolveMandateId, writeHandoff } from '../lib/handoff.mjs';

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
  await addFraming(d, { statement: 'F two', killed_by: 'E-001' });
  const cut = await cutPackage(d, { changed: 'after reframe' });

  assert.equal(cut.version, 2, 'numbering stays monotonic across a reframe');
  assert.ok(fs.existsSync(path.join(paths(d).packages, 'v1')));
  assert.ok(fs.existsSync(path.join(paths(d).packages, 'v2')));
  assert.ok(!fs.existsSync(path.join(paths(d).dir, 'framings')), 'no per-framing package tree');
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

test('a cut package is frozen — it cannot be silently re-cut', async () => {
  const d = await fresh();
  await cutPackage(d, { changed: 'first' });
  const state = await readState(d);
  state.package_version = 0; // simulate a stale writer trying to reuse v1
  fs.writeFileSync(paths(d).state, JSON.stringify(state));
  await assert.rejects(() => cutPackage(d, { changed: 'overwrite' }), /already exists — packages are frozen/);
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
