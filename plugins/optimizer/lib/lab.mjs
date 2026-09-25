/**
 * lab.mjs — the run-over-run layer: what we believe, what we tested, what moved.
 *
 * WHY THIS EXISTS. An A/B run measures a DELTA BETWEEN TWO ARMS, not a level. Every run
 * uses a different task, a different baseline and a different check set, so run-005's
 * "+8%" and run-006's "+3%" are not two points on one curve — they are two unrelated
 * measurements that happen to share a unit. Formatting ledger.md more prettily cannot fix
 * that; the missing thing is a frame in which runs are comparable at all.
 *
 * Two structures supply it:
 *
 *   1. HYPOTHESES are the unit of continuity. A hypothesis says which pillars should move
 *      and by roughly how much, a run tests it, and analyze resolves it against what
 *      actually happened. Progress is the resolved set, not a line on a chart.
 *
 *   2. REGRESSION POINTS are the only absolute measurements. A frozen canonical task,
 *      re-run periodically against the same rubric version, gives one point per re-run on
 *      all five pillars. Because the task is identical, those points ARE comparable — they
 *      are the actual curve, and they are the only thing that should ever be plotted.
 *
 * Steepest descent needs a gradient, but the five pillars trade against each other, so
 * there is deliberately NO aggregate score here: collapsing them into one number hides the
 * exact trade you want to see, and once a number exists the process optimises the number.
 * Instead one pillar is the declared PRIORITY and the other four carry regression GUARDS.
 */

import fs from 'node:fs';
import path from 'node:path';

export const PILLARS = ['quality', 'unique_tokens', 'api_calls', 'turns', 'autonomy'];

/** Which way is an improvement. Quality is the only pillar you want to go up. */
export const BETTER_DIRECTION = {
  quality: 'up',
  unique_tokens: 'down',
  api_calls: 'down',
  turns: 'down',
  autonomy: 'down', // fewer elective HITL interruptions
};

/**
 * Replaced in 0.9.0. `input_tokens` summed cache reads, cache writes and uncached input,
 * which differ up to 40x in price, so a run could look worse on it while costing less.
 * An objective still naming one of these resolves nothing until it is re-declared.
 */
export const RETIRED_PILLARS = {
  input_tokens: 'api_calls (cache reads scale with calls) and unique_tokens (cache writes + uncached input)',
  output_tokens: 'unique_tokens (output + cache writes + uncached input)',
};

export const OUTCOMES = ['confirmed', 'won-at-a-cost', 'refuted', 'inconclusive'];
export const OPEN_STATUSES = ['open', 'testing'];

export function labDir(testenvRoot) {
  return path.join(testenvRoot, 'lab');
}

function labFile(testenvRoot, name) {
  return path.join(labDir(testenvRoot), name);
}

function readJson(p, fallback) {
  if (!fs.existsSync(p)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    throw new Error(`${p} is not valid JSON: ${err.message}`);
  }
}

function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`);
}

// ---------------------------------------------------------------- objective

export function defaultObjective() {
  return {
    schema: 1,
    priority: null,
    guards: {},
    declared_at: null,
    rationale: null,
    prior_priorities: [],
  };
}

export function readObjective(testenvRoot) {
  return readJson(labFile(testenvRoot, 'objective.json'), defaultObjective());
}

/**
 * Declare (or change) the pillar being optimised. The previous priority is retired into
 * `prior_priorities` rather than overwritten — the sequence of shifts, and what forced
 * each one, is the spine of the written account this all feeds.
 */
export function declarePriority(testenvRoot, { priority, guards, rationale, at = new Date().toISOString() }) {
  if (!PILLARS.includes(priority)) throw new Error(`unknown pillar "${priority}" — expected one of: ${PILLARS.join(', ')}`);
  const obj = readObjective(testenvRoot);
  if (obj.priority && obj.priority !== priority) {
    obj.prior_priorities.push({
      priority: obj.priority,
      declared_at: obj.declared_at,
      rationale: obj.rationale,
      retired_at: at,
    });
  }
  obj.priority = priority;
  obj.guards = guards && typeof guards === 'object' ? guards : obj.guards || {};
  for (const p of Object.keys(obj.guards)) if (!PILLARS.includes(p)) delete obj.guards[p]; // retired pillars
  for (const p of PILLARS) {
    if (p === priority) continue;
    if (!(p in obj.guards)) obj.guards[p] = { max_regression_pct: 10 };
  }
  delete obj.guards[priority]; // you cannot guard the thing you are deliberately moving
  obj.declared_at = at;
  obj.rationale = rationale || null;
  writeJson(labFile(testenvRoot, 'objective.json'), obj);
  return obj;
}

// ---------------------------------------------------------------- hypotheses

export function readHypotheses(testenvRoot) {
  return readJson(labFile(testenvRoot, 'hypotheses.json'), { schema: 1, hypotheses: [] });
}

function saveHypotheses(testenvRoot, doc) {
  writeJson(labFile(testenvRoot, 'hypotheses.json'), doc);
  return doc;
}

export function nextHypothesisId(doc) {
  const nums = (doc.hypotheses || [])
    .map((h) => Number(String(h.id).replace(/^H-?/i, '')))
    .filter((n) => Number.isFinite(n));
  return `H-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')}`;
}

