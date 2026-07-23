#!/usr/bin/env node
/**
 * launch-pair.mjs — fire the control/test session pair for the next planned run.
 *
 * Usage:
 *   node launch-pair.mjs <configRoot> <testenvRoot> [--run run-003] [--dry-run]
 *
 * Two-root split (see docs/dod-contract.md): <configRoot> is <plugin-repo>/.ab-bench/
 * mandate-N/envs/env-M/ (holds env.json only). <testenvRoot> is the paired
 * <experiments_root>/<plugin-folder-name>/mandate-N/env-M/ folder (holds seed/, .dod/,
 * baselines/, runs/ — everything a run actually materializes on disk). mandate/env ids are
 * read straight off configRoot's own path (.../mandate-N/envs/env-M) rather than passed
 * separately, so there's exactly one source of truth for "which env is this."
 *
 * Picks the latest runs/run-NNN (under testenvRoot) that has task.md but no manifest.json
 * (i.e. planned, not yet fired), unless --run is given.
 *
 * For each arm (control, test):
 *   1. clone seed/ into the arm workspace
 *   2. copy task.md -> <workspace>/TASK.md
 *   3. link <workspace>/.dod as a directory junction to <testenvRoot>/.dod — REQUIRED because
 *      dod-lite resolves .dod as a direct child of cwd, no upward search (see docs/dod-contract.md)
 *   4. write <workspace>/.claude/settings.json with the SessionStart linkage hook
 *      (arm-session-start.mjs: manifest linkage + .dod registration)
 *   5. compose .launch/<arm>.settings.json (enabledPlugins) and .launch/<arm>.mcp.json — control's
 *      pluginDirs also get runs/run-NNN/baseline.json's worktree paths layered in, if that run
 *      pinned control to a previous version instead of vanilla (see /ab-bench:plan step 2). Both
 *      arms unconditionally also get DOD_LITE_DIR (plugins/dod-lite, the trimmed hooks-only DoD
 *      engine) appended — mandatory every run, never an env.json opt-in.
 *   6. spawn a detached titled terminal running:
 *      claude --model M --settings S --mcp-config C --strict-mcp-config [--plugin-dir D]* "<PROMPT>"
 *
 * The opening prompt is a fixed constant for parity across arms and across experiments.
 * Launch recipe ported from agentic_pm_app ccLauncher.ts (start "title" cmd /k batch).
 *
 * --dry-run: compose .launch/ artifacts + parity report, spawn nothing, write no
 * manifest (run stays fireable).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ARM_HOOK_SCRIPT = path.join(SCRIPT_DIR, 'arm-session-start.mjs');
// The trimmed, hooks-only DoD engine (plugins/dod-lite) — mandatory on every run, injected via
// --plugin-dir the same way a previous-version baseline's worktree is, never via env.json/
// enabledPlugins. Not listed in marketplace.json; not independently installable. See
// docs/dod-contract.md.
const DOD_LITE_DIR = path.resolve(SCRIPT_DIR, '..', '..', '..', '..', 'dod-lite');
const ARMS = ['control', 'test'];
const OPENING_PROMPT =
  'Read TASK.md in this directory and carry out the assignment exactly as written. Treat TASK.md as your task brief.';

function fail(msg) {
  console.error(`[ab-bench] ERROR: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { configRoot: null, testenvRoot: null, run: null, dryRun: false };
  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--run') args.run = argv[++i];
    else positional.push(a);
  }
  if (positional.length < 2) fail('usage: node launch-pair.mjs <configRoot> <testenvRoot> [--run run-NNN] [--dry-run]');
  args.configRoot = path.resolve(positional[0]);
  args.testenvRoot = path.resolve(positional[1]);
  return args;
}

// mandate/env ids live entirely in configRoot's own path shape
// (.ab-bench/mandate-N/envs/env-M) — derived here rather than passed as separate flags so
// there's exactly one source of truth.
function lineageFromConfigRoot(configRoot) {
  const envId = path.basename(configRoot);
  const mandateId = path.basename(path.dirname(path.dirname(configRoot)));
  return { mandate: mandateId, env: envId };
}

function loadEnv(configRoot) {
  const envPath = path.join(configRoot, 'env.json');
  if (!fs.existsSync(envPath)) fail(`env.json not found in ${configRoot}`);
  let env;
  try {
    env = JSON.parse(fs.readFileSync(envPath, 'utf8'));
  } catch (e) {
    fail(`env.json is not valid JSON: ${e.message}`);
  }
  if (!env.experiment) fail('env.json: "experiment" is required');
  if (!env.model) fail('env.json: "model" is required (both arms must run the same model)');
  for (const key of ['common', ...ARMS]) {
    env[key] = env[key] || {};
    env[key].plugins = env[key].plugins || [];
    env[key].pluginDirs = env[key].pluginDirs || [];
    env[key].mcp = env[key].mcp || [];
  }
  env.mcpServers = env.mcpServers || {};
  env.pluginUnderTestRepo = env.pluginUnderTestRepo || null;
  return env;
}

// runs/run-NNN/baseline.json — written by /ab-bench:plan's resolve-baseline.mjs. Absent (or
// type "vanilla") means today's behavior: control gets nothing beyond env.json's own control
// block. type "previous-version" layers a git-worktree checkout's pluginDirs onto control for
// THIS run only — env.json's control block is never touched (baseline varies per run, env.json
// is locked for the experiment's whole life).
function loadBaseline(runDir) {
  const p = path.join(runDir, 'baseline.json');
  if (!fs.existsSync(p)) return { control_baseline: { type: 'vanilla' } };
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    fail(`runs/${path.basename(runDir)}/baseline.json is not valid JSON: ${e.message}`);
  }
}

function findRun(testenvRoot, explicit) {
  const runsDir = path.join(testenvRoot, 'runs');
  if (explicit) {
    const dir = path.join(runsDir, explicit);
    if (!fs.existsSync(path.join(dir, 'task.md'))) fail(`${explicit} has no task.md — plan the run first`);
    if (fs.existsSync(path.join(dir, 'manifest.json'))) fail(`${explicit} already has manifest.json — already fired`);
    return dir;
  }
  if (!fs.existsSync(runsDir)) fail('no runs/ folder — plan a run first (/ab-bench:plan)');
  const candidates = fs
    .readdirSync(runsDir)
    .filter((n) => /^run-\d+$/.test(n))
    .filter((n) => fs.existsSync(path.join(runsDir, n, 'task.md')))
    .filter((n) => !fs.existsSync(path.join(runsDir, n, 'manifest.json')))
    .sort();
  if (candidates.length === 0) fail('no planned-but-unfired run found (need runs/run-NNN with task.md and no manifest.json)');
  return path.join(runsDir, candidates[candidates.length - 1]);
}

// --settings only ever ADDS enabledPlugins keys — it never clears a key already
// `true` in the user's global ~/.claude/settings.json. Without this, any plugin
// enabled globally but absent from env.json leaks into every arm unevenly
// (found via blender-plugin-tester: playwright/plugin-dev leaked into both arms).
function loadGlobalEnabledPlugins() {
  const p = path.join(os.homedir(), '.claude', 'settings.json');
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')).enabledPlugins || {};
  } catch {
    return {};
  }
}

// DoD tracking is mandatory, never an env.json opt-in — strip any stray legacy "dod-lite"
// reference (marketplace ref or raw pluginDir) so an old experiment config can never cause a
// double-load once DOD_LITE_DIR is unconditionally appended below.
function stripDodLite(refs) {
  return refs.filter((r) => !/dod-lite/i.test(r));
}

function composeArm(env, arm, globalEnabled, baseline) {
  const plugins = stripDodLite([...env.common.plugins, ...env[arm].plugins]);
  const baselineDirs =
    arm === 'control' && baseline.control_baseline.type === 'previous-version'
      ? baseline.control_baseline.pluginDirs
      : [];
  const pluginDirs = [
    ...stripDodLite([...env.common.pluginDirs, ...env[arm].pluginDirs, ...baselineDirs]),
    DOD_LITE_DIR,
  ].map((p) => path.resolve(p));
  const mcpNames = [...env.common.mcp, ...env[arm].mcp];
  const mcpServers = {};
  for (const name of mcpNames) {
    if (!env.mcpServers[name]) fail(`env.json: mcp "${name}" (arm ${arm}) has no definition in mcpServers pool`);
    mcpServers[name] = env.mcpServers[name];
  }
  const enabledPlugins = {};
  // explicit false for every stray globally-true key first, so this arm's own
  // true entries (below) always win — surgical override, global settings.json
  // itself is never touched.
  for (const ref of Object.keys(globalEnabled)) {
    if (globalEnabled[ref]) enabledPlugins[ref] = false;
  }
  for (const ref of plugins) enabledPlugins[ref] = true;
  return { plugins, pluginDirs, mcpServers, enabledPlugins };
}

function copySeed(testenvRoot, workspace) {
  const seed = path.join(testenvRoot, 'seed');
  if (fs.existsSync(seed) && fs.readdirSync(seed).length > 0) {
    fs.cpSync(seed, workspace, { recursive: true });
  }
}

function writeWorkspaceSettings(workspace, manifestPath, arm, dodDir) {
  const settings = {
    hooks: {
      SessionStart: [
        {
          hooks: [
            {
              type: 'command',
              command: 'node',
              args: [
                ARM_HOOK_SCRIPT,
                '--manifest', manifestPath,
                '--arm', arm,
                '--dod', dodDir,
              ],
              timeout: 30,
            },
          ],
        },
      ],
    },
    // Structural, not advisory: an arm must never be able to edit the shared DoD
    // checkers it's graded against, no matter what it decides mid-run (confirmed
    // real incident: blender-plugin-tester run-003, test arm edited
    // .dod/checks/_lib/scene_state_checks.py three times after getting stuck on a
    // failing check, reverting only after two live human interventions). `/.dod/**`
    // is project-settings-relative (this file lives at <workspace>/.claude/settings.json),
    // so it resolves to <workspace>/.dod/** on both arms regardless of experiment.
    // Also feeds sandbox.filesystem.denyWrite automatically (Claude Code merges
    // Edit(...)/Write(...) deny rules into it), closing the Bash-write-around-the-tool gap too.
    permissions: {
      deny: ['Edit(/.dod/**)', 'Write(/.dod/**)', 'MultiEdit(/.dod/**)'],
    },
  };
  const dir = path.join(workspace, '.claude');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings, null, 2));
}

// dod-lite resolves .dod as a direct child of cwd (no upward search) — see
// docs/dod-contract.md. Link each arm workspace's .dod to the shared experiment-level
// .dod/ via a Windows directory junction (no admin rights required), so dod-lite's own
// hooks — running with cwd = the arm workspace — transparently read/write the shared folder.
function linkDodFolder(workspace, dodDir) {
  const link = path.join(workspace, '.dod');
  if (fs.existsSync(link)) {
    console.error(`[ab-bench] WARN: ${link} already exists — not linking to shared .dod (did seed/ contain a .dod folder?)`);
    return;
  }
  fs.symlinkSync(dodDir, link, 'junction');
}

function quoteBatchArg(arg) {
  if (/[\s"^&|<>()]/.test(arg)) return `"${arg.replace(/"/g, '""')}"`;
  return arg;
}

function buildClaudeCommand(env, armConfig, settingsFile, mcpFile) {
  const args = ['claude', '--model', env.model, '--settings', settingsFile];
  // always strict, even with an empty pool: arms must not fall back to globally configured MCPs
  args.push('--mcp-config', mcpFile, '--strict-mcp-config');
  for (const dir of armConfig.pluginDirs) args.push('--plugin-dir', dir);
  args.push(OPENING_PROMPT);
  return args.map(quoteBatchArg).join(' ');
}

function spawnTerminal(title, batchFile) {
  const line = `start "${title}" cmd /k "${batchFile}"`;
  const child = spawn('cmd.exe', ['/d', '/s', '/c', line], {
    detached: true,
    stdio: 'ignore',
    windowsVerbatimArguments: true,
  });
  child.unref();
  return child.pid ?? null;
}

function main() {
  const { configRoot, testenvRoot, run, dryRun } = parseArgs(process.argv);
  const env = loadEnv(configRoot);
  const lineage = lineageFromConfigRoot(configRoot);
  const runDir = findRun(testenvRoot, run);
  const runName = path.basename(runDir);
  const launchDir = path.join(runDir, '.launch');
  const dodDir = path.join(testenvRoot, '.dod');
  const manifestPath = path.join(runDir, 'manifest.json');
  fs.mkdirSync(launchDir, { recursive: true });
  fs.mkdirSync(dodDir, { recursive: true });

  const globalEnabled = loadGlobalEnabledPlugins();
  const baseline = loadBaseline(runDir);
  const composed = {};
  const parity = { equal: {}, differs: {} };
  for (const arm of ARMS) composed[arm] = composeArm(env, arm, globalEnabled, baseline);

  parity.equal.model = env.model;
  parity.equal.prompt = OPENING_PROMPT;
  parity.equal.dod_engine = DOD_LITE_DIR;
  parity.equal.common_plugins = env.common.plugins;
  parity.equal.common_pluginDirs = env.common.pluginDirs;
  parity.equal.common_mcp = env.common.mcp;
  // pluginDirs here is the RESOLVED list (env.json + baseline.json layered in for control),
  // not just env.json's raw control block — so a previous-version baseline's worktree paths
  // actually show up in the parity report.
  parity.differs.control = { plugins: env.control.plugins, pluginDirs: composed.control.pluginDirs, mcp: env.control.mcp };
  parity.differs.test = { plugins: env.test.plugins, pluginDirs: composed.test.pluginDirs, mcp: env.test.mcp };
  parity.control_baseline = baseline.control_baseline;

  const dodChecksPath = path.join(runDir, 'dod-checks.json');
  if (fs.existsSync(dodChecksPath)) {
    const dodChecks = JSON.parse(fs.readFileSync(dodChecksPath, 'utf8'));
    parity.dod_checks = dodChecks.checks;
    const controlIds = (dodChecks.checks?.control || []).map((c) => c.id).sort().join(',');
    const testIds = (dodChecks.checks?.test || []).map((c) => c.id).sort().join(',');
    parity.dod_checks_asymmetric = controlIds !== testIds;
    parity.dod_checks_note = parity.dod_checks_asymmetric
      ? 'control/test check lists differ — expected when driven by a plugin-native checker (see "source" per check), not a parity violation by itself'
      : 'control/test check lists identical';
  } else {
    parity.dod_checks = null;
    parity.dod_checks_note = 'no runs/run-NNN/dod-checks.json — run proceeds without DoD tracking';
  }

  fs.writeFileSync(path.join(launchDir, 'parity-report.json'), JSON.stringify(parity, null, 2));

  const manifest = {
    schema: 1,
    experiment: env.experiment,
    mandate: lineage.mandate,
    env: lineage.env,
    run: runName,
    created_at: new Date().toISOString(),
    model: env.model,
    prompt: OPENING_PROMPT,
    arms: {},
  };

  for (const arm of ARMS) {
    const workspace = path.join(runDir, arm);
    const settingsFile = path.join(launchDir, `${arm}.settings.json`);
    const mcpFile = path.join(launchDir, `${arm}.mcp.json`);
    const batchFile = path.join(launchDir, `${arm}.launch.cmd`);

    fs.writeFileSync(settingsFile, JSON.stringify({ enabledPlugins: composed[arm].enabledPlugins }, null, 2));
    fs.writeFileSync(mcpFile, JSON.stringify({ mcpServers: composed[arm].mcpServers }, null, 2));

    const claudeCmd = buildClaudeCommand(env, composed[arm], settingsFile, mcpFile);
    const batch = [
      '@echo off',
      'chcp 65001 >nul',
      // this whole launcher runs via the Bash tool inside a Claude Code session, so
      // CLAUDE_CODE_CHILD_SESSION/CLAUDECODE leak down through cmd.exe -> start -> cmd /k
      // into each arm's claude.exe, which misclassifies it as nested and silently drops
      // transcript persistence (hooks/cost tracking still work — separate subsystem).
      // Confirmed via code.claude.com/docs/en/env-vars (CLAUDE_CODE_FORCE_SESSION_PERSISTENCE),
      // this is the documented override for exactly this "background launcher" case.
      'set CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1',
      `cd /d "${workspace}"`,
      claudeCmd,
      '',
    ].join('\r\n');
    fs.writeFileSync(batchFile, batch);

    if (dryRun) continue;

    fs.mkdirSync(workspace, { recursive: true });
    copySeed(testenvRoot, workspace);
    fs.copyFileSync(path.join(runDir, 'task.md'), path.join(workspace, 'TASK.md'));
    linkDodFolder(workspace, dodDir);
    writeWorkspaceSettings(workspace, manifestPath, arm, dodDir);

    manifest.arms[arm] = {
      status: 'launched',
      workspace,
      settings_file: settingsFile,
      mcp_file: mcpFile,
      plugin_dirs: composed[arm].pluginDirs,
      spawn_pid: null,
      sessions: [],
    };
    if (arm === 'control') {
      manifest.arms.control.baseline =
        baseline.control_baseline.type === 'previous-version'
          ? { type: 'previous-version', ref: baseline.control_baseline.ref }
          : { type: 'vanilla' };
    }
  }

  if (dryRun) {
    console.log(`[ab-bench] DRY RUN — composed ${runName} launch artifacts in ${launchDir}`);
    console.log(`[ab-bench] parity report: ${path.join(launchDir, 'parity-report.json')}`);
    return;
  }

  fs.mkdirSync(path.join(runDir, 'analysis'), { recursive: true });

  for (const arm of ARMS) {
    const title = `AB ${env.experiment} ${arm} ${runName}`;
    const pid = spawnTerminal(title, path.join(launchDir, `${arm}.launch.cmd`));
    manifest.arms[arm].spawn_pid = pid;
    console.log(`[ab-bench] launched ${arm} arm (pid ${pid ?? '?'}) — "${title}"`);
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`[ab-bench] manifest: ${manifestPath}`);
  console.log('[ab-bench] session ids will be linked into the manifest by the SessionStart hook of each arm.');
}

main();
