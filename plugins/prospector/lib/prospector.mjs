// Prospector's on-disk model.
//
// Everything lives in `.prospector/` inside the dir the user is developing the future plugin
// in, and it is TRACKED IN GIT — unlike the Optimizer's `.ab-bench/`, which is gitignored only
// because its state.json holds absolute machine paths. Nothing here stores an absolute path, so
// the record is portable, diffable, and ships as provenance with the plugin it produced.
//
// The living files (problem-model.md, hypotheses.json, evidence/, decisions.md, framings.md)
// mutate in place. `packages/vN/` is frozen at cut and never rewritten.

import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import path from 'node:path';

export const DIR = '.prospector';
export const SCHEMA = 1;

export const STAGES = ['intake', 'inquiry', 'needs', 'framing', 'hypotheses', 'package', 'review'];

// idea.txt's confidence vocabulary. Kept as a closed set so "we think" can never quietly
// become "we know" between one session and the next.
export const STATUSES = ['confirmed', 'strongly-supported', 'tentative', 'assumption', 'unknown', 'contradicted'];

export const HYPOTHESIS_STATUSES = ['open', 'testing', 'resolved'];

// `not-testable` is about the MVP, not the user. It means vN could not carry the test at all —
// it was not usable enough on real work to produce evidence in either direction. Without it the
// only home for that case is `inconclusive`, which reads as "they did not use it enough" and
// puts a build defect on the user's tab. Same split dod-lite makes between a failing artifact
// and a grader that could not open it.
export const OUTCOMES = ['confirmed', 'partly-confirmed', 'refuted', 'inconclusive', 'not-testable'];

/** Walks up for `.prospector/state.json`, the same way git resolves `.git`. */
export function findRoot(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fsSync.existsSync(path.join(dir, DIR, 'state.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export const paths = (root) => ({
  root,
  dir: path.join(root, DIR),
  state: path.join(root, DIR, 'state.json'),
  model: path.join(root, DIR, 'problem-model.md'),
  framings: path.join(root, DIR, 'framings.md'),
  hypotheses: path.join(root, DIR, 'hypotheses.json'),
  decisions: path.join(root, DIR, 'decisions.md'),
  evidence: path.join(root, DIR, 'evidence'),
  packages: path.join(root, DIR, 'packages'),
});

const readJson = async (p, fallback) => {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch {
    return fallback;
  }
};

const writeJson = async (p, data) => {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
};

const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- state

export const defaultState = () => ({
  schema: SCHEMA,
  created: new Date().toISOString(),
  stage: 'intake',
  current_framing: null,
  package_version: 0,
  stated_issue: null,
});

export const readState = (root) => readJson(paths(root).state, null);
export const writeState = (root, state) => writeJson(paths(root).state, state);

export async function setStage(root, stage) {
  if (!STAGES.includes(stage)) throw new Error(`unknown stage "${stage}" (${STAGES.join(', ')})`);
  const state = await readState(root);
  state.stage = stage;
  await writeState(root, state);
  return state;
}

// ---------------------------------------------------------------- hypotheses

export const readHypotheses = (root) => readJson(paths(root).hypotheses, { schema: SCHEMA, hypotheses: [] });

export function nextId(items, prefix) {
  const n = items
    .map((h) => Number(String(h.id || '').replace(`${prefix}-`, '')))
    .filter(Number.isFinite)
    .reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}-${String(n + 1).padStart(3, '0')}`;
}

/**
 * Deliberately NOT the Optimizer's hypothesis shape. Its `lib/lab.mjs` entries carry
 * `target_pillars` from the five performance pillars and a `predicted_magnitude_pct`, both
 * meaningless for "users actually want X". Same idea, different semantics — the pattern is
 * copied, the code is not, because there is no supported way for one plugin to import
 * another's files anyway.
 */
export async function addHypothesis(root, fields) {
  const doc = await readHypotheses(root);
  const state = await readState(root);
  if (!fields.statement) throw new Error('a hypothesis needs a statement');
  const h = {
    id: nextId(doc.hypotheses, 'H'),
    statement: fields.statement,
    assumption: fields.assumption ?? null,
    why_it_matters: fields.why ?? null,
    expected_outcome: fields.expected ?? null,
    validation: fields.validation ?? null,
    success_signal: fields.success ?? null,
    failure_signal: fields.failure ?? null,
    confidence: fields.confidence ?? 0.5,
    status: 'open',
    outcome: null,
    outcome_note: null,
    framing: fields.framing ?? state?.current_framing ?? null,
    created_at: new Date().toISOString(),
    origin_package: `v${state?.package_version ?? 0}`,
    resolving_package: null,
    evidence_refs: [],
  };
  doc.hypotheses.push(h);
  await writeJson(paths(root).hypotheses, doc);
  return h;
}

export async function resolveHypothesis(root, id, outcome, note) {
  if (!OUTCOMES.includes(outcome)) throw new Error(`outcome must be one of ${OUTCOMES.join(', ')}`);
  const doc = await readHypotheses(root);
  const state = await readState(root);
  const h = doc.hypotheses.find((x) => x.id === id);
  if (!h) throw new Error(`no hypothesis ${id}`);
  // A hypothesis nothing could test is still an open question, so it stays OPEN and keeps its
  // place in the ranking. Retiring it would let a build defect quietly delete the very thing the
  // engagement least understands — and by rankHypotheses' inverted scoring, that is the one
  // sitting at the top.
  h.status = outcome === 'not-testable' ? 'open' : 'resolved';
  h.outcome = outcome;
  h.outcome_note = note ?? null;
  h.resolved_at = new Date().toISOString();
  h.resolving_package = `v${state?.package_version ?? 0}`;
  await writeJson(paths(root).hypotheses, doc);
  return h;
}

/**
 * Ranks open hypotheses by what they would teach per unit of effort.
 *
 * Confidence enters INVERTED on purpose: a hypothesis you are already 90% sure of teaches
 * almost nothing by being tested, and idea.txt's whole complaint is about confirming what was
 * assumed rather than finding out what is true. Highest expected learning first.
 */
export function rankHypotheses(doc) {
  return doc.hypotheses
    .filter((h) => h.status !== 'resolved')
    .map((h) => {
      const c = Math.min(Math.max(Number(h.confidence ?? 0.5), 0), 1);
      return { ...h, score: Number((1 - Math.abs(c - 0.5) * 2).toFixed(3)) };
    })
    .sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------- evidence

/**
 * Append-only. Each entry is one observation with a status label from STATUSES, so an
 * inference can never be silently promoted to a user-confirmed fact later.
 */
export async function addEvidence(root, fields) {
  if (!fields.text) throw new Error('evidence needs text');
  const status = fields.status ?? 'tentative';
  if (!STATUSES.includes(status)) throw new Error(`status must be one of ${STATUSES.join(', ')}`);
  const dir = paths(root).evidence;
  await fs.mkdir(dir, { recursive: true });
  const existing = (await fs.readdir(dir).catch(() => [])).filter((f) => f.endsWith('.md'));
  const id = nextId(existing.map((f) => ({ id: path.parse(f).name })), 'E');
  const state = await readState(root);
  const refs = fields.hypotheses ?? [];
  const body = `---
id: ${id}
status: ${status}
source: ${fields.source ?? 'user-interview'}
package: v${state?.package_version ?? 0}
hypotheses: ${refs.join(', ')}
recorded: ${today()}
---

${fields.text}
`;
  await fs.writeFile(path.join(dir, `${id}.md`), body, 'utf8');

  if (refs.length > 0) {
    const doc = await readHypotheses(root);
    for (const hid of refs) {
      const h = doc.hypotheses.find((x) => x.id === hid);
      if (h && !h.evidence_refs.includes(id)) h.evidence_refs.push(id);
    }
    await writeJson(paths(root).hypotheses, doc);
  }
  return { id, status };
}

// ---------------------------------------------------------------- append-only logs

async function appendSection(file, header, entry) {
  let existing = '';
  try {
    existing = await fs.readFile(file, 'utf8');
  } catch {
    existing = header;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${existing.trimEnd()}\n\n${entry.trim()}\n`, 'utf8');
}

