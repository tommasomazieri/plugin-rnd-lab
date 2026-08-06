---
description: >-
  Cut design package vN and build the paired MVP plugin vN that tests the highest-value
  hypothesis in the user's real workflow, then get it installed so they can actually use it.
  Auto-trigger when the user says: "build the MVP", "make me something to try", "cut a package",
  "let's test this", "ship a version", "/prospector:build".
argument-hint: ""
---

# Prospector: cut a package and build the MVP

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" detect "<cwd>"
```

Read `problem-model.md`, the ranked hypotheses, and `framings.md` first.

**The hypothesis is not the spec. The job is the spec.** Confirm two separate things with the
user before writing a line: what work vN does *for them*, and which hypothesis you will be
watching while they do that work. The job sets the scope; the hypothesis sets what you instrument
inside it. Build the hypothesis alone and you ship a probe — an artifact aimed at your question
instead of at their work.

`/prospector:frame` §5 ranks by expected learning, which puts the hypothesis you know LEAST about
at the top. Correct for choosing what to find out; wrong as a build order, because maximum
uncertainty is usually maximum distance from anything the user would run daily. Take the
top-ranked hypothesis **that a job-doing vN can carry**, and record in `package.md` why you
passed over any above it.

## 1. Design the package

The package is the readable artifact the user reacts to. Write `packages/vN/package.md` with:

1. **Defined problem statement** — evidence-based, citing `E-NNN`.
2. **User and stakeholder model** — who, in what context, why.
3. **Needs and desired outcomes** — ordered by importance AND by confidence, separately. A
   high-importance/low-confidence need is the most valuable thing on the page.
4. **Constraints and non-goals** — what the solution must respect, and what it deliberately
   does not attempt. Non-goals are as load-bearing as needs.
5. **Current alternatives and failure modes** — what they do today and precisely why it is
   insufficient. "Nothing" is almost never the true answer; find the workaround.
6. **Opportunity areas** — the promising directions, without crowning one.
7. **Ranked hypotheses** — with evidence, uncertainty, and recommended validation.
8. **Recommended next experiment** — the smallest step that reduces the biggest uncertainty.
9. **Handoff readiness** — one of: more discovery · validation · concept design ·
   implementation · ready for the Optimizer.
10. **MVP plugin** — what vN actually does, the single hypothesis it is instrumented for, and
    **coverage**: which of the needs in (3) vN addresses, and which it deliberately does not.
    Every need in (3) appears in one list or the other, no exceptions. This is the section that
    answers *"we talked for two hours — where did it all go?"*. A need named as uncovered is a
    decision the user can argue with; a need left off the page is a leak they can only notice
    by its absence, days later, while trying to use the thing.

## 2. Build the MVP — narrow in SCOPE, never in USEFULNESS

It goes at the **repo root**, not inside `.prospector/`: `.claude-plugin/plugin.json`, `skills/`,
and whatever else it needs. `.prospector/` is the engagement's record; the root is the product.

Two constraints. Miss either and vN is wrong.

**Floor — it must do the user's job.** Not describe the job, not interview them about the job,
not emit a document *about* the job. Do the job, badly. They came to `/prospector:start` because
work they care about comes out wrong; vN has to be a thing they can point at that work and run.

**Ceiling — only enough of the job to expose the chosen hypothesis.** An MVP covering the full
imagined product tests the framing and five other things at once, and when they dislike it you
will not know which part failed.

**"Thinnest thing that produces a signal" is not the rule**, and taking it as the rule has a
degenerate optimum — the thinnest thing that produces a signal is a *question*, and a question
shipped as a plugin is not an MVP. The rule is **the thinnest thing that does the job**.

### The floor test — all four, before writing a line

1. **Can they run it repeatedly, on different real work?** A thing that is run once and answered
   has no second day. No → it is a probe.
2. **If they quietly stopped using it on day two, would that show?** `/prospector:review` §1
   calls abandonment the strongest signal the engagement gets. An artifact that cannot be
   abandoned cannot produce one.
3. **Does it output the thing they came for, or a description of that thing?** A document about
   the work is the interview wearing a trenchcoat.
4. **Afterwards, do they still do the whole job by hand?** Then vN bought nothing, and the
   annoyance you measure in review is the annoyance of using vN — not of the original problem.

Any "no" means you designed a probe. **Ask that question in this session instead** — it is free
and it is now — and build vN against a hypothesis a working artifact can carry.

**Set `plugin.json`'s version to `N.0.0` matching package vN.** Package vN and MVP vN are one
event and one number, so "which version were you using?" always has an answer.

## 3. Cut the package

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" package "<cwd>" \
    --changed "<what changed since the previous package>" \
    --why "<why it changed>" \
    --evidence "<the evidence that triggered it — E-NNN>" \
    --unresolved "<assumptions still open>" \
    --confidence "<up | down | unchanged, and in what>"
```

`packages/vN/` is **frozen** once cut. Later learning goes into `vN+1`, never back into a
shipped package — a record that gets edited after the fact cannot show how understanding moved.

## 4. Get it into their real workflow

An MVP nobody installs produces no evidence. It must run in the user's own projects, over real
work, for days — not in a demo.

On first build, write a single-plugin `.claude-plugin/marketplace.json` at the repo root, then:

```bash
claude plugin marketplace add "<cwd>"
claude plugin install <mvp-name>
```

On every later build, they bump to the new version:

```bash
claude plugin update <mvp-name>
```

Installed plugins are **copied into the plugin cache**, so each installed version is an immutable
snapshot rather than a live view of this directory. That is what makes feedback attributable: "v2
was worse than v1" means something because v2 cannot have changed underneath them.

Tell them plainly: **use it for real, and notice when it annoys you.** Then come back to
`/prospector:review`.

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" stage "<cwd>" --to review
```

Commit — package cut and MVP build are one checkpoint.
