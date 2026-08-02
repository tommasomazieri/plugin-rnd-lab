// The five-pillar accounting, especially the autonomy correction.

import test from 'node:test';
import assert from 'node:assert/strict';

import { harnessHitl, electiveHitl, pillarsFor, pinsFromManifest } from '../skills/analyze/scripts/compare-runs.mjs';

const metrics = (over = {}) => ({
  tokens: { input: 1, output: 2, cache_read: 3, cache_creation: 4 },
  combined: { tokens: { input: 10, output: 20, cache_read: 30, cache_creation: 40 } },
  tool_calls: {},
  user_bias: { real_user_turns: 1 },
  turn_counter: { turns: 5 },
  ...over,
});

const dodSession = (state) => ({ checks: Object.keys(state), state });

test('harnessHitl counts only arm-reported human checks', () => {
  assert.equal(harnessHitl(null), 0);
  assert.equal(
    harnessHitl(dodSession({
      taste: { tier: 'human', answer_source: 'arm-reported' },
      shape: { tier: 'human', answer_source: 'arm-reported' },
      build: { tier: 'script', last_result: 'pass' },
      graded: { tier: 'prompt', last_result: 'pass' },
      unanswered: { tier: 'human' },
    })),
    2,
  );
});

test('elective HITL subtracts harness-induced interruptions', () => {
  // Three asks, two of which the DoD harness forced. Only one was the arm's choice.
  const m = metrics({ tool_calls: { AskUserQuestion: 3 }, user_bias: { real_user_turns: 1 } });
  const dod = dodSession({
    a: { tier: 'human', answer_source: 'arm-reported' },
    b: { tier: 'human', answer_source: 'arm-reported' },
  });
  assert.equal(electiveHitl(m, dod), 1);
});

test('adding a human check does not make an arm look less autonomous', () => {
  // The failure this correction exists to prevent: the same arm behaviour, scored
  // differently only because the run happened to carry a taste check.
  const m = metrics({ tool_calls: { AskUserQuestion: 2 } });
  const withoutHumanCheck = electiveHitl(m, dodSession({ build: { tier: 'script' } }));
  const withHumanCheck = electiveHitl(
    metrics({ tool_calls: { AskUserQuestion: 3 } }), // the extra ask IS the human check
    dodSession({ build: { tier: 'script' }, taste: { tier: 'human', answer_source: 'arm-reported' } }),
  );
  assert.equal(withHumanCheck, withoutHumanCheck, 'harness ceremony must be invisible to the pillar');
});

test('unprompted user turns beyond the opening prompt count against autonomy', () => {
  // A user who had to step in unasked is as much an autonomy failure as one who was asked.
  assert.equal(electiveHitl(metrics({ user_bias: { real_user_turns: 1 } }), null), 0, 'the opening prompt is not HITL');
  assert.equal(electiveHitl(metrics({ user_bias: { real_user_turns: 4 } }), null), 3);
});

test('elective HITL floors at zero rather than going negative', () => {
  const m = metrics({ tool_calls: { AskUserQuestion: 0 }, user_bias: { real_user_turns: 1 } });
  const dod = dodSession({ a: { tier: 'human', answer_source: 'arm-reported' } });
  assert.equal(electiveHitl(m, dod), 0, 'a forged or double-counted answer must not manufacture autonomy');
});

test('pillarsFor: input_tokens includes cache, and uses combined (arm + subagents)', () => {
  const p = pillarsFor(metrics(), null);
  assert.equal(p.input_tokens, 10 + 30 + 40, 'cache reads and writes are input tokens you paid for');
  assert.equal(p.output_tokens, 20);
  assert.equal(p.turns, 5);
  assert.equal(p.quality, null, 'quality comes from the rubric, never from this file');
});

test('pillarsFor: falls back to the arm session alone when there is no combined roll-up', () => {
  const m = metrics();
  delete m.combined;
  const p = pillarsFor(m, null);
  assert.equal(p.input_tokens, 1 + 3 + 4);
});

test('pillarsFor: a missing turn counter yields null, never a fabricated number', () => {
  const p = pillarsFor(metrics({ turn_counter: null }), null);
  assert.equal(p.turns, null);
});

test('pinsFromManifest: reads schema-2 artifacts for both arms', () => {
  const out = pinsFromManifest({
    arms: {
      control: { artifacts: [{ id: 'p', deliver: 'plugin-dir', requested_ref: 'v1', resolved: { kind: 'ref', sha: 'abc' } }] },
      test: { artifacts: [{ id: 'p', deliver: 'plugin-dir', requested_ref: null, resolved: { kind: 'worktree-snapshot', hash: 'h1', dirty: true } }] },
    },
  });
  assert.equal(out.control[0].requested_ref, 'v1');
  assert.equal(out.test[0].dirty, true);
  assert.equal(out.test[0].hash, 'h1');
});

test('pinsFromManifest: a schema-1 manifest still reports what control ran', () => {
  const out = pinsFromManifest({
    arms: { control: { baseline: { type: 'previous-version', ref: 'v0.1.0' } }, test: { baseline: { type: 'vanilla' } } },
  });
  assert.equal(out.control[0].requested_ref, 'v0.1.0');
  assert.deepEqual(out.test, []);
});

test('pinsFromManifest: a manifest with neither shape reports empty, not a crash', () => {
  const out = pinsFromManifest({ arms: {} });
  assert.deepEqual(out.control, []);
  assert.deepEqual(out.test, []);
});
