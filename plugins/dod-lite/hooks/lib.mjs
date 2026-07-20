// Shared helpers for dod-lite hook scripts.
// Every hook script imports from here and follows the same fail-open contract:
// internal errors are logged to stderr and the hook exits 0, never blocking
// an unrelated session on a dod-lite bug.

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

export async function ensureDodScaffold(cwd) {
  await fs.mkdir(checksDir(cwd), { recursive: true });
  await fs.mkdir(path.join(dodDir(cwd), SESSIONS_DIR), { recursive: true });
}

export async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export function newSessionScaffold(sessionId, title = null) {
  return {
    session_id: sessionId,
    session_title: title,
    created_at: new Date().toISOString(),
    planning_invoked: false,
    session_goal: null,
    checks: [],
    state: {},
    history: [],
  };
}

// A session file counts as "meaningful" once planning ran or it has checks/
// history — an empty scaffold is indistinguishable from the throwaway
// `source=startup` stub Claude Code fires alongside some resumes (see
// findResumeDonor), so those never get picked as migration donors.
export function isMeaningfulSession(data) {
  return Boolean(
    data &&
      (data.planning_invoked ||
        (Array.isArray(data.checks) && data.checks.length > 0) ||
        (Array.isArray(data.history) && data.history.length > 0))
  );
}

export async function readSession(cwd, sessionId) {
  const p = sessionFilePath(cwd, sessionId);
  if (!(await pathExists(p))) return null;
  const raw = await fs.readFile(p, 'utf8');
  return JSON.parse(raw);
}

// Create-if-absent: never clobbers an existing session file (matters for
// SessionStart firing again on --resume).
export async function createSessionIfAbsent(cwd, sessionId, title = null) {
  const p = sessionFilePath(cwd, sessionId);
  if (await pathExists(p)) {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw);
  }
  const scaffold = newSessionScaffold(sessionId, title);
  await writeSession(cwd, sessionId, scaffold);
  return scaffold;
}

// Claude Code resume can hand SessionStart a brand-new session_id instead of
// reusing the resumed session's durable one (known upstream bug: the "resume"
// fire sometimes forks rather than reattaches — anthropics/claude-code#76493,
// #70373, #72012; a harmless throwaway `source=startup` twin is also filed as
// #76734/#30825). The hook payload never names the original id, so this is a
// best-effort donor search: prefer an exact session_title match (present once
// a title has been captured by a prior run of this hook), else fall back to
// the most-recently-modified non-stub, non-already-superseded session file.
// Single-active-session-per-project usage is the assumption; concurrent
// unrelated sessions in one project can fool the mtime fallback.
export async function findResumeDonor(cwd, sessionId, title) {
  const dir = path.join(dodDir(cwd), SESSIONS_DIR);
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch {
    return null;
  }

  const candidates = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const id = entry.slice(0, -'.json'.length);
    if (id === sessionId) continue;
    const p = path.join(dir, entry);
    let data;
    try {
      data = JSON.parse(await fs.readFile(p, 'utf8'));
    } catch {
      continue;
    }
    if (data.superseded_by) continue;
    if (!isMeaningfulSession(data)) continue;
    const stat = await fs.stat(p);
    candidates.push({ id, data, path: p, mtimeMs: stat.mtimeMs });
  }
  if (candidates.length === 0) return null;

  if (title) {
    const titleMatch = candidates.find((c) => c.data.session_title === title);
    if (titleMatch) return titleMatch;
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0];
}

// Copies a donor session's DoD state onto the new id (checks/history/goal/
// planning_invoked survive) and marks the donor superseded so it's never
// picked as a donor again and its history reads as frozen, not abandoned.
export async function migrateSession(cwd, donor, newSessionId, title) {
  const migrated = {
    ...donor.data,
    session_id: newSessionId,
    session_title: title ?? donor.data.session_title ?? null,
    resumed_from: donor.id,
    resumed_at: new Date().toISOString(),
  };
  delete migrated.superseded_by;
  delete migrated.superseded_at;
  await writeSession(cwd, newSessionId, migrated);

  await writeSession(cwd, donor.id, {
    ...donor.data,
    superseded_by: newSessionId,
    superseded_at: new Date().toISOString(),
  });

  return migrated;
}

// Self-heals session_title on every SessionStart fire (not just resume) so a
// later resume of *this* session has a title to match against.
export async function touchSessionTitle(cwd, sessionId, title) {
  const session = await readSession(cwd, sessionId);
  if (!session || session.session_title === title) return;
  session.session_title = title;
  await writeSession(cwd, sessionId, session);
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
