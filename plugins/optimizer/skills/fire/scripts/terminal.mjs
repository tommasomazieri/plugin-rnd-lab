/**
 * terminal.mjs — every platform-specific part of firing an arm, in one place.
 *
 * An A/B run needs two things from the host OS that nothing else in optimizer needs:
 * a *shell script* the arm runs, and a *visible titled terminal window* to run it in.
 * Both differ per platform; nothing else in the harness does. Keeping them here means
 * launch-pair.mjs reads as one flow instead of a fork, and the platform matrix can be
 * unit-tested without spawning a single window.
 *
 * The window is not a nicety. The operator watches two arms side by side for the length
 * of a run, and tells them apart by title. A run they cannot watch is a run they cannot
 * judge, which is why an unresolvable terminal degrades to printed instructions rather
 * than to a silent background process.
 *
 * Three script dialects, one contract — cd to the workspace, export the arm's env,
 * force colour on, set the window title, exec claude with argv preserved exactly:
 *   win32          PowerShell (.ps1), args via array + splat
 *   darwin/linux   POSIX sh (.sh), args via `set --` + "$@"
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

export const IS_WINDOWS = process.platform === 'win32';
export const IS_MAC = process.platform === 'darwin';

/**
 * Locate an executable by walking PATH ourselves.
 *
 * Deliberately not `where`/`which` under `shell: true`: that spawns a shell per probe,
 * is spelled differently per platform, and puts operator-supplied strings on a command
 * line for no gain. A PATH scan is the same answer with no shell in the picture.
 */
