#!/usr/bin/env node
/**
 * compare-runs.mjs — pair the two arms of a fired run and compute the comparison.
 *
 * Usage:
 *   node compare-runs.mjs <runDir>
 *
 * Reads runs/run-NNN/manifest.json, analyzes each arm's transcript (last session
 * segment of each arm; earlier segments flagged), writes:
 *   analysis/metrics-control.json
 *   analysis/metrics-test.json
 *   analysis/comparison.json
 * and prints a terse summary table.
 *
 * The comparison stays deterministic and honest: raw totals side by side, deltas,
 * and BIAS INDICATORS (user-turn asymmetry, compaction asymmetry, session-segment
 * asymmetry, model parity check). It never fabricates "adjusted" numbers by
 * subtracting estimates — interpretation of the bias indicators belongs to the
 * session-comparator agent and the human.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeFile, analyzeWithSubagents, collectPeerSessions } from './analyze-jsonl.mjs';
import { digestFile, renderDigest } from './digest-transcript.mjs';
import { readCounter, counterPath } from '../../fire/scripts/turn-counter.mjs';

const ARMS = ['control', 'test'];

// Dated list prices, pinned into every comparison.json that uses them, so a run's cost
// stays reproducible after the table is updated.
const PRICES = JSON.parse(fs.readFileSync(new URL('../prices.json', import.meta.url), 'utf8'));

function fail(msg) {
  console.error(`[optimizer] ERROR: ${msg}`);
  process.exit(1);
}

function pct(a, b) {
  if (!b) return null;
  return Math.round(((a - b) / b) * 1000) / 10;
}

function readJsonSafe(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

// runDir = <testenvRoot>/runs/run-NNN — same two-levels-up shape regardless of the
// two-root split (only where testenvRoot itself lives moved; this function's logic didn't).
function testenvRootFromRunDir(runDir) {
  return path.dirname(path.dirname(runDir));
}

/**
 * Checks whose verdict predates the arm's last file-changing action.
 *
 * A verdict older than the artifact it grades is not a verdict. In run-004 this
 * snapshotter sampled while the test arm's prompt tier was still executing and
 * reported 8/10; four checks resolved up to 3.5 minutes later and all passed, so the
 * true result was 10/10. That produced a "control won on quality" reading which
 * contradicted the operator and had to be retracted mid-analysis. Silence here is
 * what made it convincing — a stale `fail` is indistinguishable from a real one.
 */
function staleChecks(session, lastMutationAt) {
  if (!session || !lastMutationAt) return [];
  const out = [];
  for (const id of session.checks || []) {
    const at = session.state?.[id]?.last_checked_at;
    if (!at) {
      out.push({ id, checked_at: null, reason: 'never ran' });
    } else if (at < lastMutationAt) {
      out.push({ id, checked_at: at, reason: `graded at ${at}, deliverable changed at ${lastMutationAt}` });
    }
  }
  return out;
}

function summarizeDodState(session) {
  if (!session) return null;
  const ids = session.checks || [];
  const results = ids.map((id) => session.state?.[id]?.last_result || 'pending');
  // `error` and `pending` are NOT quality signals — they mean the dimension was
  // never graded (checker infrastructure failed, or the tier never ran). Counting
  // either as a fail would read a dod-lite defect as an arm quality difference.
  return {
    total: ids.length,
    pass: results.filter((r) => r === 'pass').length,
    fail: results.filter((r) => r === 'fail').length,
    waived: results.filter((r) => r === 'waived').length,
    pending: results.filter((r) => r === 'pending').length,
    error: results.filter((r) => r === 'error').length,
    ungraded: results.filter((r) => r === 'pending' || r === 'error').length,
    all_passing: ids.length > 0 && results.every((r) => r === 'pass' || r === 'waived'),
  };
}

/**
 * LEGACY. Always 0 for runs fired after the DoD engine became observational — the human
 * tier that produced these no longer exists, precisely because blocking to tell an arm to
 * call AskUserQuestion manufactured the autonomy signal being measured.
 *
 * Kept because runs already on disk have `answer_source: "arm-reported"` entries, and their
 * autonomy numbers must stay reproducible: those interruptions really were harness-induced,
 * so subtracting them is still the correct reading of that data.
 */
export function harnessHitl(dodSession) {
  if (!dodSession) return 0;
  return Object.values(dodSession.state || {}).filter(
    (s) => s && s.tier === 'human' && s.answer_source === 'arm-reported',
  ).length;
}

/**
 * HITL the arm chose. `AskUserQuestion` calls plus any real user turn beyond the opening
 * prompt — a user who had to step in unprompted is as much a failure of autonomy as one
 * who was asked. Floored at zero: a forged or double-counted harness answer must not
 * manufacture negative autonomy.
 */
