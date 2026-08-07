# Prospector

The discovery-stage counterpart to the **Optimizer**.

The Optimizer starts from an already-defined plugin and makes its execution efficient. It assumes
the right problem has already been chosen. Prospector starts one step earlier, from ambiguity,
and decides what is worth solving at all.

> Prospect first. Then refine.

| | Prospector | Optimizer |
|---|---|---|
| starts from | a situation, frustration, or hunch | a defined artifact |
| optimises for | **effectiveness** — the right problem | **efficiency** — the right execution |
| primary evidence | the user's real use of narrow MVPs | paired A/B runs across five pillars |
| output | a validated direction + `mandate.md` | an evidence-backed improvement report |

## How it runs

**In place, in the directory the future plugin will live in.** Create an empty dir, launch Claude
Code inside it, and start. There is no experiments root, no path argument, no second root, and
nothing to cd into — Prospector never runs paired sessions, so it has no execution root to
separate. The user installs each MVP and uses it in their own real projects.

```
/prospector:start     record what they walked in with, verbatim; open the inquiry
/prospector:survey    does this already exist? — three verdicts, one of them ends the engagement
/prospector:frame     competing framings → adopt one → ranked hypotheses
/prospector:design    blueprint.md — the WHOLE plugin, before anything is built
/prospector:build     cut package vN + build MVP plugin vN, shallow on purpose
/prospector:review    turn real use into evidence; resolve or refute
/prospector:handoff   write mandate.md + quality-rubric.md for the Optimizer
/prospector:reenter   after an Optimizer cycle: what's still missing, what's next
/prospector:status    where the engagement stands, read-only
```

It is a **loop**, not a pipeline:

```
start → survey → frame → design → build → review ─┐
                            ↑                     │
                            └─────────────────────┘
                                    │
                                 handoff → /optimizer:* → reenter → design → …
```

## Layout

```
<your dir>/                  git init'd by Prospector — not optional, see below
  .prospector/               TRACKED IN GIT
    state.json               stage, current framing, package version, blueprint sha
    problem-model.md         the living record; rewritten in place, meant to be read by you
    needs.json               N-NNN — what the user cannot do, each citing its evidence
    blueprint.md             LIVING — the whole-plugin design, revised every cycle
    framings.md              F1, F2 … append-only, each with the evidence that killed the last
    hypotheses.json          statement, assumption, validation, success/failure signals
    evidence/E-NNN.md        one observation per file, each with a status label
    decisions.md             append-only: what was decided and why
    packages/vN/             FROZEN at cut: package.md + changelog.md
  .ab-bench/                 appears at handoff; mandate.md pre-written by Prospector
  .claude-plugin/            the MVP itself, at the root
  skills/
```

**`.prospector/` is tracked, unlike the Optimizer's `.ab-bench/`.** That directory is gitignored
because its `state.json` holds absolute machine paths. Prospector stores none, so it inherits
none of the reason — and the record is the deliverable: git gives it a real version history,
diffs show how the framing moved, and it ships as provenance with the plugin it produced.

Git is therefore not optional. `/prospector:start` runs `git init` if needed. The Optimizer's
artifact pinning is built on git as well, so a non-repo directory could never be handed off.

## The rules that make it work

