// Finding dod-lite from wherever optimizer was installed.
//
// Every other suite here runs optimizer from this clone, where dod-lite is a plain sibling —
// the one layout that always worked. A GitHub install copies each plugin into its own
// versioned cache folder instead, and in that layout `fire` refused to launch and the `plan`
// probe crashed on import, for every stranger and never once for the author. These tests
// build the cached layout on disk, from the real plugin files, and run the real scripts in it.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { resolveDodLiteDir, installedMarketplace } from '../lib/dod-lite-dir.mjs';

const OPTIMIZER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOD_LITE_ROOT = path.resolve(OPTIMIZER_ROOT, '..', 'dod-lite');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dodlite-dir-'));
}

function fakeEngine(dir) {
  fs.mkdirSync(path.join(dir, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'hooks', 'dod-check.mjs'), '');
}

test('in place: a clone finds dod-lite as optimizer\'s sibling', () => {
  assert.equal(resolveDodLiteDir(OPTIMIZER_ROOT), DOD_LITE_ROOT);
});

test('cached: a GitHub install finds dod-lite in its own versioned folder, newest first', () => {
  const cache = tmp();
  try {
    const optimizer = path.join(cache, 'plugin-rnd-lab', 'optimizer', '0.8.0');
    fs.mkdirSync(optimizer, { recursive: true });
    // 0.10.0 must beat 0.9.0: a plain string sort gets this backwards.
    for (const v of ['0.9.0', '0.10.0']) fakeEngine(path.join(cache, 'plugin-rnd-lab', 'dod-lite', v));
    // A version folder without the engine in it is a half-written update, not a candidate.
    fs.mkdirSync(path.join(cache, 'plugin-rnd-lab', 'dod-lite', '0.11.0'), { recursive: true });
    assert.equal(resolveDodLiteDir(optimizer), path.join(cache, 'plugin-rnd-lab', 'dod-lite', '0.10.0'));
  } finally {
    fs.rmSync(cache, { recursive: true, force: true });
  }
});

test('missing: no dod-lite in either layout is null, not a guessed path', () => {
  const cache = tmp();
  try {
    const optimizer = path.join(cache, 'plugin-rnd-lab', 'optimizer', '0.8.0');
    fs.mkdirSync(optimizer, { recursive: true });
    assert.equal(resolveDodLiteDir(optimizer), null);
  } finally {
    fs.rmSync(cache, { recursive: true, force: true });
  }
});

test('the install hint names the marketplace optimizer actually came from', () => {
  assert.equal(installedMarketplace(OPTIMIZER_ROOT), 'plugin-rnd-lab');
  const cached = path.join('cache', 'claude-community', 'optimizer', '0.8.3');
  assert.equal(installedMarketplace(path.resolve(cached)), 'claude-community');
});

test('a directory install missing dod-lite is told to install it from claude-community', () => {
  const cache = tmp();
  try {
    const optimizer = path.join(cache, 'claude-community', 'optimizer', '0.8.3');
    fs.cpSync(OPTIMIZER_ROOT, optimizer, { recursive: true, filter: (src) => !src.split(path.sep).includes('test') });
    const probe = spawnSync(process.execPath,
      [path.join(optimizer, 'skills', 'plan', 'scripts', 'probe-checks.mjs')],
      { encoding: 'utf8' });
    assert.match(probe.stderr, /claude plugin install dod-lite@claude-community/, probe.stderr);
  } finally {
    fs.rmSync(cache, { recursive: true, force: true });
  }
});

test('the real launcher and the real probe both start from a cached layout', () => {
  const cache = tmp();
  try {
    const optimizer = path.join(cache, 'plugin-rnd-lab', 'optimizer', '0.8.0');
    const dodLite = path.join(cache, 'plugin-rnd-lab', 'dod-lite', '0.4.1');
    const skipTests = (src) => !src.split(path.sep).includes('test');
    fs.cpSync(OPTIMIZER_ROOT, optimizer, { recursive: true, filter: skipTests });
    fs.cpSync(DOD_LITE_ROOT, dodLite, { recursive: true, filter: skipTests });

    // No experiment exists, so each script must get as far as complaining about that —
    // which it can only do after dod-lite has been found and, for the probe, imported.
    const nowhere = path.join(cache, 'no-such-experiment');
    const launch = spawnSync(process.execPath,
      [path.join(optimizer, 'skills', 'fire', 'scripts', 'launch-pair.mjs'), nowhere, nowhere, '--dry-run'],
      { encoding: 'utf8' });
    assert.doesNotMatch(launch.stderr, /dod-lite\) not found/, launch.stderr);
    assert.match(launch.stderr, /env\.json not found/, launch.stderr);

    const probe = spawnSync(process.execPath,
      [path.join(optimizer, 'skills', 'plan', 'scripts', 'probe-checks.mjs')],
      { encoding: 'utf8' });
    assert.doesNotMatch(probe.stderr, /ERR_MODULE_NOT_FOUND|dod-lite\) not found/, probe.stderr);
  } finally {
    fs.rmSync(cache, { recursive: true, force: true });
  }
});