export function electiveHitl(m, dodSession) {
  const asks = m.tool_calls?.AskUserQuestion || 0;
  const unpromptedTurns = Math.max(0, (m.user_bias?.real_user_turns || 0) - 1);
  return Math.max(0, asks + unpromptedTurns - harnessHitl(dodSession));
}

export function tokenize(text) {
  return String(text || '').toLowerCase().match(/[a-z0-9]+/g) || [];
}

/** Jaccard over word sets. Order-insensitive on purpose: the same instruction reworded is a
 *  smaller divergence than a different instruction, and this only has to rank, not grade. */
export function similarity(a, b) {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (A.size === 0 && B.size === 0) return 1;
  let shared = 0;
  for (const tok of A) if (B.has(tok)) shared++;
  return shared / (A.size + B.size - shared);
}

const DIVERGENCE_THRESHOLD = 0.8;

/**
 * Prompt parity across arms.
 *
 * The DoD auditor no longer drives an arm to completion, so a session ends when it ends and
 * the operator decides whether to feed back and grant another turn. That makes their
 * between-turn prompts an uncontrolled independent variable — and there are two arms. Type
 * different things into each and the delta stops being attributable to the plugin.
 *
 * Measured and reported, never enforced. Two live terminals cannot be stopped from diverging,
 * and unblocking one genuinely stuck arm is worth more than a clean number bought by
 * pretending that never happens. Same posture as the config parity report next to it.
 *
 * Turn 0 is the harness's own opening prompt, identical by construction — if THAT diverged,
 * the launch is faulty, which is a different problem and is reported as one.
 */
export function promptParity(controlMetrics, testMetrics) {
  const turns = {
    control: controlMetrics.user_bias?.user_turns || [],
    test: testMetrics.user_bias?.user_turns || [],
  };
  const divergence = [];
  for (let i = 0; i < Math.max(turns.control.length, turns.test.length); i++) {
    const c = turns.control[i];
    const t = turns.test[i];
    if (!c || !t) {
      divergence.push({
        turn: i,
        similarity: 0,
        reason: 'one arm has no such turn',
        control: c ? c.preview : '— (no turn)',
        test: t ? t.preview : '— (no turn)',
      });
      continue;
    }
    const s = similarity(c.text ?? c.preview, t.text ?? t.preview);
    if (s < DIVERGENCE_THRESHOLD) {
      divergence.push({
        turn: i,
        similarity: Number(s.toFixed(2)),
        reason: 'different text',
        control: c.preview,
        test: t.preview,
      });
    }
  }

  const openingDiverged = divergence.some((d) => d.turn === 0);
  const afterOpening = divergence.filter((d) => d.turn > 0);
  return {
    user_turns: { control: turns.control.length, test: turns.test.length },
    opening: openingDiverged
      ? 'DIVERGED — both arms are sent the same opening prompt against the same TASK.md, so this is a launch fault, not operator input'
      : 'identical (task.md)',
    threshold: DIVERGENCE_THRESHOLD,
    divergence,
    verdict:
      divergence.length === 0
        ? 'PARITY — every user turn matched across arms; deltas are attributable to the independent variable'
        : `DIVERGENT — ${afterOpening.length + (openingDiverged ? 1 : 0)} turn(s) differ. Attribution to the plugin is weakened by exactly this much operator input, and any causal claim must account for it.`,
  };
}

/**
 * The four countable pillars. `quality` is deliberately absent — it is scored against the
 * mandate's versioned rubric into analysis/quality-<arm>.json, because a number derived
 * from this run's own DoD checks would not be comparable to any other run's.
 *
 * Why these two token pillars. Every API call re-reads the whole context from cache, and
 * cache reads were 66% of list-price cost across a month of real sessions (2026-09-25).
 * Cache reads are roughly api_calls x context size. The context's baseline size is set by
 * the window, auto-compact and the user, not by the artifact, so it is not a pillar:
 *   - `api_calls` is the multiplier the artifact controls (parallel calls, one script
 *     instead of a chain of commands).
 *   - `unique_tokens` is what the artifact adds: uncached input + cache writes + output,
 *     each paid once. Over-fetching to save a call shows up here, so the two check each other.
 * `api_calls_per_turn` is a reading, not a pillar.
 */
export function pillarsFor(m, dodSession) {
  const tok = m.combined?.tokens || m.tokens;
  const apiCalls = m.combined?.api_calls ?? m.api_calls ?? null;
  const turns = m.turn_counter?.turns ?? null;
  return {
    unique_tokens: (tok.input || 0) + (tok.cache_creation || 0) + (tok.output || 0),
    api_calls: apiCalls,
    api_calls_per_turn: apiCalls !== null && turns ? Math.round((apiCalls / turns) * 10) / 10 : null,
    turns,
    autonomy: {
      hitl_elective: electiveHitl(m, dodSession),
      hitl_total: (m.tool_calls?.AskUserQuestion || 0) + Math.max(0, (m.user_bias?.real_user_turns || 0) - 1),
      hitl_harness: harnessHitl(dodSession),
      note: 'hitl_elective is the scored value: total minus interruptions the DoD harness caused.',
    },
    quality: null,
  };
}

