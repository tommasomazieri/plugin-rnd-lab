// Check loading, classification, and the script tier.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  parseFrontmatter,
  parseList,
  findCheckFile,
  loadCheckDefs,
  seedExpectation,
  runScriptCheck,
  validateCheckerModel,
} from '../hooks/dod-check.mjs';
import { loadRunners, readAnswers, truncate } from '../hooks/lib.mjs';
import { makeWorkspace, cleanupAll, writeCheck, writeScriptCheck, writeMeta, writeAnswer } from './helpers.mjs';

test.after(cleanupAll);

test('parseFrontmatter: strips quotes, tolerates CRLF, keeps colons in values', () => {
  const { meta, body } = parseFrontmatter(
    '---\r\ntype: prompt\r\ndescription: "has: a colon"\r\nmodel: \'claude-x\'\r\n---\r\nthe question\r\n',
  );
  assert.equal(meta.type, 'prompt');
  assert.equal(meta.description, 'has: a colon');
  assert.equal(meta.model, 'claude-x');
  assert.equal(body, 'the question');
});

test('parseFrontmatter: no frontmatter means the whole file is the body', () => {
  const { meta, body } = parseFrontmatter('just a question\n');
  assert.deepEqual(meta, {});
  assert.equal(body, 'just a question');
});

test('parseFrontmatter: unterminated frontmatter is treated as body, not a crash', () => {
  const { meta, body } = parseFrontmatter('---\ntype: prompt\nnever closed\n');
  assert.deepEqual(meta, {});
  assert.ok(body.includes('never closed'));
});

test('parseList: json array, csv, and empty', () => {
  assert.deepEqual(parseList('["a","b"]'), ['a', 'b']);
  assert.deepEqual(parseList('a, b ,c'), ['a', 'b', 'c']);
  assert.deepEqual(parseList(''), []);
  assert.deepEqual(parseList(undefined), []);
  assert.deepEqual(parseList(['x']), ['x']);
});

test('validateCheckerModel: rejects bare "haiku", accepts documented aliases and full ids', () => {
  // The regression that made every authored check bill as Sonnet without saying so.
  assert.equal(validateCheckerModel('haiku').ok, false);
  assert.match(validateCheckerModel('haiku').reason, /full model id/);
  for (const ok of ['opus', 'sonnet', 'fable', 'claude-haiku-4-5-20251001', undefined]) {
    assert.equal(validateCheckerModel(ok).ok, true, `expected ${ok} to be accepted`);
  }
  assert.equal(validateCheckerModel('gpt-4').ok, false);
});

test('findCheckFile: ambiguous id is reported, never silently resolved', async () => {
  const cwd = makeWorkspace();
  writeScriptCheck(cwd, 'dup', 0);
  writeCheck(cwd, 'dup.md', '---\ntype: prompt\n---\nq');
  const found = await findCheckFile(cwd, 'dup');
  assert.deepEqual(found.ambiguous, ['dup.md', 'dup.mjs']);

  const defs = await loadCheckDefs(cwd, ['dup']);
  assert.equal(defs.dup.type, 'ambiguous');

  const r = await runScriptCheck(cwd, await loadRunners(cwd), 'dup', defs.dup);
  assert.equal(r.result, 'error', 'ambiguity is infrastructure breakage, not a failed criterion');
  assert.match(r.output, /more than one file/);
});

test('findCheckFile: .meta.json sidecars are not mistaken for checks', async () => {
  const cwd = makeWorkspace();
  writeScriptCheck(cwd, 'thing', 0);
  writeMeta(cwd, 'thing', { seed_expectation: 'pass' });
  const found = await findCheckFile(cwd, 'thing');
  assert.ok(!found.ambiguous, 'sidecar must not collide with its own check');
  assert.equal(path.extname(found.full), '.mjs');
});

test('loadCheckDefs: classifies script, prompt, human, missing', async () => {
  const cwd = makeWorkspace();
  writeScriptCheck(cwd, 's', 0);
  writeCheck(cwd, 'p.md', '---\ntype: prompt\n---\nq');
  writeCheck(cwd, 'h.md', '---\ntype: human\n---\nq');
  writeCheck(cwd, 'defaulted.md', 'no frontmatter at all');
  const defs = await loadCheckDefs(cwd, ['s', 'p', 'h', 'defaulted', 'nope']);
  assert.equal(defs.s.type, 'script');
  assert.equal(defs.p.type, 'prompt');
  assert.equal(defs.h.type, 'human');
  assert.equal(defs.defaulted.type, 'prompt', '.md without a type defaults to prompt');
  assert.equal(defs.nope.type, 'missing');
});

