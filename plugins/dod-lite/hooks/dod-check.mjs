#!/usr/bin/env node
// Stop hook (matcher "*"). The DoD auditor.
//
// THIS HOOK IS AN INSTRUMENT, NOT A CONTROL LOOP. It observes the session it runs
// in and records what it saw. It never speaks to that session — no `decision`, no
// `reason`, no `systemMessage`, nothing on stdout at all. That is the single
// invariant this file exists to uphold, and it is load-bearing for the experiment:
//
//   - optimizer injects this into BOTH arms identically. Feedback would pull both
//     arms toward the same output and mask the very difference being measured.
//   - Real vanilla Claude Code has no such feedback. Control-with-nudges is not
//     control, so any result obtained that way does not generalise.
//   - A plugin under test may ship its own Stop-event checks. Those are intrinsic
//     to the treatment and must be the ONLY checks an arm can hear.
//
// Its predecessor blocked on failure and shipped failing-check output back into the
// arm, which is correct for a DoD engine driving a job to completion and wrong for
// one measuring whether the agent got there unaided.
//
// Two tiers, both run every turn, ungated:
//   1. script — local subprocess, exit code is the verdict. Costs nothing, so it
//               always runs.
//   2. prompt — headless `claude -p` subprocesses under --permission-mode plan
//               (generic read-only guarantee, covers project MCP tools too, not
//               just builtins). Run in parallel: sequential runs blew the budget.
//
// There is no gate between them and no human tier. The old `prompt_tier_gate`
// skipped the prompt tier whenever a script check was red — which mid-run is the
// normal state — so the graded tier silently never ran. Both tiers now run every
// turn unconditionally; prompt-tier COST is a planning concern, handled by
// /optimizer:plan being sparing about how many prompt checks a run declares, since
// each one now bills once per turn per arm.
//
// The human tier is gone entirely. The human is the gate: a session ends when it
// ends, and the user either reports the job undone at /optimizer:analyze or feeds
// back and grants another turn. The old tier blocked with instructions telling the
// arm to call AskUserQuestion — which manufactured the very autonomy signal the
// harness measures.
//
// PER-TURN AUDIT, APPEND-NEVER-OVERWRITE. Every stop appends a complete record of
// that turn to `history`, with full output and evidence, not just a verdict. Earlier
// turns are never rewritten. That series is what makes improvement vs regression
// across turns visible, and what lets /optimizer:analyze separate a plugin problem
// from bad user prompts in between turns.
//
// Two invariants exist because run-002 lost an entire prompt tier to a hook kill:
//   - RESULTS ARE PERSISTED AS THEY LAND, not in one write at the end. A hook
//     killed at its timeout must still leave behind everything it did finish.
//   - THE HOOK SELF-TERMINATES ON ITS OWN BUDGET (HOOK_BUDGET_MS) before Claude
//     Code's timeout can kill it, so the final write always happens.
//
// Infrastructure failures (spawn error, subprocess timeout, unparseable verdict,
// exhausted budget) record `error`, NOT `fail`. A checker bug must stay
// distinguishable from a genuine failure when /optimizer:analyze reads the series.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Note the absence of printJSON: this hook has nothing to say. Importing it back
// is the first step of reintroducing the contamination this file was rebuilt to remove.
import {
  isRecursionGuardActive,
  readStdinJSON,
  readSession,
  writeSession,
  checksDir,
  loadConfig,
  loadRunners,
  truncate,
  runFailOpen,
} from './lib.mjs';

const SCRIPT_TIMEOUT_MS = 30_000;
const PROMPT_TIMEOUT_MS = 180_000;

// How many prompt checkers run at once. Wall time for the tier is now roughly
// one checker, not the sum of all of them.
const PROMPT_CONCURRENCY = 4;

// Self-imposed wall-clock ceiling for the whole hook. Must stay under the
// `timeout` in hooks.json (600s) AND under any lower value Claude Code might
// clamp that to, because everything after the deadline is a lost result.
const HOOK_BUDGET_MS = 270_000;