/** Exact id, or id plus a date suffix. Prefix matching would price an unknown
 *  `claude-opus-4-9` as `claude-opus-4`, three times too high, without saying so. */
export function priceFor(model, table = PRICES.models) {
  const key = Object.keys(table).find((k) => model === k || new RegExp(`^${k}-\\d{8}$`).test(model));
  return key ? { key, ...table[key] } : null;
}

/**
 * List-price cost of one arm. A reading, not a pillar: it is the tiebreak when api_calls and
 * unique_tokens move in opposite directions. Any unpriced model with real usage makes the
 * total null rather than a silent undercount.
 */
export function listCost(tokensByModel, table = PRICES.models) {
  let usd = 0;
  const unpriced = [];
  const prices_used = {};
  for (const [model, t] of Object.entries(tokensByModel || {})) {
    if (!(t.input + t.output + t.cache_read + t.cache_creation)) continue;
    const p = priceFor(model, table);
    if (!p) {
      unpriced.push(model);
      continue;
    }
    prices_used[p.key] = table[p.key];
    // Writes with no TTL split are priced at the 5-minute rate: a floor, never an overcharge.
    const w1h = t.cache_creation_1h || 0;
    usd += (t.input * p.input + t.output * p.output + t.cache_read * p.cache_read
      + (t.cache_creation - w1h) * p.cache_write_5m + w1h * p.cache_write_1h) / 1e6;
  }
  return { usd: unpriced.length ? null : Math.round(usd * 1e4) / 1e4, unpriced, prices_used };
}

/** Resolved artifact identities per arm, tolerating schema-1 manifests. */
export function pinsFromManifest(manifest) {
  const out = {};
  for (const arm of ['control', 'test']) {
    const a = manifest.arms?.[arm];
    if (Array.isArray(a?.artifacts)) {
      out[arm] = a.artifacts.map((x) => ({
        id: x.id,
        deliver: x.deliver,
        requested_ref: x.requested_ref,
        kind: x.resolved?.kind,
        sha: x.resolved?.sha,
        hash: x.resolved?.hash,
        dirty: Boolean(x.resolved?.dirty),
      }));
    } else if (a?.baseline) {
      out[arm] = a.baseline.type === 'previous-version'
        ? [{ id: 'plugin-under-test', deliver: 'plugin-dir', requested_ref: a.baseline.ref, kind: 'ref', dirty: false }]
        : [];
    } else {
      out[arm] = [];
    }
  }
  out.note = 'What each arm ran against. A `dirty: true` pin is replayable from its cached snapshot but is NOT reconstructible from git history alone.';
  return out;
}

