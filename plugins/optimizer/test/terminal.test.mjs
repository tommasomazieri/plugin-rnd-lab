// The platform matrix, tested from whichever platform happens to be running.
//
// This is the point of splitting terminal.mjs out. The launcher's Windows-only past was
// not a design decision anyone made — it was that nothing here could be checked without a
// Mac or a Linux box to check it on, so the two branches that mattered were never written.
// The script builders take an explicit platform, so all three dialects can be asserted
// anywhere, and the quoting rules — the part that actually breaks runs, since every path
// in an experiment root has spaces in it — get exercised on every commit.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  psQuote,
  shQuote,
  osaQuote,
  findOnPath,
  launchScriptExt,
  buildLaunchScript,
} from '../skills/fire/scripts/terminal.mjs';

const IS_WINDOWS = process.platform === 'win32';

/* ----------------------------------------------------------------------- quoting */

test('sh quoting survives the characters that actually appear in an experiment path', () => {
  assert.equal(shQuote('/home/me/claude experiments/run-001'), `'/home/me/claude experiments/run-001'`);
  // A single quote has to leave the literal and come back — the one case naive quoting
  // gets wrong, and the one that turns a prompt into two arguments.
  assert.equal(shQuote(`it's`), `'it'\\''s'`);
  // Everything else is inert inside single quotes and must pass through untouched.
  for (const hostile of ['$HOME', '`whoami`', 'a;b', 'a&&b', 'a|b', 'a\nb', '$(rm -rf /)', 'a\\b']) {
    assert.equal(shQuote(hostile), `'${hostile}'`, `sh-quoting must not alter ${JSON.stringify(hostile)}`);
  }
});

test('PowerShell quoting doubles the single quote and leaves the rest inert', () => {
  assert.equal(psQuote(String.raw`C:\Users\me\claude experiments`), String.raw`'C:\Users\me\claude experiments'`);
  assert.equal(psQuote(`it's`), `'it''s'`);
  for (const hostile of ['$env:PATH', '$(rm)', 'a;b', 'a`b', 'a|b']) {
    assert.equal(psQuote(hostile), `'${hostile}'`, `ps-quoting must not alter ${JSON.stringify(hostile)}`);
  }
});

test('PowerShell quoting doubles the typographic single quotes too', () => {
  // PowerShell closes a single-quoted literal on ‘ ’ ‚ ‛ as readily as on '. Doubling only
  // the ASCII one let an experiment called "Tom’s run" end the literal and run the rest.
  assert.equal(psQuote('Tom’s run'), "'Tom’’s run'");
  assert.equal(psQuote('‘‚‛'), "'‘‘‚‚‛‛'");
});

// The string comparisons above only check what psQuote emits. This one asks PowerShell
// itself, which is the only authority on what closes a literal.
test('a PowerShell literal round-trips every quote character through a real parser', { skip: !IS_WINDOWS && 'needs powershell.exe' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'psquote-'));
  try {
    for (const value of ["Tom’s run’; Write-Output INJECTED; ’", "a'b‘c’d‚e‛f", "''’’"]) {
      const file = path.join(dir, 'q.ps1');
      fs.writeFileSync(file, '﻿' + [
        '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
        `$t = ${psQuote(value)}`,
        '[Console]::Out.Write($t)',
        '',
      ].join('\r\n'));
      const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], { encoding: 'utf8' });
      assert.equal(r.stdout, value, `PowerShell read ${JSON.stringify(value)} back as ${JSON.stringify(r.stdout)} ${r.stderr}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('AppleScript quoting escapes backslash before quote, not after', () => {
  assert.equal(osaQuote('/Users/me/exp'), '"/Users/me/exp"');
  assert.equal(osaQuote('a"b'), '"a\\"b"');
  // Order matters: escaping the quote first would then double-escape its own backslash.
  assert.equal(osaQuote('a\\b'), '"a\\\\b"');
  assert.equal(osaQuote('a\\"b'), '"a\\\\\\"b"');
});

/* -------------------------------------------------------------------- PATH probing */

test('findOnPath resolves a real executable and refuses an invented one', () => {
  // node is on PATH by definition — this suite is running under it.
  assert.ok(findOnPath(IS_WINDOWS ? 'node.exe' : 'node'), 'node should be on PATH');
  assert.equal(findOnPath('definitely-not-a-real-binary-xyz'), null);
  // An empty PATH must produce null rather than throw: it is what a stripped CI job or a
  // launchd/systemd unit actually hands a process, and the terminal probe runs there.
  assert.equal(findOnPath('node', { PATH: '' }), null);
});

test('findOnPath applies PATHEXT only on Windows', () => {
  // The bare stem must resolve on Windows (where `node` means `node.exe`) and must not
  // silently pick up an extension elsewhere.
  const hit = findOnPath('node');
  if (IS_WINDOWS) assert.match(String(hit), /node\.exe$/i);
  else assert.ok(hit === null || !/\.(exe|cmd|bat)$/i.test(hit));
});

/* -------------------------------------------------------------- both script dialects */

const SAMPLE = {
  title: 'AB demo control run-001',
  armEnv: { LIB_ROOT: '/opt/some lib' },
  claudeArgs: ['--model', 'sonnet', '--settings', '/exp/a file.json', 'Read TASK.md, then do it exactly.'],
};

test('every dialect keeps the four things a measurable arm depends on', () => {
  // Whatever the shell, an arm that loses any of these is unusable: a wrong cwd reads the
  // wrong TASK.md, a lost NO_COLOR scrub makes two windows unreadable side by side, and a
  // lost session-persistence override silently drops the transcript the run is judged on.
  for (const platform of ['win32', 'darwin', 'linux']) {
    const s = buildLaunchScript({ ...SAMPLE, workspace: '/exp/a workspace', platform });
    assert.match(s, /a workspace/, `${platform}: cds to the workspace`);
    assert.match(s, /CLAUDE_CODE_FORCE_SESSION_PERSISTENCE/, `${platform}: forces session persistence`);
    assert.match(s, /NO_COLOR/, `${platform}: scrubs NO_COLOR`);
    assert.match(s, /FORCE_COLOR/, `${platform}: forces colour back on`);
    assert.match(s, /LIB_ROOT/, `${platform}: exports the arm's env`);
    assert.match(s, /AB demo control run-001/, `${platform}: titles the window`);
  }
});

