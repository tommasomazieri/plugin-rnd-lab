#!/usr/bin/env node
/**
 * analyze-jsonl.mjs — deterministic metrics extractor for one Claude Code session JSONL.
 *
 * Usage (CLI):
 *   node analyze-jsonl.mjs <transcript.jsonl> [--out metrics.json]
 *
 * Also importable: `import { analyzeFile } from './analyze-jsonl.mjs'`.
 *
 * Parsing is defensive: unknown fields ignored, malformed lines counted and skipped.
 * Token usage is deduped by message.id — Claude Code writes one JSONL line per
 * content block of the same API message, repeating the usage object on each.
 *
 * No LLM, no judgment, no cost table (model pricing drifts; token counts are the
 * stable ground truth). The subjective layer lives in the session-comparator agent.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Tools that can change the deliverable. Bash is included deliberately: deck renders,
// builds and generators all run through it, so excluding it would miss most real
// mutations. A false positive here costs a warning; a false negative costs a wrong
// scoreline.
const MUTATING_TOOLS = new Set([
  'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell', 'Task', 'Agent',
]);

export function analyzeFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);

  const m = {
    transcript: path.resolve(filePath),
    parsed_lines: 0,
    malformed_lines: 0,
    models: {},
    turns: { user_real: 0, user_tool_results: 0, user_meta: 0, assistant_messages: 0, sidechain_lines: 0 },
    tokens: { input: 0, output: 0, cache_read: 0, cache_creation: 0 },
    tokens_by_model: {},
    cost_usd_reported: 0,
    has_reported_cost: false,
    api_time_ms_total: 0,
    tool_calls: {},
    tool_calls_total: 0,
    tool_errors: 0,
    // Timestamp of the last tool call that could have changed the deliverable. A DoD
    // verdict older than this graded an artifact that no longer exists — see the
    // stale-verdict flag in compare-runs.mjs.
    last_mutation_at: null,
    compactions: { boundaries: 0, compact_summaries: 0, summary_entries: 0 },
    user_bias: { real_user_turns: 0, user_chars_total: 0, user_turns: [] },
    duration: { start: null, end: null, seconds: null },
  };

  const seenUsageIds = new Set();

  for (const line of lines) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      m.malformed_lines++;
      continue;
    }
    m.parsed_lines++;

    if (e.timestamp) {
      if (!m.duration.start || e.timestamp < m.duration.start) m.duration.start = e.timestamp;
      if (!m.duration.end || e.timestamp > m.duration.end) m.duration.end = e.timestamp;
    }

    if (e.isSidechain) m.turns.sidechain_lines++;

    if (e.type === 'summary') {
      m.compactions.summary_entries++;
      continue;
    }

    if (e.type === 'system') {
      if (e.subtype === 'compact_boundary') m.compactions.boundaries++;
      continue;
    }

    if (e.type === 'assistant' && e.message) {
      m.turns.assistant_messages++;
      const model = e.message.model || 'unknown';
      m.models[model] = (m.models[model] || 0) + 1;

      if (typeof e.costUSD === 'number') {
        m.cost_usd_reported += e.costUSD;
        m.has_reported_cost = true;
      }
      if (typeof e.durationMs === 'number') m.api_time_ms_total += e.durationMs;

      const usage = e.message.usage;
      const usageKey = e.message.id || e.requestId || e.uuid;
      if (usage && usageKey && !seenUsageIds.has(usageKey)) {
        seenUsageIds.add(usageKey);
        m.tokens.input += usage.input_tokens || 0;
        m.tokens.output += usage.output_tokens || 0;
        m.tokens.cache_read += usage.cache_read_input_tokens || 0;
        m.tokens.cache_creation += usage.cache_creation_input_tokens || 0;
        const bm = (m.tokens_by_model[model] = m.tokens_by_model[model] || {
          input: 0, output: 0, cache_read: 0, cache_creation: 0,
        });
        bm.input += usage.input_tokens || 0;
        bm.output += usage.output_tokens || 0;
        bm.cache_read += usage.cache_read_input_tokens || 0;
        bm.cache_creation += usage.cache_creation_input_tokens || 0;
      }

      const content = Array.isArray(e.message.content) ? e.message.content : [];
      for (const block of content) {
        if (block?.type === 'tool_use') {
          const name = block.name || 'unknown';
          m.tool_calls[name] = (m.tool_calls[name] || 0) + 1;
          m.tool_calls_total++;
          if (MUTATING_TOOLS.has(name) && e.timestamp && (!m.last_mutation_at || e.timestamp > m.last_mutation_at)) {
            m.last_mutation_at = e.timestamp;
          }
        }
      }
      continue;
    }

    if (e.type === 'user' && e.message) {
      if (e.isCompactSummary) {
        m.compactions.compact_summaries++;
        continue;
      }
      if (e.isMeta) {
        m.turns.user_meta++;
        continue;
      }
      const content = e.message.content;
      if (Array.isArray(content)) {
        const toolResults = content.filter((b) => b?.type === 'tool_result');
        if (toolResults.length > 0) {
          m.turns.user_tool_results++;
          for (const tr of toolResults) if (tr.is_error) m.tool_errors++;
          continue;
        }
      }
      // real human-typed turn (string content, or content array without tool_result)
      if (e.isSidechain) continue; // sidechain "user" lines are agent-to-agent prompts
      const text =
        typeof content === 'string'
          ? content
          : (Array.isArray(content) ? content : [])
              .filter((b) => b?.type === 'text')
              .map((b) => b.text || '')
              .join('\n');
      m.turns.user_real++;
      m.user_bias.real_user_turns++;
      m.user_bias.user_chars_total += text.length;
      m.user_bias.user_turns.push({
        at: e.timestamp || null,
        chars: text.length,
        preview: text.slice(0, 80).replace(/\s+/g, ' '),
      });
    }
  }

  if (m.duration.start && m.duration.end) {
    m.duration.seconds = Math.round((new Date(m.duration.end) - new Date(m.duration.start)) / 1000);
  }
  if (!m.has_reported_cost) m.cost_usd_reported = null;
  delete m.has_reported_cost;
  return m;
}

/**
 * Subagent transcripts are NOT part of their parent's JSONL.
 *
 * A backgrounded `Task` dispatch gets its own session, stored at
 *   <projectDir>/<parentSessionId>/subagents/agent-<agentId>.jsonl
 * with a sibling `.meta.json` carrying {agentType, description, toolUseId, spawnDepth}.
 * The parent transcript keeps only the tool_use block and a "launched successfully"
 * tool_result — no `isSidechain` lines, no usage. So every token a subagent spends is
 * invisible to analyzeFile(parent).
 *
 * Measured on ab-bench run-004: the test arm dispatched deck-critic twice, and those
 * two sessions carried 400,963 cache-read and 134,103 cache-creation tokens over 28
 * tool calls that the reported cost excluded entirely. A plugin that fans out more
 * aggressively would be understated without limit, and nothing in the output would
 * show it.
 *
 * Recurses: a subagent may itself dispatch (spawnDepth > 1).
 */