**Four layers arrive together, and only two of them are ever challenged.** The **medium** is a
Claude Code plugin — always, that is what invoking Prospector means, and it is never treated as
a proposed solution. The **symptom** ("my games come out bad") is accepted as fact: the user is
the sole authority on their own dissatisfaction. The **diagnosis** ("because Claude doesn't get
game feel") is a hypothesis, and testing it is what the engagement is for. The **prescription**
("so build me a tool that manages my tasks") is held loosest — a solution named before the
problem is known.

So "my output is bad and I don't know why" is the *strongest* possible opening, not a deficient
one — a clean symptom with no diagnosis welded on top. Disbelieve the explanation, never the
complaint, and never say any of this to the user: a person told their framing is wrong, and
handed no legal alternative, has nothing left to say.

**Behaviour over opinion.** "Tell me about the last time this happened" predicts far better than
"would you use this?". People report their own context and history well and predict their own
adoption badly.

**Uncertainty is labelled, always.** Every claim carries `confirmed`, `strongly-supported`,
`tentative`, `assumption`, `unknown`, or `contradicted`. An inference is never recorded as a
user-confirmed fact. When evidence is weak, what would strengthen or kill it gets written down.

**Hypotheses rank by expected learning, not by likelihood of success.** Confidence enters
inverted: a 50/50 hypothesis teaches the most, a 90% one teaches almost nothing. The point is to
find out, not to be right.

**The MVP is narrow in DEPTH, never in BREADTH.** Every core need the user actually stated is
either touched by `vN` or deferred with a written reason — and `cutPackage` refuses otherwise, with
no flag that skips it. Cut polish, generality, and edge cases; cut the hard half of each need
before cutting a need entirely. The failure this exists for: *"I said I find it difficult to do A
and to do B, and it produced an MVP that tackles a fraction of what only A is."*

Breadth is what makes the interview honest. The user spent two hours investing in being
understood; a version covering a sixth of it teaches them the interview was theatre. Depth is what
makes it cheap.

**The denominator is `needs.json`, and the agent that builds does not author it.** Needs are
recorded during the interview, each citing the evidence file it came from — the CLI refuses a
`stated` need with no `E-NNN`. Previously the coverage list and the need list were both written
inside `build`, in the same turn as the MVP, so a short need list made coverage complete by
construction. Needs the *agent* found (`inferred`, `prior-art`) are recorded honestly and never
gate a cut, because gating on them would restore exactly that.

**The design is written before the build, in its own skill.** `/prospector:design` produces
`blueprint.md` while there is nothing to be loyal to; `/prospector:build` reads it. An agent that
designs and implements in one turn writes a design its implementation happens to satisfy.

**Package `vN` ↔ MVP plugin `vN`.** One event, one number, so "which version were you using?"
always has an answer. Packages are frozen at cut; later learning goes into `vN+1`. `blueprint.md`
is the exception — it is living, and each package records its git sha at cut so "which design was
v2 built against" stays answerable.

**A negative prior-art result is `unknown`, never `confirmed`.** There is no plugin search API and
no aggregator; `/prospector:survey` reads a flat community marketplace, a demo directory, and the
open web. Absence of evidence recorded as evidence of absence is the same class of error as a
grader reporting `fail` when it could not open the artifact.

**A reframe does not fork the packages.** The MVP lives at the repo root and has one git history,
so it cannot fork — packages stay one monotonic sequence and each records the framing it served.
Evidence and decisions carry over untouched: they did not become wrong, the framing did.

## Handoff

`/optimizer:understand` interviews seven categories. A finished engagement already establishes
six of them, so Prospector writes `mandate.md` and `quality-rubric.md` directly and `understand`
asks only for **appropriate task complexity** — the one category that is about A/B signal
strength rather than about the problem, and which nothing in a discovery engagement answers.

The mechanism is a filesystem contract in the shared working directory, not a code dependency:
there is no supported way for one plugin to read another's install directory (`dependencies`
buys co-installation, not code access). Prospector writes plain files where the Optimizer
already looks, writes no `state.json` or `env.json`, and refuses to overwrite a mandate that a
live experiment is already anchored to.

## Coming back — the loop closes

`/prospector:reenter` is the return leg, and it is the same contract read in the other direction:
`.ab-bench/state.json` names `testenv_root`, and every `runs/*/analysis/report.md` under it is
evidence about how the shipped plugin actually behaved. `detect` reports `post-optimizer` once a
blueprint exists and at least one run has been analysed.

Re-entry ingests that evidence, diffs the shipped surface against the blueprint's build order,
re-interviews on real use, re-runs the prior-art survey, revises the blueprint, and ranks the next
slice **by value** — `needs rank`, uninverted. That last part matters: `hypothesis rank` inverts
confidence because it answers *what should we find out next*, which is right while the problem is
unknown and wrong on a plugin that already works.

`analysis/fix-list.md` is **not** re-entry's to execute. Its reader is the operator, by hand, in
the plugin's own repo. Re-entry reads it only to classify: an item meaning *"does the wrong
thing"* is a discovery finding, *"does the right thing slowly"* is handed back untouched. Mixing
efficiency fixes into `vN+1` makes the user's reaction unattributable.

The Optimizer holds up its half at `/optimizer:analyze` §7b: when the finding is that the plugin
is aimed at the wrong job rather than executing it badly, it says so and names `/prospector:reenter`.
It still never redefines the problem itself — but it is the instrument most likely to notice that
the problem needs redefining, and silence there is not neutrality.

## Learning it

`/core:learn prospector` walks the whole loop in plain language, `/core:learn chain` covers the
handoff to the Optimizer. This file is the internals reference; that one is the walkthrough.

## Tests

```bash
node --test plugins/prospector/test/*.test.mjs
```
