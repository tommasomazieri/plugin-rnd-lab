#!/usr/bin/env node
/**
 * resolve-baseline.mjs — pin every declared artifact, for both arms, for one run.
 *
 * Usage:
 *   node resolve-baseline.mjs <configRoot> <testenvRoot> <runDir> [--control <spec>] [--test <spec>]
 *
 *   <spec> is a comma-separated list of <artifactId>=<ref>, or the word `vanilla`, or
 *   `HEAD`/omitted for "whatever is in the working tree".
 *
 *   # single-artifact experiment, control on an old tag (the schema-1 case, unchanged)
 *   node resolve-baseline.mjs ... --control my-plugin=v0.2.0
 *   node resolve-baseline.mjs ... --control vanilla
 *
 *   # two artifacts, control on the previous release of both
 *   node resolve-baseline.mjs ... --control "plugin=v0.2.0,lib=v0.2.0"
 *
 *   # hold the library fixed, vary only the plugin — the isolating run
 *   node resolve-baseline.mjs ... --control "plugin=v0.2.0,lib=v0.3.0" --test "lib=v0.3.0"
 *
 * `vanilla` means the arm gets nothing beyond env.json's own block for it — no artifacts
 * at all. That is the only way an arm ends up unpinned, and it is unpinned because it has
 * nothing to pin, not because something mutable leaked in.
 *
 * Two-root split (see docs/dod-contract.md): <configRoot> is <plugin-repo>/.ab-bench/
 * mandate-N/envs/env-M/ (env.json only). <testenvRoot> is the paired
 * <experiments_root>/<plugin-folder-name>/mandate-N/env-M/ folder (seed/, .dod/,
 * baselines/, runs/, lab/).
 *
 * Writes runs/run-NNN/baseline.json, read by launch-pair.mjs at fire time.
 */

import fs from 'node:fs';
import path from 'node:path';

import { normalizeArtifacts, resolveArtifact, describeResolved } from '../../../lib/artifacts.mjs';

const ARMS = ['control', 'test'];

function fail(msg) {
  console.error(`[resolve-baseline] ERROR: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { configRoot: null, testenvRoot: null, runDir: null, specs: {} };
  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--control') args.specs.control = argv[++i];
    else if (a === '--test') args.specs.test = argv[++i];
    else if (a === '--vanilla') args.specs.control = 'vanilla'; // schema-1 spelling, still accepted
    else if (a === '--ref') args.specs.control = `*=${argv[++i]}`; // schema-1 spelling
    else positional.push(a);
  }
  if (positional.length < 3) {
    fail('usage: node resolve-baseline.mjs <configRoot> <testenvRoot> <runDir> [--control <spec>] [--test <spec>]');
  }
  args.configRoot = path.resolve(positional[0]);
  args.testenvRoot = path.resolve(positional[1]);
  args.runDir = path.resolve(positional[2]);
  return args;
}

function loadEnv(configRoot) {
  const envPath = path.join(configRoot, 'env.json');
  if (!fs.existsSync(envPath)) fail(`env.json not found in ${configRoot}`);
  try {
    return JSON.parse(fs.readFileSync(envPath, 'utf8'));
  } catch (e) {
    fail(`env.json is not valid JSON: ${e.message}`);
  }
}

/**
 * "vanilla" -> no artifacts. "a=v1,b=v2" -> those refs. "*=v1" -> that ref for every
 * artifact (the schema-1 --ref spelling). Absent -> every artifact at its working tree.
 */
function parseSpec(spec, artifactIds) {
  if (spec === undefined || spec === null || spec === '') {
    return Object.fromEntries(artifactIds.map((id) => [id, null]));
  }
  if (spec.trim().toLowerCase() === 'vanilla') return {};
  const pins = {};
  for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const idx = part.indexOf('=');
    const id = idx === -1 ? part : part.slice(0, idx).trim();
    const ref = idx === -1 ? null : part.slice(idx + 1).trim() || null;
    if (id === '*') {
      for (const a of artifactIds) pins[a] = ref;
      continue;
    }
    if (!artifactIds.includes(id)) {
      fail(`unknown artifact "${id}" — env.json declares: ${artifactIds.join(', ') || '(none)'}`);
    }
    pins[id] = ref && ref.toUpperCase() === 'HEAD' ? null : ref;
  }
  // Anything not named stays at its working tree, so a spec only has to state what differs.
  for (const id of artifactIds) if (!(id in pins)) pins[id] = null;
  return pins;
}

function main() {
  const { configRoot, testenvRoot, runDir, specs } = parseArgs(process.argv);
  if (!fs.existsSync(runDir)) fail(`runDir does not exist: ${runDir}`);

  const env = loadEnv(configRoot);
  let artifacts;
  try {
    artifacts = normalizeArtifacts(env);
  } catch (e) {
    fail(e.message);
  }
  const artifactIds = Object.keys(artifacts);
  if (artifactIds.length === 0) {
    fail('env.json declares no artifacts and has no "pluginUnderTestRepo" — nothing to pin. See /optimizer:init.');
  }

  const out = { schema: 2, run: path.basename(runDir), generated_at: new Date().toISOString(), arms: {} };

  for (const arm of ARMS) {
    const wanted = parseSpec(specs[arm], artifactIds);
    const pins = {};
    for (const [id, ref] of Object.entries(wanted)) {
      try {
        pins[id] = resolveArtifact(artifacts[id], ref, testenvRoot);
      } catch (e) {
        fail(`${arm} arm, artifact "${id}": ${e.message}`);
      }
    }
    out.arms[arm] = { pins };

    const summary = Object.values(pins).map(describeResolved);
    console.log(`[resolve-baseline] ${arm}: ${summary.length ? summary.join(', ') : 'vanilla (no artifacts)'}`);
    for (const pin of Object.values(pins)) {
      const r = pin.resolved;
      console.log(`  - ${pin.id} [${pin.deliver}] ${r.kind} -> ${r.path}${r.cached ? ' (cached)' : ''}`);
      if (r.dirty) {
        console.log(`    NOTE: ${pin.repo} had uncommitted changes; this run is pinned to a snapshot of them, not to the live repo.`);
      }
    }
  }

  const baselinePath = path.join(runDir, 'baseline.json');
  fs.writeFileSync(baselinePath, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`[resolve-baseline] -> ${baselinePath}`);
}

main();
