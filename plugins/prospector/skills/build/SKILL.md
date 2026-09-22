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

## 0. If a package already exists, it has to have come back first

The CLI **refuses** to cut vN+1 while vN has no `mvp-*` evidence and no hypothesis resolved
against it. That is not a formality. Packages are a monotonic *evidence* sequence — each one cut
because use of the last one taught something — and skipping the middle turns them into numbered
guesses.

**The case this exists for: the user rejects vN the moment you hand it over.** The reflex is to
start building whatever they just named, immediately, and it is wrong twice. It throws away the
strongest signal the engagement has produced — *they could tell it was useless without running
it* — and it aims vN+1 at the last sentence they said rather than at the job. Building faster is
how you look responsive while learning nothing.

Do this instead, in order, and it takes one turn:

1. Record the rejection as evidence — `--source mvp-rejected`, their words verbatim.
2. Ask **what they expected to be able to do with it**. Their answer is the job statement §2's
   floor test needs, and you do not have it yet or vN would have passed.
3. Resolve the hypothesis `--outcome not-testable` — it was never tested, and it keeps its rank.
4. Only then cut vN+1, passing `--unreviewed-reason "rejected on delivery, never used"`.

A rejection is a review. Run it as one.

Read `blueprint.md` first, then `problem-model.md`, the ranked hypotheses, and `framings.md`.

**No blueprint → go to `/prospector:design`.** Building without one is how the design gets sized
to the slice: the agent writing the spec is the agent about to implement it, and it will write a
spec its MVP happens to satisfy.

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

## 1. Write the package — TRANSCRIBED from the blueprint, not composed here

The package is the readable artifact the user reacts to: a snapshot of the design at the moment
vN was cut, frozen, so later versions can be compared against what was believed at the time.

**Sections 3 and 10 are transcriptions.** Section 3 comes from `needs.json`, section 10 from the
blueprint's build order. You are not deciding them here — deciding them here, in the same turn as
the MVP, is the defect `/prospector:design` exists to prevent. If writing them makes you want to
change the design, stop and go change the design.

Write `packages/vN/package.md` with:

1. **Defined problem statement** — evidence-based, citing `E-NNN`.
2. **User and stakeholder model** — who, in what context, why.
3. **Needs and desired outcomes** — **every need in `needs.json`, by id**, ordered by importance
   AND by confidence, separately. A high-importance/low-confidence need is the most valuable thing
   on the page. Mark each `stated` / `observed` / `inferred` / `prior-art` — the user should be
   able to see at a glance which of these they said and which you supplied.
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
    **coverage**: which of the needs in (3) vN addresses, and which it deliberately does not,
    with the deferral reason. Every need in (3) appears in one list or the other, no exceptions.
    This is the section that answers *"we talked for two hours — where did it all go?"*. A need
    named as uncovered is a decision the user can argue with; a need left off the page is a leak
    they can only notice by its absence, days later, while trying to use the thing.

    The lists come from `needs list` — `status: covered` and `status: deferred`. Transcribe them;
    the CLI has already refused the cut if anything core was in neither. Historically this section
    was airtight and worthless, because (3) was authored thirty seconds earlier by the agent about
    to build: a small (3) made coverage complete by construction. It is load-bearing now only
    because its denominator was accumulated during the interview and lives outside this skill.

## 2. Build the MVP — narrow in DEPTH, never in BREADTH or USEFULNESS

It goes at the **repo root**, not inside `.prospector/`: `.claude-plugin/plugin.json`, `skills/`,
and whatever else it needs. `.prospector/` is the engagement's record; the root is the product.

Three constraints. Miss any and vN is wrong.

**Floor — it must do the user's job.** Not describe the job, not interview them about the job,
not emit a document *about* the job. Do the job, badly. They came to `/prospector:start` because
work they care about comes out wrong; vN has to be a thing they can point at that work and run.

**Breadth — it must span everything they asked for.** Every need in `needs.json` marked `core`
that the user actually stated is either touched by vN or explicitly deferred with a reason they
can read. Not "the most important one, properly". All of them, roughly.

**Ceiling — shallow, not narrow.** Cut depth, polish, generality, edge-case handling, and
configurability, in that order. Cut the *hard* half of each need before you cut a need entirely.
An MVP at full depth on everything tests six things at once and teaches nothing when disliked —
but the cure for that is a rough version of the whole job, not a finished version of a sixth of it.

### Why breadth is a hard constraint and not a preference

The failure this exists for, verbatim from the operator:

> *"if i say 'i find it difficult to do A and to do B' and the agent produces a MVP that tackles
> only a fraction of what ONLY A is."*

An earlier version of this section said *"only enough of the job to expose the chosen hypothesis"*.
That is a correct instinct about depth and a disastrous one about breadth, and it read as a licence
to pick one need and go. Combined with §0's rank-1 hypothesis, the agent was being told twice to
narrow and never told what it was not allowed to drop.

Consider it from the user's side. They spent two hours answering questions. Every answer was an
investment in being understood. A version that addresses one sixth of what they said does not read
as "a focused first step" — it reads as not having listened, and it teaches them that the interview
was theatre. **Breadth is what makes the interview honest.** Depth is what makes it cheap.

There is a second, colder reason. A vN that touches every core need generates evidence about every
core need — including "I never used the part for B", which you cannot learn from a version that
never shipped a part for B. Narrow-and-deep buys one datum per version; shallow-and-wide buys the
whole map, roughly drawn.

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

### The breadth test — run it against the list, not against your memory

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" needs list "<cwd>"
```

For every id in `blocking_a_cut`, one of two things, explicitly:

```bash
# vN does something for it, however crudely
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" needs cover "<cwd>" --id N-002

# vN deliberately does not, and here is why
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" needs defer "<cwd>" --id N-002 \
    --reason "<why not this version — something the user can disagree with>"
```

`/prospector:build` **cannot cut a package** while any of them is unaccounted for, and there is no
flag that skips it. **Deferring is the override** — a better one, because it names which need is
being dropped instead of waving at the set, and the reason lands in the frozen changelog where the
user can argue with it forever.

Three rules about deferring, because the gate is only as good as the reasons:

- **Defer for a reason about the WORK, not about the schedule.** "Needs the A pipeline working
  first" is a reason. "Out of scope for v1" is the absence of one.
- **Never defer everything except one.** If that is genuinely right, the design is wrong: go back
  to `/prospector:design` rather than deferring your way to the old defect.
- **Say the deferrals out loud when you hand over.** A deferral the user reads is a decision they
  can overturn; one they find in a changelog later is a thing that was done to them.

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

**On the first build only (package v1)**, end your reply with this line, verbatim, on its own,
after the install commands and the sentence above, with nothing added around it:

```
Feedback on plugin-rnd-lab, mostly clicks: https://docs.google.com/forms/d/e/1FAIpQLSfINKyrAFuydl9SC-wNGceL_I-04cWqy7BkeQf0IJSwOKxFfg/viewform
```

A first MVP in their hands is as far as many people take Prospector, and the form is how its
author learns what the interview, survey, framing and design stages were like. Never on v2 or
later: `/prospector:handoff` carries it once more at the end.

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" stage "<cwd>" --to review
```

Commit — package cut and MVP build are one checkpoint.