export function collectSubagentTranscripts(transcriptPath) {
  const dir = path.dirname(transcriptPath);
  const sessionId = path.basename(transcriptPath, '.jsonl');
  const subDir = path.join(dir, sessionId, 'subagents');
  const out = [];
  if (!fs.existsSync(subDir)) return out;
  for (const f of fs.readdirSync(subDir)) {
    if (!f.endsWith('.jsonl')) continue;
    const p = path.join(subDir, f);
    let meta = {};
    const metaPath = p.replace(/\.jsonl$/, '.meta.json');
    if (fs.existsSync(metaPath)) {
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      } catch {
        /* unreadable meta is not a reason to drop the tokens */
      }
    }
    out.push({
      path: p,
      agent_id: f.replace(/^agent-/, '').replace(/\.jsonl$/, ''),
      agent_type: meta.agentType || null,
      description: meta.description || null,
      tool_use_id: meta.toolUseId || null,
      spawn_depth: meta.spawnDepth ?? null,
    });
    out.push(...collectSubagentTranscripts(p));
  }
  return out;
}

/** How many Task/Agent dispatches this transcript made. */
export function countAgentDispatches(m) {
  return (m.tool_calls?.Task || 0) + (m.tool_calls?.Agent || 0);
}

const ZERO = () => ({ input: 0, output: 0, cache_read: 0, cache_creation: 0 });