export function addHypothesis(testenvRoot, h) {
  const doc = readHypotheses(testenvRoot);
  for (const p of h.target_pillars || []) {
    if (!PILLARS.includes(p)) throw new Error(`hypothesis targets unknown pillar "${p}"`);
  }
  if (!h.statement || !String(h.statement).trim()) throw new Error('a hypothesis needs a statement');
  if (!(h.target_pillars || []).length) throw new Error('a hypothesis must name at least one target pillar — an untargeted hypothesis cannot be ranked or resolved');
  const entry = {
    id: h.id || nextHypothesisId(doc),
    statement: String(h.statement).trim(),
    rationale: h.rationale || null,
    target_pillars: h.target_pillars,
    predicted_direction: h.predicted_direction || 'improve',
    predicted_magnitude_pct: Number.isFinite(h.predicted_magnitude_pct) ? h.predicted_magnitude_pct : 10,
    confidence: Number.isFinite(h.confidence) ? Math.min(1, Math.max(0, h.confidence)) : 0.5,
    est_cost: Number.isFinite(h.est_cost) ? Math.max(1, h.est_cost) : 1,
    status: 'open',
    created_at: h.created_at || new Date().toISOString(),
    origin_run: h.origin_run || null,
    resolving_run: null,
    resolved_at: null,
    outcome: null,
    outcome_note: null,
    evidence_refs: [],
  };
  doc.hypotheses.push(entry);
  saveHypotheses(testenvRoot, doc);
  return entry;
}

/**
 * Steepest descent: expected movement on the DECLARED priority pillar, weighted by how
 * much we believe it, divided by what it costs to find out.
 *
 * A hypothesis that does not target the current priority is not ranked against ones that
 * do — it is still listed, but below, because testing it cannot move the thing we said
 * matters most right now.
 */
export function rankHypotheses(testenvRoot, objective = null) {
  const obj = objective || readObjective(testenvRoot);
  const doc = readHypotheses(testenvRoot);
  const open = (doc.hypotheses || []).filter((h) => OPEN_STATUSES.includes(h.status));
  const scored = open.map((h) => {
    const onPriority = Boolean(obj.priority) && h.target_pillars.includes(obj.priority);
    const score = (h.predicted_magnitude_pct * h.confidence) / h.est_cost;
    return { ...h, on_priority: onPriority, score: Math.round(score * 100) / 100 };
  });
  scored.sort((a, b) => {
    if (a.on_priority !== b.on_priority) return a.on_priority ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    return a.id.localeCompare(b.id);
  });
  return { objective: obj, ranked: scored };
}

/**
 * Did the priority move, and did anything else break while it did?
 *
 * `deltas` is a map of pillar -> percent change of test vs control, already signed so that
 * a negative number means "test used less" — which is an improvement everywhere except
 * quality. Guard breaches do not turn a win into a loss; they turn it into a `won-at-a-cost`,
 * which is a different and more useful thing to record than either.
 */
export function classifyOutcome({ objective, deltas, contaminated = false }) {
  if (contaminated) return { outcome: 'inconclusive', breaches: [], why: 'run flagged contaminated or underpowered — it cannot resolve anything' };
  const priority = objective.priority;
  if (!priority) return { outcome: 'inconclusive', breaches: [], why: 'no priority pillar declared, so there is nothing to have moved' };
  if (RETIRED_PILLARS[priority]) {
    return {
      outcome: 'inconclusive',
      breaches: [],
      why: `the declared priority "${priority}" was retired in optimizer 0.9.0; it is now measured as ${RETIRED_PILLARS[priority]}. Re-declare with lab-cli.mjs objective --priority <pillar>.`,
    };
  }

  const d = deltas[priority];
  if (d === null || d === undefined) {
    return { outcome: 'inconclusive', breaches: [], why: `the priority pillar (${priority}) was not measured this run` };
  }
  const improved = BETTER_DIRECTION[priority] === 'up' ? d > 0 : d < 0;

  const breaches = [];
  for (const [pillar, guard] of Object.entries(objective.guards || {})) {
    const gd = deltas[pillar];
    if (gd === null || gd === undefined) continue;
    const regression = BETTER_DIRECTION[pillar] === 'up' ? -gd : gd;
    const limit = Number.isFinite(guard?.max_regression_pct) ? guard.max_regression_pct : 10;
    if (regression > limit) breaches.push({ pillar, regression_pct: gd, limit_pct: limit });
  }

  if (!improved) {
    return { outcome: 'refuted', breaches, why: `${priority} did not move in the predicted direction (${d}%)` };
  }
  if (breaches.length > 0) {
    return {
      outcome: 'won-at-a-cost',
      breaches,
      why: `${priority} improved (${d}%) but ${breaches.map((b) => `${b.pillar} regressed ${b.regression_pct}% past its ${b.limit_pct}% guard`).join('; ')}`,
    };
  }
  return { outcome: 'confirmed', breaches, why: `${priority} improved (${d}%) with every guard held` };
}

