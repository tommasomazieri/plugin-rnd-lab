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
 *      which would fight the accumulated `history`):
 *      this hook is now the SOLE writer of .dod/sessions/<session_id>.json — the trimmed
 *      dod-lite engine (plugins/dod-lite, see docs/dod-contract.md) ships no SessionStart
 *      hook of its own, so there is no foreign hook to race or wait for:
 *        - read runs/run-NNN/dod-checks.json (this arm's check id list); if absent or
 *          no entry for this arm, skip silently (graceful degradation)
 *        - create the session file from dod-lite's documented scaffold shape if absent,
 *          or merge into it if present (never overwrite wholesale) — append this arm's
 *          check ids into checks[] (dedup), seed state[id] for new ids using the recorded
 *          tier. `planning_invoked: true` is still set for schema-shape consistency with
 *          what dod-lite's Stop hook and /ab-bench:analyze expect, but it's cosmetic now —
 *          no gate hook exists anymore for it to neutralize.
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

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

// dod-lite's documented scaffold shape (mirrors newSessionScaffold() in its lib.mjs) —
// this hook is the sole creator of the session file now, so this always applies on first touch.
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

  // no foreign SessionStart hook exists anymore to create this first — this hook is the
  // sole writer, so a brand-new session id always hits the create-fresh path. The
  // merged-existing path stays in case this ever fires twice for the same session id.
  let session = readJsonSafe(sessionFile);
  const mode = session ? 'merged-existing' : 'created-fresh';
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
