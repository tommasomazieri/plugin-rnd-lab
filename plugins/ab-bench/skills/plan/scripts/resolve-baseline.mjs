#!/usr/bin/env node
/**
 * resolve-baseline.mjs — resolve control's arm config for one run: vanilla, or a
 * previous-version git worktree checkout of the plugin-under-test.
 *
 * Usage:
 *   node resolve-baseline.mjs <envRoot> <runDir> --vanilla
 *   node resolve-baseline.mjs <envRoot> <runDir> --ref <tag-or-commit>
 *
 * --vanilla: writes runs/run-NNN/baseline.json with control_baseline.type = "vanilla"
 *   (today's behavior — control gets nothing beyond env.json's control block).
 *
 * --ref <ref>: requires env.json's `pluginUnderTestRepo` (a git repo). Checks out (or
 *   reuses, if already checked out) a worktree of that repo at <ref>, cached under
 *   <envRoot>/baselines/<sanitized-ref>/ so every future run pinning the same ref reuses
 *   it instead of re-checking out. Globs the worktree for plugin.json files — each
 *   containing folder becomes a control pluginDirs entry (covers monorepos shipping
 *   multiple plugins, e.g. the blender suite's six plugins from one repo/tag).
 *
 * Writes runs/run-NNN/baseline.json, read by launch-pair.mjs at fire time to layer
 * these pluginDirs onto control's composed arm config for that run only. env.json's own
 * control block is never touched.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', '.dod']);

function fail(msg) {
  console.error(`[resolve-baseline] ERROR: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { envRoot: null, runDir: null, ref: null, vanilla: false };
  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--vanilla') args.vanilla = true;
    else if (a === '--ref') args.ref = argv[++i];
    else positional.push(a);
  }
  if (positional.length < 2) {
    fail('usage: node resolve-baseline.mjs <envRoot> <runDir> (--vanilla | --ref <tag-or-commit>)');
  }
  args.envRoot = path.resolve(positional[0]);
  args.runDir = path.resolve(positional[1]);
  if (!args.vanilla && !args.ref) fail('must pass either --vanilla or --ref <tag-or-commit>');
  if (args.vanilla && args.ref) fail('pass either --vanilla or --ref, not both');
  return args;
}

function loadEnv(envRoot) {
  const envPath = path.join(envRoot, 'env.json');
  if (!fs.existsSync(envPath)) fail(`env.json not found in ${envRoot}`);
  try {
    return JSON.parse(fs.readFileSync(envPath, 'utf8'));
  } catch (e) {
    fail(`env.json is not valid JSON: ${e.message}`);
  }
}

function git(repo, args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

function sanitizeRef(ref) {
  return ref.replace(/[^A-Za-z0-9._-]/g, '-');
}

// parses `git worktree list --porcelain` and returns the set of registered worktree paths
function listWorktrees(repo) {
  let out;
  try {
    out = git(repo, ['worktree', 'list', '--porcelain']);
  } catch (e) {
    fail(`"${repo}" doesn't look like a git repo (git worktree list failed: ${e.message})`);
  }
  const paths = [];
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) paths.push(path.resolve(line.slice('worktree '.length).trim()));
  }
  return paths;
}

function ensureWorktree(repo, ref, worktreePath) {
  const registered = listWorktrees(repo);
  if (registered.includes(path.resolve(worktreePath))) {
    console.log(`[resolve-baseline] reusing existing worktree: ${worktreePath}`);
    return;
  }
  if (fs.existsSync(worktreePath)) {
    const contents = fs.readdirSync(worktreePath);
    if (contents.length > 0) {
      fail(
        `${worktreePath} already exists, is not a registered worktree of ${repo}, and is not empty — ` +
          `refusing to touch it. Remove it manually (or \`git worktree prune\` in ${repo}) if it's stale.`
      );
    }
    fs.rmdirSync(worktreePath);
  }
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
  try {
    git(repo, ['worktree', 'add', '--detach', worktreePath, ref]);
  } catch (e) {
    fail(`git worktree add failed for ref "${ref}" — does that tag/commit exist in ${repo}? (${e.message})`);
  }
  console.log(`[resolve-baseline] checked out ${ref} -> ${worktreePath}`);
}

function findPluginDirs(root) {
  const found = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isFile() && e.name === 'plugin.json')) {
      found.push(dir);
      return; // don't descend into a plugin's own folder looking for nested plugin.json
    }
    for (const e of entries) {
      if (e.isDirectory() && !SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name));
    }
  }
  walk(root);
  return found;
}

function main() {
  const { envRoot, runDir, ref, vanilla } = parseArgs(process.argv);
  if (!fs.existsSync(runDir)) fail(`runDir does not exist: ${runDir}`);

  const baselinePath = path.join(runDir, 'baseline.json');

  if (vanilla) {
    fs.writeFileSync(
      baselinePath,
      JSON.stringify({ schema: 1, run: path.basename(runDir), control_baseline: { type: 'vanilla' } }, null, 2)
    );
    console.log(`[resolve-baseline] control_baseline: vanilla -> ${baselinePath}`);
    return;
  }

  const env = loadEnv(envRoot);
  const repo = env.pluginUnderTestRepo;
  if (!repo) fail('env.json has no "pluginUnderTestRepo" — set it first (see /ab-bench:init) to pin a previous-version baseline');
  if (!fs.existsSync(repo)) fail(`pluginUnderTestRepo does not exist: ${repo}`);

  const worktreePath = path.join(envRoot, 'baselines', sanitizeRef(ref));
  ensureWorktree(repo, ref, worktreePath);

  const pluginDirs = findPluginDirs(worktreePath);
  if (pluginDirs.length === 0) {
    fail(`no plugin.json found anywhere under ${worktreePath} — wrong ref, or repo layout changed at that ref`);
  }

  fs.writeFileSync(
    baselinePath,
    JSON.stringify(
      {
        schema: 1,
        run: path.basename(runDir),
        control_baseline: { type: 'previous-version', ref, repoPath: repo, worktreePath, pluginDirs },
      },
      null,
      2
    )
  );
  console.log(`[resolve-baseline] control_baseline: previous-version@${ref} — ${pluginDirs.length} plugin(s) -> ${baselinePath}`);
  for (const d of pluginDirs) console.log(`  - ${d}`);
}

main();
