// Fixture builders for the ab-bench suite. These make REAL git repos and REAL directory
// trees, because the code under test shells out to git and copies files — a mock would
// only test the mock.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const AB_BENCH_ROOT = path.resolve(HERE, '..');
export const SCRIPTS = {
  resolveBaseline: path.join(AB_BENCH_ROOT, 'skills', 'plan', 'scripts', 'resolve-baseline.mjs'),
  launchPair: path.join(AB_BENCH_ROOT, 'skills', 'fire', 'scripts', 'launch-pair.mjs'),
  probeChecks: path.join(AB_BENCH_ROOT, 'skills', 'plan', 'scripts', 'probe-checks.mjs'),
};

const created = [];

export function tmpDir(label = 'ab-bench-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), label));
  created.push(dir);
  return fs.realpathSync(dir);
}

export function cleanupAll() {
  for (const dir of created.splice(0)) {
    try {
      // Registered worktrees hold handles; prune them so the rm can succeed.
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch { /* a leaked temp dir is not a test failure */ }
  }
}

export function git(repo, args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

export function write(root, rel, contents) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, contents);
  return p;
}

/** A git repo with an initial commit, isolated from the user's global git config. */
export function makeRepo(files = { 'README.md': 'v1\n' }) {
  const repo = tmpDir('ab-bench-repo-');
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 'test@example.invalid']);
  git(repo, ['config', 'user.name', 'ab-bench test']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  // Without this, a Windows checkout rewrites LF to CRLF and fixtures stop being
  // byte-comparable. The resolver itself is line-ending agnostic; the test needs exactness.
  git(repo, ['config', 'core.autocrlf', 'false']);
  for (const [rel, contents] of Object.entries(files)) write(repo, rel, contents);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'initial']);
  return repo;
}

export function commitAll(repo, message = 'change') {
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', message]);
  return git(repo, ['rev-parse', 'HEAD']).trim();
}

export function tag(repo, name) {
  git(repo, ['tag', name]);
  return name;
}

/** A repo shaped like a Claude Code plugin, so findPluginDirs has something to find. */
export function makePluginRepo(pluginName = 'demo') {
  return makeRepo({
    [`plugins/${pluginName}/.claude-plugin/plugin.json`]: JSON.stringify({ name: pluginName, version: '0.1.0' }, null, 2),
    [`plugins/${pluginName}/README.md`]: 'v1\n',
  });
}

/** configRoot (holds env.json) + testenvRoot (holds seed/, runs/, baselines/, .dod/). */
export function makeEnvPair(envJson, { seed = { 'seed.txt': 'seed\n' } } = {}) {
  const base = tmpDir('ab-bench-env-');
  const configRoot = path.join(base, '.ab-bench', 'mandate-1', 'envs', 'env-1');
  const testenvRoot = path.join(base, 'testenv', 'mandate-1', 'env-1');
  fs.mkdirSync(configRoot, { recursive: true });
  fs.mkdirSync(path.join(testenvRoot, 'runs'), { recursive: true });
  fs.mkdirSync(path.join(testenvRoot, '.dod', 'checks'), { recursive: true });
  fs.mkdirSync(path.join(testenvRoot, 'seed'), { recursive: true });
  for (const [rel, contents] of Object.entries(seed)) write(path.join(testenvRoot, 'seed'), rel, contents);
  fs.writeFileSync(path.join(configRoot, 'env.json'), JSON.stringify(envJson, null, 2));
  return { base, configRoot, testenvRoot };
}

export function makeRun(testenvRoot, name = 'run-001', task = 'Do the thing.\n') {
  const runDir = path.join(testenvRoot, 'runs', name);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'task.md'), task);
  return runDir;
}

export function node(scriptPath, args, opts = {}) {
  const r = execFileSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
  return r;
}

/** Runs a script expecting failure; returns {status, stdout, stderr}. */
export function nodeExpectFail(scriptPath, args, opts = {}) {
  try {
    const stdout = node(scriptPath, args, opts);
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    return { status: e.status ?? -1, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') };
  }
}

export function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
