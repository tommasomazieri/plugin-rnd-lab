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