export function findOnPath(name, env = process.env) {
  const dirs = (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  // On Windows an "executable" is a stem plus one of PATHEXT's suffixes; elsewhere the
  // name is the whole filename and the executable bit is what carries the meaning.
  // PATHEXT is conventionally uppercase and real filenames are not, so the "does this
  // name already carry an extension" test has to be case-insensitive — otherwise
  // findOnPath('node.exe') goes looking for node.exe.EXE.
  const exts = IS_WINDOWS ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [];
  const lower = name.toLowerCase();
  const names = !IS_WINDOWS
    ? [name]
    : exts.some((e) => lower.endsWith(e.toLowerCase()))
      ? [name]
      : [...exts.map((e) => name + e), name];

  for (const dir of dirs) {
    for (const candidateName of names) {
      const candidate = path.join(dir, candidateName);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch { /* not here, keep looking */ }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ quoting */

/** A PowerShell single-quoted literal: nothing expands, only `'` needs doubling. */
export function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** A POSIX sh single-quoted literal: nothing expands, and `'` must leave and re-enter. */
export function shQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/** An AppleScript string literal: only backslash and double-quote are special. */
export function osaQuote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * The extension the generated arm launcher must carry.
 *
 * `platform` defaults to the host and is only ever passed explicitly by the tests, which
 * is the whole reason it is a parameter: the dialect this repo's author cannot run is the
 * one most likely to be wrong, so both must be assertable from either.
 */
export function launchScriptExt(platform = process.platform) {
  return platform === 'win32' ? '.ps1' : '.sh';
}

/* ------------------------------------------------------- launcher script body */

/**
 * The arm launcher, as text.
 *
 * `claudeArgs` arrives as an argv array and must stay one. Paths here contain spaces and
 * the opening prompt contains a period and a comma; hand-quoting that into a single
 * command line is how a launcher ends up passing half a prompt. PowerShell splatting and
 * sh's `set -- ... ; "$@"` are the same guarantee in two dialects: each element reaches
 * claude as exactly one argv entry, whatever is inside it.
 *
 * The env scrubbing is not cosmetic. This launcher usually runs via the Bash tool inside
 * a Claude Code session, so the parent session's variables leak down the whole spawn
 * chain into the arm's own `claude`:
 *   - CLAUDECODE / CLAUDE_CODE_CHILD_SESSION make the arm think it is nested, and it
 *     silently drops transcript persistence — the run's primary evidence.
 *     CLAUDE_CODE_FORCE_SESSION_PERSISTENCE is the documented override for exactly this
 *     background-launcher case (code.claude.com/docs/en/env-vars).
 *   - NO_COLOR is set in the environment of tool subprocesses, so the arm's TUI comes up
 *     monochrome. Verified process-scoped, not machine configuration.
 * Scrubbed in the script rather than in the spawn env on purpose: the arm window must
 * look the same whether it was fired from a session, a bare shell, or CI.
 */
export function buildLaunchScript({ workspace, armEnv = {}, claudeArgs, title, platform = process.platform }) {
  return platform === 'win32'
    ? buildPowerShellScript({ workspace, armEnv, claudeArgs, title })
    : buildPosixScript({ workspace, armEnv, claudeArgs, title });
}

function buildPowerShellScript({ workspace, armEnv, claudeArgs, title }) {
  return [
    '$ErrorActionPreference = "Continue"',
    // UTF-8 in and out, or box-drawing and em dashes come out as mojibake in the arm's
    // own TUI and in anything it echoes back.
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$OutputEncoding = [System.Text.Encoding]::UTF8',
    'chcp 65001 > $null',
    `$Host.UI.RawUI.WindowTitle = ${psQuote(title)}`,
    ...Object.entries(armEnv).map(([k, v]) => `$env:${k} = ${psQuote(v)}`),
    '$env:CLAUDE_CODE_FORCE_SESSION_PERSISTENCE = "1"',
    'Remove-Item Env:NO_COLOR -ErrorAction SilentlyContinue',
    'Remove-Item Env:CLICOLOR -ErrorAction SilentlyContinue',
    '$env:FORCE_COLOR = "1"',
    '$env:CLICOLOR_FORCE = "1"',
    `Set-Location -LiteralPath ${psQuote(workspace)}`,
    `$claudeArgs = @(${claudeArgs.map(psQuote).join(', ')})`,
    '& claude @claudeArgs',
    '',
  ].join('\r\n');
}

function buildPosixScript({ workspace, armEnv, claudeArgs, title }) {
  return [
    '#!/bin/sh',
    '# generated by /optimizer:fire — regenerated every run, edits are lost',
    ...Object.entries(armEnv).map(([k, v]) => `export ${k}=${shQuote(v)}`),
    'export CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1',
    'unset NO_COLOR',
    'unset CLICOLOR',
    'export FORCE_COLOR=1',
    'export CLICOLOR_FORCE=1',
    // OSC 0 is how every terminal emulator worth supporting takes a title — Terminal.app,
    // iTerm2, gnome-terminal, konsole, kitty, alacritty, wezterm, xterm. Setting it from
    // inside the script means no host branch below has to know about titles.
    `printf '\\033]0;%s\\007' ${shQuote(title)}`,
    `cd ${shQuote(workspace)} || exit 1`,
    `set -- ${claudeArgs.map(shQuote).join(' ')}`,
    'claude "$@"',
    'status=$?',
    `printf '\\n[optimizer] arm exited (status %s)\\n' "$status"`,
    // The PowerShell arm gets -NoExit; this is its equivalent. A crashed arm's scrollback
    // is evidence, and a window that closes on exit takes it with it. Guarded on there
    // actually being a terminal: run headless or piped (CI, `sh arm.sh > log`) an
    // interactive shell would just hang with nobody to type into it.
    '[ -t 0 ] && [ -t 1 ] && exec "${SHELL:-/bin/sh}" -i',
    'exit "$status"',
    '',
  ].join('\n');
}

/* --------------------------------------------------------------- terminal host */

/**
 * Which terminal emulator to run both arms in, best first, or null if none is reachable.
 *
 * Resolved once and applied to both arms: an asymmetry here would be a parity break in
 * the most literal sense — two arms in two different terminals.
 *
 * OPTIMIZER_TERMINAL overrides everything. The Linux list below covers what is actually
 * installed on desktops, but "actually installed" has a long tail, and an operator with
 * something exotic should not have to patch the harness to run an experiment.
 */
export function resolveTerminalHost(env = process.env) {
  const override = (env.OPTIMIZER_TERMINAL || '').trim();
  if (override) {
    const bin = path.isAbsolute(override) ? override : findOnPath(override, env);
    if (bin) return { id: 'custom', bin, label: override };
    return null;
  }

  if (IS_WINDOWS) {
    const wt = findOnPath('wt.exe', env);
    // Windows Terminal is the right host: true colour, a real title, a real PowerShell
    // underneath. The legacy conhost fallbacks render Claude Code's TUI without colour,
    // which in a benchmark whose deliverable is visual is a defect, not a preference.
    if (wt) return { id: 'wt', bin: wt, label: 'Windows Terminal' };
    const pwsh = findOnPath('pwsh.exe', env);
    if (pwsh) return { id: 'pwsh', bin: pwsh, label: 'pwsh.exe (no colour)' };
    const ps = findOnPath('powershell.exe', env);
    if (ps) return { id: 'powershell', bin: ps, label: 'powershell.exe (no colour)' };
    return null;
  }

  if (IS_MAC) {
    // iTerm2 first where it exists — it is the deliberate install, so it is the one the
    // operator is set up to read. Terminal.app is on every Mac and needs no probe.
    if (fs.existsSync('/Applications/iTerm.app')) return { id: 'iterm', bin: 'osascript', label: 'iTerm2' };
    return { id: 'terminal-app', bin: 'osascript', label: 'Terminal.app' };
  }

  // Linux and the other unixes. A GUI terminal needs a display server; without one this
  // is a headless or SSH session and every probe below would be a false positive.
  if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return null;

  for (const [id, name, label] of LINUX_TERMINALS) {
    const bin = findOnPath(name, env);
    if (bin) return { id, bin, label };
  }
  return null;
}

// Ordered by how likely the operator already has it, not alphabetically. x-terminal-emulator
// is last of the generics because Debian's alternatives system points it at one of the above
// anyway — it only earns its place when that one is something not on this list.
const LINUX_TERMINALS = [
  ['gnome-terminal', 'gnome-terminal', 'GNOME Terminal'],
  ['konsole', 'konsole', 'Konsole'],
  ['xfce4-terminal', 'xfce4-terminal', 'Xfce Terminal'],
  ['kitty', 'kitty', 'kitty'],
  ['alacritty', 'alacritty', 'Alacritty'],
  ['wezterm', 'wezterm', 'WezTerm'],
  ['tilix', 'tilix', 'Tilix'],
  ['terminator', 'terminator', 'Terminator'],
  ['x-terminal-emulator', 'x-terminal-emulator', 'x-terminal-emulator'],
  ['xterm', 'xterm', 'xterm'],
];

/**
 * Open `scriptFile` in a new window of `host`, detached from this process.
 *
 * Returns the spawned pid, or null when the window was opened by an agent that does not
 * hand one back (osascript asks the terminal app to open a window; the pid of osascript
 * itself is meaningless once it exits). A null pid is recorded as-is rather than faked —
 * it is the honest answer to "which process is this arm", and nothing downstream needs it.
 */
export function spawnTerminal({ title, scriptFile, host }) {
  if (IS_WINDOWS) return spawnWindowsTerminal({ title, scriptFile, host });
  // The generated script is invoked directly, so it needs the executable bit. chmod is a
  // no-op on Windows, hence only doing it here.
  try { fs.chmodSync(scriptFile, 0o755); } catch { /* best effort; the host branches below still pass it to a shell */ }
  if (IS_MAC) return spawnMacTerminal({ title, scriptFile, host });
  return spawnLinuxTerminal({ title, scriptFile, host });
}

function detached(bin, args) {
  const child = spawn(bin, args, { detached: true, stdio: 'ignore' });
  child.unref();
  return child.pid ?? null;
}

function spawnWindowsTerminal({ title, scriptFile, host }) {
  // -NoExit keeps the window up after claude exits, so a crashed arm can still be read.
  // -ExecutionPolicy Bypass because the launch script is generated, not signed.
  const psArgs = ['-NoExit', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-File', scriptFile];

  if (host.id === 'wt') {
    // wt takes the title itself, so there is no `start` wrapper and no lost quoting.
    // Semicolons are wt's own argument separator; none of our paths carry one, but the
    // title is operator-facing text, so strip them there.
    return detached(host.bin, ['--title', title.replace(/;/g, ','), 'powershell.exe', ...psArgs]);
  }
  if (host.id === 'custom') return detached(host.bin, [scriptFile]);

  // No Windows Terminal: a standalone console via `start`, which needs a title argument
  // first or it eats the quoted exe path as the title. This is the one branch that still
  // needs cmd.exe, because `start` is a cmd builtin and not a program — and therefore the
  // one place where a value from env.json lands on a command line rather than in an argv
  // slot. The title is built from env.json's `experiment`, so it is reduced to a plain
  // label first: `"` would close the quoting, and `%` would splice in an environment
  // variable's value. Everything cmd could act on is gone before it gets there.
  const exe = host.id === 'pwsh' ? 'pwsh.exe' : 'powershell.exe';
  const safeTitle = title.replace(/[^A-Za-z0-9 _.:@#-]/g, '-');
  const line = `start "${safeTitle}" ${exe} -NoExit -NoLogo -ExecutionPolicy Bypass -File "${scriptFile}"`;
  const child = spawn('cmd.exe', ['/d', '/s', '/c', line], {
    detached: true,
    stdio: 'ignore',
    windowsVerbatimArguments: true,
  });
  child.unref();
  return child.pid ?? null;
}

function spawnMacTerminal({ title, scriptFile, host }) {
  if (host.id === 'custom') return detached(host.bin, [scriptFile]);

  // The script path reaches the terminal app as a *shell command*, so it is sh-quoted
  // first and AppleScript-quoted second. A Mac experiments root under ~/Documents or an
  // iCloud folder has spaces in it far more often than not.
  const command = shQuote(scriptFile);

  if (host.id === 'iterm') {
    const script = [
      'tell application "iTerm"',
      '  create window with default profile',
      `  tell current session of current window to write text ${osaQuote(command)}`,
      '  activate',
      'end tell',
    ].join('\n');
    // Run this one synchronously: iTerm2's scripting interface has changed across major
    // versions, and a silent AppleScript error would leave the operator with a manifest
    // claiming an arm launched and no window anywhere. Terminal.app is on every Mac, so
    // there is always somewhere to fall back to.
    const r = spawnSync('osascript', ['-e', script], { encoding: 'utf8' });
    if (r.status === 0) return null;
    console.error(`[optimizer] NOTE: iTerm2 refused the launch (${(r.stderr || '').trim() || 'no message'}) — using Terminal.app.`);
  }

  const script = [
    `tell application "Terminal" to do script ${osaQuote(command)}`,
    'tell application "Terminal" to activate',
  ].join('\n');
  const r = spawnSync('osascript', ['-e', script], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`osascript could not open Terminal.app: ${(r.stderr || '').trim() || `exit ${r.status}`}`);
  return null;
}

function spawnLinuxTerminal({ title, scriptFile, host }) {
  // Every emulator spells "run this program, with this title" differently, and several
  // changed their spelling across versions. Titles are set by the script itself via OSC 0
  // (see buildPosixScript), so a wrong title flag here would be the only thing it broke —
  // but passing the right one still gives a correct title before the script's first line.
  const argv = {
    'gnome-terminal': () => ['--title', title, '--', scriptFile],
    konsole: () => ['-p', `tabtitle=${title}`, '-e', scriptFile],
    'xfce4-terminal': () => ['--title', title, `--command=${scriptFile}`],
    kitty: () => ['-T', title, scriptFile],
    alacritty: () => ['-t', title, '-e', scriptFile],
    wezterm: () => ['start', '--', scriptFile],
    tilix: () => ['-t', title, '-e', scriptFile],
    terminator: () => ['-T', title, '-x', scriptFile],
    'x-terminal-emulator': () => ['-T', title, '-e', scriptFile],
    xterm: () => ['-T', title, '-e', scriptFile],
    custom: () => [scriptFile],
  }[host.id];
  if (!argv) throw new Error(`unknown terminal host "${host.id}"`);
  return detached(host.bin, argv());
}

/**
 * What to tell the operator when no terminal could be resolved.
 *
 * This is a degraded mode, not a failure: the workspaces, artifacts, prepare steps and
 * manifest are all real and correct, and the two scripts are runnable by hand. Headless
 * CI and SSH sessions land here by design, and so does anyone on a desktop this list
 * does not cover.
 */
export function manualLaunchInstructions(scriptFiles) {
  const runner = IS_WINDOWS
    ? (f) => `powershell -NoExit -NoLogo -ExecutionPolicy Bypass -File "${f}"`
    : (f) => `sh ${shQuote(f)}`;
  const hint = IS_WINDOWS
    ? 'Install Windows Terminal, or set OPTIMIZER_TERMINAL to a terminal on PATH.'
    : IS_MAC
      ? 'Set OPTIMIZER_TERMINAL to a terminal on PATH.'
      : (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)
        ? 'No DISPLAY/WAYLAND_DISPLAY — this looks like a headless or SSH session. Run each script in its own tmux/screen pane, or set OPTIMIZER_TERMINAL.'
        : `No supported terminal found on PATH (tried ${LINUX_TERMINALS.map(([, n]) => n).join(', ')}). Set OPTIMIZER_TERMINAL to yours.`;
  return [
    'No terminal emulator could be opened — both arms are staged but not started.',
    hint,
    'Start them yourself, each in its own window, at the same time:',
    ...scriptFiles.map((f) => `  ${runner(f)}`),
  ].join('\n');
}