// The default was 'haiku', which is NOT a recognised CLI alias (the CLI documents
// 'fable', 'opus', 'sonnet'). It does not error — it silently resolves to Sonnet,
// measured at $0.24/check vs $0.058 for real Haiku. A check's own `model:`
// frontmatter still wins; only the fallback is pinned to a full model id.
export const CHECKER_MODEL = 'claude-haiku-4-5-20251001';

// The CLI's documented short aliases. Anything else that isn't a full model id is
// REJECTED rather than passed through, because `--model` accepts unknown values
// silently and falls back to a default — which is how every check authored against the
// old docs ("model: haiku") ended up billing as Sonnet with nothing in any log to say
// so. Checked against a shape, not a version list, so this does not go stale.
const CLI_MODEL_ALIASES = new Set(['fable', 'opus', 'sonnet']);

// The grader binary, overridable via DOD_LITE_CLAUDE_CMD (a JSON array: executable
// first, then any fixed leading args). Exists so the prompt tier can be exercised
// against a stub — `spawn` runs with shell:false, which on Windows resolves only real
// executables, so there is otherwise no way to substitute one — and so an operator can
// pin a specific claude binary instead of whatever PATH happens to resolve.
export function resolveCheckerCommand() {
  const raw = process.env.DOD_LITE_CLAUDE_CMD;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return { cmd: String(parsed[0]), prefixArgs: parsed.slice(1).map(String) };
      }
    } catch (err) {
      console.error(`dod-lite: ignoring malformed DOD_LITE_CLAUDE_CMD: ${err.message}`);
    }
  }
  return { cmd: 'claude', prefixArgs: [] };
}

export function validateCheckerModel(model) {
  if (!model) return { ok: true };
  if (CLI_MODEL_ALIASES.has(model)) return { ok: true };
  if (/^claude-[a-z0-9][a-z0-9._-]*$/i.test(model)) return { ok: true };
  return {
    ok: false,
    reason:
      `"${model}" is neither a documented CLI alias (${[...CLI_MODEL_ALIASES].join(', ')}) ` +
      'nor a full model id (claude-...). `--model` accepts unknown values silently and ' +
      'resolves them to a default, so this check would be graded — and billed — by a model ' +
      'nobody chose. Use a full model id.',
  };
}

// v2. `evidence` and `confidence` are REQUIRED: a grader that returns a pass while
// citing nothing did not look, and analyze needs to be able to say so. The citations
// are also what makes a verdict auditable after the run, when the workspace is gone
// and the reason string is all that survives.
export const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    reason: { type: 'string' },
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          line: { type: 'number' },
          quote: { type: 'string' },
        },
        required: ['path', 'quote'],
      },
    },
    confidence: { type: 'string', enum: ['high', 'low'] },
  },
  required: ['pass', 'reason', 'evidence', 'confidence'],
};

function systemPromptFile() {
  if (process.env.CLAUDE_PLUGIN_ROOT) {
    return path.join(process.env.CLAUDE_PLUGIN_ROOT, 'resources', 'prompt-checker-system.md');
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, '..', 'resources', 'prompt-checker-system.md');
}

// Inlined, not passed as a path: `--append-system-prompt-file` is not a real CLI
// flag. The CLI accepts unknown options silently, so the grader system prompt was
// being dropped on the floor with no error — checkers ran with stock instructions.
export async function loadSystemPrompt() {
  const file = systemPromptFile();
  try {
    return (await fs.readFile(file, 'utf8')).trim();
  } catch (err) {
    console.error(`dod-lite: could not read checker system prompt ${file}: ${err.message}`);
    return null;
  }
}

// Frontmatter is parsed line-by-line, so a list value arrives as a raw string. Accepts
// a JSON array or a comma-separated list; anything empty yields no entries.
export function parseList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch { /* fall through to comma-splitting */ }
  }
  return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
}

