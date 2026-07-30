#!/usr/bin/env node
/**
 * digest-transcript.mjs — bounded, line-anchored narrative digest of one arm's session JSONL.
 *
 * Usage:
 *   node digest-transcript.mjs <transcript.jsonl> --arm control [--out analysis/digest-control.md]
 *
 * WHY THIS EXISTS
 *
 * `analyze-jsonl.mjs` produces counters. Counters cannot tell you WHY an arm burned
 * 40k tokens, and an analyst handed only counters will invent a cause. The obvious
 * alternative — "go read the transcript" — is what actually happened, and it doesn't
 * work: a 1005-line JSONL is unreadable in context, so the analyst greps a bit, finds
 * nothing conclusive, and writes the plausible story anyway.
 *
 * This script removes the excuse. It converts the JSONL into a digest that is
 * (a) small enough to read whole, and (b) line-anchored, so every claim can cite
 * `L<n>` and be checked against the raw file. Reading it is mandatory before the
 * session-comparator may assert any cause — see agents/session-comparator.md.
 *
 * WHAT IT KEEPS (the things that actually explain a delta)
 *   - every real user turn, near-verbatim  — the #1 source of arm asymmetry
 *   - every tool error, verbatim            — including permission rejections
 *   - every Stop-hook event                 — block reasons, and hooks that ran long
 *   - skill/plugin attribution counts       — did the plugin under test get USED at all
 *   - compaction boundaries                 — context resets that invalidate comparisons
 *   - assistant reasoning, truncated        — enough to follow the plot
 *   - tool calls, with identical runs collapsed
 *
 * WHAT IT DROPS: thinking-block bodies, attachment payloads, file-history snapshots,
 * tool RESULT bodies (only errors survive). All dropped material is counted in the
 * header so the reader knows the coverage they are working with.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Per-entry caps. Generous for the rare high-signal entries (user turns, errors),
// tight for the repetitive ones. Tuned so a 1000-line JSONL digests to ~30-40KB.
const CAP_USER = 1500;
const CAP_ASSISTANT = 400;
const CAP_TOOL_ARG = 110;
const CAP_ERROR = 400;
const CAP_HOOK = 600;
const MAX_TIMELINE_ENTRIES = 400;

// A transcript this small with this few human turns is almost never an arm's real
// working session — it's an abandoned start or a restart stub. run-002's control arm
// selected a 49-line/1-turn transcript and would have been compared, token for token,
// against a 1005-line test session.
const STUB_LINES = 120;
const STUB_USER_TURNS = 1;

// dod-lite's prompt-tier checkers are `claude -p` sessions running INSIDE the arm
// workspace, so they inherit the arm's settings.json and look like arm sessions to
// every hook that doesn't check DOD_LITE_CHECKER. When that guard misses one, it gets
// linked in manifest.json and — because compare-runs.mjs analyzes the LAST linked
// session — silently replaces the arm's real work with a grader's 40-line transcript.
// This matches on the prompt text dod-check.mjs builds, which needs no env access.
const CHECKER_PROMPT_RE = /^DoD check "|Return your verdict via the required structured output/;

function squash(text, cap) {
  const s = String(text ?? '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return s.length > cap ? `${s.slice(0, cap)} …[+${s.length - cap} chars]` : s;
}

function hhmmss(ts) {
  if (!ts) return '--:--:--';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '--:--:--' : d.toISOString().slice(11, 19);
}

// One short human-readable descriptor per tool call. Falls back to raw input JSON for
// tools this doesn't know — an unknown MCP tool still gets a usable line.
function describeTool(name, input) {
  const i = input && typeof input === 'object' ? input : {};
  const rel = (p) => (typeof p === 'string' ? p.split(/[\\/]/).slice(-2).join('/') : '');
  switch (name) {
    case 'Read': case 'Write': case 'NotebookEdit': return rel(i.file_path);
    case 'Edit': return `${rel(i.file_path)} ${i.replace_all ? '(all)' : ''}`.trim();
    case 'Bash': case 'PowerShell': return squash(i.command, CAP_TOOL_ARG);
    case 'Grep': return `/${i.pattern}/ ${i.path ? rel(i.path) : ''}`.trim();
    case 'Glob': return i.pattern || '';
    case 'Skill': return `${i.skill || ''} ${i.args || ''}`.trim();
    case 'Task': case 'Agent': return squash(i.description || i.subagent_type, CAP_TOOL_ARG);
    case 'WebFetch': return i.url || '';
    case 'TodoWrite': return `${(i.todos || []).length} items`;
    default: return squash(JSON.stringify(i), CAP_TOOL_ARG);
  }
}

function parseLines(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw.split('\n').map((l, idx) => ({ n: idx + 1, raw: l })).filter((x) => x.raw.trim().length > 0);
}

export function digestFile(filePath, arm) {
  const lines = parseLines(filePath);
  const d = {
    arm,
    transcript: path.resolve(filePath),
    session_id: null,
    jsonl_lines: lines.length,
    malformed: 0,
    counts: {
      user_real: 0, assistant_text: 0, thinking_blocks: 0, tool_calls: 0,
      tool_results: 0, tool_errors: 0, permission_rejections: 0,
      attachments: 0, snapshots: 0, compact_boundaries: 0,
    },
    attribution: { skills: {}, plugins: {} },
    errors: [],
    hooks: [],
    timeline: [],
    warnings: [],
  };

  for (const { n, raw } of lines) {
    let e;
    try { e = JSON.parse(raw); } catch { d.malformed++; continue; }
    if (!d.session_id && e.sessionId) d.session_id = e.sessionId;
    const at = hhmmss(e.timestamp);

    if (e.attributionSkill) d.attribution.skills[e.attributionSkill] = (d.attribution.skills[e.attributionSkill] || 0) + 1;
    if (e.attributionPlugin) d.attribution.plugins[e.attributionPlugin] = (d.attribution.plugins[e.attributionPlugin] || 0) + 1;

    if (e.type === 'attachment') { d.counts.attachments++; continue; }
    if (e.type === 'file-history-snapshot' || e.type === 'file-history-delta') { d.counts.snapshots++; continue; }

    if (e.type === 'system') {
      if (e.subtype === 'compact_boundary') {
        d.counts.compact_boundaries++;
        d.timeline.push({ n, at, kind: 'COMPACT', text: '─── context compaction boundary ───' });
      } else if (e.subtype === 'stop_hook_summary') {
        // The single richest line in the file for harness debugging: which Stop hooks ran,
        // which blocked, and how long each took (a hook at its configured timeout shows here
        // as durationMs, and nowhere else).
        for (const err of e.hookErrors || []) {
          const text = squash(err, CAP_HOOK);
          d.hooks.push({ n, at, kind: 'blocked', text });
          d.timeline.push({ n, at, kind: 'HOOK', text: `BLOCKED: ${text}` });
        }
        for (const h of e.hookInfos || []) {
          if (typeof h.durationMs === 'number' && h.durationMs >= 60_000) {
            const text = `${Math.round(h.durationMs / 1000)}s — ${squash(h.command, 90)}`;
            d.hooks.push({ n, at, kind: 'slow', text });
            d.timeline.push({ n, at, kind: 'HOOK', text: `SLOW HOOK ${text}` });
          }
        }
      }
      continue;
    }

    if (e.type === 'assistant' && e.message) {
      const content = Array.isArray(e.message.content) ? e.message.content : [];
      const attrib = e.attributionSkill ? ` «${e.attributionSkill}»` : '';
      for (const b of content) {
        if (b?.type === 'thinking') { d.counts.thinking_blocks++; continue; }
        if (b?.type === 'text' && b.text?.trim()) {
          d.counts.assistant_text++;
          d.timeline.push({ n, at, kind: 'ASST', text: squash(b.text, CAP_ASSISTANT) });
        } else if (b?.type === 'tool_use') {
          d.counts.tool_calls++;
          d.timeline.push({ n, at, kind: 'TOOL', tool: b.name || 'unknown', text: `${b.name || 'unknown'}(${describeTool(b.name, b.input)})${attrib}` });
        }
      }
      continue;
    }

    if (e.type === 'user' && e.message) {
      const content = e.message.content;
      if (Array.isArray(content)) {
        const toolResults = content.filter((b) => b?.type === 'tool_result');
        if (toolResults.length > 0) {
          d.counts.tool_results += toolResults.length;
          for (const tr of toolResults) {
            if (!tr.is_error) continue;
            d.counts.tool_errors++;
            const body = typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content);
            const isReject = /doesn't want to proceed|tool use was rejected/i.test(body);
            if (isReject) d.counts.permission_rejections++;
            const text = squash(body, CAP_ERROR);
            d.errors.push({ n, at, reject: isReject, text });
            d.timeline.push({ n, at, kind: 'ERR', text: `${isReject ? 'USER REJECTED TOOL — ' : ''}${text}` });
          }
          continue;
        }
      }
      if (e.isCompactSummary || e.isSidechain) continue;
      const text = typeof content === 'string'
        ? content
        : (Array.isArray(content) ? content : []).filter((b) => b?.type === 'text').map((b) => b.text || '').join('\n');
      if (!text.trim()) continue;
      // isMeta covers system-injected pseudo-user lines (hook context, reminders); they are
      // NOT operator input and must never be counted as arm asymmetry.
      const kind = e.isMeta ? 'META' : 'USER';
      if (!e.isMeta) {
        d.counts.user_real++;
        if (d.counts.user_real === 1 && CHECKER_PROMPT_RE.test(text.trim())) d.checker_prompt_line = n;
      }
      d.timeline.push({ n, at, kind, text: squash(text, e.isMeta ? CAP_ASSISTANT : CAP_USER) });
    }
  }

  if (d.checker_prompt_line) {
    d.warnings.push(
      `NOT AN ARM SESSION — this transcript is a dod-lite prompt-tier CHECKER subprocess ` +
      `(its first user turn, L${d.checker_prompt_line}, is a generated DoD grading prompt). ` +
      'ab-bench\'s DOD_LITE_CHECKER guard failed to skip it, so it was linked in manifest.json and ' +
      'selected as this arm\'s session. Every metric derived from it describes the grader, not the arm. ' +
      'STOP: re-select this arm\'s session from manifest.json and say the run is unanalyzable as-linked.',
    );
  }
  if (d.jsonl_lines <= STUB_LINES && d.counts.user_real <= STUB_USER_TURNS) {
    d.warnings.push(
      `STUB TRANSCRIPT: ${d.jsonl_lines} JSONL lines and ${d.counts.user_real} real user turn(s). ` +
      'This is very likely an abandoned start or a restart stub, NOT this arm\'s working session. ' +
      'Check manifest.json for earlier sessions on this arm before comparing any totals — comparing a ' +
      'stub against a full session produces a large, entirely fake efficiency delta.',
    );
  }
  if (d.counts.tool_calls === 0) {
    d.warnings.push('NO TOOL CALLS in this session — nothing was actually done here.');
  }
  if (d.counts.permission_rejections > 0) {
    d.warnings.push(
      `${d.counts.permission_rejections} tool call(s) were REJECTED BY THE OPERATOR mid-session. ` +
      'Operator intervention is an arm asymmetry: it is not the plugin\'s behavior.',
    );
  }
  return d;
}

// Consecutive identical no-error tool calls carry no analytical signal individually —
// "Bash ×7 (L100–L118)" says the same thing in one line and keeps the digest readable.
function collapseRuns(timeline) {
  const out = [];
  for (const entry of timeline) {
    const prev = out[out.length - 1];
    if (entry.kind === 'TOOL' && prev?.kind === 'TOOL' && prev.tool === entry.tool && prev.text === entry.text) {
      prev.count = (prev.count || 1) + 1;
      prev.lastN = entry.n;
      continue;
    }
    out.push({ ...entry });
  }
  return out;
}

export function renderDigest(d) {
  const L = [];
  L.push(`# Transcript digest — ${d.arm} arm`);
  L.push('');
  L.push(`- Source: \`${d.transcript}\``);
  L.push(`- Session id: \`${d.session_id || 'unknown'}\``);
  L.push(`- JSONL lines: ${d.jsonl_lines}${d.malformed ? ` (${d.malformed} malformed, skipped)` : ''}`);
  L.push(`- Real user turns: ${d.counts.user_real} | assistant messages: ${d.counts.assistant_text} | tool calls: ${d.counts.tool_calls} | tool errors: ${d.counts.tool_errors}`);
  L.push(`- Dropped from this digest (counted, not shown): ${d.counts.thinking_blocks} thinking blocks, ${d.counts.attachments} attachments, ${d.counts.snapshots} file snapshots, ${d.counts.tool_results} tool-result bodies`);
  L.push(`- \`L<n>\` anchors are 1-based line numbers in the source JSONL — Read it at that offset to verify any claim.`);
  L.push('');

  if (d.warnings.length > 0) {
    L.push('## ⚠ Session-shape warnings');
    L.push('');
    for (const w of d.warnings) L.push(`- **${w}**`);
    L.push('');
  }

  L.push('## Skill / plugin attribution');
  L.push('');
  const skills = Object.entries(d.attribution.skills).sort((a, b) => b[1] - a[1]);
  const plugins = Object.entries(d.attribution.plugins).sort((a, b) => b[1] - a[1]);
  if (skills.length === 0 && plugins.length === 0) {
    L.push('_No skill- or plugin-attributed activity recorded in this session._');
    L.push('');
    L.push('For a TEST arm this is a finding in itself: the plugin under test was never actually invoked, so any delta this run is not attributable to it.');
  } else {
    for (const [k, v] of plugins) L.push(`- plugin \`${k}\`: ${v} attributed entries`);
    for (const [k, v] of skills) L.push(`- skill \`${k}\`: ${v} attributed entries`);
  }
  L.push('');

  L.push('## Stop-hook events');
  L.push('');
  if (d.hooks.length === 0) L.push('_None recorded._');
  else for (const h of d.hooks) L.push(`- \`L${h.n}\` ${h.at} **${h.kind}** — ${h.text}`);
  L.push('');

  L.push('## Tool errors (all of them)');
  L.push('');
  if (d.errors.length === 0) L.push('_None._');
  else for (const e of d.errors) L.push(`- \`L${e.n}\` ${e.at}${e.reject ? ' **[OPERATOR REJECTION]**' : ''} — ${e.text}`);
  L.push('');

  L.push('## Timeline');
  L.push('');
  let entries = collapseRuns(d.timeline);
  if (entries.length > MAX_TIMELINE_ENTRIES) {
    // Never drop the high-signal kinds; thin plain tool calls only, oldest-middle first.
    const keep = new Set(['USER', 'ERR', 'HOOK', 'COMPACT', 'ASST']);
    const priority = entries.filter((e) => keep.has(e.kind));
    const rest = entries.filter((e) => !keep.has(e.kind));
    const room = Math.max(0, MAX_TIMELINE_ENTRIES - priority.length);
    const kept = new Set(rest.slice(0, room).map((e) => e.n));
    entries = entries.filter((e) => keep.has(e.kind) || kept.has(e.n));
    L.push(`_Timeline thinned to ${entries.length} entries (tool calls only; all user turns, assistant messages, errors, hook events and compactions retained)._`);
    L.push('');
  }
  L.push('```');
  for (const e of entries) {
    const span = e.count > 1 ? `L${e.n}-${e.lastN}` : `L${e.n}`;
    const mult = e.count > 1 ? ` ×${e.count}` : '';
    const body = String(e.text).split('\n').join('\n' + ' '.repeat(22));
    L.push(`${span.padEnd(12)} ${e.at}  ${e.kind.padEnd(7)} ${body}${mult}`);
  }
  L.push('```');
  L.push('');
  return L.join('\n');
}

function main() {
  const argv = process.argv;
  let file = null; let arm = 'unknown'; let out = null;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--arm') arm = argv[++i];
    else if (argv[i] === '--out') out = argv[++i];
    else if (!file) file = argv[i];
  }
  if (!file) {
    console.error('usage: node digest-transcript.mjs <transcript.jsonl> --arm <control|test> [--out digest.md]');
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`[ab-bench] transcript not found: ${file}`);
    process.exit(1);
  }
  const d = digestFile(file, arm);
  const md = renderDigest(d);
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, md, 'utf8');
    console.log(`[ab-bench] digest written: ${out} (${(md.length / 1024).toFixed(1)} KB from ${d.jsonl_lines} JSONL lines)`);
    for (const w of d.warnings) console.log(`[ab-bench] WARNING (${arm}): ${w}`);
  } else {
    console.log(md);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
