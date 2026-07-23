#!/usr/bin/env node
/**
 * ab-bench-scaffold.mjs — mechanical folder/state.json plumbing for /ab-bench:init.
 * The skill still runs the interview and writes env.json/mandate.md CONTENT via the
 * Write tool (same convention as before) — this script only ever creates directories,
 * writes state.json, appends .gitignore, and hands back the exact paths the skill
 * should write next. It never overwrites an existing env.json/mandate.md/ledger.md.
 *
 * Subcommands (each prints one JSON line to stdout):
 *   detect <repoRoot> <experimentsRoot>
 *     Read-only. { status: "fresh" } or { status: "existing", state, mandateExists,
 *     envExists, mandates: [...], envsUnderCurrentMandate: [...] }
 *
 *   create-fresh <repoRoot> <experimentsRoot>
 *     First-ever /ab-bench:init in this repo. Creates .ab-bench/mandate-1/envs/env-1/,
 *     the paired testenv folder (seed/, .dod/, runs/, ledger.md), state.json, and
 *     appends .ab-bench/ to the repo's .gitignore. Prints target paths for env.json
 *     (not yet written — skill writes it after the interview) and mandate.md (written
 *     by /ab-bench:understand, invoked mandatorily right after).
 *
 *   create-env <repoRoot> <experimentsRoot>
 *     Bumps env-N -> env-(N+1) under the CURRENT mandate (arm config changed, plugin
 *     purpose didn't). Creates the new testenv folder + ledger.md, updates state.json.
 *
 *   create-mandate <repoRoot> <experimentsRoot>
 *     Bumps mandate-N -> mandate-(N+1) (plugin's actual scope changed) AND creates its
 *     first env (env-1) under it, since a mandate always needs at least one env. Prints
 *     mandateFile (for /ab-bench:understand to write) and envFile (for the skill to
 *     write after understand completes). Updates state.json.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AB_BENCH_DIR,
  loadState,
  saveState,
  resolveTestenvRoot,
  nextId,
  currentPaths,
  ensureGitignored,
  findRepoRoot,
} from '../../../lib/state.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

function fail(msg) {
  console.error(`[ab-bench-scaffold] ERROR: ${msg}`);
  process.exit(1);
}

function print(obj) {
  process.stdout.write(JSON.stringify(obj));
}

function listSubdirs(dir, prefix) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && new RegExp(`^${prefix}-\\d+$`).test(e.name))
    .map((e) => e.name)
    .sort();
}

function writeLedgerHeader(testenvDir, displayName, pluginRef) {
  const p = path.join(testenvDir, 'ledger.md');
  if (fs.existsSync(p)) return; // never overwrite real run history
  const content =
    `# ${displayName} — experiment ledger\n` +
    `Plugin under test: ${pluginRef} | Created: ${new Date().toISOString().slice(0, 10)}\n\n` +
    `| run | control baseline | date | verdict | subjective score | key delta | report |\n` +
    `|---|---|---|---|---|---|---|\n`;
  fs.writeFileSync(p, content);
}

function scaffoldTestenv(testenvDir, displayName, pluginRef) {
  fs.mkdirSync(path.join(testenvDir, 'seed'), { recursive: true });
  fs.mkdirSync(path.join(testenvDir, '.dod'), { recursive: true });
  fs.mkdirSync(path.join(testenvDir, 'runs'), { recursive: true });
  writeLedgerHeader(testenvDir, displayName, pluginRef);
}

const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', '.dod', AB_BENCH_DIR]);

function cmdFindRepoRoot(cwd) {
  print({ repoRoot: findRepoRoot(cwd) });
}

// Scans repoRoot for plugin.json files (root-level or nested under .claude-plugin/) —
// same intent as resolve-baseline.mjs's findPluginDirs, duplicated here rather than
// imported since it's a small, self-contained scan and the two scripts have no other
// shared dependency.
function cmdFindPlugins(repoRoot) {
  const found = [];
  function hasPluginJson(dir) {
    return fs.existsSync(path.join(dir, 'plugin.json')) || fs.existsSync(path.join(dir, '.claude-plugin', 'plugin.json'));
  }
  function walk(dir) {
    if (hasPluginJson(dir)) {
      found.push(dir);
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory() && !SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name));
    }
  }
  walk(repoRoot);
  print({ pluginDirs: found });
}

function cmdDetect(repoRoot, experimentsRoot) {
  const abBenchDir = path.join(repoRoot, AB_BENCH_DIR);
  const state = loadState(abBenchDir);
  if (!state) return print({ status: 'fresh' });

  const paths = currentPaths(abBenchDir, state, experimentsRoot);
  const mandates = listSubdirs(abBenchDir, 'mandate');
  const envsUnderCurrentMandate = listSubdirs(path.join(paths.mandateDir, 'envs'), 'env');
  print({
    status: 'existing',
    state,
    mandateExists: fs.existsSync(paths.mandateFile),
    envExists: fs.existsSync(paths.envFile),
    envFile: paths.envFile,
    mandateFile: paths.mandateFile,
    testenvRoot: paths.testenvRoot,
    mandates,
    envsUnderCurrentMandate,
  });
}

function cmdCreateFresh(repoRoot, experimentsRoot) {
  const abBenchDir = path.join(repoRoot, AB_BENCH_DIR);
  if (loadState(abBenchDir)) fail('.ab-bench/state.json already exists — this is not a fresh init, use create-env or create-mandate');

  const mandateId = 'mandate-1';
  const envId = 'env-1';
  const mandateDir = path.join(abBenchDir, mandateId);
  const envDir = path.join(mandateDir, 'envs', envId);
  fs.mkdirSync(envDir, { recursive: true });

  const testenvBase = resolveTestenvRoot(experimentsRoot, repoRoot);
  const testenvDir = path.join(testenvBase, mandateId, envId);
  const displayName = `${path.basename(repoRoot)}/${mandateId}/${envId}`;
  scaffoldTestenv(testenvDir, displayName, repoRoot);

  const state = {
    schema: 1,
    plugin_repo: repoRoot,
    experiments_root: experimentsRoot,
    testenv_root: testenvBase,
    current_mandate: mandateId,
    current_env: envId,
  };
  saveState(abBenchDir, state);
  const gitignoreAdded = ensureGitignored(repoRoot);

  print({
    mandateId,
    envId,
    mandateFile: path.join(mandateDir, 'mandate.md'),
    envFile: path.join(envDir, 'env.json'),
    testenvDir,
    displayName,
    gitignoreAdded,
  });
}

function cmdCreateEnv(repoRoot, experimentsRoot) {
  const abBenchDir = path.join(repoRoot, AB_BENCH_DIR);
  const state = loadState(abBenchDir);
  if (!state) fail('.ab-bench/state.json not found — run create-fresh first (/ab-bench:init has never run in this repo)');

  const mandateDir = path.join(abBenchDir, state.current_mandate);
  const envsDir = path.join(mandateDir, 'envs');
  const envId = nextId(envsDir, 'env');
  const envDir = path.join(envsDir, envId);
  fs.mkdirSync(envDir, { recursive: true });

  const testenvBase = state.testenv_root || resolveTestenvRoot(experimentsRoot, repoRoot);
  const testenvDir = path.join(testenvBase, state.current_mandate, envId);
  const displayName = `${path.basename(repoRoot)}/${state.current_mandate}/${envId}`;
  scaffoldTestenv(testenvDir, displayName, repoRoot);

  state.current_env = envId;
  saveState(abBenchDir, state);

  print({
    mandateId: state.current_mandate,
    envId,
    mandateFile: path.join(mandateDir, 'mandate.md'),
    envFile: path.join(envDir, 'env.json'),
    testenvDir,
    displayName,
  });
}

function cmdCreateMandate(repoRoot, experimentsRoot) {
  const abBenchDir = path.join(repoRoot, AB_BENCH_DIR);
  const state = loadState(abBenchDir);
  if (!state) fail('.ab-bench/state.json not found — run create-fresh first (/ab-bench:init has never run in this repo)');

  const mandateId = nextId(abBenchDir, 'mandate');
  const envId = 'env-1';
  const mandateDir = path.join(abBenchDir, mandateId);
  const envDir = path.join(mandateDir, 'envs', envId);
  fs.mkdirSync(envDir, { recursive: true });

  const testenvBase = state.testenv_root || resolveTestenvRoot(experimentsRoot, repoRoot);
  const testenvDir = path.join(testenvBase, mandateId, envId);
  const displayName = `${path.basename(repoRoot)}/${mandateId}/${envId}`;
  scaffoldTestenv(testenvDir, displayName, repoRoot);

  state.current_mandate = mandateId;
  state.current_env = envId;
  saveState(abBenchDir, state);

  print({
    mandateId,
    envId,
    mandateFile: path.join(mandateDir, 'mandate.md'),
    envFile: path.join(envDir, 'env.json'),
    testenvDir,
    displayName,
  });
}

function main() {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd) {
    fail('usage: node ab-bench-scaffold.mjs <find-repo-root <cwd> | find-plugins <repoRoot> | detect|create-fresh|create-env|create-mandate <repoRoot> <experimentsRoot>>');
  }

  if (cmd === 'find-repo-root') return cmdFindRepoRoot(path.resolve(rest[0] || process.cwd()));
  if (cmd === 'find-plugins') return cmdFindPlugins(path.resolve(rest[0] || process.cwd()));

  const [repoRootArg, experimentsRootArg] = rest;
  if (!repoRootArg || !experimentsRootArg) fail(`${cmd} requires <repoRoot> <experimentsRoot>`);
  const repoRoot = path.resolve(repoRootArg);
  const experimentsRoot = path.resolve(experimentsRootArg);

  if (cmd === 'detect') return cmdDetect(repoRoot, experimentsRoot);
  if (cmd === 'create-fresh') return cmdCreateFresh(repoRoot, experimentsRoot);
  if (cmd === 'create-env') return cmdCreateEnv(repoRoot, experimentsRoot);
  if (cmd === 'create-mandate') return cmdCreateMandate(repoRoot, experimentsRoot);
  fail(`unknown subcommand: ${cmd}`);
}

main();