/**
 * analyzeFile plus every subagent session it spawned, rolled into one total.
 *
 * `self` is the session's own usage, `subagents` the per-agent breakdown, and
 * `total` what the work actually cost. `unaccounted_dispatches` is the alarm: Task
 * calls whose transcript could not be located, i.e. work that happened and is still
 * not being counted.
 */
export function analyzeWithSubagents(transcriptPath) {
  const self = analyzeFile(transcriptPath);
  const found = collectSubagentTranscripts(transcriptPath);
  const subagents = found.map((s) => ({ ...s, metrics: analyzeFile(s.path) }));

  const total = { tokens: ZERO(), tool_calls_total: self.tool_calls_total, assistant_messages: self.turns.assistant_messages };
  for (const k of Object.keys(total.tokens)) total.tokens[k] = self.tokens[k];
  for (const s of subagents) {
    for (const k of Object.keys(total.tokens)) total.tokens[k] += s.metrics.tokens[k];
    total.tool_calls_total += s.metrics.tool_calls_total;
    total.assistant_messages += s.metrics.turns.assistant_messages;
  }

  const dispatches = countAgentDispatches(self);
  const topLevel = subagents.filter((s) => (s.spawn_depth ?? 1) === 1).length;
  return {
    self,
    subagents,
    total,
    dispatches,
    unaccounted_dispatches: Math.max(0, dispatches - topLevel),
  };
}

/**
 * What kind of session a JSONL is, from its opening user message.
 *
 * dod-lite spawns its prompt checkers with `claude -p` and cwd = the arm workspace,
 * so those checker sessions land in the SAME project directory as the arm's own
 * transcript. In run-004 that was 16 extra files for test and 8 for control —
 * 144,566 and 61,420 output tokens of grading, which is harness overhead and must
 * never be folded into either arm's cost.
 */
export function peekSessionRole(filePath) {
  let head;
  try {
    head = fs.readFileSync(filePath, 'utf8').split('\n', 60);
  } catch {
    return 'unknown';
  }
  for (const line of head) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type !== 'user' || !e.message) continue;
    const c = e.message.content;
    const text =
      typeof c === 'string'
        ? c
        : (Array.isArray(c) ? c : []).filter((b) => b?.type === 'text').map((b) => b.text || '').join('\n');
    if (!text) continue;
    return /^\s*DoD check\s+"/.test(text) ? 'dod-checker' : 'session';
  }
  return 'unknown';
}

/**
 * Every other session sitting in the same project directory, classified. Used to
 * report harness overhead separately rather than silently ignoring or wrongly
 * including it.
 */
export function collectPeerSessions(transcriptPath) {
  const dir = path.dirname(transcriptPath);
  const selfName = path.basename(transcriptPath);
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const f of entries) {
    if (!f.endsWith('.jsonl') || f === selfName) continue;
    const p = path.join(dir, f);
    out.push({ path: p, session_id: path.basename(f, '.jsonl'), role: peekSessionRole(p), metrics: analyzeFile(p) });
  }
  return out;
}

function main() {
  const argv = process.argv;
  let file = null;
  let out = null;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--out') out = argv[++i];
    else if (!file) file = argv[i];
  }
  if (!file) {
    console.error('usage: node analyze-jsonl.mjs <transcript.jsonl> [--out metrics.json]');
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`[ab-bench] transcript not found: ${file}`);
    process.exit(1);
  }
  const metrics = analyzeFile(file);
  const json = JSON.stringify(metrics, null, 2);
  if (out) {
    fs.writeFileSync(out, json);
    console.log(`[ab-bench] metrics written: ${out}`);
  } else {
    console.log(json);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
