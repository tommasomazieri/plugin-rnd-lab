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
 *   2. materialize that arm's pinned artifacts from runs/run-NNN/baseline.json —
 *      `plugin-dir` ones become --plugin-dir flags, `workspace:<subpath>` ones are COPIED
 *      into the workspace (never junctioned: the baselines/ cache is shared between arms
 *      and an arm that builds in a delivered tree would corrupt it), `env:<VAR>` ones are
 *      exported into the arm's launcher
 *   3. run each artifact's optional `prepare` command in the workspace, logging to
 *      .launch/prepare-<arm>-<id>.log. Non-zero exit ABORTS the run with no manifest —
 *      a build is not a property of the thing under test, so its cost is kept out of the
 *      arm's metrics and its failure is caught here rather than at analyze time
 *   4. copy task.md -> <workspace>/TASK.md
 *   5. link <workspace>/.dod to <testenvRoot>/.dod — REQUIRED because dod-lite resolves
 *      .dod as a direct child of cwd, no upward search (see docs/dod-contract.md)
 *   6. write <workspace>/.claude/settings.json with the SessionStart linkage hook
 *      (arm-session-start.mjs: manifest linkage + .dod registration + turn-counter init)
 *      and the Stop turn-counter hook (arm-turn-count.mjs)
 *   7. compose .launch/<arm>.settings.json (enabledPlugins) and .launch/<arm>.mcp.json. Both
 *      arms unconditionally also get DOD_LITE_DIR (plugins/dod-lite, the trimmed hooks-only DoD
 *      engine) appended — mandatory every run, never an env.json opt-in.
 *   8. spawn a detached titled terminal running:
 *      claude --model M --settings S --mcp-config C --strict-mcp-config [--plugin-dir D]* "<PROMPT>"
 *
 * The opening prompt is a fixed constant for parity across arms and across experiments.
 *
 * Terminal host and launcher dialect are both platform-specific and both live in
 * terminal.mjs: a generated .ps1 under Windows Terminal on win32, a generated .command under
 * Terminal.app on macOS, and a .sh under whichever emulator is installed on Linux. The
 * host is resolved ONCE and applied to both arms — two arms in two different terminals
 * would be a parity break in the most literal sense. Where no terminal can be opened
 * (headless, SSH, an unlisted emulator) the pair is staged and the operator is given the
 * two commands to run; see manualLaunchInstructions.
 *
 * --dry-run: compose .launch/ artifacts + parity report, spawn nothing, write no
 * manifest (run stays fireable).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { normalizeArtifacts, describeResolved } from '../../../lib/artifacts.mjs';
import { resolveDodLiteDir, dodLiteSearchPaths, installedMarketplace } from '../../../lib/dod-lite-dir.mjs';
import {
  buildLaunchScript,
  launchScriptExt,
  manualLaunchInstructions,
  resolveTerminalHost,
  spawnTerminal,
} from './terminal.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ARM_HOOK_SCRIPT = path.join(SCRIPT_DIR, 'arm-session-start.mjs');
const TURN_COUNT_SCRIPT = path.join(SCRIPT_DIR, 'arm-turn-count.mjs');
// The trimmed, hooks-only DoD auditor (plugins/dod-lite) — mandatory on every run, injected via
// --plugin-dir the same way a previous-version baseline's worktree is, never via env.json/
// enabledPlugins. It is a separate plugin and must stay one: an arm has to load the auditor and
// NOTHING else, and folding it into optimizer would mean enabling optimizer's own skills inside
// the very sessions being measured. Registered in marketplace.json so it is installed alongside;
// where "alongside" is on disk differs between a clone and a GitHub install, and
// lib/dod-lite-dir.mjs owns both answers. See docs/dod-contract.md.
const PLUGIN_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');
const DOD_LITE_DIR = resolveDodLiteDir(PLUGIN_ROOT);
const ARMS = ['control', 'test'];
const OPENING_PROMPT =
  'Read TASK.md in this directory and carry out the assignment exactly as written. Treat TASK.md as your task brief.';

function fail(msg) {
  console.error(`[optimizer] ERROR: ${msg}`);
  process.exit(1);
}

