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

export const STAGES = [
  'intake', 'inquiry', 'survey', 'needs', 'framing', 'hypotheses', 'design', 'package', 'review', 'reentry',
];

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

// ---------------------------------------------------------------- needs vocabulary
//
// `kind` is the whole point of the needs record, and it is about PROVENANCE, not importance.
//
// `stated` is the hard denominator: the user said it, in an interview, and there is an evidence
// file to prove it. Those are the needs a package must account for, because the failure this
// record exists to prevent is two hours of interview resolving to an MVP that addresses a
// fraction of one thing the user asked for. The agent does not get to shrink that list.
//
// `observed` is behaviour the agent watched rather than heard; treat it as nearly as strong.
// `inferred` and `prior-art` are the agent's own contribution — a workflow implication found by
// walking the job through end to end, or a capability an existing tool has that the user never
// thought to ask for. They are real, they belong in the design, and they NEVER gate a build:
// gating on them would let the agent manufacture its own denominator, which is the exact defect
// being fixed here.
export const NEED_KINDS = ['stated', 'observed', 'inferred', 'prior-art'];

export const NEED_IMPORTANCE = ['core', 'significant', 'peripheral'];

export const NEED_STATUSES = ['open', 'covered', 'deferred', 'withdrawn'];

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
  needs: path.join(root, DIR, 'needs.json'),
  blueprint: path.join(root, DIR, 'blueprint.md'),
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

// ---------------------------------------------------------------- needs
//
// THE DENOMINATOR.
//
// Before this record existed, the only list of what the user wanted was `package.md` section 3,
// written by the agent inside `/prospector:build` — in the same turn as the MVP, thirty seconds
// before section 10 claimed to cover it. Section 10's rule ("every need in (3) appears in one
// list or the other, no exceptions") was airtight and worthless, because (3) was whatever the
// agent had just decided to build. A small (3) makes coverage complete by construction.
//
// So the denominator is accumulated during the interview, as things surface, and the build reads
// it rather than writing it. `cutPackage` refuses while any `stated`/`core` need is still `open`.

export const readNeeds = (root) => readJson(paths(root).needs, { schema: SCHEMA, needs: [] });

/**
 * Records one thing the user cannot currently do.
 *
 * `evidence` is REQUIRED for every kind except `inferred` and `prior-art` — the same discipline
 * `addHypothesis` applies to a missing failure signal. A `stated` need with no evidence file
 * behind it is the agent putting words in the user's mouth, and since `stated` needs are what
 * gate a package cut, an invented one would let the agent write its own denominator after all.
 */
export async function addNeed(root, fields) {
  if (!fields.statement) throw new Error('a need needs a statement');

  const kind = fields.kind ?? 'stated';
  if (!NEED_KINDS.includes(kind)) throw new Error(`kind must be one of ${NEED_KINDS.join(', ')}`);

  const importance = fields.importance ?? 'significant';
  if (!NEED_IMPORTANCE.includes(importance)) {
    throw new Error(`importance must be one of ${NEED_IMPORTANCE.join(', ')}`);
  }

  const evidence = fields.evidence ?? [];
  const agentAuthored = kind === 'inferred' || kind === 'prior-art';
  if (!agentAuthored && evidence.length === 0) {
    throw new Error(
      `a "${kind}" need must cite the evidence it came from (--evidence E-NNN). If the user has not ` +
      'actually said this yet, either go ask them, or record it as --kind inferred — which is honest ' +
      'and still lands in the design, but deliberately does not gate a package cut.',
    );
  }

  const doc = await readNeeds(root);
  const state = await readState(root);
  const n = {
    id: nextId(doc.needs, 'N'),
    statement: fields.statement,
    verbatim: fields.verbatim ?? null,
    evidence,
    kind,
    importance,
    confidence: fields.confidence ?? 0.5,
    status: 'open',
    covered_by: null,
    deferred_reason: null,
    framing: fields.framing ?? state?.current_framing ?? null,
    created_at: new Date().toISOString(),
    origin_package: `v${state?.package_version ?? 0}`,
  };
  doc.needs.push(n);
  await writeJson(paths(root).needs, doc);
  return n;
}

/** Marks a need addressed by the package currently being cut (or by an explicit version). */
export async function coverNeed(root, id, version) {
  const doc = await readNeeds(root);
  const state = await readState(root);
  const n = doc.needs.find((x) => x.id === id);
  if (!n) throw new Error(`no need ${id}`);
  n.status = 'covered';
  n.covered_by = version ?? `v${(state?.package_version ?? 0) + 1}`;
  n.deferred_reason = null;
  await writeJson(paths(root).needs, doc);
  return n;
}

