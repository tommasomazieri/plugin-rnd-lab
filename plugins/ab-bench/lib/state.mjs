// Shared helpers for ab-bench's plugin-repo-side state: <plugin-repo>/.ab-bench/
// (mandate-N/envs/env-M/ + state.json). Used by the SessionStart context hook and by
// every main-session skill's scripts (init/understand/plan/fire/analyze/status) so the
// resolution logic — where is .ab-bench/, what's the current mandate/env, where's the
// paired testenv folder — lives in exactly one place.
//
// Two-root model: configRoot (<plugin-repo>/.ab-bench/mandate-N/envs/env-M/, holds
// env.json) and testenvRoot (<experiments_root>/<plugin-folder-name>/mandate-N/env-M/,
// holds seed/, ledger.md, .dod/, baselines/, runs/) are siblings in the mandate/env
// hierarchy but physically live in different places on disk. Scripts that need both take
// both as explicit paths — nothing here ever assumes they're the same folder.

import fs from 'node:fs';
import path from 'node:path';

export const AB_BENCH_DIR = '.ab-bench';
export const STATE_FILE = 'state.json';

// Walk up from `startDir` looking for a `.ab-bench/` folder. Returns its absolute path,
// or null if none found before hitting the filesystem root. Mirrors how git resolves
// .git — lets the main session run from a subdirectory of the plugin repo, not just its
// exact root.
export function findAbBenchDir(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, AB_BENCH_DIR);
    if (fs.existsSync(path.join(candidate, STATE_FILE))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Walk up from `startDir` looking for `.git`. Used at /ab-bench:init time to decide
// where a FRESH .ab-bench/ gets created (repo root, not wherever the user happened to
// cd into) — falls back to startDir itself if no .git is found (plugin under test isn't
// a git repo yet).
export function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(startDir);
    dir = parent;
  }
}

export function loadState(abBenchDir) {
  const p = path.join(abBenchDir, STATE_FILE);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function saveState(abBenchDir, state) {
  fs.mkdirSync(abBenchDir, { recursive: true });
  const p = path.join(abBenchDir, STATE_FILE);
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, p);
}

// testenv path is fully auto-derived — no name the user has to invent. Collision note:
// two different repos sharing the same folder basename would collide here; state.json's
// own recorded plugin_repo path is the tiebreaker a skill can check if that ever comes up.
export function resolveTestenvRoot(experimentsRoot, pluginRepoRoot) {
  return path.join(experimentsRoot, path.basename(pluginRepoRoot));
}

// Next auto-increment id in a directory of "<prefix>-<N>" folders, e.g. nextId(abBenchDir, 'mandate') -> 'mandate-2'.
export function nextId(parentDir, prefix) {
  let max = 0;
  if (fs.existsSync(parentDir)) {
    for (const entry of fs.readdirSync(parentDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const m = entry.name.match(new RegExp(`^${prefix}-(\\d+)$`));
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return `${prefix}-${max + 1}`;
}

// Resolve every path a skill needs from state.json's current_mandate/current_env pointers.
export function currentPaths(abBenchDir, state, experimentsRoot) {
  const mandateDir = path.join(abBenchDir, state.current_mandate);
  const envDir = path.join(mandateDir, 'envs', state.current_env);
  const testenvRoot = state.testenv_root || resolveTestenvRoot(experimentsRoot, path.dirname(abBenchDir));
  return {
    mandateDir,
    mandateFile: path.join(mandateDir, 'mandate.md'),
    configRoot: envDir, // holds env.json — passed to scripts as "configRoot"
    envFile: path.join(envDir, 'env.json'),
    testenvRoot: path.join(testenvRoot, state.current_mandate, state.current_env),
  };
}

export function ensureGitignored(repoRoot) {
  const p = path.join(repoRoot, '.gitignore');
  const line = AB_BENCH_DIR + '/';
  let content = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  const lines = content.split(/\r?\n/);
  if (lines.some((l) => l.trim() === line || l.trim() === AB_BENCH_DIR)) return false;
  if (content.length > 0 && !content.endsWith('\n')) content += '\n';
  content += `${content ? '' : ''}${line}\n`;
  fs.writeFileSync(p, content);
  return true;
}
