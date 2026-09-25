// The lab layer: objective, hypothesis ranking, outcome classification, the curve.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
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
} from '../lib/lab.mjs';
import { tmpDir, cleanupAll } from './helpers.mjs';

test.after(cleanupAll);

const root = () => {
  const r = tmpDir('optimizer-lab-');
  ensureLab(r);
  return r;
};

test('declaring a priority auto-guards every other pillar and never guards the priority', () => {
  const r = root();
  const obj = declarePriority(r, { priority: 'api_calls', rationale: 'cost is the current pain' });
  assert.equal(obj.priority, 'api_calls');
  assert.ok(!('api_calls' in obj.guards), 'you cannot guard the thing you are deliberately moving');
  assert.deepEqual(Object.keys(obj.guards).sort(), ['autonomy', 'quality', 'turns', 'unique_tokens']);
});

test('a priority shift is retired into the record, not overwritten', () => {
  const r = root();
  declarePriority(r, { priority: 'api_calls', rationale: 'cost first' });
  declarePriority(r, { priority: 'quality', rationale: 'cost is solved; output is now the problem' });
  const obj = readObjective(r);
  assert.equal(obj.priority, 'quality');
  assert.equal(obj.prior_priorities.length, 1);
  assert.equal(obj.prior_priorities[0].priority, 'api_calls');
  assert.equal(obj.prior_priorities[0].rationale, 'cost first', 'why we cared then is the point of keeping it');
  assert.ok(obj.prior_priorities[0].retired_at);
});

test('an unknown pillar is rejected on both objective and hypothesis', () => {
  const r = root();
  assert.throws(() => declarePriority(r, { priority: 'vibes' }), /unknown pillar/);
  assert.throws(() => addHypothesis(r, { statement: 's', target_pillars: ['vibes'] }), /unknown pillar/);
});

test('a hypothesis with no target pillars is rejected', () => {
  const r = root();
  assert.throws(() => addHypothesis(r, { statement: 's', target_pillars: [] }), /at least one target pillar/);
  assert.throws(() => addHypothesis(r, { statement: '  ', target_pillars: ['turns'] }), /needs a statement/);
});

test('ranking puts priority-moving hypotheses first regardless of raw score', () => {
  const r = root();
  declarePriority(r, { priority: 'turns' });
  // Big score, but cannot move the priority.
  addHypothesis(r, { statement: 'huge win elsewhere', target_pillars: ['unique_tokens'], predicted_magnitude_pct: 90, confidence: 1, est_cost: 1 });
  // Small score, but on the priority.
  addHypothesis(r, { statement: 'small win on the thing that matters', target_pillars: ['turns'], predicted_magnitude_pct: 5, confidence: 0.4, est_cost: 2 });

  const { ranked } = rankHypotheses(r);
  assert.equal(ranked[0].statement, 'small win on the thing that matters');
  assert.equal(ranked[0].on_priority, true);
  assert.equal(ranked[1].on_priority, false);
});

test('within the priority group, score = magnitude x confidence / cost', () => {
  const r = root();
  declarePriority(r, { priority: 'turns' });
  addHypothesis(r, { statement: 'cheap and likely', target_pillars: ['turns'], predicted_magnitude_pct: 20, confidence: 0.8, est_cost: 1 });
  addHypothesis(r, { statement: 'expensive and unsure', target_pillars: ['turns'], predicted_magnitude_pct: 40, confidence: 0.3, est_cost: 4 });
  const { ranked } = rankHypotheses(r);
  assert.equal(ranked[0].statement, 'cheap and likely');
  assert.equal(ranked[0].score, 16);
  assert.equal(ranked[1].score, 3);
});

test('resolved hypotheses drop out of the ranking', () => {
  const r = root();
  declarePriority(r, { priority: 'turns' });
  const h = addHypothesis(r, { statement: 'x', target_pillars: ['turns'] });
  assert.equal(rankHypotheses(r).ranked.length, 1);
  resolveHypothesis(r, h.id, { run: 'run-001', outcome: 'confirmed', note: 'it worked' });
  assert.equal(rankHypotheses(r).ranked.length, 0);
});

test('classify: priority improved, guards held -> confirmed', () => {
  const r = root();
  declarePriority(r, { priority: 'api_calls', guards: { quality: { max_regression_pct: 5 } } });
  const out = classifyOutcome({ objective: readObjective(r), deltas: { api_calls: -20, quality: 1, turns: -2 } });
  assert.equal(out.outcome, 'confirmed');
  assert.deepEqual(out.breaches, []);
});