export function compareRun(runDir) {
  const manifestPath = path.join(runDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) fail(`no manifest.json in ${runDir} — run not fired yet`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const analysisDir = path.join(runDir, 'analysis');
  fs.mkdirSync(analysisDir, { recursive: true });

  const metrics = {};
  const digests = {};
  const rolledByArm = {};
  const flags = [];

  for (const arm of ARMS) {
    const armData = manifest.arms?.[arm];
    if (!armData) fail(`manifest has no "${arm}" arm`);
    const sessions = armData.sessions || [];
    if (sessions.length === 0) fail(`${arm} arm never linked a session (hook failed or session never started)`);
    const linkEvents = sessions.filter((s) => s.source === 'startup' || s.source === 'clear');
    let segments = linkEvents.length > 0 ? linkEvents : sessions;
    // Runs fired before the turn counter existed can carry dod-lite prompt-checker
    // subprocesses in sessions[] (they inherited the arm's settings.json and fired its
    // SessionStart hook), and the last segment is the one analyzed — so a 13-line checker
    // transcript could stand in for the arm's whole run. A counter file only exists for
    // real arm sessions, so prefer counted segments whenever any exist.
    const counted = segments.filter((s) => readCounter(runDir, s.session_id));
    if (counted.length > 0 && counted.length !== segments.length) {
      flags.push(`${arm} arm: ignored ${segments.length - counted.length} unmeasured session segment(s) (dod-lite checker subprocesses or pre-counter sessions)`);
      segments = counted;
    }
    if (segments.length > 1) {
      flags.push(`${arm} arm has ${segments.length} session segments (/clear or relaunch mid-run) — only the last is analyzed`);
    }
    const last = segments[segments.length - 1];
    if (!last.transcript_path || !fs.existsSync(last.transcript_path)) {
      fail(`${arm} arm transcript not found: ${last.transcript_path}`);
    }
    // The arm's own session PLUS every subagent it dispatched. A backgrounded Task
    // gets its own transcript under <sessionId>/subagents/, so counting only the arm
    // file credits the plugin with work it did not pay for. Everything done toward
    // the goal is counted; nothing else is.
    const rolled = analyzeWithSubagents(last.transcript_path);
    rolledByArm[arm] = rolled;
    metrics[arm] = rolled.self;
    metrics[arm].session_id = last.session_id;
    metrics[arm].subagents = {
      count: rolled.subagents.length,
      dispatches_in_transcript: rolled.dispatches,
      unaccounted_dispatches: rolled.unaccounted_dispatches,
      tokens: rolled.total.tokens,
      agents: rolled.subagents.map((s) => ({
        agent_id: s.agent_id,
        agent_type: s.agent_type,
        description: s.description,
        spawn_depth: s.spawn_depth,
        tokens: s.metrics.tokens,
        tool_calls_total: s.metrics.tool_calls_total,
        duration_seconds: s.metrics.duration.seconds,
      })),
    };
    // `combined` is what the arm actually cost. `metrics[arm].tokens` stays the
    // arm session alone so the split remains inspectable.
    metrics[arm].combined = rolled.total;
    if (rolled.unaccounted_dispatches > 0) {
      flags.push(
        `${arm} arm: ${rolled.unaccounted_dispatches} agent dispatch(es) have NO locatable transcript — that work is real and still unmeasured. Every cost number for this arm is a floor, not a total.`,
      );
    }
    // dod-lite prompt checkers run with cwd = the arm workspace, so their sessions
    // land in the same project dir. Harness overhead, never arm cost — reported
    // separately so it is neither hidden nor miscounted.
    const peers = collectPeerSessions(last.transcript_path);
    const checkers = peers.filter((p) => p.role === 'dod-checker');
    const overhead = { input: 0, output: 0, cache_read: 0, cache_creation: 0 };
    for (const p of checkers) for (const k of Object.keys(overhead)) overhead[k] += p.metrics.tokens[k];
    metrics[arm].harness_overhead = {
      note: 'dod-lite prompt-checker sessions sharing this workspace. NOT part of the arm\'s cost; listed so the run\'s full token footprint is visible.',
      checker_sessions: checkers.length,
      other_sessions: peers.length - checkers.length,
      tokens: overhead,
    };
    // Real turn count, emitted by the arm's own Stop hook (see fire/scripts/turn-counter.mjs).
    // `turns` = stop signals that ended a user turn; `stops_total` also counts the
    // continuations dod-lite forced by blocking a stop on failing checks.
    metrics[arm].turn_counter = readCounter(runDir, last.session_id);
    if (!metrics[arm].turn_counter) {
      flags.push(`${arm} arm has NO turn counter (${counterPath(runDir, last.session_id)}) — turn numbers below fall back to assistant-message counts, which are per tool-call round trip, not per turn`);
    }
    // Bounded, line-anchored narrative of the same transcript. Written here (not left to
    // the analyst) so it always exists, and so its session-shape warnings become parity
    // flags rather than something an analyst has to notice on their own.
    const dig = digestFile(last.transcript_path, arm);
    const digestPath = path.join(analysisDir, `digest-${arm}.md`);
    fs.writeFileSync(digestPath, renderDigest(dig), 'utf8');
    digests[arm] = {
      path: digestPath,
      jsonl_lines: dig.jsonl_lines,
      attribution: dig.attribution,
      warnings: dig.warnings,
      counts: dig.counts,
      is_checker_transcript: Boolean(dig.checker_prompt_line),
    };
    for (const w of dig.warnings) flags.push(`${arm} arm: ${w}`);

    // Subagent tokens were already rolled up; their BEHAVIOUR was not. If a subagent is
    // part of the thing under test, a cost with no visible conduct is a blind spot in the
    // exact place the experiment is aimed — so every subagent session gets the same
    // bounded, line-anchored narrative the arm itself gets.
    digests[arm].subagents = [];
    for (const sub of metrics[arm].subagents?.agents || []) {
      const subPath = (rolledByArm[arm]?.subagents || []).find((s) => s.agent_id === sub.agent_id)?.path;
      if (!subPath || !fs.existsSync(subPath)) {
        flags.push(`${arm} arm: subagent ${sub.agent_type || sub.agent_id} has tokens but no readable transcript — its conduct is unmeasured.`);
        continue;
      }
      const subDig = digestFile(subPath, `${arm}/${sub.agent_type || 'agent'}`);
      const subDigestPath = path.join(analysisDir, `digest-${arm}-sub-${sub.agent_id}.md`);
      fs.writeFileSync(subDigestPath, renderDigest(subDig), 'utf8');
      digests[arm].subagents.push({
        path: subDigestPath,
        agent_id: sub.agent_id,
        agent_type: sub.agent_type,
        description: sub.description,
        spawn_depth: sub.spawn_depth,
        jsonl_lines: subDig.jsonl_lines,
        tokens: sub.tokens,
      });
    }
    if (digests[arm].subagents.length > 0) {
      flags.push(
        `${arm} arm delegated to ${digests[arm].subagents.length} subagent session(s) — digests written to analysis/digest-${arm}-sub-*.md. Read them before attributing any delta: work that happened there is invisible in the arm's own transcript.`,
      );
    }

    fs.writeFileSync(path.join(analysisDir, `metrics-${arm}.json`), JSON.stringify(metrics[arm], null, 2));
  }

  const c = metrics.control;
  const t = metrics.test;

  // Written as its own file as well as embedded below: the session-comparator is told to
  // read it before attributing any delta, and a path it can be pointed at is harder to skip
  // than a nested key.
  const promptParityReport = promptParity(c, t);
  fs.writeFileSync(
    path.join(analysisDir, 'prompt-parity.json'),
    JSON.stringify(promptParityReport, null, 2),
  );
  if (promptParityReport.divergence.length > 0) {
    flags.push(
      `PROMPT PARITY: ${promptParityReport.verdict} ` +
        `(control ${promptParityReport.user_turns.control} user turns, test ${promptParityReport.user_turns.test}). ` +
        'See analysis/prompt-parity.json — the arms were not given the same instructions after the opening brief.',
    );
  }

  // parity checks
  const cModels = Object.keys(c.models).sort().join(',');
  const tModels = Object.keys(t.models).sort().join(',');
  if (cModels !== tModels) flags.push(`MODEL PARITY VIOLATION: control=[${cModels}] test=[${tModels}]`);

  // The single question an A/B run exists to answer is whether the plugin changed anything.
  // If the test arm never invoked it, no delta this run can be credited to it — and that is
  // invisible in token counts, which is exactly why it gets computed rather than eyeballed.
  const testPlugins = Object.keys(digests.test?.attribution?.plugins || {});
  if (testPlugins.length === 0) {
    flags.push('TEST ARM RECORDED NO PLUGIN-ATTRIBUTED ACTIVITY — the plugin under test was never actually invoked; no delta this run is attributable to it. Verify before crediting anything to the plugin.');
  }
  const controlPlugins = Object.keys(digests.control?.attribution?.plugins || {});
  if (controlPlugins.length > 0) {
    flags.push(`CONTROL ARM used plugin(s) [${controlPlugins.join(', ')}] — the control is supposed to be the status-quo setup; this is contamination unless env.json says otherwise.`);
  }
  // A size gap this large is never a real efficiency result; it means the arms did not run
  // the same task (one crashed, restarted, or the wrong session got linked).
  const lineRatio = (a, b) => (a && b ? Math.max(a, b) / Math.min(a, b) : null);
  const ratio = lineRatio(digests.control?.jsonl_lines, digests.test?.jsonl_lines);
  if (ratio && ratio >= 5) {
    flags.push(`TRANSCRIPT SIZE ASYMMETRY ${ratio.toFixed(1)}x (control ${digests.control.jsonl_lines} lines vs test ${digests.test.jsonl_lines}) — the arms did not do comparable amounts of work. Treat every efficiency delta below as suspect until the digests explain the gap.`);
  }

  // DoD tracking (dod-lite's real schema: .dod/sessions/<session_id>.json at testenv root)
  const testenvRoot = testenvRootFromRunDir(runDir);
  const dodChecksDef = readJsonSafe(path.join(runDir, 'dod-checks.json'));
  const dodSessions = {};
  for (const arm of ARMS) {
    dodSessions[arm] = readJsonSafe(path.join(testenvRoot, '.dod', 'sessions', `${metrics[arm].session_id}.json`));
  }
  const dodStale = {};
  for (const arm of ARMS) {
    dodStale[arm] = staleChecks(dodSessions[arm], metrics[arm].last_mutation_at);
    if (dodStale[arm].length > 0) {
      flags.push(
        `STALE DoD VERDICTS (${arm}): ${dodStale[arm].map((s) => s.id).join(', ')} — ` +
          `graded before the arm's last change at ${metrics[arm].last_mutation_at}. The scoreline ` +
          `below is PROVISIONAL: do not report it as a quality result, re-run compare-runs once ` +
          `every check has settled.`,
      );
    }
  }

  let dodNote = 'no runs/run-NNN/dod-checks.json — DoD tracking not used for this run';
  if (dodChecksDef) {
    const cIds = (dodChecksDef.checks?.control || []).map((x) => x.id).sort().join(',');
    const tIds = (dodChecksDef.checks?.test || []).map((x) => x.id).sort().join(',');
    // An asymmetric list used to be excused when a check came from the artifact's own tooling.
    // That exemption is retired (/optimizer:plan 4b): a check only one arm can run grades only
    // one arm, so the pass counts either side of it are not like-for-like.
    const nonGeneric = ['control', 'test']
      .flatMap((a) => (dodChecksDef.checks?.[a] || []).map((x) => ({ arm: a, ...x })))
      .filter((x) => x.source && x.source !== 'generic');
    dodNote = cIds !== tIds
      ? 'DEFECT: control/test check lists differ — a check only one arm can run grades only one arm, so any pass-count spanning it is NOT like-for-like. Report as a harness defect, do not quote the raw scoreline as a quality comparison.'
      : nonGeneric.length > 0
        ? `DEFECT: ${nonGeneric.length} non-generic check(s) [${nonGeneric.map((x) => `${x.arm}:${x.id}`).join(', ')}] — a check that runs the artifact's own tooling measures whether the artifact satisfies itself. Report as a harness defect.`
        : 'control/test check lists identical, all checks generic';
  }

  const pillars = { control: pillarsFor(c, dodSessions.control), test: pillarsFor(t, dodSessions.test) };
  const cost = { control: listCost(c.combined.tokens_by_model), test: listCost(t.combined.tokens_by_model) };
  for (const arm of ARMS) {
    if (cost[arm].unpriced.length) {
      flags.push(`${arm} arm: no list price for model(s) [${cost[arm].unpriced.join(', ')}] in skills/analyze/prices.json — its cost is null, not estimated.`);
    }
  }

  const comparison = {
    schema: 2,
    experiment: manifest.experiment,
    run: manifest.run,
    // What each arm actually ran against, resolved and immutable. Schema-1 manifests
    // carried only `arms.control.baseline`; that is folded in so old runs still read.
    pins: pinsFromManifest(manifest),
    generated_at: new Date().toISOString(),
    pillars: {
      note:
        'The five axes progress is tracked on. quality is scored separately against the mandate\'s ' +
        'quality-rubric (analysis/quality-<arm>.json) and is NOT derivable from this file alone; ' +
        'the other four are counted here. Lower is better on every axis except quality.',
      control: pillars.control,
      test: pillars.test,
      deltas_test_vs_control: {
        unique_tokens_pct: pct(pillars.test.unique_tokens, pillars.control.unique_tokens),
        api_calls_pct: pct(pillars.test.api_calls, pillars.control.api_calls),
        turns_pct: pct(t.turn_counter?.turns, c.turn_counter?.turns),
        autonomy_hitl_elective: electiveHitl(t, dodSessions.test) - electiveHitl(c, dodSessions.control),
      },
    },
    cost: {
      note:
        'List price of each arm, arm session plus subagents. A reading, not a pillar: no priority or guard ' +
        'can be declared on it. It settles runs where api_calls and unique_tokens move in opposite directions.',
      source: PRICES.source,
      verified_at: PRICES.verified_at,
      unit: 'USD',
      control: cost.control,
      test: cost.test,
      delta_pct: pct(cost.test.usd, cost.control.usd),
    },
    totals: {
      control: summarize(c),
      test: summarize(t),
    },
    turn_counts: {
      control: c.turn_counter,
      test: t.turn_counter,
      note:
        c.turn_counter && t.turn_counter
          ? 'authoritative: counted by each arm\'s own Stop hook'
          : 'INCOMPLETE — at least one arm has no counter; do not compare turn totals across arms in this run',
    },
    // Computed on `combined` — arm session plus its subagents — because that is what
    // the work cost. Comparing arm sessions alone would credit an arm that delegates
    // heavily with a saving it never made.
    deltas_test_vs_control: {
      basis: 'combined (arm session + all subagent sessions); harness overhead excluded from both arms',
      turns_pct: pct(t.turn_counter?.turns, c.turn_counter?.turns),
      input_tokens_pct: pct(t.combined.tokens.input, c.combined.tokens.input),
      output_tokens_pct: pct(t.combined.tokens.output, c.combined.tokens.output),
      cache_read_pct: pct(t.combined.tokens.cache_read, c.combined.tokens.cache_read),
      cache_creation_pct: pct(t.combined.tokens.cache_creation, c.combined.tokens.cache_creation),
      api_calls_pct: pct(t.combined.api_calls, c.combined.api_calls),
      tool_calls_pct: pct(t.combined.tool_calls_total, c.combined.tool_calls_total),
      tool_errors: t.tool_errors - c.tool_errors,
      duration_seconds_pct: pct(t.duration.seconds, c.duration.seconds),
      arm_session_only: {
        note: 'the same deltas excluding subagents — compare against the combined figures above to see how much of each arm ran in delegated sessions',
        output_tokens_pct: pct(t.tokens.output, c.tokens.output),
        cache_read_pct: pct(t.tokens.cache_read, c.tokens.cache_read),
        tool_calls_pct: pct(t.tool_calls_total, c.tool_calls_total),
      },
    },
    bias_indicators: {
      user_turns: { control: c.user_bias.real_user_turns, test: t.user_bias.real_user_turns },
      user_chars: { control: c.user_bias.user_chars_total, test: t.user_bias.user_chars_total },
      user_turn_asymmetry: t.user_bias.real_user_turns - c.user_bias.real_user_turns,
      user_chars_asymmetry: t.user_bias.user_chars_total - c.user_bias.user_chars_total,
      compactions: {
        control: c.compactions.boundaries + c.compactions.compact_summaries,
        test: t.compactions.boundaries + t.compactions.compact_summaries,
      },
    },
    // The operator's own turns are an independent variable now that nothing drives an arm to
    // completion for it. Counting them was never enough — two arms can have four turns each
    // and have been told completely different things.
    prompt_parity: promptParityReport,
    // Paths, not content: the digests are files the session-comparator MUST read. Their
    // warnings are duplicated into parity_flags so nothing depends on the agent opening them
    // — but nothing about WHY a delta happened can be answered without doing so.
    digests: {
      control: digests.control,
      test: digests.test,
      note: 'Bounded line-anchored transcript narratives. Read both in full before asserting any cause. `L<n>` anchors resolve against the source JSONL.',
    },
    parity_flags: flags,
    dod_tracking: {
      note: dodNote,
      definitions: dodChecksDef?.checks || null,
      control: summarizeDodState(dodSessions.control),
      test: summarizeDodState(dodSessions.test),
      stale_verdicts: dodStale,
      stale_note:
        'A check listed here was graded BEFORE its arm last changed the deliverable, so it describes an artifact that no longer exists. Any scoreline including one is provisional.',
    },
  };

  fs.writeFileSync(path.join(analysisDir, 'comparison.json'), JSON.stringify(comparison, null, 2));
  return comparison;
}

function summarize(m) {
  return {
    session_id: m.session_id,
    tokens: m.tokens,
    combined: m.combined,
    subagents: m.subagents,
    harness_overhead: m.harness_overhead,
    cost_usd_reported: m.cost_usd_reported,
    turns: m.turn_counter?.turns ?? null,
    stops_total: m.turn_counter?.stops_total ?? null,
    blocked_continuations: m.turn_counter?.blocked_continuations ?? null,
    api_calls: m.api_calls,
    user_real_turns: m.turns.user_real,
    // Background-Agent completions that re-entered the session as `type: "user"`.
    // Reported rather than dropped: a large asymmetry here is the delegation signal
    // itself, and it used to be silently miscounted as operator intervention.
    user_system_reentries: m.turns.user_system_reentry ?? 0,
    tool_calls_total: m.tool_calls_total,
    tool_errors: m.tool_errors,
    compaction_events: m.compactions,
    duration_seconds: m.duration.seconds,
    models: m.models,
  };
}

function printSummary(cmp) {
  const rows = [
    ['metric', 'control', 'test', 'delta'],
    ['turns (Stop)', cmp.totals.control.turns ?? 'n/a', cmp.totals.test.turns ?? 'n/a', fmt(cmp.deltas_test_vs_control.turns_pct)],
    ['stops total', cmp.totals.control.stops_total ?? 'n/a', cmp.totals.test.stops_total ?? 'n/a', ''],
    ['api calls', cmp.pillars.control.api_calls, cmp.pillars.test.api_calls, fmt(cmp.pillars.deltas_test_vs_control.api_calls_pct)],
    ['unique tokens', cmp.pillars.control.unique_tokens, cmp.pillars.test.unique_tokens, fmt(cmp.pillars.deltas_test_vs_control.unique_tokens_pct)],
    ['cost (list $)', cmp.cost.control.usd ?? 'n/a', cmp.cost.test.usd ?? 'n/a', fmt(cmp.cost.delta_pct)],
    ['input tokens', cmp.totals.control.combined.tokens.input, cmp.totals.test.combined.tokens.input, fmt(cmp.deltas_test_vs_control.input_tokens_pct)],
    ['output tokens', cmp.totals.control.combined.tokens.output, cmp.totals.test.combined.tokens.output, fmt(cmp.deltas_test_vs_control.output_tokens_pct)],
    ['cache read', cmp.totals.control.combined.tokens.cache_read, cmp.totals.test.combined.tokens.cache_read, fmt(cmp.deltas_test_vs_control.cache_read_pct)],
    ['cache creation', cmp.totals.control.combined.tokens.cache_creation, cmp.totals.test.combined.tokens.cache_creation, fmt(cmp.deltas_test_vs_control.cache_creation_pct)],
    ['tool calls', cmp.totals.control.combined.tool_calls_total, cmp.totals.test.combined.tool_calls_total, fmt(cmp.deltas_test_vs_control.tool_calls_pct)],
    ['tool errors', cmp.totals.control.tool_errors, cmp.totals.test.tool_errors, String(cmp.deltas_test_vs_control.tool_errors)],
    ['duration (s)', cmp.totals.control.duration_seconds, cmp.totals.test.duration_seconds, fmt(cmp.deltas_test_vs_control.duration_seconds_pct)],
    ['user turns', cmp.bias_indicators.user_turns.control, cmp.bias_indicators.user_turns.test, String(cmp.bias_indicators.user_turn_asymmetry)],
    ['user chars', cmp.bias_indicators.user_chars.control, cmp.bias_indicators.user_chars.test, String(cmp.bias_indicators.user_chars_asymmetry)],
    ['compactions', cmp.bias_indicators.compactions.control, cmp.bias_indicators.compactions.test, ''],
  ];
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  for (const r of rows) {
    console.log(r.map((cell, i) => String(cell).padEnd(widths[i] + 2)).join(''));
  }
  if (cmp.parity_flags.length > 0) {
    console.log('\nPARITY FLAGS:');
    for (const f of cmp.parity_flags) console.log(`  ! ${f}`);
  }

  console.log(`\nToken attribution (table above = ${cmp.deltas_test_vs_control.basis}):`);
  for (const arm of ARMS) {
    const s = cmp.totals[arm];
    const sub = s.subagents || { count: 0, agents: [], dispatches_in_transcript: 0, unaccounted_dispatches: 0 };
    console.log(
      `  ${arm}: arm session ${s.tokens.output} out / ${s.tokens.cache_read} cache-read` +
        `  +  ${sub.count} subagent session(s)`,
    );
    for (const a of sub.agents) {
      console.log(
        `      ${a.agent_type || 'agent'} (depth ${a.spawn_depth ?? '?'}): ` +
          `${a.tokens.output} out / ${a.tokens.cache_read} cache-read / ${a.tool_calls_total} tools` +
          `${a.description ? ` — ${a.description}` : ''}`,
      );
    }
    if (sub.unaccounted_dispatches > 0) {
      console.log(`      ! ${sub.unaccounted_dispatches} dispatch(es) with no transcript — UNMEASURED`);
    }
    const ho = s.harness_overhead;
    if (ho && (ho.checker_sessions > 0 || ho.other_sessions > 0)) {
      console.log(
        `      [harness, excluded] ${ho.checker_sessions} dod-lite checker session(s)` +
          `${ho.other_sessions ? ` + ${ho.other_sessions} other` : ''}: ` +
          `${ho.tokens.output} out / ${ho.tokens.cache_read} cache-read`,
      );
    }
  }

  console.log(`\nTurns: ${cmp.turn_counts.note}`);
  console.log(`\nDoD: ${cmp.dod_tracking.note}`);
  for (const arm of ['control', 'test']) {
    const s = cmp.dod_tracking[arm];
    console.log(s ? `  ${arm}: ${s.pass}/${s.total} pass, ${s.fail} fail, ${s.pending} pending, ${s.error} error, ${s.waived} waived` : `  ${arm}: no tracker found`);
    const stale = cmp.dod_tracking.stale_verdicts?.[arm] || [];
    for (const st of stale) console.log(`    ! STALE: ${st.id} — ${st.reason}`);
  }
  console.log('\nTranscript digests (READ BOTH before explaining any delta):');
  for (const arm of ['control', 'test']) {
    const d = cmp.digests?.[arm];
    if (!d) { console.log(`  ${arm}: none`); continue; }
    const plugins = Object.keys(d.attribution?.plugins || {});
    console.log(`  ${arm}: ${d.path}`);
    console.log(`    ${d.jsonl_lines} JSONL lines | ${d.counts.user_real} user turns | ${d.counts.tool_calls} tool calls | ${d.counts.tool_errors} errors | plugins: ${plugins.length ? plugins.join(', ') : 'NONE'}`);
  }

  const ungraded = ['control', 'test'].map((a) => cmp.dod_tracking[a]?.ungraded || 0);
  if (ungraded.some((n) => n > 0)) {
    console.log('  ! ungraded checks present (pending/error) — those dimensions produced NO data this run; treat as a harness defect, not a result.');
  }
}

function fmt(p) {
  if (p === null || p === undefined) return 'n/a';
  return `${p > 0 ? '+' : ''}${p}%`;
}

function main() {
  const runDir = process.argv[2];
  if (!runDir) fail('usage: node compare-runs.mjs <runDir>');
  const cmp = compareRun(path.resolve(runDir));
  printSummary(cmp);
  console.log(`\n[optimizer] full comparison: ${path.join(path.resolve(runDir), 'analysis', 'comparison.json')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