test('seedExpectation: defaults to fail, honours a declared pass, case-insensitive', async () => {
  const cwd = makeWorkspace();
  writeScriptCheck(cwd, 'a', 0);
  writeScriptCheck(cwd, 'b', 0);
  writeMeta(cwd, 'b', { seed_expectation: 'PASS' });
  writeCheck(cwd, 'c.md', '---\ntype: prompt\nseed_expectation: pass\n---\nq');
  const defs = await loadCheckDefs(cwd, ['a', 'b', 'c']);
  assert.equal(seedExpectation(defs.a), 'fail');
  assert.equal(seedExpectation(defs.b), 'pass');
  assert.equal(seedExpectation(defs.c), 'pass');
  assert.equal(seedExpectation({}), 'fail', 'garbage defaults to the safe expectation');
});

test('runScriptCheck: exit 0 passes, non-zero fails, output is captured', async () => {
  const cwd = makeWorkspace();
  writeScriptCheck(cwd, 'good', 0, { stdout: 'all good' });
  writeScriptCheck(cwd, 'bad', 3, { stdout: 'nope' });
  const defs = await loadCheckDefs(cwd, ['good', 'bad']);
  const runners = await loadRunners(cwd);

  const good = await runScriptCheck(cwd, runners, 'good', defs.good);
  assert.equal(good.result, 'pass');
  assert.match(good.output, /all good/);

  const bad = await runScriptCheck(cwd, runners, 'bad', defs.bad);
  assert.equal(bad.result, 'fail');
  assert.match(bad.output, /nope/);
});

test('runScriptCheck: missing file fails, unknown extension fails, neither errors', async () => {
  const cwd = makeWorkspace();
  writeCheck(cwd, 'weird.xyz', 'nothing runs this');
  const defs = await loadCheckDefs(cwd, ['gone', 'weird']);
  const runners = await loadRunners(cwd);

  const gone = await runScriptCheck(cwd, runners, 'gone', defs.gone);
  assert.equal(gone.result, 'fail');
  assert.match(gone.output, /not found/);

  const weird = await runScriptCheck(cwd, runners, 'weird', defs.weird);
  assert.equal(weird.result, 'fail');
  assert.match(weird.output, /No runner configured/);
});

test('runScriptCheck: a hanging check is killed and recorded as error, not fail', async () => {
  // error, never fail: a checker that never returned tells us nothing about the
  // criterion, and recording it as fail would block the arm over harness breakage.
  const cwd = makeWorkspace();
  writeScriptCheck(cwd, 'hang', 0, { hang: true });
  const defs = await loadCheckDefs(cwd, ['hang']);
  const runners = await loadRunners(cwd);

  const r = await runScriptCheck(cwd, runners, 'hang', defs.hang, 1200);
  assert.equal(r.result, 'error');
  assert.match(r.output, /without exiting/);
});

test('loadRunners: config.json overrides merge onto defaults, malformed config degrades', async () => {
  const cwd = makeWorkspace();
  fs.writeFileSync(path.join(cwd, '.dod', 'config.json'), '{ not json');
  const runners = await loadRunners(cwd);
  assert.equal(runners['.mjs'], 'node', 'a malformed config must not take the runner table down');
});

test('readAnswers: reads valid files, ignores malformed ones, tolerates a missing dir', async () => {
  const cwd = makeWorkspace();
  assert.deepEqual(await readAnswers(cwd), {}, 'no .dod-answers/ is not an error');

  writeAnswer(cwd, 'ok', { result: 'pass', note: '', answered_at: 'now' });
  fs.writeFileSync(path.join(cwd, '.dod-answers', 'broken.json'), '{ nope');
  const answers = await readAnswers(cwd);
  assert.equal(answers.ok.result, 'pass');
  assert.ok(!('broken' in answers), 'a malformed answer file is skipped, not thrown');
});

test('truncate: bounds output and marks it', () => {
  assert.equal(truncate('abc', 10), 'abc');
  const long = truncate('x'.repeat(50), 10);
  assert.ok(long.length < 50);
  assert.match(long, /truncated/);
});