test('the two dialects do not leak into each other', () => {
  const ps = buildLaunchScript({ ...SAMPLE, workspace: 'C:\\exp\\ws', platform: 'win32' });
  assert.equal(launchScriptExt('win32'), '.ps1');
  assert.match(ps, /^\$claudeArgs = @\(.+\)$/m);
  assert.match(ps, /^& claude @claudeArgs$/m);
  assert.match(ps, /^Set-Location -LiteralPath '.+'$/m);
  assert.ok(!/^#!/.test(ps), 'a .ps1 must not carry a shebang');
  assert.ok(!/\bexport \w+=/.test(ps), 'no sh export syntax in PowerShell');

  for (const platform of ['darwin', 'linux']) {
    const sh = buildLaunchScript({ ...SAMPLE, workspace: '/exp/ws', platform });
    assert.equal(launchScriptExt(platform), '.sh');
    assert.match(sh, /^#!\/bin\/sh$/m);
    assert.match(sh, /^set -- .+$/m);
    assert.match(sh, /^claude "\$@"$/m);
    assert.ok(!/\$env:/.test(sh), 'no PowerShell env syntax in sh');
    assert.ok(!/Set-Location|Remove-Item|chcp/.test(sh), 'no PowerShell cmdlets in sh');
  }
});

/* --------------------------------------------------------------- executing the sh arm */

/**
 * String assertions catch a missing line; they do not catch a script that is subtly
 * unrunnable. `sh` exists on every supported platform AND on this repo's Windows dev box
 * (Git for Windows ships one), so the POSIX arm launcher — the dialect that could not be
 * exercised at all while the harness was Windows-only — runs for real on every commit,
 * against a stub claude that records exactly what argv it was handed.
 */
const SH = findOnPath(IS_WINDOWS ? 'sh.exe' : 'sh');

/** The path as `sh` on THIS machine spells it: identity off Windows, cygpath under Git Bash. */
function posixPath(p) {
  if (!IS_WINDOWS) return p;
  const cygpath = findOnPath('cygpath.exe');
  if (!cygpath) return null;
  const r = spawnSync(cygpath, ['-u', p], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

test('the POSIX launcher runs: it cds, exports, scrubs colour, and hands claude its argv intact', () => {
  if (!SH) return; // no sh here; the string assertions above still hold
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'optimizer-sh-'));
  try {
    // Spaces in the workspace path are the norm in an experiments root, not the edge case.
    const workspace = path.join(dir, 'a workspace');
    const binDir = path.join(dir, 'bin');
    fs.mkdirSync(workspace);
    fs.mkdirSync(binDir);

    const wsPosix = posixPath(workspace);
    const outPosix = posixPath(path.join(dir, 'out'));
    if (!wsPosix || !outPosix) return; // no cygpath under this Git Bash

    // A stub `claude` ahead of any real one on PATH, recording argv one entry per line
    // plus the three pieces of environment the launcher is responsible for.
    const stub = [
      '#!/bin/sh',
      `for a in "$@"; do printf '%s\\n' "$a"; done > '${outPosix}.argv'`,
      `printf '%s' "$PWD" > '${outPosix}.pwd'`,
      `printf '%s' "$LIB_ROOT" > '${outPosix}.lib'`,
      `printf '%s' "\${NO_COLOR-unset}" > '${outPosix}.nocolor'`,
      'exit 0',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(binDir, 'claude'), stub, { mode: 0o755 });

    // The exact argv shapes that broke the old hand-quoted command line: a path with a
    // space in it, and a prompt carrying a period and a comma.
    const claudeArgs = ['--model', 'sonnet', '--settings', `${wsPosix}/a file.json`, 'Read TASK.md, then do it exactly.'];
    const scriptFile = path.join(dir, 'arm.sh');
    fs.writeFileSync(
      scriptFile,
      buildLaunchScript({ platform: 'linux', workspace: wsPosix, armEnv: { LIB_ROOT: '/opt/some lib' }, title: 'AB demo control run-001', claudeArgs }),
    );

    const r = spawnSync(SH, [posixPath(scriptFile) || scriptFile], {
      encoding: 'utf8',
      // NO_COLOR set exactly as a Claude Code session sets it for its tool subprocesses —
      // this is the leak the launcher exists to scrub.
      env: { ...process.env, PATH: `${posixPath(binDir)}:${process.env.PATH}`, NO_COLOR: '1' },
    });
    assert.equal(r.status, 0, `launcher exited ${r.status}: ${r.stderr}`);

    const read = (suffix) => fs.readFileSync(path.join(dir, `out.${suffix}`), 'utf8');
    // argv survived element for element — the entire reason for `set --` plus "$@".
    assert.deepEqual(read('argv').split('\n').slice(0, -1), claudeArgs);
    assert.equal(read('pwd'), wsPosix, 'ran in the arm workspace');
    assert.equal(read('lib'), '/opt/some lib', "the arm's env var kept its space");
    assert.equal(read('nocolor'), 'unset', 'NO_COLOR must not reach the arm');
    // The window is kept open only when there is one; piped like this it must exit.
    assert.match(r.stdout, /arm exited \(status 0\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