/**
 * A reframe does NOT fork the packages. The MVP lives at the repo root and has one git
 * history, so package numbering stays monotonic and each package records which framing it
 * served. Evidence and decisions carry over untouched — they did not become wrong, the
 * framing did.
 */
export async function addFraming(root, { statement, killed_by, target, need, outcome }) {
  const state = await readState(root);
  const prior = (state.framings ?? []).length;
  const id = `F${prior + 1}`;
  await appendSection(
    paths(root).framings,
    '# Problem framings\n\nCompeting readings of what the real problem is. Append-only: a superseded framing stays, together with the evidence that killed it.\n',
    `## ${id} — ${statement}\n\n` +
      `- **Target:** ${target ?? '(unstated)'}\n` +
      `- **Unmet need:** ${need ?? '(unstated)'}\n` +
      `- **Desired outcome:** ${outcome ?? '(unstated)'}\n` +
      `- **Adopted:** ${today()}\n` +
      (killed_by ? `- **Supersedes ${state.current_framing}, killed by:** ${killed_by}\n` : ''),
  );
  state.framings = [...(state.framings ?? []), { id, statement, adopted: today() }];
  state.current_framing = id;
  await writeState(root, state);
  return { id };
}

export async function addDecision(root, { text, why }) {
  await appendSection(
    paths(root).decisions,
    '# Decision log\n\nWhat was decided, when, and why. Append-only.\n',
    `- **${today()}** — ${text}${why ? `\n  - **Why:** ${why}` : ''}`,
  );
}

// ---------------------------------------------------------------- packages

/**
 * Has package vN been put in front of the user and come back with something?
 *
 * Closed by either `mvp-*` evidence recorded while vN was current (`mvp-use` after real use,
 * `mvp-rejected` when they refused it on sight) or a hypothesis resolved against vN.
 */
