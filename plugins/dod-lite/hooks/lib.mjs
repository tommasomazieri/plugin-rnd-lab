// Shared helpers for dod-lite's Stop hook (dod-check.mjs — the only hook this
// trimmed, ab-bench-owned copy ships). Fail-open contract: internal errors are
// logged to stderr and the hook exits 0, never blocking an unrelated session.

import { promises as fs } from 'node:fs';
import path from 'node:path';

export const DOD_DIR = '.dod';
export const CHECKS_DIR = 'checks';
export const SESSIONS_DIR = 'sessions';
export const CONFIG_FILE = 'config.json';

// Human-tier answers land HERE, not in .dod/. An ab-bench arm is denied
// Edit/Write/MultiEdit on `/.dod/**` (launch-pair.mjs writes that deny rule so an arm
// can never edit the checks it is graded against), and the session file lives inside
// that same tree — so the old instruction to "edit the session file yourself" was
// structurally impossible to obey and looped the arm into Claude Code's 8-stop cap.
// A sibling directory keeps .dod immutable to arms AND leaves the arm's raw claim on
// disk next to the harness's own record, so a forged verdict is detectable.
export const ANSWERS_DIR = '.dod-answers';

export const DEFAULT_RUNNERS = {
  '.mjs': 'node',
  '.js': 'node',
  '.cjs': 'node',
  '.sh': 'bash',
  '.ps1': 'powershell -NoProfile -ExecutionPolicy Bypass -File',
  '.py': 'python',
  '.rb': 'ruby',
};

export function isRecursionGuardActive() {
  return process.env.DOD_LITE_CHECKER === '1';
}

export async function readStdinJSON() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

export function dodDir(cwd) {
  return path.join(cwd, DOD_DIR);
}

export function checksDir(cwd) {
  return path.join(cwd, DOD_DIR, CHECKS_DIR);
}

export function sessionFilePath(cwd, sessionId) {
  return path.join(cwd, DOD_DIR, SESSIONS_DIR, `${sessionId}.json`);
}

export function answersDir(cwd) {
  return path.join(cwd, ANSWERS_DIR);
}

export function answerFilePath(cwd, id) {
  return path.join(cwd, ANSWERS_DIR, `${id}.json`);
}

// Reads whatever the arm wrote into .dod-answers/. Absent dir, unreadable file, or
// malformed JSON all degrade to "no answer for that check" rather than taking the hook
// down — an arm that writes garbage should keep being asked, not crash the session.
export async function readAnswers(cwd) {
  const dir = answersDir(cwd);
  const out = {};
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch {
    return out;
  }
  for (const f of entries) {
    if (!f.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(path.join(dir, f), 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') out[f.slice(0, -'.json'.length)] = parsed;
    } catch (err) {
      console.error(`dod-lite: ignoring unreadable answer file ${f}: ${err.message}`);
    }
  }
  return out;
}

export async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// Session files are created/seeded entirely by ab-bench's arm-session-start.mjs
// (a separate plugin, no import dependency on this file) — this hook only ever
// reads an already-seeded file and writes updated state/history back onto it.
export async function readSession(cwd, sessionId) {
  const p = sessionFilePath(cwd, sessionId);
  if (!(await pathExists(p))) return null;
  const raw = await fs.readFile(p, 'utf8');
  return JSON.parse(raw);
}

// Atomic-ish write: write to a temp file then rename, so a crash mid-write
// never leaves a half-written session json for the next hook to choke on.
export async function writeSession(cwd, sessionId, data) {
  const p = sessionFilePath(cwd, sessionId);
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, p);
}

// .dod/config.json is optional and entirely advisory — a malformed one degrades
// to defaults rather than taking the hook down with it.
export async function loadConfig(cwd) {
  const configPath = path.join(dodDir(cwd), CONFIG_FILE);
  if (!(await pathExists(configPath))) return {};
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(raw);
    return config && typeof config === 'object' ? config : {};
  } catch (err) {
    console.error(`dod-lite: ignoring malformed ${configPath}: ${err.message}`);
    return {};
  }
}

export async function loadRunners(cwd) {
  const merged = { ...DEFAULT_RUNNERS };
  const config = await loadConfig(cwd);
  if (config.runners && typeof config.runners === 'object') {
    Object.assign(merged, config.runners);
  }
  return merged;
}

export function truncate(text, max = 2000) {
  if (typeof text !== 'string') return text;
  return text.length > max ? `${text.slice(0, max)}\n... [truncated]` : text;
}

// Wraps a hook's main() in the fail-open contract: log and exit 0 on any
// uncaught error, so a dod-lite bug never blocks an unrelated session.
export function runFailOpen(mainFn) {
  mainFn().catch((err) => {
    console.error(`dod-lite hook error: ${err && err.stack ? err.stack : err}`);
    process.exitCode = 0;
  });
}

export function printJSON(obj) {
  process.stdout.write(JSON.stringify(obj));
}
