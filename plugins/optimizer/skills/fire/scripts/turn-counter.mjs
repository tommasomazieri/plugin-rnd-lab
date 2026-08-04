/**
 * turn-counter.mjs — optimizer's own per-arm turn counter.
 *
 * WHY THIS EXISTS (measured, not assumed): the arms used to rely entirely on the
 * user's global Stop hook (~/.claude/hooks/count-turn.sh) to produce
 * ~/.claude/turn-counts/<session_id>.count, which the statusline footer reads. In
 * fired arm sessions that file was routinely absent or frozen at 1 — checked across
 * consultant run-001/run-002 and blender-plugin-tester run-003: main arm sessions with
 * 300-620 transcript lines carried count=1 or no file at all, so the footer fell back
 * to its JSONL scan and reported one line per assistant entry ("135 turns" against a
 * control that read "1 turn"). dod-lite's own Stop hook shows the same pattern (0 or 1
 * history entries on those same sessions), i.e. once a Stop hook blocks, later Stop
 * events in that session stop being counted as fresh turns.
 *
 * So optimizer counts its own stop signals instead of borrowing someone else's:
 *   - node, not bash+python3 — no PATH/interpreter dependency inside the spawned
 *     `cmd /k` terminal, same runtime already proven to work for arm-session-start.mjs
 *   - registered in <workspace>/.claude/settings.json (project scope), so it exists
 *     for the arm regardless of what the user's global settings do
 *   - `turns` counts stop signals where stop_hook_active is false (one real
 *     user-turn-to-final-response cycle); `stops_total` counts every stop signal, so a
 *     DoD-block continuation loop is visible instead of silently swallowed
 *   - the canonical record lives in the run itself (<runDir>/.launch/turns/), which is
 *     what /optimizer:analyze reads — the home-dir mirror is only there so the footer
 *     tells the truth while the run is live
 *
 * The mirror is written as an ABSOLUTE value, never read-modify-write: if the user's
 * global bash hook is also incrementing the same file, our next write corrects it
 * rather than compounding with it.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// dod-lite's prompt-tier checks spawn `claude -p` subprocesses with DOD_LITE_CHECKER=1,
// in the arm workspace — so they inherit the arm's project settings.json and fire its
// hooks too. Their sessions are not arm turns and must never be counted or linked.
export function isCheckerSubprocess() {
  return process.env.DOD_LITE_CHECKER === '1';
}

export function turnsDir(runDir) {
  return path.join(runDir, '.launch', 'turns');
}

export function counterPath(runDir, sessionId) {
  return path.join(turnsDir(runDir), `${sessionId}.json`);
}

// The path the statusline footer reads (statusline-command.sh:
// "$HOME/.claude/turn-counts/$PY_SESSION_ID.count").
export function mirrorPath(sessionId) {
  return path.join(os.homedir(), '.claude', 'turn-counts', `${sessionId}.count`);
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonAtomic(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, p);
}

function writeMirror(sessionId, turns) {
  const p = mirrorPath(sessionId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${turns}\n`);
}

/**
 * Called from the SessionStart hook. Creates the counter at 0 so "was the counter ever
 * armed for this arm?" is answerable BEFORE any turn happens — /optimizer:fire gates the
 * handoff on it. A 0 in the mirror is also what the footer wants: its display gate is
 * `turns > 0`, so a fresh session shows no turn segment instead of a stale JSONL guess.
 */
export function initCounter({ runDir, arm, sessionId }) {
  if (isCheckerSubprocess()) return { skipped: 'checker-subprocess' };
  const p = counterPath(runDir, sessionId);
  const existing = readJsonSafe(p);
  if (existing) return { already: true, turns: existing.turns ?? 0 };
  const state = {
    schema: 1,
    arm,
    session_id: sessionId,
    turns: 0,
    stops_total: 0,
    blocked_continuations: 0,
    initiated_at: new Date().toISOString(),
    last_stop_at: null,
  };
  writeJsonAtomic(p, state);
  writeMirror(sessionId, 0);
  return { created: true, turns: 0 };
}

/**
 * Called from the Stop hook. `stopHookActive` true means this stop is a continuation
 * forced by a blocking Stop hook (dod-lite refusing to let the arm stop on failing
 * checks) — same user turn, so it moves stops_total and blocked_continuations but not
 * `turns`.
 */
export function bumpCounter({ runDir, arm, sessionId, stopHookActive }) {
  if (isCheckerSubprocess()) return { skipped: 'checker-subprocess' };
  const p = counterPath(runDir, sessionId);
  const state = readJsonSafe(p) || {
    schema: 1,
    arm,
    session_id: sessionId,
    turns: 0,
    stops_total: 0,
    blocked_continuations: 0,
    // no initiated_at: this session's SessionStart init did not land, and that is worth
    // seeing in the counter file rather than papering over.
    initiated_at: null,
    last_stop_at: null,
  };
  state.arm = state.arm || arm;
  state.stops_total = (state.stops_total || 0) + 1;
  if (stopHookActive) state.blocked_continuations = (state.blocked_continuations || 0) + 1;
  else state.turns = (state.turns || 0) + 1;
  state.last_stop_at = new Date().toISOString();
  writeJsonAtomic(p, state);
  writeMirror(sessionId, state.turns);
  return { turns: state.turns, stops_total: state.stops_total };
}

/** All counters recorded for a run, newest-initiated last. Used by verify-launch + analyze. */
export function readCounters(runDir) {
  const dir = turnsDir(runDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJsonSafe(path.join(dir, f)))
    .filter(Boolean);
}

export function readCounter(runDir, sessionId) {
  return readJsonSafe(counterPath(runDir, sessionId));
}