export async function packageVerdict(root, v) {
  if (v < 1) return { closed: true, reason: 'no previous package' };
  const dir = paths(root).evidence;
  const files = (await fs.readdir(dir).catch(() => [])).filter((f) => f.endsWith('.md'));
  for (const f of files.sort()) {
    const head = (await fs.readFile(path.join(dir, f), 'utf8')).split('\n---')[0];
    if (/^source:\s*mvp-/m.test(head) && new RegExp(String.raw`^package:\s*v${v}\s*$`, 'm').test(head)) {
      return { closed: true, reason: `evidence ${path.parse(f).name}` };
    }
  }
  const resolved = (await readHypotheses(root)).hypotheses.find((h) => h.resolving_package === `v${v}`);
  return resolved ? { closed: true, reason: `${resolved.id} resolved` } : { closed: false, reason: null };
}

/**
 * Cuts package vN and returns its dir. Frozen once written.
 *
 * Package vN and MVP plugin vN are the same number by construction: Stage 6 of idea.txt cuts
 * a package and builds an MVP as one event, so they are one version, not two.
 *
 * Refuses to cut vN+1 while vN has never come back from the user. The packages are supposed to
 * be a monotonic EVIDENCE sequence — each one cut because use of the last one taught something.
 * Skip the middle and they become a sequence of guesses that merely happens to be numbered, and
 * the most likely reason to skip it is the worst one: the user disliked vN and the reflex is to
 * build more rather than to find out what they expected.
 */
export async function cutPackage(root, { changed, why, evidence, unresolved, confidence, unreviewed_reason }) {
  const state = await readState(root);
  const prev = state.package_version ?? 0;
  if (prev >= 1 && !unreviewed_reason) {
    const { closed } = await packageVerdict(root, prev);
    if (!closed) {
      throw new Error(
        `packages/v${prev} has never come back from the user — no mvp-* evidence recorded against it and no ` +
        `hypothesis resolved by it. Run /prospector:review before cutting v${prev + 1}. If v${prev} was rejected ` +
        `on sight and never used, that rejection IS the finding: record it (--source mvp-rejected), resolve its ` +
        `hypothesis --outcome not-testable, then re-run with --unreviewed-reason "<why this is legitimate>".`,
      );
    }
  }
  const v = prev + 1;
  const dir = path.join(paths(root).packages, `v${v}`);
  if (fsSync.existsSync(dir)) throw new Error(`packages/v${v} already exists — packages are frozen once cut`);
  await fs.mkdir(dir, { recursive: true });

  await fs.writeFile(
    path.join(dir, 'changelog.md'),
    `# v${v} — ${today()}\n\n` +
      `- **Framing:** ${state.current_framing ?? '(none)'}\n` +
      `- **What changed:** ${changed ?? '(first package)'}\n` +
      `- **Why it changed:** ${why ?? '(initial)'}\n` +
      `- **Evidence that triggered it:** ${evidence ?? '(none yet)'}\n` +
      `- **Still unresolved:** ${unresolved ?? '(none recorded)'}\n` +
      `- **Confidence moved:** ${confidence ?? 'unchanged'}\n` +
      (unreviewed_reason ? `- **Cut without reviewing v${prev}:** ${unreviewed_reason}\n` : ''),
    'utf8',
  );

  state.package_version = v;
  await writeState(root, state);
  return { version: v, dir };
}

export const packageDir = (root, v) => path.join(paths(root).packages, `v${v}`);

// ---------------------------------------------------------------- scaffold

const MODEL_TEMPLATE = (issue) => `# Living problem model

The single source of truth for this engagement. Updated whenever new information materially
changes the understanding — not appended to blindly, rewritten in place.

Every claim carries a status: \`confirmed\`, \`strongly-supported\`, \`tentative\`, \`assumption\`,
\`unknown\`, or \`contradicted\`. An inference is never written down as a user-confirmed fact.

## Stated issue

${issue ?? '(not yet captured)'}

> This is an entry point, not the problem definition. It stays here verbatim so later reframings
> can be checked against what was actually said.

## User context

## Stakeholders

## Observed symptoms

## Current workarounds and alternatives

## Pain points

## Needs

## Desired outcomes

## Functional requirements

## Emotional and social requirements

## Constraints

## Assumptions

## Evidence

See \`evidence/\` — one file per observation, each with a status label. Summarise the load-bearing
ones here; do not duplicate them.

## Open questions

## Candidate opportunity areas

## Non-goals

What this explicitly does NOT try to solve. As load-bearing as the needs.

## Confidence level

Overall: \`unknown\`
`;

export async function scaffold(root, { issue } = {}) {
  const p = paths(root);
  await fs.mkdir(p.evidence, { recursive: true });
  await fs.mkdir(p.packages, { recursive: true });

  if (!fsSync.existsSync(p.state)) {
    const state = defaultState();
    state.stated_issue = issue ?? null;
    await writeState(root, state);
  }
  if (!fsSync.existsSync(p.model)) await fs.writeFile(p.model, MODEL_TEMPLATE(issue), 'utf8');
  if (!fsSync.existsSync(p.hypotheses)) await writeJson(p.hypotheses, { schema: SCHEMA, hypotheses: [] });
  return p;
}
