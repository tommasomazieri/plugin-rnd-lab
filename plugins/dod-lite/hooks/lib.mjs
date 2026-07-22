// Shared helpers for dod-lite's Stop hook (dod-check.mjs — the only hook this
// trimmed, ab-bench-owned copy ships). Fail-open contract: internal errors are
// logged to stderr and the hook exits 0, never blocking an unrelated session.

import { promises as fs } from 'node:fs';
import path from 'node:path';

export const DOD_DIR = '.dod';
export const CHECKS_DIR = 'checks';
export const SESSIONS_DIR = 'sessions';
export const CONFIG_FILE = 'config.json';

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

export async function loadRunners(cwd) {
  const merged = { ...DEFAULT_RUNNERS };
  const configPath = path.join(dodDir(cwd), CONFIG_FILE);
  if (await pathExists(configPath)) {
    try {
      const raw = await fs.readFile(configPath, 'utf8');
      const config = JSON.parse(raw);
      if (config && typeof config.runners === 'object' && config.runners) {
        Object.assign(merged, config.runners);
      }
    } catch (err) {
      console.error(`dod-lite: ignoring malformed ${configPath}: ${err.message}`);
    }
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
