#!/usr/bin/env node
/**
 * session-context.mjs — SessionStart hook, fires in EVERY session ab-bench is enabled in
 * (it's a normal marketplace plugin, not conditionally loaded). Cheap no-op almost always:
 * walks up from cwd looking for .ab-bench/state.json (a plugin-under-test repo that's run
 * /ab-bench:init at least once); if absent, exits silently. If present, injects the current
 * mandate/env/testenv location as additionalContext — this is what lets a main session
 * "just know" where things are without the user re-stating an experiment name every time,
 * and what a fresh session reading .claude-plugin docs alone has no way to infer.
 *
 * Fail-open: any error here must never block an unrelated session from starting.
 */

import fs from 'node:fs';
import path from 'node:path';
import { findAbBenchDir, loadState, currentPaths } from '../lib/state.mjs';

function readStdinJSON() {
  try {
    const raw = fs.readFileSync(0, 'utf8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function main() {
  const input = readStdinJSON();
  const cwd = input.cwd || process.cwd();

  const abBenchDir = findAbBenchDir(cwd);
  if (!abBenchDir) {
    process.exit(0); // no .ab-bench/ anywhere above cwd — not an ab-bench-tracked repo, stay silent
  }

  const state = loadState(abBenchDir);
  if (!state) process.exit(0);

  const paths = currentPaths(abBenchDir, state, state.experiments_root);
  const mandateExists = fs.existsSync(paths.mandateFile);
  const envExists = fs.existsSync(paths.envFile);

  const lines = [
    'ab-bench: this repo has an active experiment tracked in .ab-bench/ — you are the MAIN session (never an arm).',
    `  plugin repo: ${abBenchDir.replace(/\.ab-bench$/, '').replace(/[\\/]$/, '')}`,
    `  current mandate: ${state.current_mandate}${mandateExists ? '' : ' (mandate.md MISSING — run /ab-bench:understand)'}`,
    `  current env: ${state.current_env}${envExists ? '' : ' (env.json MISSING — run /ab-bench:init)'}`,
    `  testenv (runs/.dod/seed/ledger/baselines): ${paths.testenvRoot}`,
    '  ab-bench skills (init/understand/plan/fire/analyze/status) resolve these automatically — no experiment name needed unless you want to target a different env.',
  ];

  const output = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: lines.join('\n'),
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

try {
  main();
} catch (e) {
  console.error(`[ab-bench] session-context hook error (non-fatal): ${e.message}`);
  process.exit(0);
}
