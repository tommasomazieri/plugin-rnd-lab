// Shared fixture helpers for the dod-lite suite. Every test gets its own temp workspace
// with a real .dod/ tree, because the hook resolves everything relative to cwd and
// mocking the filesystem would stop testing the thing that actually breaks.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOOKS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks');

const created = [];

export function makeWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dod-lite-test-'));
  fs.mkdirSync(path.join(dir, '.dod', 'checks'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.dod', 'sessions'), { recursive: true });
  created.push(dir);
  return dir;
}

export function cleanupAll() {
  for (const dir of created.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* a leaked temp dir is not a test failure */ }
  }
}

export function writeCheck(cwd, filename, contents) {
  const p = path.join(cwd, '.dod', 'checks', filename);
  fs.writeFileSync(p, contents);
  return p;
}

/** A script check that exits with the given code. Written in node so no interpreter hunt. */
export function writeScriptCheck(cwd, id, exitCode, { stdout = '', hang = false } = {}) {
  const body = hang
    ? 'setTimeout(() => {}, 60_000);'
    : `${stdout ? `console.log(${JSON.stringify(stdout)});` : ''}process.exit(${exitCode});`;
  return writeCheck(cwd, `${id}.mjs`, body);
}

export function writeMeta(cwd, id, meta) {
  return writeCheck(cwd, `${id}.meta.json`, JSON.stringify(meta, null, 2));
}

export function writeSessionFile(cwd, sessionId, checks, state = {}) {
  const p = path.join(cwd, '.dod', 'sessions', `${sessionId}.json`);
  fs.writeFileSync(
    p,
    JSON.stringify({ session_id: sessionId, created_at: new Date().toISOString(), checks, state, history: [] }, null, 2),
  );
  return p;
}

export function readSessionFile(cwd, sessionId) {
  return JSON.parse(fs.readFileSync(path.join(cwd, '.dod', 'sessions', `${sessionId}.json`), 'utf8'));
}

export function writeAnswer(cwd, id, answer) {
  const dir = path.join(cwd, '.dod-answers');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(answer, null, 2));
}

export function writeConfig(cwd, config) {
  fs.writeFileSync(path.join(cwd, '.dod', 'config.json'), JSON.stringify(config, null, 2));
}

/**
 * Substitutes a fake grader for the duration of a test, so the prompt tier can be
 * exercised without spending money or depending on the network. `script` is node source
 * that receives the real argv and decides what to print and exit with.
 *
 * Goes through DOD_LITE_CLAUDE_CMD rather than shadowing PATH: the hook spawns with
 * shell:false, which on Windows resolves only real executables — a .cmd shim on PATH is
 * skipped and the real claude.exe gets invoked instead, which is exactly the trap that
 * made the first version of this suite spend 20s per test talking to production.
 */
export function stubClaude(script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dod-lite-bin-'));
  created.push(dir);
  const impl = path.join(dir, 'claude-impl.mjs');
  fs.writeFileSync(impl, script);
  const prev = process.env.DOD_LITE_CLAUDE_CMD;
  process.env.DOD_LITE_CLAUDE_CMD = JSON.stringify([process.execPath, impl]);
  return () => {
    if (prev === undefined) delete process.env.DOD_LITE_CLAUDE_CMD;
    else process.env.DOD_LITE_CLAUDE_CMD = prev;
  };
}

/** Points the grader at a binary that does not exist, to exercise the spawn-failure path. */
export function stubMissingClaude() {
  const prev = process.env.DOD_LITE_CLAUDE_CMD;
  process.env.DOD_LITE_CLAUDE_CMD = JSON.stringify([path.join(os.tmpdir(), 'definitely-not-a-real-binary-xyz')]);
  return () => {
    if (prev === undefined) delete process.env.DOD_LITE_CLAUDE_CMD;
    else process.env.DOD_LITE_CLAUDE_CMD = prev;
  };
}

/** A stub that emits a well-formed v2 verdict. */
export function verdictStub({ pass = true, reason = 'ok', evidence = [{ path: 'a.txt', quote: 'x' }], confidence = 'high' } = {}) {
  return `
const out = { structured_output: ${JSON.stringify({ pass, reason, evidence, confidence })} };
console.log(JSON.stringify(out));
process.exit(0);
`;
}
