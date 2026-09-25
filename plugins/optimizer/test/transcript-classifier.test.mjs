// What counts as a real user turn, read straight off a session JSONL.
//
// This file exists because analyzeFile had no coverage at all: pillars.test.mjs feeds
// synthetic metrics objects into compare-runs, so nothing ever exercised the classifier
// that BUILDS those objects. A background-Agent completion re-enters the session as a
// plain `type: "user"` entry and was scored as operator intervention for eight runs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { analyzeFile } from '../skills/analyze/scripts/analyze-jsonl.mjs';
import { promptParity } from '../skills/analyze/scripts/compare-runs.mjs';
import { tmpDir, cleanupAll } from './helpers.mjs';

test.after(cleanupAll);

const jsonl = (entries) => {
  const dir = tmpDir('transcript-');
  const p = path.join(dir, 'session.jsonl');
  fs.writeFileSync(p, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return p;
};

const typed = (text) => ({
  type: 'user',
  origin: { kind: 'human' },
  promptSource: 'typed',
  timestamp: '2026-08-05T11:45:39.361Z',
  message: { role: 'user', content: text },
});

// Shape taken verbatim from consultant run-007's test arm: plain string content, not
// meta, not a tool_result, not a sidechain — structurally identical to a typed prompt.
const taskNotification = (body) => ({
  type: 'user',
  origin: { kind: 'task-notification' },
  promptSource: 'system',
  slug: 'sharded-riding-hippo',
  timestamp: '2026-08-05T12:31:57.000Z',
  message: { role: 'user', content: `<task-notification>\n<task-id>a06c5263</task-id>\n${body}\n</task-notification>` },
});

test('a background-Agent completion is not an operator turn', () => {
  const brief = 'Read TASK.md in this directory and carry out the assignment exactly as written.';
  const m = analyzeFile(jsonl([
    typed(brief),
    taskNotification('x'.repeat(11_000)),
    taskNotification('y'.repeat(9_000)),
  ]));

  assert.equal(m.turns.user_real, 1, 'only the typed prompt is a real turn');
  assert.equal(m.turns.user_system_reentry, 2, 'both notifications are counted, not discarded');
  assert.equal(m.user_bias.real_user_turns, 1);
  assert.equal(m.user_bias.user_chars_total, brief.length, 'notification bodies must not inflate user_chars');
  assert.equal(m.user_bias.user_turns.length, 1, 'prompt-parity diffs only real turns');
});

test('the delegating arm is not scored as the intervened-in arm', () => {
  // The asymmetry that made this bug systematic rather than random: only an arm that
  // delegates receives these entries, and that is essentially always the test arm.
  const brief = 'Read TASK.md in this directory and carry out the assignment exactly as written.';
  const control = analyzeFile(jsonl([typed(brief)]));
  const testArm = analyzeFile(jsonl([typed(brief), taskNotification('z'.repeat(11_000))]));

  assert.equal(control.user_bias.real_user_turns, testArm.user_bias.real_user_turns);
  assert.equal(control.user_bias.user_chars_total, testArm.user_bias.user_chars_total);

  const parity = promptParity(control, testArm);
  assert.equal(parity.divergence.length, 0, 'one identical brief per arm is parity, not divergence');
  assert.deepEqual(parity.user_turns, { control: 1, test: 1 });

  // The delegation itself stays visible — it moved to its own counter rather than
  // being silently dropped.
  assert.equal(testArm.turns.user_system_reentry, 1);
  assert.equal(control.turns.user_system_reentry, 0);
});

test('a transcript predating origin/promptSource is still classified by its tag', () => {
  // Older sessions carry the <task-notification> body without the structural fields.
  const legacy = {
    type: 'user',
    timestamp: '2026-07-01T00:00:00.000Z',
    message: { role: 'user', content: '<task-notification>\n<task-id>old</task-id>\n</task-notification>' },
  };
  const m = analyzeFile(jsonl([typed('do the thing'), legacy]));

  assert.equal(m.turns.user_real, 1);
  assert.equal(m.turns.user_system_reentry, 1);
});

test('genuine operator interventions are still counted', () => {
  // The fix must not swing the other way: nudging a stalled arm IS a bias indicator,
  // and losing it would hide a real uncontrolled variable.
  const m = analyzeFile(jsonl([
    typed('Read TASK.md and carry out the assignment.'),
    taskNotification('noise'),
    typed('the deck is missing slide 9, add it'),
  ]));

  assert.equal(m.turns.user_real, 2);
  assert.equal(m.turns.user_system_reentry, 1);
  assert.equal(m.user_bias.user_turns.at(-1).preview, 'the deck is missing slide 9, add it');
});

// Claude Code writes one line per content block and repeats the usage object on each, so
// counting assistant lines overstates model requests. api_calls is what re-reads the context.
test('api_calls counts distinct message ids, not lines, and skips synthetic entries', () => {
  const usage = { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 100, cache_creation_input_tokens: 10, cache_creation: { ephemeral_1h_input_tokens: 4 } };
  const reply = (id, model, block) => ({ type: 'assistant', message: { id, model, usage, content: [block] } });
  const m = analyzeFile(jsonl([
    reply('msg_1', 'claude-opus-5-5', { type: 'text', text: 'reading two files' }),
    reply('msg_1', 'claude-opus-5-5', { type: 'tool_use', name: 'Read', input: {} }),
    reply('msg_1', 'claude-opus-5-5', { type: 'tool_use', name: 'Read', input: {} }),
    reply('msg_2', 'claude-opus-5-5', { type: 'text', text: 'done' }),
    reply('msg_3', '<synthetic>', { type: 'text', text: 'interrupted' }),
  ]));
  assert.equal(m.turns.assistant_messages, 5, 'lines');
  assert.equal(m.api_calls, 2, 'two requests reached the model; the synthetic entry did not');
  assert.equal(m.tokens_by_model['claude-opus-5-5'].cache_read, 200, 'usage counted once per request');
  assert.equal(m.tokens_by_model['claude-opus-5-5'].cache_creation_1h, 8, '1h writes kept apart for pricing');
});
