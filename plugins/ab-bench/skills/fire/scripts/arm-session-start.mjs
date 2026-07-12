#!/usr/bin/env node
/**
 * arm-session-start.mjs — SessionStart hook injected into each arm workspace
 * (via <workspace>/.claude/settings.json, written by launch-pair.mjs).
 *
 * Receives the standard SessionStart JSON on stdin ({session_id, transcript_path,
 * cwd, source, ...}) and:
 *
 *   1. MANIFEST LINKAGE — appends {at, source, session_id, transcript_path} to
 *      arms.<arm>.sessions in the run manifest. File-based replacement for
 *      agentic_pm_app's REST link-session.
 *
 *   2. DOD REGISTRATION (source "startup" or "clear" only — never on resume/compact,
 *      which would fight dod-lite's own accumulated `history`):
 *      order-independent contract with dod-lite (see docs/dod-contract.md), against its
 *      REAL schema (.dod/sessions/<session_id>.json, dod-lite's own scaffold shape):
 *        - read runs/run-NNN/dod-checks.json (this arm's check id list); if absent or
 *          no entry for this arm, skip silently (graceful degradation)
 *        - poll up to 5s for .dod/sessions/<session_id>.json (dod-lite's own SessionStart
 *          hook creates it, create-if-absent, via the .dod junction)
 *        - MERGE (never overwrite wholesale): append this arm's check ids into checks[]
 *          (dedup), seed state[id] for new ids using the recorded tier, set
 *          planning_invoked = true (neutralizes dod-lite's own plan-mode gate/nudge so
 *          this arm is never steered into designing its own competing checks)
 *        - if the session file never appears within 5s, create it from scratch using
 *          dod-lite's exact scaffold shape, then merge in the same way
 *
 * Deliberately writes NOTHING to stdout: any injected context would have to be
 * byte-identical across arms to preserve parity, and identifying the arm to the
 * agent would contaminate the experiment. Always exits 0 (fail-open): a broken
 * hook must never block an arm from starting — failures land in .launch/hooks.log
 * and show up as unlinked arms in /ab-bench:status.
 */

import fs from 'node:fs';
import path from 'node:path';

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

function log(launchDir, msg) {
  try {
    fs.mkdirSync(launchDir, { recursive: true });
    fs.appendFileSync(path.join(launchDir, 'hooks.log'), `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* logging must never throw */
  }
}

function updateManifest(manifestPath, arm, entry) {
  // read-modify-write with retries: the two arms start seconds apart but can race
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (!manifest.arms?.[arm]) throw new Error(`arm "${arm}" missing from manifest`);
      manifest.arms[arm].sessions = manifest.arms[arm].sessions || [];
      manifest.arms[arm].sessions.push(entry);
      manifest.arms[arm].status = 'linked';
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      return true;
    } catch (e) {
      if (attempt === 4) throw e;
      const wait = 100 * (attempt + 1);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
    }
  }
  return false;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

// dod-lite's exact scaffold shape (mirrors newSessionScaffold() in its lib.mjs) —
// used only if dod-lite's own SessionStart hook never shows up within the poll window.
function dodLiteScaffold(sessionId) {
  return {
    session_id: sessionId,
    created_at: new Date().toISOString(),
    planning_invoked: false,
    session_goal: null,
    checks: [],
    state: {},
    history: [],
  };
}

function registerDod(dodDir, runDir, arm, sessionId, launchDir) {
  const dodChecksPath = path.join(runDir, 'dod-checks.json');
  if (!fs.existsSync(dodChecksPath)) {
    log(launchDir, `dod: no ${dodChecksPath} — skipping registration`);
    return { registered: false, mode: 'no-dod-checks' };
  }
  const dodChecks = readJsonSafe(dodChecksPath);
  const list = dodChecks?.checks?.[arm] || [];
  if (list.length === 0) {
    log(launchDir, `dod: dod-checks.json has no checks for arm "${arm}" — skipping registration`);
    return { registered: false, mode: 'no-checks-for-arm' };
  }

  const sessionsDir = path.join(dodDir, 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });
  const sessionFile = path.join(sessionsDir, `${sessionId}.json`);

  // poll for dod-lite's own SessionStart hook to scaffold the session file first
  const deadline = Date.now() + 5000;
  let session = null;
  let mode = 'created-fresh';
  while (Date.now() < deadline) {
    session = readJsonSafe(sessionFile);
    if (session) {
      mode = 'merged-existing';
      break;
    }
    sleep(500);
  }
  if (!session) session = dodLiteScaffold(sessionId);

  session.checks = session.checks || [];
  session.state = session.state || {};
  const existingIds = new Set(session.checks);
  for (const { id, tier } of list) {
    if (!existingIds.has(id)) {
      session.checks.push(id);
      existingIds.add(id);
    }
    if (!session.state[id]) {
      session.state[id] = { tier, last_result: 'pending', last_output: null, last_checked_at: null };
    }
  }
  session.planning_invoked = true;
  if (!session.session_goal && dodChecks.run) {
    session.session_goal = `ab-bench run ${dodChecks.run} (${arm} arm)`;
  }

  const tmp = `${sessionFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(session, null, 2));
  fs.renameSync(tmp, sessionFile);

  const ids = list.map((c) => c.id).join(', ');
  log(launchDir, `dod: ${mode} ${sessionFile} — seeded checks [${ids}], planning_invoked=true`);
  return { registered: true, mode, checks: list.map((c) => c.id) };
}

function main() {
  const args = parseArgs(process.argv);
  const manifestPath = args.manifest;
  const arm = args.arm;
  const dodDir = args.dod;
  const runDir = manifestPath ? path.dirname(manifestPath) : null;
  const launchDir = runDir ? path.join(runDir, '.launch') : path.resolve('.launch');

  let input = {};
  try {
    input = JSON.parse(readStdin() || '{}');
  } catch {
    log(launchDir, `WARN: could not parse stdin JSON (arm ${arm})`);
  }

  const sessionId = input.session_id || null;
  const source = input.source || 'unknown';

  try {
    if (!manifestPath || !arm) throw new Error('missing --manifest or --arm');
    if (!sessionId) throw new Error('no session_id on stdin');

    const entry = {
      at: new Date().toISOString(),
      source,
      session_id: sessionId,
      transcript_path: input.transcript_path || null,
    };

    if (source === 'startup' || source === 'clear') {
      entry.dod = registerDod(dodDir, runDir, arm, sessionId, launchDir);
    }

    updateManifest(manifestPath, arm, entry);
    log(launchDir, `linked ${arm}: session ${sessionId} (source=${source})`);
  } catch (e) {
    log(launchDir, `ERROR (arm ${arm}, source ${source}): ${e.message}`);
  }
  process.exit(0);
}

main();