// A missing engine launches two arms with no DoD instrumentation at all — and downstream,
// nothing can tell that apart from a run where every check happened to pass. This was the real
// behaviour of every marketplace install while dod-lite went unregistered: the four levels up
// land outside optimizer's own plugin root, and files outside a plugin root are not copied into
// the plugin cache. Refuse to launch instead. A measurement harness running without its
// instrument is worse than one that did not run at all.
function assertDodEngine() {
  if (DOD_LITE_DIR) return;
  fail(
    'DoD audit engine (dod-lite) not found. Looked in:\n' +
      dodLiteSearchPaths(PLUGIN_ROOT).map((p) => `    ${p}\n`).join('') +
      '  Both arms are instrumented by plugins/dod-lite. Without it this run would record no DoD\n' +
      '  evidence at all, which is indistinguishable later from every check passing.\n' +
      '  Install it from the same marketplace as optimizer:\n' +
      `    claude plugin install dod-lite@${installedMarketplace(PLUGIN_ROOT)}\n` +
      '  No arms were launched.',
  );
}

function parseArgs(argv) {
  const args = { configRoot: null, testenvRoot: null, run: null, dryRun: false, noSpawn: false };
  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--no-spawn') args.noSpawn = true;
    else if (a === '--run') args.run = argv[++i];
    else positional.push(a);
  }
  if (positional.length < 2) fail('usage: node launch-pair.mjs <configRoot> <testenvRoot> [--run run-NNN] [--dry-run|--no-spawn]');
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

// runs/run-NNN/baseline.json — written by /optimizer:plan's resolve-baseline.mjs. Carries,
// per arm, the resolved immutable identity of every declared artifact for THIS run only;
// env.json is never touched (pins vary per run, env.json is locked for the experiment's
// whole life). Absent means no artifacts for either arm.
//
// Schema 1 (one plugin, control-only, {control_baseline: {type, pluginDirs}}) is mapped
// onto the schema-2 shape here so nothing downstream has to know two formats exist.
function loadBaseline(runDir) {
  const p = path.join(runDir, 'baseline.json');
  const empty = { schema: 2, arms: { control: { pins: {} }, test: { pins: {} } } };
  if (!fs.existsSync(p)) return empty;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    fail(`runs/${path.basename(runDir)}/baseline.json is not valid JSON: ${e.message}`);
  }
  if (raw.schema === 2 && raw.arms) {
    for (const arm of ARMS) raw.arms[arm] = raw.arms[arm] || { pins: {} };
    return raw;
  }
  const legacy = raw.control_baseline || { type: 'vanilla' };
  const out = { schema: 2, arms: { control: { pins: {} }, test: { pins: {} } }, migrated_from_schema: 1 };
  if (legacy.type === 'previous-version') {
    out.arms.control.pins[path.basename(legacy.repoPath || 'plugin-under-test')] = {
      id: path.basename(legacy.repoPath || 'plugin-under-test'),
      repo: legacy.repoPath || null,
      deliver: 'plugin-dir',
      requested_ref: legacy.ref || null,
      resolved: {
        kind: 'ref',
        sha: null,
        hash: null,
        dirty: false,
        path: legacy.worktreePath || null,
        pluginDirs: legacy.pluginDirs || [],
      },
    };
  }
  return out;
}

function armPins(baseline, arm) {
  return Object.values(baseline.arms?.[arm]?.pins || {});
}

