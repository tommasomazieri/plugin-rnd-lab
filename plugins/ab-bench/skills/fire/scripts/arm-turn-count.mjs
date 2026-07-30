#!/usr/bin/env node
/**
 * arm-turn-count.mjs — Stop hook injected into each arm workspace (via
 * <workspace>/.claude/settings.json, written by launch-pair.mjs).
 *
 * Usage: node arm-turn-count.mjs --run <runDir> --arm control|test
 * Stdin: standard Stop hook JSON ({session_id, stop_hook_active, cwd, ...}).
 *
 * One stop signal in, one counter increment out. See turn-counter.mjs for why ab-bench
 * counts its own stops instead of trusting the user's global count-turn.sh.
 *
 * Writes nothing to stdout — a Stop hook's stdout is control channel (decision/block),
 * and this must never influence whether an arm is allowed to stop. Always exits 0.
 */

import fs from 'node:fs';
import path from 'node:path';
import { bumpCounter } from './turn-counter.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (key.startsWith('--')) args[key.slice(2)] = argv[++i];
  }
  return args;
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function log(runDir, msg) {
  try {
    const dir = path.join(runDir, '.launch');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'hooks.log'), `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* logging must never throw */
  }
}

function main() {
  const args = parseArgs(process.argv);
  const runDir = args.run;
  const arm = args.arm;
  if (!runDir || !arm) process.exit(0);

  let input = {};
  try {
    input = JSON.parse(readStdin() || '{}');
  } catch {
    /* fall through to the no-session-id exit below */
  }
  const sessionId = input.session_id;
  if (!sessionId) {
    log(runDir, `turns: stop signal with no session_id (arm ${arm}) — not counted`);
    process.exit(0);
  }

  try {
    const r = bumpCounter({
      runDir,
      arm,
      sessionId,
      stopHookActive: input.stop_hook_active === true,
    });
    if (r.skipped) log(runDir, `turns: skipped ${sessionId} (${r.skipped})`);
  } catch (e) {
    log(runDir, `turns: ERROR counting stop for ${arm}/${sessionId}: ${e.message}`);
  }
  process.exit(0);
}

main();
