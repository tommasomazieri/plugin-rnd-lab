// The feedback form's link is written into the README, the issue-template chooser, the launch
// post and five skills that print it as their last line. The form can be rebuilt in place under
// the same link (launch/feedback-form.gs), but if it ever moves, every copy has to move with it;
// this fails on the first one left behind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FORM = /https:\/\/docs\.google\.com\/forms\/d\/e\/[\w-]+\/viewform/g;
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const readmeLink = () => read('README.md').match(FORM)?.[0];

// The skills that end a reply with the line. Each one says when; the line itself is identical.
const SKILLS_WITH_LINE = [
  'plugins/optimizer/skills/analyze/SKILL.md',
  'plugins/optimizer/skills/paper/SKILL.md',
  'plugins/prospector/skills/build/SKILL.md',
  'plugins/prospector/skills/handoff/SKILL.md',
  'plugins/core/skills/learn/SKILL.md',
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules' || name === '.dod') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(md|mjs|js|json|ya?ml|txt|gs)$/.test(name)) out.push(full);
  }
  return out;
}

test('the README links the feedback form', () => {
  assert.ok(readmeLink(), 'no Google Forms link in README.md');
});

test('every copy of the form link in the repo is the same link', () => {
  const link = readmeLink();
  const stray = [];
  for (const file of walk(ROOT)) {
    for (const found of readFileSync(file, 'utf8').match(FORM) ?? []) {
      if (found !== link) stray.push(`${path.relative(ROOT, file)}: ${found}`);
    }
  }
  assert.deepEqual(stray, []);
});

test('each skill that closes with the feedback line carries it verbatim', () => {
  const line = `Feedback on plugin-rnd-lab, mostly clicks: ${readmeLink()}`;
  for (const rel of SKILLS_WITH_LINE) {
    assert.ok(read(rel).includes(line), `${rel} does not carry the feedback line`);
  }
});

test('the issue-template chooser offers the form', () => {
  assert.ok(read('.github/ISSUE_TEMPLATE/config.yml').includes(readmeLink()));
});
