#!/usr/bin/env node
// Stop hook (matcher "*"). The core DoD checker.
//
// Three tiers, gated in order — a later tier only runs if every earlier tier
// currently passes, so a failing script check never triggers a paid prompt-check
// subprocess or interrupts the user with a HITL question for nothing:
//   1. script  — always run, every turn (a passing check last turn can regress
//                this turn), local subprocess, exit code is the verdict.
//   2. prompt  — spawns a headless `claude -p` subprocess under
//                --permission-mode plan (generic read-only guarantee, works for
//                project-specific MCP tools too, not just builtins).
//   3. human   — needs a live user; the hook can't ask directly, so it blocks
//                with explicit instructions for Claude to run AskUserQuestion
//                and persist the answer itself.
//
// No custom stall/cooldown counter: Claude Code's native cap (stops issuing
// further Stop blocks after 8 consecutive ones) is the safety net.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  isRecursionGuardActive,
  readStdinJSON,
  readSession,
  writeSession,
  sessionFilePath,
  checksDir,
  loadRunners,
  truncate,
  runFailOpen,
  printJSON,
} from './lib.mjs';

const SCRIPT_TIMEOUT_MS = 30_000;
const PROMPT_TIMEOUT_MS = 120_000;

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['pass', 'reason'],
};

function systemPromptFile() {
  if (process.env.CLAUDE_PLUGIN_ROOT) {
    return path.join(process.env.CLAUDE_PLUGIN_ROOT, 'resources', 'prompt-checker-system.md');
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, '..', 'resources', 'prompt-checker-system.md');
}