function findRun(testenvRoot, explicit) {
  const runsDir = path.join(testenvRoot, 'runs');
  if (explicit) {
    const dir = path.join(runsDir, explicit);
    if (!fs.existsSync(path.join(dir, 'task.md'))) fail(`${explicit} has no task.md — plan the run first`);
    if (fs.existsSync(path.join(dir, 'manifest.json'))) fail(`${explicit} already has manifest.json — already fired`);
    return dir;
  }
  if (!fs.existsSync(runsDir)) fail('no runs/ folder — plan a run first (/optimizer:plan)');
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
  // Both arms resolve their pins the same way — there is no control-only special case
  // any more. An arm with no plugin-dir artifacts simply contributes nothing here.
  const pinnedDirs = armPins(baseline, arm).flatMap((pin) => pin.resolved?.pluginDirs || []);
  const pluginDirs = [
    ...stripDodLite([...env.common.pluginDirs, ...env[arm].pluginDirs, ...pinnedDirs]),
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

/**
 * Put each pinned artifact where the arm can reach it, per its declared delivery mode.
 *
 * `workspace:` artifacts are COPIED, never junctioned: the cache under baselines/ is
 * shared between both arms and across every run pinning the same ref, and an arm that
 * builds in a delivered source tree would corrupt it for everyone. plugin-dir artifacts
 * are read-only to Claude Code, so those stay as shared paths.
 *
 * Returns the env vars the arm's launcher must export.
 */
function materializePins(workspace, pins) {
  const envVars = {};
  for (const pin of pins) {
    const src = pin.resolved?.path;
    const deliver = String(pin.deliver || 'plugin-dir');
    if (deliver === 'plugin-dir' || deliver === 'none') continue;
    if (!src || !fs.existsSync(src)) {
      fail(`artifact "${pin.id}" resolved to a path that does not exist: ${src} — re-run /optimizer:plan to re-resolve baselines`);
    }
    if (deliver.startsWith('workspace:')) {
      const subpath = deliver.slice('workspace:'.length).replace(/^[\\/]+/, '');
      const dest = path.join(workspace, subpath);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(src, dest, { recursive: true });
      // The snapshot marker is bookkeeping, not part of the delivered artifact.
      fs.rmSync(path.join(dest, '.ab-bench-snapshot.json'), { force: true });
    } else if (deliver.startsWith('env:')) {
      envVars[deliver.slice('env:'.length)] = src;
    } else {
      fail(`artifact "${pin.id}" has an unknown deliver mode "${deliver}"`);
    }
  }
  return envVars;
}

/**
 * Run each artifact's declared `prepare` command in the arm workspace before the session
 * starts. Cost lands in .launch/, not in the arm's tokens or turns: a build is not a
 * property of the thing under test, so charging it to the arm is measurement noise.
 *
 * A non-zero exit aborts the whole run. A pin that cannot be built is not a result worth
 * collecting, and finding out at analyze time costs a full run.
 */
function runPrepare(workspace, arm, pins, artifacts, launchDir, extraEnv) {
  for (const pin of pins) {
    const spec = artifacts[pin.id];
    if (!spec || !spec.prepare) continue;
    const logPath = path.join(launchDir, `prepare-${arm}-${pin.id}.log`);
    console.log(`[optimizer] ${arm}: preparing "${pin.id}" — ${spec.prepare}`);
    const started = Date.now();
    const r = spawnSync(spec.prepare, {
      cwd: workspace,
      shell: true,
      encoding: 'utf8',
      timeout: spec.prepareTimeoutSec * 1000,
      env: { ...process.env, ...extraEnv, AB_BENCH_ARM: arm, AB_BENCH_WORKSPACE: workspace },
      maxBuffer: 64 * 1024 * 1024,
    });
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    fs.writeFileSync(
      logPath,
      [
        `# prepare: ${pin.id} (${arm})`,
        `# command: ${spec.prepare}`,
        `# cwd: ${workspace}`,
        `# exit: ${r.status}${r.error ? ` (${r.error.message})` : ''}  elapsed: ${elapsed}s`,
        '',
        '--- stdout ---',
        r.stdout || '',
        '--- stderr ---',
        r.stderr || '',
      ].join('\n'),
    );
    if (r.error || r.status !== 0) {
      fail(
        `prepare failed for artifact "${pin.id}" on the ${arm} arm (exit ${r.status ?? 'n/a'}${r.error ? `, ${r.error.message}` : ''}).\n` +
          `  log: ${logPath}\n` +
          '  No manifest was written — fix the build and fire again.',
      );
    }
    console.log(`[optimizer] ${arm}: prepared "${pin.id}" in ${elapsed}s -> ${logPath}`);
  }
}

function writeWorkspaceSettings(workspace, manifestPath, arm, dodDir) {
  const runDir = path.dirname(manifestPath);
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
                '--run', runDir,
              ],
              timeout: 30,
            },
          ],
        },
      ],
      // Turn counting is optimizer's own, at project scope, because the arms cannot rely
      // on the operator's global Stop hook: measured across three fired runs, main arm
      // sessions ended up with no ~/.claude/turn-counts entry at all or one frozen at 1
      // while the transcript ran to 600+ lines, which is what made the footer fall back
      // to its per-assistant-entry guess ("135 turns" vs "1 turn" on the other arm).
      // /optimizer:analyze needs a real per-arm turn number, so optimizer emits it itself.
      Stop: [
        {
          hooks: [
            {
              type: 'command',
              command: 'node',
              args: [
                TURN_COUNT_SCRIPT,
                '--run', runDir,
                '--arm', arm,
              ],
              timeout: 10,
            },
          ],
        },
      ],
    },
    // Structural, not advisory: `.dod/` is opaque to the arm in BOTH directions.
    //
    // WRITE — an arm must never be able to edit the shared DoD checkers it is graded
    // against, no matter what it decides mid-run (confirmed real incident:
    // blender-plugin-tester run-003, test arm edited
    // .dod/checks/_lib/scene_state_checks.py three times after getting stuck on a
    // failing check, reverting only after two live human interventions).
    //
    // READ — `linkDodFolder` junctions BOTH arms' `.dod` to the same
    // <testenvRoot>/.dod, so `.dod/sessions/` holds every session's scorecard and
    // either arm could read the other's. In an A/B harness the arms must not be able
    // to see each other's answers, and an arm reading even its OWN scorecard turns a
    // silent auditor into a feedback channel — which is exactly what dod-lite's
    // stdout silence exists to prevent (see docs/dod-contract.md). Nothing in an
    // arm's real work ever needs to open this folder.
    //
    // `/.dod/**` is project-settings-relative (this file lives at
    // <workspace>/.claude/settings.json), so it resolves to <workspace>/.dod/** on
    // both arms regardless of experiment. Read/Edit deny rules are merged into the
    // sandbox filesystem boundary automatically, which closes the
    // Bash-around-the-tool gap (`cat`/`head`/`tail`/`sed`) for both directions.
    // Residual, accepted: an arbitrary subprocess (`node -e`, a python one-liner)
    // is outside what permission rules can reach. dod-lite's own hooks are
    // unaffected — they run as subprocesses with direct fs access, not through the
    // arm's tool permissions, so the auditor keeps working normally.
    permissions: {
      deny: [
        'Edit(/.dod/**)', 'Write(/.dod/**)', 'MultiEdit(/.dod/**)',
        'Read(/.dod/**)',
      ],
    },
  };
  const dir = path.join(workspace, '.claude');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings, null, 2));
}