test('classify: priority improved but a guard breached -> won-at-a-cost', () => {
  // The case a single aggregate score would have hidden entirely.
  const r = root();
  declarePriority(r, { priority: 'api_calls', guards: { quality: { max_regression_pct: 5 } } });
  const out = classifyOutcome({ objective: readObjective(r), deltas: { api_calls: -30, quality: -12 } });
  assert.equal(out.outcome, 'won-at-a-cost');
  assert.equal(out.breaches[0].pillar, 'quality');
  assert.match(out.why, /quality regressed -12% past its 5% guard/);
});

test('classify: quality is the one pillar where up is the improvement', () => {
  const r = root();
  declarePriority(r, { priority: 'quality' });
  assert.equal(classifyOutcome({ objective: readObjective(r), deltas: { quality: 8 } }).outcome, 'confirmed');
  assert.equal(classifyOutcome({ objective: readObjective(r), deltas: { quality: -8 } }).outcome, 'refuted');
});

test('classify: an unmeasured priority or a contaminated run resolves nothing', () => {
  const r = root();
  declarePriority(r, { priority: 'turns' });
  const obj = readObjective(r);
  assert.equal(classifyOutcome({ objective: obj, deltas: { turns: null } }).outcome, 'inconclusive');
  assert.equal(classifyOutcome({ objective: obj, deltas: {} }).outcome, 'inconclusive');
  assert.equal(classifyOutcome({ objective: obj, deltas: { turns: -50 }, contaminated: true }).outcome, 'inconclusive');
});

test('a lab declared before 0.9.0 resolves nothing until re-declared, and re-declaring drops retired guards', () => {
  const r = root();
  // objective.json as an older optimizer wrote it: priority and a guard on retired pillars.
  const old = { schema: 1, priority: 'input_tokens', guards: { output_tokens: { max_regression_pct: 10 } }, declared_at: null, rationale: null, prior_priorities: [] };
  fs.writeFileSync(path.join(r, 'lab', 'objective.json'), JSON.stringify(old));
  const out = classifyOutcome({ objective: readObjective(r), deltas: { api_calls: -40, unique_tokens: -10 } });
  assert.equal(out.outcome, 'inconclusive');
  assert.match(out.why, /retired in optimizer 0\.9\.0.*Re-declare/);

  const obj = declarePriority(r, { priority: 'api_calls' });
  assert.ok(!('output_tokens' in obj.guards), 'a guard on a pillar that no longer exists would never fire');
  assert.equal(obj.prior_priorities[0].priority, 'input_tokens', 'the old priority stays in the record');
});

test('classify: with no priority declared nothing can be resolved', () => {
  const r = root();
  const out = classifyOutcome({ objective: readObjective(r), deltas: { turns: -50 } });
  assert.equal(out.outcome, 'inconclusive');
  assert.match(out.why, /no priority pillar declared/);
});

test('a finding must cite a run', () => {
  const r = root();
  assert.throws(() => appendFinding(r, { text: 'something true' }), /must cite the run/);
  appendFinding(r, { text: 'skill X reduces turns on refactor tasks', run: 'run-003', hypothesis: 'H-001' });
  const md = fs.readFileSync(path.join(r, 'lab', 'findings.md'), 'utf8');
  assert.match(md, /reduces turns on refactor tasks — `run-003` \(H-001\)/);
});

test('regression points form one series per rubric version', () => {
  const r = root();
  recordRegressionPoint(r, { run: 'run-001', rubric_version: 'v1', arms: { test: { quality: 2 } } });
  recordRegressionPoint(r, { run: 'run-002', rubric_version: 'v1', arms: { test: { quality: 3 } } });
  recordRegressionPoint(r, { run: 'run-003', rubric_version: 'v2', arms: { test: { quality: 1 } } });

  const series = regressionSeries(r);
  assert.equal(series.length, 2, 'a rubric bump forks the curve — these are not one line');
  assert.equal(series[0].points.length, 2);
  assert.equal(series[1].rubric_version, 'v2');
});

test('re-analysing a run replaces its regression point instead of duplicating it', () => {
  const r = root();
  recordRegressionPoint(r, { run: 'run-001', rubric_version: 'v1', arms: { test: { quality: 2 } } });
  recordRegressionPoint(r, { run: 'run-001', rubric_version: 'v1', arms: { test: { quality: 4 } } });
  const series = regressionSeries(r);
  assert.equal(series[0].points.length, 1);
  assert.equal(series[0].points[0].arms.test.quality, 4);
});

test('ensureLab is idempotent and never clobbers existing state', () => {
  const r = root();
  declarePriority(r, { priority: 'turns' });
  addHypothesis(r, { statement: 'keep me', target_pillars: ['turns'] });
  ensureLab(r);
  assert.equal(readObjective(r).priority, 'turns');
  assert.equal(rankHypotheses(r).ranked.length, 1);
});
