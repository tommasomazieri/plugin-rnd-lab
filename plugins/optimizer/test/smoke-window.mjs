// Opens a real terminal window through the real launcher and checks what arrived inside it.
//
// terminal.test.mjs proves the POSIX launch *script* is right by running it under `sh`. What no
// unit test can reach is the layer above: `open -a` handing the launcher to Terminal.app or
// iTerm2, and each Linux emulator's argument spelling. Those only prove themselves by opening a window, so this
// is not part of `node --test` — CI runs it on machines that have a display (see
// .github/workflows/ci.yml). It exits non-zero on anything short of a stub `claude`, started in
// the new window, reporting the workspace, argv and env the arm would have had.
//
// The stub reaches the window through the launcher's own exported env, not through inheritance:
// Terminal.app starts a fresh login shell, so nothing from this process's environment survives
// into it. That is also how a real arm gets its variables.
//
// Optional: SMOKE_EXPECT_TERM_PROGRAM (e.g. Apple_Terminal, iTerm.app) asserts which app ran it,
// since the iTerm2 branch falls back to Terminal.app and would otherwise pass for the wrong reason.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildLaunchScript,
  launchScriptExt,
  resolveTerminalHost,
  spawnTerminal,
} from '../skills/fire/scripts/terminal.mjs';

const TIMEOUT_MS = 90_000;

if (process.platform === 'win32') {
  console.error('smoke-window: the Windows launch path is exercised by real use; this covers macOS and Linux.');
  process.exit(2);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'optimizer smoke '));
const workspace = path.join(root, 'arm workspace');
const stubDir = path.join(root, 'bin');
const marker = path.join(root, 'arrived.txt');
fs.mkdirSync(workspace, { recursive: true });
fs.mkdirSync(stubDir, { recursive: true });

// A stand-in for `claude`: writes down what it was given, then exits. Written to a temp name
// and renamed, so a half-written file is never read as the answer.
fs.writeFileSync(path.join(stubDir, 'claude'), [
  '#!/bin/sh',
  '{',
  '  printf "cwd=%s\\n" "$(pwd -P)"',
  '  printf "term=%s\\n" "${TERM_PROGRAM:-}"',
  '  printf "var=%s\\n" "$SMOKE_VAR"',
  '  for a in "$@"; do printf "arg=%s\\n" "$a"; done',
  '} > "$SMOKE_MARKER.tmp" && mv "$SMOKE_MARKER.tmp" "$SMOKE_MARKER"',
  '',
].join('\n'), { mode: 0o755 });

const title = 'optimizer smoke — control run-001';
const claudeArgs = ['--model', 'smoke-model', '--settings', path.join(workspace, 'settings.json'),
  'Read TASK.md in this directory and carry out the assignment exactly as written. Treat TASK.md as your task brief.'];
const armEnv = {
  PATH: `${stubDir}${path.delimiter}${process.env.PATH}`,
  SMOKE_MARKER: marker,
  SMOKE_VAR: "a value with spaces, a 'quote' and a $dollar",
};

const scriptFile = path.join(root, `control${launchScriptExt()}`);
fs.writeFileSync(scriptFile, buildLaunchScript({ workspace, armEnv, claudeArgs, title }));

const host = resolveTerminalHost();
if (!host) {
  console.error('smoke-window: FAIL — no terminal host resolved on this machine.');
  process.exit(1);
}
console.log(`smoke-window: host = ${host.label} (${host.id})`);
spawnTerminal({ title, scriptFile, host });

const deadline = Date.now() + TIMEOUT_MS;
while (!fs.existsSync(marker)) {
  if (Date.now() > deadline) {
    console.error(`smoke-window: FAIL — no window ran the arm within ${TIMEOUT_MS / 1000}s (host ${host.label}).`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 500));
}

const lines = fs.readFileSync(marker, 'utf8').trimEnd().split('\n');
const field = (k) => lines.filter((l) => l.startsWith(`${k}=`)).map((l) => l.slice(k.length + 1));
const failures = [];
const [cwd] = field('cwd');
if (cwd !== fs.realpathSync(workspace)) failures.push(`cwd ${JSON.stringify(cwd)} != workspace ${JSON.stringify(fs.realpathSync(workspace))}`);
if (field('var')[0] !== armEnv.SMOKE_VAR) failures.push(`env ${JSON.stringify(field('var')[0])} != ${JSON.stringify(armEnv.SMOKE_VAR)}`);
if (JSON.stringify(field('arg')) !== JSON.stringify(claudeArgs)) failures.push(`argv ${JSON.stringify(field('arg'))} != ${JSON.stringify(claudeArgs)}`);
const expected = process.env.SMOKE_EXPECT_TERM_PROGRAM;
if (expected && field('term')[0] !== expected) failures.push(`ran in TERM_PROGRAM=${JSON.stringify(field('term')[0])}, expected ${expected}`);

if (failures.length) {
  console.error(`smoke-window: FAIL (host ${host.label})\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`smoke-window: PASS — ${host.label} opened a window, and claude got the workspace, env and all ${claudeArgs.length} args intact.`);