/**
 * Deliberately NOT covered by the next package, with a reason the user can argue with.
 *
 * A deferral is a decision, not a disposal: the need stays in the file, keeps its importance, and
 * `/prospector:reenter` reopens the deferred set when the next cycle starts. The reason is also
 * copied into the frozen changelog at cut, so it is visible in the record forever — the same
 * treatment `--unreviewed-reason` gets.
 */
export async function deferNeed(root, id, reason) {
  if (!reason) {
    throw new Error(
      `deferring ${id} requires a reason (--reason). An unexplained deferral is indistinguishable ` +
      'from having forgotten it, which is the thing this gate exists to catch.',
    );
  }
  const doc = await readNeeds(root);
  const n = doc.needs.find((x) => x.id === id);
  if (!n) throw new Error(`no need ${id}`);
  n.status = 'deferred';
  n.deferred_reason = reason;
  n.covered_by = null;
  await writeJson(paths(root).needs, doc);
  return n;
}

/** The user says it was never really a need. Only they can retire one; the agent may only defer. */
export async function withdrawNeed(root, id, reason) {
  const doc = await readNeeds(root);
  const n = doc.needs.find((x) => x.id === id);
  if (!n) throw new Error(`no need ${id}`);
  n.status = 'withdrawn';
  n.deferred_reason = reason ?? null;
  await writeJson(paths(root).needs, doc);
  return n;
}

/** Reopens a deferred need — what `/prospector:reenter` does at the start of a new cycle. */
export async function reopenNeed(root, id) {
  const doc = await readNeeds(root);
  const n = doc.needs.find((x) => x.id === id);
  if (!n) throw new Error(`no need ${id}`);
  n.status = 'open';
  n.covered_by = null;
  await writeJson(paths(root).needs, doc);
  return n;
}

const IMPORTANCE_WEIGHT = { core: 1, significant: 0.6, peripheral: 0.25 };
const KIND_WEIGHT = { stated: 1, observed: 0.9, inferred: 0.6, 'prior-art': 0.5 };

/**
 * Ranks open needs by VALUE — deliberately a different question from `rankHypotheses`.
 *
 * `rankHypotheses` inverts confidence, because it answers "what should we find out next" and a
 * 50/50 hypothesis teaches most. That is the right ranking while the problem is still unknown,
 * and `/prospector:frame` says so outright.
 *
 * It is the WRONG ranking for "what should we build next" on a plugin that already works, which
 * is exactly what `/prospector:reenter` is asked for. Inverted confidence would aim v3 at the
 * least-understood thing on the page. So value ranks by importance and provenance, and confidence
 * enters the normal way round: a need you are sure about is worth MORE, not less.
 */