// dod-lite resolves .dod as a direct child of cwd (no upward search) — see
// docs/dod-contract.md. Link each arm workspace's .dod to the shared experiment-level
// .dod/, so dod-lite's own hooks — running with cwd = the arm workspace — transparently
// read and write the shared folder.
//
// The 'junction' type is what makes this work unprivileged on Windows, where a plain
// symlink needs Developer Mode or an elevated shell. Node ignores the type argument
// everywhere else ("only used on Windows platforms" — nodejs.org/api/fs.html), so the
// same call is a plain directory symlink on macOS and Linux, which needs no privilege
// there either. One call, one behaviour, three platforms.
function linkDodFolder(workspace, dodDir) {
  const link = path.join(workspace, '.dod');
  if (fs.existsSync(link)) {
    console.error(`[optimizer] WARN: ${link} already exists — not linking to shared .dod (did seed/ contain a .dod folder?)`);
    return;
  }
  try {
    fs.symlinkSync(dodDir, link, 'junction');
  } catch (err) {
    fail(
      `could not link ${link} -> ${dodDir}: ${err.message}\n` +
        '  Both arms record their DoD evidence through this link. Without it the run would\n' +
        '  produce no evidence at all, which is indistinguishable later from every check passing.\n' +
        (process.platform === 'win32'
          ? '  On Windows this needs no admin rights; a failure here usually means the experiments\n' +
            '  root is on a filesystem that does not support junctions (a network share, some\n' +
            '  virtualised mounts). Move experiments_root onto a local NTFS path.\n'
          : '  A failure here usually means the experiments root is on a filesystem that does not\n' +
            '  support symlinks (some network mounts, exFAT, a container volume mounted noexec).\n' +
            '  Move experiments_root onto a local filesystem.\n') +
        '  No arms were launched.',
    );
  }
}

/**
 * The claude argv for one arm, as an array — never as a command line.
 *
 * Splatted (PowerShell) or `set --`'d (sh) into place by terminal.mjs, so each element
 * reaches claude as exactly one argv entry however many spaces and commas it contains.
 */
function buildClaudeArgs(env, armConfig, settingsFile, mcpFile) {
  const args = ['--model', env.model, '--settings', settingsFile];
  // always strict, even with an empty pool: arms must not fall back to globally configured MCPs
  args.push('--mcp-config', mcpFile, '--strict-mcp-config');
  for (const dir of armConfig.pluginDirs) args.push('--plugin-dir', dir);
  args.push(OPENING_PROMPT);
  return args;
}

