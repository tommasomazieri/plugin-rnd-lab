// The five-pillar accounting, especially the autonomy correction.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  harnessHitl,
  electiveHitl,
  pillarsFor,
  priceFor,
  listCost,
  pinsFromManifest,
  promptParity,
  similarity,
} from '../skills/analyze/scripts/compare-runs.mjs';

const metrics = (over = {}) => ({
  api_calls: 7,
  tokens: { input: 1, output: 2, cache_read: 3, cache_creation: 4 },
  combined: { api_calls: 50, tokens: { input: 10, output: 20, cache_read: 30, cache_creation: 40 } },
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

test('pillarsFor: unique_tokens leaves cache reads out, and uses combined (arm + subagents)', () => {
  const p = pillarsFor(metrics(), null);
  assert.equal(p.unique_tokens, 10 + 40 + 20, 'uncached input + cache writes + output; cache reads are api_calls x context');
  assert.equal(p.api_calls, 50);
  assert.equal(p.api_calls_per_turn, 10);
  assert.equal(p.turns, 5);
  assert.equal(p.quality, null, 'quality comes from the rubric, never from this file');
});

test('pillarsFor: falls back to the arm session alone when there is no combined roll-up', () => {
  const m = metrics();
  delete m.combined;
  const p = pillarsFor(m, null);
  assert.equal(p.unique_tokens, 1 + 4 + 2);
  assert.equal(p.api_calls, 7);
});

test('pillarsFor: no turn counter means no per-turn rate, not a division by zero', () => {
  const p = pillarsFor(metrics({ turn_counter: null }), null);
  assert.equal(p.api_calls_per_turn, null);
});

test('priceFor: exact id or a date suffix, never a looser prefix', () => {
  assert.equal(priceFor('claude-opus-5-5').key, 'claude-opus-5-5', 'longer key is not shadowed by claude-opus-5');
  assert.equal(priceFor('claude-opus-5').key, 'claude-opus-5');
  assert.equal(priceFor('claude-haiku-4-5-20251001').key, 'claude-haiku-4-5');
  assert.equal(priceFor('claude-opus-4-9'), null, 'an unknown model is not priced as claude-opus-4');
});

test('listCost: prices each category, splits 1h from 5m writes, and never guesses a model', () => {
  const table = { m: { input: 1, output: 10, cache_write_5m: 2, cache_write_1h: 4, cache_read: 0.5 } };
  const t = { input: 1e6, output: 1e6, cache_read: 2e6, cache_creation: 3e6, cache_creation_1h: 1e6 };
  assert.equal(listCost({ m: t }, table).usd, 1 + 10 + 1 + 2 * 2 + 4, '2M of the writes at 5m, 1M at 1h');
  const unknown = listCost({ m: t, mystery: t }, table);
  assert.equal(unknown.usd, null, 'a partial total would read as a saving');
  assert.deepEqual(unknown.unpriced, ['mystery']);
  const zero = { input: 0, output: 0, cache_read: 0, cache_creation: 0, cache_creation_1h: 0 };
  assert.equal(listCost({ m: t, '<synthetic>': zero }, table).usd, 20, 'a model with no usage does not null the total');
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
