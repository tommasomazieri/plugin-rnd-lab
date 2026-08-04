// The five-pillar accounting, especially the autonomy correction.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  harnessHitl,
  electiveHitl,
  pillarsFor,
  pinsFromManifest,
  promptParity,
  similarity,
} from '../skills/analyze/scripts/compare-runs.mjs';

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

// Prompt parity. Once the DoD auditor stopped driving arms to completion, the operator's own
// between-turn prompts became an uncontrolled independent variable across two arms.

const withTurns = (texts) => ({
  user_bias: {
    real_user_turns: texts.length,
    user_turns: texts.map((text) => ({ at: null, chars: text.length, preview: text.slice(0, 80), text })),
  },
});

test('similarity: identical is 1, disjoint is 0, reworded lands in between', () => {
  assert.equal(similarity('fix the failing test', 'fix the failing test'), 1);
  assert.equal(similarity('alpha beta', 'gamma delta'), 0);
  assert.equal(similarity('', ''), 1, 'two empty turns are not a divergence');
  const s = similarity('please fix the failing test', 'fix the failing test now');
  assert.ok(s > 0 && s < 1, `reworded should be partial, got ${s}`);
});

test('promptParity: identical turns on both arms is PARITY', () => {
  const p = promptParity(withTurns(['do the task', 'keep going']), withTurns(['do the task', 'keep going']));
  assert.deepEqual(p.divergence, []);
  assert.match(p.verdict, /^PARITY/);
  assert.equal(p.opening, 'identical (task.md)');
  assert.deepEqual(p.user_turns, { control: 2, test: 2 });
});

test('promptParity: a different follow-up is flagged with both sides quoted', () => {
  const p = promptParity(
    withTurns(['do the task', 'try a completely different approach instead']),
    withTurns(['do the task', 'keep going']),
  );
  assert.equal(p.divergence.length, 1);
  assert.equal(p.divergence[0].turn, 1, 'turn 0 matched, so only the follow-up diverged');
  assert.match(p.verdict, /^DIVERGENT/);
  assert.match(p.divergence[0].control, /completely different approach/);
  assert.match(p.divergence[0].test, /keep going/);
});

test('promptParity: an extra turn on one arm counts as divergence', () => {
  const p = promptParity(withTurns(['do the task', 'again', 'and again']), withTurns(['do the task']));
  assert.equal(p.divergence.length, 2, 'both unmatched turns are reported');
  assert.equal(p.divergence[0].reason, 'one arm has no such turn');
  assert.equal(p.divergence[0].test, '— (no turn)');
  assert.match(p.verdict, /^DIVERGENT/);
});

test('promptParity: a diverged OPENING is a launch fault, reported separately', () => {
  // Both arms are sent the same opening prompt against the same TASK.md. If turn 0 differs,
  // the operator is not the cause and saying "you typed different things" would misdirect.
  const p = promptParity(withTurns(['build a parser']), withTurns(['write documentation']));
  assert.match(p.opening, /launch fault/);
  assert.match(p.verdict, /^DIVERGENT/);
});

test('promptParity: missing user_bias degrades to empty, never throws', () => {
  const p = promptParity({}, {});
  assert.deepEqual(p.user_turns, { control: 0, test: 0 });
  assert.match(p.verdict, /^PARITY/);
});