export function rankNeeds(doc) {
  return doc.needs
    .filter((n) => n.status === 'open' || n.status === 'deferred')
    .map((n) => {
      const c = Math.min(Math.max(Number(n.confidence ?? 0.5), 0), 1);
      const score = (IMPORTANCE_WEIGHT[n.importance] ?? 0.5) * (KIND_WEIGHT[n.kind] ?? 0.5) * c;
      return { ...n, score: Number(score.toFixed(3)) };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * The needs a package cut must account for: said by the user, marked core, still open.
 *
 * Scoped to `core` on purpose. Requiring every `peripheral` need to be individually dispositioned
 * before any package could be cut would turn the gate into paperwork, and a gate that is annoying
 * enough gets routed around with `--defer-all` reasoning that means nothing. Core is the set the
 * user would notice missing.
 */
export function blockingNeeds(doc) {
  return doc.needs.filter(
    (n) => (n.kind === 'stated' || n.kind === 'observed') && n.importance === 'core' && n.status === 'open',
  );
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
 * The git sha of blueprint.md at the moment a package was cut.
 *
 * blueprint.md is LIVING — it is revised every cycle, unlike `packages/vN/` which freezes. So a
 * frozen package that merely says "built from the blueprint" ages into a claim nobody can check.
 * The sha makes "which design was v2 actually built against" answerable with `git show`.
 *
 * Best-effort: returns null for an uncommitted blueprint rather than blocking the cut. Refusing
 * here would make the record's completeness depend on the user's commit timing, which is not a
 * design property.
 */
async function blueprintSha(root) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  try {
    const { stdout } = await promisify(execFile)('git', ['rev-parse', `HEAD:${DIR}/blueprint.md`], { cwd: root });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Cuts package vN and returns its dir. Frozen once written.
 *
 * Package vN and MVP plugin vN are the same number by construction: Stage 6 of idea.txt cuts
 * a package and builds an MVP as one event, so they are one version, not two.
 *
 * TWO refusals guard a cut, and they check different things.
 *
 * 1. Has the LAST package come back? The packages are a monotonic EVIDENCE sequence — each one
 *    cut because use of the last one taught something. Skip the middle and they become a
 *    sequence of guesses that merely happens to be numbered, and the most likely reason to skip
 *    it is the worst one: the user disliked vN and the reflex is to build more rather than to
 *    find out what they expected.
 *
 * 2. Does the NEXT package account for everything the user asked for? This is the breadth gate.
 *    It exists because an engagement once ran a two-hour interview and shipped an MVP covering a
 *    fraction of one of the several things the user had named. Every `core` need they stated is
 *    either covered or deferred with a written reason — never simply absent. Note the asymmetry
 *    with (1): that one is overridable with `--unreviewed-reason`, this one is NOT. Deferring is
 *    already the escape hatch, and it is a better one, because it names WHICH need is being
 *    dropped instead of waving at the set.
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

  const needsDoc = await readNeeds(root);
  const blocking = blockingNeeds(needsDoc);
  if (blocking.length > 0) {
    const list = blocking.map((n) => `  ${n.id}  ${n.statement}`).join('\n');
    throw new Error(
      `${blocking.length} core need(s) the user stated are neither covered by this package nor deferred:\n\n` +
      `${list}\n\n` +
      'They asked for these. A package that silently omits them is the defect this gate exists for — two ' +
      'hours of interview resolving to an MVP that addresses a fraction of one of the things they named. ' +
      'For each: either build something for it and run `needs cover <id>`, or run ' +
      '`needs defer <id> --reason "<why not this version>"`. A deferral is legitimate and lands in the ' +
      'frozen changelog where the user can argue with it; an omission is invisible until they go looking ' +
      'for the feature days later. There is no flag that skips this — deferring IS the override.',
    );
  }

  const deferred = needsDoc.needs.filter((n) => n.status === 'deferred');
  const sha = await blueprintSha(root);
  const v = prev + 1;
  const dir = path.join(paths(root).packages, `v${v}`);
  if (fsSync.existsSync(dir)) throw new Error(`packages/v${v} already exists — packages are frozen once cut`);
  await fs.mkdir(dir, { recursive: true });

  await fs.writeFile(
    path.join(dir, 'changelog.md'),
    `# v${v} — ${today()}\n\n` +
      `- **Framing:** ${state.current_framing ?? '(none)'}\n` +
      `- **Blueprint:** ${sha ?? '(uncommitted at cut)'}\n` +
      `- **What changed:** ${changed ?? '(first package)'}\n` +
      `- **Why it changed:** ${why ?? '(initial)'}\n` +
      `- **Evidence that triggered it:** ${evidence ?? '(none yet)'}\n` +
      `- **Still unresolved:** ${unresolved ?? '(none recorded)'}\n` +
      `- **Confidence moved:** ${confidence ?? 'unchanged'}\n` +
      (unreviewed_reason ? `- **Cut without reviewing v${prev}:** ${unreviewed_reason}\n` : '') +
      // Deferrals go in the FROZEN record, not just in needs.json, because needs.json is living:
      // a need deferred at v2 and covered at v3 would leave no trace that v2 ever skipped it.
      // The user reading back "why didn't v2 do X" gets an answer that cannot be edited later.
      (deferred.length > 0
        ? `\n## Deliberately not covered by v${v}\n\n` +
          deferred
            .map((n) => `- **${n.id}** ${n.statement}\n  - **Why not this version:** ${n.deferred_reason}`)
            .join('\n') +
          '\n'
        : ''),
    'utf8',
  );

  state.package_version = v;
  state.blueprint_sha = sha;
  await writeState(root, state);
  return { version: v, dir, blueprint_sha: sha, deferred: deferred.map((n) => n.id) };
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

Enumerated in \`needs.json\`, not here — \`N-NNN\` ids, each citing the evidence it came from. That
file is the denominator a package cut is checked against, so it has to be machine-readable. Use
this section for the shape of the need set (clusters, tensions between needs, which ones trade off
against each other) — the things a list of records cannot say.

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
  if (!fsSync.existsSync(p.needs)) await writeJson(p.needs, { schema: SCHEMA, needs: [] });
  return p;
}