export function parseFrontmatter(raw) {
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

// A check id is the filename without extension, so `foo.py` and `foo.md` are the same
// id declared twice as different tiers. That used to resolve to whichever one readdir
// happened to return first — a silent coin-flip between a script and an AI grader.
// Ambiguity is now surfaced, never guessed.
export async function findCheckFile(cwd, id) {
  const dir = checksDir(cwd);
  const entries = await fs.readdir(dir).catch(() => []);
  const matches = entries
    .filter((f) => !f.endsWith('.meta.json'))
    .filter((f) => path.parse(f).name === id);
  if (matches.length === 0) return null;
  if (matches.length > 1) return { ambiguous: matches.slice().sort() };
  const match = matches[0];
  return { file: match, ext: path.extname(match), full: path.join(dir, match) };
}

// Script checks carry their declared metadata in a `<id>.meta.json` sidecar, since an
// executable has nowhere to put frontmatter. Prompt/human checks use frontmatter. Both
// end up on `def.meta`, so every consumer reads one shape.
async function loadScriptMeta(cwd, id) {
  const p = path.join(checksDir(cwd), `${id}.meta.json`);
  try {
    const parsed = JSON.parse(await fs.readFile(p, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function loadCheckDefs(cwd, ids) {
  const defs = {};
  for (const id of ids) {
    const found = await findCheckFile(cwd, id);
    if (!found) {
      defs[id] = { type: 'missing', meta: {} };
      continue;
    }
    if (found.ambiguous) {
      defs[id] = { type: 'ambiguous', files: found.ambiguous, meta: {} };
      continue;
    }
    if (found.ext === '.md') {
      const raw = await fs.readFile(found.full, 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      defs[id] = { type: meta.type === 'human' ? 'human' : 'prompt', meta, body, full: found.full };
    } else {
      defs[id] = { type: 'script', ext: found.ext, full: found.full, meta: await loadScriptMeta(cwd, id) };
    }
  }
  return defs;
}

// What this check is declared to report against a PRISTINE seed workspace. Default
// `fail`: a check normally asserts work that has not happened yet. `pass` means it is a
// regression guard — legitimate, but it can only contribute to an A/B by flipping, so
// /optimizer:plan makes the author justify it. The gate compares this against reality.
export function seedExpectation(def) {
  const raw = String(def?.meta?.seed_expectation ?? 'fail').trim().toLowerCase();
  return raw === 'pass' ? 'pass' : 'fail';
}

// child.kill() on Windows terminates only `claude` itself; the bash/python/node
// processes it spawned survive, keep the inherited pipes open, and outlive the
// hook. taskkill /T walks the tree.
function killTree(child) {
  if (typeof child.pid === 'number' && process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
      return;
    } catch { /* fall through to kill() */ }
  }
  try { child.kill(); } catch { /* already exited */ }
}

export function runProcess(cmd, args, opts, timeoutMs) {
  return new Promise((resolve) => {
    let child;
    try {
      // stdin explicitly ignored: left as the default inherited pipe, an
      // unfed/unclosed fd can make a child-of-this-child (e.g. a bare
      // interactive `python` a graded model runs via its own Bash tool)
      // block on stdin until this process's timeoutMs kill, instead of
      // hitting EOF immediately like a real closed stdin would.
      child = spawn(cmd, args, { ...opts, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: err.message, timedOut: false, spawnFailed: true });
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    child.stdout?.on('data', (d) => { stdout += d; });
    child.stderr?.on('data', (d) => { stderr += d; });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}\n${err.message}`, timedOut, spawnFailed: true });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut, spawnFailed: false });
    });
  });
}

export async function runScriptCheck(cwd, runners, id, def, timeoutMs = SCRIPT_TIMEOUT_MS) {
  if (def.type === 'missing') {
    return { id, tier: 'script', result: 'fail', output: 'Check file not found in .dod/checks/ (referenced in session checks[] but missing on disk).' };
  }
  if (def.type === 'ambiguous') {
    return {
      id,
      tier: 'script',
      result: 'error',
      output:
        `check id "${id}" matches more than one file in .dod/checks/: ${def.files.join(', ')}. ` +
        'A check id is the filename without its extension, so these are the same check declared ' +
        'twice at different tiers. Delete or rename all but one — this is not graded until you do.',
    };
  }
  const runnerCmd = runners[def.ext];
  if (!runnerCmd) {
    return { id, tier: 'script', result: 'fail', output: `No runner configured for extension "${def.ext}". Add one to .dod/config.json under "runners".` };
  }
  const [cmd, ...baseArgs] = runnerCmd.split(' ');
  const { code, stdout, stderr, timedOut } = await runProcess(cmd, [...baseArgs, def.full], { cwd }, timeoutMs);
  const output = [stdout, stderr].filter(Boolean).join('\n').trim() || `(exit code ${code}, no output)`;
  if (timedOut) {
    return { id, tier: 'script', result: 'error', output: `check script killed after ${Math.round(timeoutMs / 1000)}s without exiting.\n${truncate(output, 500)}` };
  }
  return { id, tier: 'script', result: code === 0 ? 'pass' : 'fail', output };
}

function formatEvidence(evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) return '';
  return `\n\nEvidence:\n${evidence
    .map((e) => `- ${e.path}${e.line ? `:${e.line}` : ''} — ${truncate(String(e.quote ?? ''), 300)}`)
    .join('\n')}`;
}

async function attemptPromptCheck(cwd, id, def, systemPrompt, timeoutMs) {
  const model = def.meta.model || CHECKER_MODEL;
  const promptText = [
    `DoD check "${id}"${def.meta.description ? ` — ${def.meta.description}` : ''}`,
    '',
    'Grading question:',
    def.body,
    '',
    `Investigate the repository at ${cwd} as needed (read-only tool access under plan mode) to determine whether this check currently passes. Verify — don't assume. Return your verdict via the required structured output, and cite the specific files and lines you actually read in \`evidence\`.`,
  ].join('\n');

  const args = [
    '-p', promptText,
    '--permission-mode', 'plan',
    '--model', model,
    '--output-format', 'json',
    '--json-schema', JSON.stringify(VERDICT_SCHEMA),
  ];
  if (systemPrompt) args.push('--append-system-prompt', systemPrompt);
  // Opt-in specialisation: a check may grade with the plugin-under-test's own QA tooling
  // instead of as a naive reader. Recorded in the parity report, because a grader that
  // has different capabilities on one arm than the other is an experimental variable.
  if (def.meta.agents) args.push('--agents', def.meta.agents);
  for (const dir of parseList(def.meta.plugin_dirs)) args.push('--plugin-dir', dir);

  const env = { ...process.env, DOD_LITE_CHECKER: '1' };
  const { cmd, prefixArgs } = resolveCheckerCommand();
  const { code, stdout, stderr, timedOut, spawnFailed } = await runProcess(cmd, [...prefixArgs, ...args], { cwd, env }, timeoutMs);

  if (timedOut) {
    return { id, tier: 'prompt', result: 'error', output: `checker subprocess killed after ${Math.round(timeoutMs / 1000)}s without returning a verdict.` };
  }
  if (spawnFailed) {
    return { id, tier: 'prompt', result: 'error', output: `could not spawn checker subprocess: ${truncate(stderr.trim(), 500)}` };
  }
  if (code !== 0) {
    return { id, tier: 'prompt', result: 'error', output: `checker subprocess exited ${code}: ${truncate((stderr || stdout).trim(), 500)}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    return { id, tier: 'prompt', result: 'error', output: `could not parse checker output: ${err.message}` };
  }
  const verdict = parsed.structured_output;
  if (!verdict || typeof verdict.pass !== 'boolean') {
    return { id, tier: 'prompt', result: 'error', output: 'checker returned no structured verdict — nothing was graded.' };
  }
  const evidence = Array.isArray(verdict.evidence) ? verdict.evidence : [];
  return {
    id,
    tier: 'prompt',
    result: verdict.pass ? 'pass' : 'fail',
    output: (verdict.reason || '') + formatEvidence(evidence),
    evidence,
    confidence: verdict.confidence === 'low' ? 'low' : 'high',
    // A pass citing nothing is not a pass anyone can check. Recorded here rather than
    // downgraded, so /optimizer:analyze decides what an ungrounded verdict is worth.
    grounded: evidence.length > 0,
    model: def.meta.model || CHECKER_MODEL,
  };
}

export async function runPromptCheck(cwd, id, def, systemPrompt, timeoutMs, budgetMs) {
  if (timeoutMs <= 0) {
    return { id, tier: 'prompt', result: 'error', output: `hook time budget (${Math.round(budgetMs / 1000)}s) exhausted before this check could start — it was not graded.` };
  }
  const modelCheck = validateCheckerModel(def.meta.model);
  if (!modelCheck.ok) {
    return { id, tier: 'prompt', result: 'error', output: `invalid \`model:\` in check "${id}": ${modelCheck.reason}` };
  }

  const first = await attemptPromptCheck(cwd, id, def, systemPrompt, timeoutMs);
  if (first.result !== 'error') return first;

  // One retry. Grader failures are dominated by transient spawn/parse noise, and an
  // `error` never blocks — so without a retry a flaky checker silently contributes
  // nothing to the run and only shows up at analyze time as an ungraded dimension.
  const remaining = Math.min(timeoutMs, budgetMs);
  if (remaining <= 0) return first;
  const second = await attemptPromptCheck(cwd, id, def, systemPrompt, remaining);
  if (second.result !== 'error') return { ...second, retried: true };
  return { ...second, retried: true, output: `${second.output}\n(first attempt also failed: ${truncate(first.output, 300)})` };
}

export async function runWithConcurrency(items, limit, worker) {
  const queue = [...items];
  const lanes = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0) {
      await worker(queue.shift());
    }
  });
  await Promise.all(lanes);
}

// Writes are serialised through one promise chain so parallel checkers finishing
// at the same moment can't interleave two writeSession() calls on one object.
export function makePersister(cwd, sessionId, session) {
  let chain = Promise.resolve();
  const flushOne = () => {
    chain = chain
      .then(() => writeSession(cwd, sessionId, session))
      .catch((err) => { console.error(`dod-lite: session write failed: ${err.message}`); });
    return chain;
  };
  return {
    record(result) {
      session.state[result.id] = {
        tier: result.tier,
        last_result: result.result,
        last_output: truncate(result.output),
        last_checked_at: new Date().toISOString(),
        ...(result.evidence ? { evidence: result.evidence, grounded: result.grounded } : {}),
        ...(result.confidence ? { confidence: result.confidence } : {}),
        ...(result.model ? { grader_model: result.model } : {}),
        ...(result.retried ? { retried: true } : {}),
      };
      return flushOne();
    },
    // The per-turn audit record. Appends a COMPLETE account of this turn — full
    // output, evidence, grader model — never a bare verdict, and never a rewrite of
    // an earlier turn. `state` above is a latest-value convenience only; THIS array
    // is the record, and it is what makes improvement-vs-regression across turns
    // readable, and what lets analyze tell a plugin problem apart from a bad user
    // prompt in between turns.
    finalize(results) {
      session.history.push({
        turn: session.history.length + 1,
        at: new Date().toISOString(),
        // `check` and `result` keep their old names and positions: consumers that
        // only ever read a verdict keep working, everything else is additive.
        results: results.map((r) => ({
          check: r.id,
          result: r.result,
          tier: r.tier,
          output: truncate(r.output),
          ...(r.evidence ? { evidence: r.evidence, grounded: r.grounded } : {}),
          ...(r.confidence ? { confidence: r.confidence } : {}),
          ...(r.model ? { grader_model: r.model } : {}),
          ...(r.retried ? { retried: true } : {}),
        })),
      });
      return flushOne();
    },
  };
}

async function main() {
  if (isRecursionGuardActive()) return;

  const startedAt = Date.now();
  const input = await readStdinJSON();
  const { session_id: sessionId, cwd } = input;
  if (!sessionId || !cwd) return;

  const session = await readSession(cwd, sessionId);
  if (!session || !Array.isArray(session.checks) || session.checks.length === 0) return;

  const config = await loadConfig(cwd);
  const budgetMs = Number.isFinite(config.hook_budget_ms) ? config.hook_budget_ms : HOOK_BUDGET_MS;
  const promptTimeoutMs = Number.isFinite(config.prompt_timeout_ms) ? config.prompt_timeout_ms : PROMPT_TIMEOUT_MS;
  const scriptTimeoutMs = Number.isFinite(config.script_timeout_ms) ? config.script_timeout_ms : SCRIPT_TIMEOUT_MS;
  const deadline = startedAt + budgetMs;

  const defs = await loadCheckDefs(cwd, session.checks);
  const scriptIds = session.checks.filter(
    (id) => defs[id].type === 'script' || defs[id].type === 'missing' || defs[id].type === 'ambiguous',
  );
  const promptIds = session.checks.filter((id) => defs[id].type === 'prompt');
  const humanIds = session.checks.filter((id) => defs[id].type === 'human');

  const runners = await loadRunners(cwd);
  const persister = makePersister(cwd, sessionId, session);
  const results = [];

  // The human tier is gone. A leftover `type: human` check is recorded as an error
  // rather than silently dropped, so a run authored against the old contract surfaces
  // as ungraded at analyze time instead of quietly counting as fine.
  for (const id of humanIds) {
    const r = {
      id,
      tier: 'human',
      result: 'error',
      output:
        'human-tier checks are no longer supported: these checks observe, they never ask the ' +
        'session for anything. Re-author as a script or prompt check, or drop it and judge it ' +
        'yourself at /optimizer:analyze.',
    };
    results.push(r);
    await persister.record(r);
  }

  for (const id of scriptIds) {
    const r = await runScriptCheck(cwd, runners, id, defs[id], scriptTimeoutMs);
    results.push(r);
    await persister.record(r);
  }

  // Ungated on purpose, so the per-turn series has no holes: every declared dimension
  // is graded every turn regardless of what the script tier said. The old gate skipped
  // this tier whenever a script check was red — the normal mid-run state — which is how
  // the graded tier silently never ran.
  if (promptIds.length > 0) {
    const systemPrompt = await loadSystemPrompt();
    await runWithConcurrency(promptIds, PROMPT_CONCURRENCY, async (id) => {
      const remaining = deadline - Date.now();
      const r = await runPromptCheck(cwd, id, defs[id], systemPrompt, Math.min(promptTimeoutMs, remaining), budgetMs);
      results.push(r);
      await persister.record(r);
    });
  }

  await persister.finalize(results);

  // Diagnostics go to stderr, never stdout. A Stop hook's stdout IS the control
  // channel, so the only safe amount to write there is none — see this file's header.
  // Anything the run needs to know is in the session file for /optimizer:analyze.
  const errors = results.filter((r) => r.result === 'error');
  if (errors.length > 0) {
    console.error(
      `dod-lite: ${errors.length} check(s) could not be evaluated: ${errors.map((e) => e.id).join(', ')}`,
    );
  }
}

export { main };

// Only run when invoked as the hook. Without this guard the test suite could not import
// a single function without the whole Stop-hook flow firing against process.stdin.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) runFailOpen(main);