function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw.trim() };
  const [, fmBlock, body] = m;
  const meta = {};
  for (const line of fmBlock.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    val = val.replace(/^["']|["']$/g, '');
    meta[key] = val;
  }
  return { meta, body: body.trim() };
}

async function findCheckFile(cwd, id) {
  const dir = checksDir(cwd);
  const entries = await fs.readdir(dir).catch(() => []);
  const match = entries.find((f) => path.parse(f).name === id);
  if (!match) return null;
  return { file: match, ext: path.extname(match), full: path.join(dir, match) };
}

async function loadCheckDefs(cwd, ids) {
  const defs = {};
  for (const id of ids) {
    const found = await findCheckFile(cwd, id);
    if (!found) {
      defs[id] = { type: 'missing' };
      continue;
    }
    if (found.ext === '.md') {
      const raw = await fs.readFile(found.full, 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      defs[id] = { type: meta.type === 'human' ? 'human' : 'prompt', meta, body, full: found.full };
    } else {
      defs[id] = { type: 'script', ext: found.ext, full: found.full };
    }
  }
  return defs;
}

function runProcess(cmd, args, opts, timeoutMs) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { ...opts, shell: false });
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: err.message });
      return;
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already exited */ }
    }, timeoutMs);
    child.stdout?.on('data', (d) => { stdout += d; });
    child.stderr?.on('data', (d) => { stderr += d; });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}\n${err.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function runScriptCheck(cwd, runners, id, def) {
  if (def.type === 'missing') {
    return { id, tier: 'script', result: 'fail', output: 'Check file not found in .dod/checks/ (referenced in session checks[] but missing on disk).' };
  }
  const runnerCmd = runners[def.ext];
  if (!runnerCmd) {
    return { id, tier: 'script', result: 'fail', output: `No runner configured for extension "${def.ext}". Add one to .dod/config.json under "runners".` };
  }
  const [cmd, ...baseArgs] = runnerCmd.split(' ');
  const { code, stdout, stderr } = await runProcess(cmd, [...baseArgs, def.full], { cwd }, SCRIPT_TIMEOUT_MS);
  const output = [stdout, stderr].filter(Boolean).join('\n').trim() || `(exit code ${code}, no output)`;
  return { id, tier: 'script', result: code === 0 ? 'pass' : 'fail', output };
}

async function runPromptCheck(cwd, id, def) {
  const model = def.meta.model || 'haiku';
  const promptText = [
    `DoD check "${id}"${def.meta.description ? ` — ${def.meta.description}` : ''}`,
    '',
    'Grading question:',
    def.body,
    '',
    `Investigate the repository at ${cwd} as needed (read-only tool access under plan mode) to determine whether this check currently passes. Verify — don't assume. Return your verdict via the required structured output.`,
  ].join('\n');

  const args = [
    '-p', promptText,
    '--permission-mode', 'plan',
    '--model', model,
    '--output-format', 'json',
    '--json-schema', JSON.stringify(VERDICT_SCHEMA),
    '--append-system-prompt-file', systemPromptFile(),
  ];
  const env = { ...process.env, DOD_LITE_CHECKER: '1' };
  const { code, stdout, stderr } = await runProcess('claude', args, { cwd, env }, PROMPT_TIMEOUT_MS);

  if (code !== 0) {
    return { id, tier: 'prompt', result: 'fail', output: `checker subprocess exited ${code}: ${truncate((stderr || stdout).trim(), 500)}` };
  }
  try {
    const parsed = JSON.parse(stdout);
    const verdict = parsed.structured_output;
    if (!verdict || typeof verdict.pass !== 'boolean') {
      return { id, tier: 'prompt', result: 'fail', output: 'checker returned no structured verdict (inconclusive counts as fail).' };
    }
    return { id, tier: 'prompt', result: verdict.pass ? 'pass' : 'fail', output: verdict.reason || '' };
  } catch (err) {
    return { id, tier: 'prompt', result: 'fail', output: `could not parse checker output: ${err.message}` };
  }
}

function buildFailureReason(label, failures) {
  const items = failures.map((f) => `- "${f.id}": ${truncate(f.output, 800)}`).join('\n');
  return `dod-lite: ${failures.length} ${label} DoD check(s) failing:\n${items}\n\nAddress these before stopping.`;
}

function buildHumanPendingReason(pendingIds, defs, sessFile) {
  const items = pendingIds.map((id) => `- "${id}": ${defs[id]?.body || '(no question text found)'}`).join('\n');
  return `dod-lite: ${pendingIds.length} human-judgement DoD check(s) need your input before this turn can end:\n${items}\n\n` +
    'For EACH item above, ask the user via AskUserQuestion with exactly these three options: ' +
    '"Done", "Not done" (collect a free-text note on what is missing), "Stop anyway, finish later". ' +
    `Then Edit ${sessFile} and set state["<id>"].last_result to "pass" (Done), "fail" (Not done — put their note in last_output), ` +
    'or "waived" (Stop anyway), plus last_checked_at to the current ISO timestamp. ' +
    'Do not mark a check pass without actually asking the user and recording their real answer.';
}

async function main() {
  if (isRecursionGuardActive()) return;

  const input = await readStdinJSON();
  const { session_id: sessionId, cwd } = input;
  if (!sessionId || !cwd) return;

  const session = await readSession(cwd, sessionId);
  if (!session || !Array.isArray(session.checks) || session.checks.length === 0) return;

  const defs = await loadCheckDefs(cwd, session.checks);
  const scriptIds = session.checks.filter((id) => defs[id].type === 'script' || defs[id].type === 'missing');
  const promptIds = session.checks.filter((id) => defs[id].type === 'prompt');
  const humanIds = session.checks.filter((id) => defs[id].type === 'human');

  const runners = await loadRunners(cwd);
  const results = [];
  let blockReason = null;

  for (const id of scriptIds) {
    results.push(await runScriptCheck(cwd, runners, id, defs[id]));
  }
  const scriptFailures = results.filter((r) => r.result === 'fail');

  if (scriptFailures.length > 0) {
    blockReason = buildFailureReason('script', scriptFailures);
  } else {
    for (const id of promptIds) {
      results.push(await runPromptCheck(cwd, id, defs[id]));
    }
    const promptFailures = results.filter((r) => r.tier === 'prompt' && r.result === 'fail');

    if (promptFailures.length > 0) {
      blockReason = buildFailureReason('AI-graded', promptFailures);
    } else {
      const pendingHuman = humanIds.filter((id) => {
        const prior = session.state[id]?.last_result;
        return prior !== 'pass' && prior !== 'waived';
      });
      if (pendingHuman.length > 0) {
        blockReason = buildHumanPendingReason(pendingHuman, defs, sessionFilePath(cwd, sessionId));
      }
    }
  }

  const now = new Date().toISOString();
  for (const r of results) {
    session.state[r.id] = { tier: r.tier, last_result: r.result, last_output: truncate(r.output), last_checked_at: now };
  }
  session.history.push({ at: now, results: results.map((r) => ({ check: r.id, result: r.result })) });
  await writeSession(cwd, sessionId, session);

  if (blockReason) {
    printJSON({ decision: 'block', reason: blockReason });
  } else {
    printJSON({ systemMessage: 'dod-lite: all Definition-of-Done checks passed.' });
  }
}

runFailOpen(main);