function main() {
  const { configRoot, testenvRoot, run, dryRun, noSpawn } = parseArgs(process.argv);
  // Before anything else: no instrument, no run.
  assertDodEngine();
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
  let artifacts;
  try {
    artifacts = normalizeArtifacts(env);
  } catch (e) {
    fail(`env.json artifacts: ${e.message}`);
  }
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

  // The resolved identity of every artifact on both arms. This is what makes a run
  // replayable and what tells you, months later, exactly what was compared to what.
  parity.pins = {};
  for (const arm of ARMS) {
    parity.pins[arm] = armPins(baseline, arm).map((pin) => ({
      id: pin.id,
      deliver: pin.deliver,
      requested_ref: pin.requested_ref,
      kind: pin.resolved?.kind,
      sha: pin.resolved?.sha,
      hash: pin.resolved?.hash,
      dirty: Boolean(pin.resolved?.dirty),
      path: pin.resolved?.path,
      prepare: artifacts[pin.id]?.prepare || null,
      prepare_cost: artifacts[pin.id]?.prepare ? 'excluded from arm metrics (harness-run)' : 'n/a',
    }));
  }
  const pinIds = (arm) => parity.pins[arm].map((p) => `${p.id}@${p.requested_ref || p.kind}`).sort().join(',');
  parity.pins_symmetric = pinIds('control') === pinIds('test');
  // A dirty pin is legitimate (it is snapshotted, so the run is still replayable) but it
  // is not a named ref, so nobody can reconstruct it from git alone. Say so.
  parity.pins_dirty = ARMS.flatMap((arm) => parity.pins[arm].filter((p) => p.dirty).map((p) => `${arm}:${p.id}`));

  const dodChecksPath = path.join(runDir, 'dod-checks.json');
  if (fs.existsSync(dodChecksPath)) {
    const dodChecks = JSON.parse(fs.readFileSync(dodChecksPath, 'utf8'));
    parity.dod_checks = dodChecks.checks;
    const controlIds = (dodChecks.checks?.control || []).map((c) => c.id).sort().join(',');
    const testIds = (dodChecks.checks?.test || []).map((c) => c.id).sort().join(',');
    parity.dod_checks_asymmetric = controlIds !== testIds;
    // Asymmetry used to be excused when a check came from the artifact's own tooling. That
    // exemption is RETIRED (see /optimizer:plan 4b). A check only one arm can run grades only
    // one arm, so its column holds no comparison and every downstream pass-count quietly stops
    // being like-for-like. run-007's `qa-gate-clean` was the last of them: it re-ran the
    // plugin's own gate, which the plugin's own Stop hook already blocked the arm until it
    // passed, so it could only ever report `pass`. It did, on every turn, and measured nothing.
    const nonGeneric = ['control', 'test']
      .flatMap((a) => (dodChecks.checks?.[a] || []).map((c) => ({ arm: a, ...c })))
      .filter((c) => c.source && c.source !== 'generic');
    parity.dod_checks_non_generic = nonGeneric.map((c) => `${c.arm}:${c.id} (source="${c.source}")`);
    parity.dod_checks_note = parity.dod_checks_asymmetric
      ? 'DEFECT: control/test check lists differ — a check only one arm can run grades only one arm. Make the lists identical before firing.'
      : nonGeneric.length > 0
        ? `DEFECT: ${nonGeneric.length} check(s) declare a non-generic source — a DoD check must not run the artifact's own tooling (see /optimizer:plan 4b)`
        : 'control/test check lists identical, all checks generic';
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
    const scriptFile = path.join(launchDir, `${arm}.launch${launchScriptExt()}`);
    const armTitle = `AB ${env.experiment} ${arm} ${runName}`;

    fs.writeFileSync(settingsFile, JSON.stringify({ enabledPlugins: composed[arm].enabledPlugins }, null, 2));
    fs.writeFileSync(mcpFile, JSON.stringify({ mcpServers: composed[arm].mcpServers }, null, 2));

    const pins = armPins(baseline, arm);

    // Order matters: seed first (it may contain scaffolding an artifact overlays), then
    // artifacts, then prepare — a prepare command expects both to already be in place.
    let armEnv = {};
    if (!dryRun) {
      fs.mkdirSync(workspace, { recursive: true });
      copySeed(testenvRoot, workspace);
      armEnv = materializePins(workspace, pins);
      runPrepare(workspace, arm, pins, artifacts, launchDir, armEnv);
    }

    const script = buildLaunchScript({
      workspace,
      armEnv,
      title: armTitle,
      claudeArgs: buildClaudeArgs(env, composed[arm], settingsFile, mcpFile),
    });
    fs.writeFileSync(scriptFile, script, 'utf8');

    if (dryRun) continue;

    fs.copyFileSync(path.join(runDir, 'task.md'), path.join(workspace, 'TASK.md'));
    linkDodFolder(workspace, dodDir);
    writeWorkspaceSettings(workspace, manifestPath, arm, dodDir);

    manifest.arms[arm] = {
      status: 'launched',
      workspace,
      settings_file: settingsFile,
      mcp_file: mcpFile,
      plugin_dirs: composed[arm].pluginDirs,
      // The full resolved identity of what this arm ran against. Replayability and every
      // cross-run comparison in lab/ depend on this being complete and immutable.
      artifacts: pins.map((pin) => ({
        id: pin.id,
        repo: pin.repo,
        deliver: pin.deliver,
        requested_ref: pin.requested_ref,
        resolved: pin.resolved,
        prepare: artifacts[pin.id]?.prepare || null,
      })),
      env_vars: armEnv,
      spawn_pid: null,
      sessions: [],
    };
  }

  if (dryRun) {
    console.log(`[optimizer] DRY RUN — composed ${runName} launch artifacts in ${launchDir}`);
    for (const arm of ARMS) {
      const pins = armPins(baseline, arm);
      console.log(`[optimizer]   ${arm}: ${pins.length ? pins.map(describeResolved).join(', ') : 'vanilla (no artifacts)'}`);
    }
    if (parity.pins_dirty.length > 0) {
      console.log(`[optimizer]   NOTE: snapshotted from a dirty tree (no named ref): ${parity.pins_dirty.join(', ')}`);
    }
    console.log('[optimizer]   (dry run composes only — no workspace, no artifact delivery, no prepare)');
    console.log(`[optimizer] parity report: ${path.join(launchDir, 'parity-report.json')}`);
    return;
  }

  fs.mkdirSync(path.join(runDir, 'analysis'), { recursive: true });

  // Resolved once, so both arms are hosted identically. An asymmetry here would be a
  // parity break in the most literal sense: two arms in two different terminals.
  const host = noSpawn ? null : resolveTerminalHost();
  const scriptFiles = ARMS.map((arm) => path.join(launchDir, `${arm}.launch${launchScriptExt()}`));

  // No terminal on this machine is a degraded mode, not a failed run: the workspaces,
  // artifacts, prepare steps and manifest are all real, and the operator can start the
  // two scripts by hand. Silently backgrounding them instead would produce a run nobody
  // could watch, which is the one thing an A/B operator cannot work without.
  if (!noSpawn && !host) {
    console.log(`[optimizer] ${manualLaunchInstructions(scriptFiles)}`);
    for (const arm of ARMS) manifest.arms[arm].status = 'staged';
  } else {
    if (host) console.log(`[optimizer] terminal host: ${host.label}`);
    for (const [i, arm] of ARMS.entries()) {
      if (noSpawn) {
        // Workspaces, artifacts, prepare and the manifest are all real — only the terminal
        // is withheld. Lets a run be staged and inspected (and tested) before it starts.
        console.log(`[optimizer] --no-spawn: ${arm} arm staged at ${manifest.arms[arm].workspace}`);
        manifest.arms[arm].status = 'staged';
        continue;
      }
      const title = `AB ${env.experiment} ${arm} ${runName}`;
      let pid = null;
      try {
        pid = spawnTerminal({ title, scriptFile: scriptFiles[i], host });
      } catch (err) {
        // One arm in a window and one nowhere is worse than neither: it looks like a
        // fired run and analyzes as a broken one. Fall the whole pair back to manual.
        console.error(`[optimizer] ERROR: could not open a terminal for the ${arm} arm — ${err.message}`);
        console.log(`[optimizer] ${manualLaunchInstructions(scriptFiles)}`);
        for (const a of ARMS) manifest.arms[a].status = 'staged';
        break;
      }
      manifest.arms[arm].spawn_pid = pid;
      manifest.arms[arm].terminal_host = host.id;
      console.log(`[optimizer] launched ${arm} arm (pid ${pid ?? 'n/a'}) — "${title}"`);
    }
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`[optimizer] manifest: ${manifestPath}`);
  console.log('[optimizer] session ids will be linked into the manifest by the SessionStart hook of each arm.');
}

main();