export function resolveHypothesis(testenvRoot, id, { run, outcome, note, evidence_refs = [], at = new Date().toISOString() }) {
  if (!OUTCOMES.includes(outcome)) throw new Error(`unknown outcome "${outcome}" — expected one of: ${OUTCOMES.join(', ')}`);
  const doc = readHypotheses(testenvRoot);
  const h = (doc.hypotheses || []).find((x) => x.id === id);
  if (!h) throw new Error(`no hypothesis "${id}" in lab/hypotheses.json`);
  h.status = outcome;
  h.outcome = outcome;
  h.outcome_note = note || null;
  h.resolving_run = run || null;
  h.resolved_at = at;
  h.evidence_refs = evidence_refs;
  saveHypotheses(testenvRoot, doc);
  return h;
}

// ---------------------------------------------------------------- findings

/**
 * Append-only, and every line carries the run that earned it. A finding with no citation
 * is an opinion, and opinions are what this whole apparatus exists to replace.
 */
export function appendFinding(testenvRoot, { text, run, hypothesis = null, at = new Date().toISOString() }) {
  if (!text || !String(text).trim()) throw new Error('a finding needs text');
  if (!run) throw new Error('a finding must cite the run that produced it');
  const p = labFile(testenvRoot, 'findings.md');
  if (!fs.existsSync(p)) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(
      p,
      '# Findings\n\nConfirmed knowledge about the subject under test. Append-only; every line cites the run that earned it.\n\n',
    );
  }
  const line = `- ${String(text).trim()} — \`${run}\`${hypothesis ? ` (${hypothesis})` : ''}, ${at.slice(0, 10)}\n`;
  fs.appendFileSync(p, line);
  return line;
}

// ---------------------------------------------------------------- regressions

export function regressionsPath(testenvRoot) {
  return labFile(testenvRoot, path.join('regressions', 'points.json'));
}

export function readRegressions(testenvRoot) {
  return readJson(regressionsPath(testenvRoot), { schema: 1, task: null, points: [] });
}

/**
 * One absolute point on all five pillars, from the frozen canonical task.
 *
 * `rubric_version` is recorded because a rubric change FORKS the curve: quality scores
 * either side of a bump are not on the same scale, and plotting them as one line would
 * invent a trend. Consumers must group by it rather than assume continuity.
 */
/**
 * `kind` separates the two things a point can be:
 *   'frozen'  — the frozen regression task, run again. Comparable to other 'frozen' points
 *               and the only sequence that is a true like-for-like curve.
 *   'run'     — an ordinary run, whose task differs from every other run's.
 *
 * Both are recorded. Only recording 'frozen' points is why consultant reached run-007 with
 * an empty regressions/ dir and no way to answer "has the priority pillar ever moved?" — a
 * programme can miss its own target eight times running if nothing accumulates per-run
 * numbers. Ordinary points are not a curve and must never be plotted as one; they are the
 * per-run record that makes the question answerable at all.
 */
export function recordRegressionPoint(testenvRoot, { run, at = new Date().toISOString(), rubric_version = null, kind = 'frozen', arms }) {
  const doc = readRegressions(testenvRoot);
  doc.points = doc.points.filter((p) => p.run !== run); // re-analysing a run replaces its point
  doc.points.push({ run, at, rubric_version, kind, arms });
  doc.points.sort((a, b) => String(a.run).localeCompare(String(b.run)));
  writeJson(regressionsPath(testenvRoot), doc);
  return doc;
}

/**
 * Regression points grouped into contiguous same-rubric series. Each series is plottable;
 * across series is not. Pass `{ kind: 'frozen' }` for the true like-for-like curve — mixing
 * ordinary runs into it compares different tasks and means nothing.
 */
export function regressionSeries(testenvRoot, { kind = null } = {}) {
  const { points } = readRegressions(testenvRoot);
  const selected = kind ? points.filter((p) => (p.kind ?? 'frozen') === kind) : points;
  const series = [];
  for (const p of selected) {
    const last = series[series.length - 1];
    if (last && last.rubric_version === p.rubric_version) last.points.push(p);
    else series.push({ rubric_version: p.rubric_version, points: [p] });
  }
  return series;
}

// ---------------------------------------------------------------- scaffold

export function ensureLab(testenvRoot) {
  fs.mkdirSync(path.join(labDir(testenvRoot), 'regressions'), { recursive: true });
  const objPath = labFile(testenvRoot, 'objective.json');
  if (!fs.existsSync(objPath)) writeJson(objPath, defaultObjective());
  const hypPath = labFile(testenvRoot, 'hypotheses.json');
  if (!fs.existsSync(hypPath)) writeJson(hypPath, { schema: 1, hypotheses: [] });
  return labDir(testenvRoot);
}
