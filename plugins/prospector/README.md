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
/prospector:start     capture the stated issue without believing it; open the inquiry
/prospector:frame     competing framings → adopt one → ranked hypotheses
/prospector:build     cut package vN + build MVP plugin vN, narrow on purpose
/prospector:review    turn real use into evidence; resolve or refute
/prospector:handoff   write mandate.md + quality-rubric.md for the Optimizer
/prospector:status    where the engagement stands, read-only
```

## Layout

```
<your dir>/                  git init'd by Prospector — not optional, see below
  .prospector/               TRACKED IN GIT
    state.json               stage, current framing, package version
    problem-model.md         the living record; rewritten in place, meant to be read by you
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

**The stated issue is an entry point, not the problem.** "I need a tool that manages my tasks"
is a *solution*, and the problem behind it is still unknown. Prospector separates stated
solution, stated issue, observed symptoms, underlying need, and desired outcome, and never lets
the first collapse into the last.

**Behaviour over opinion.** "Tell me about the last time this happened" predicts far better than
"would you use this?". People report their own context and history well and predict their own
adoption badly.

**Uncertainty is labelled, always.** Every claim carries `confirmed`, `strongly-supported`,
`tentative`, `assumption`, `unknown`, or `contradicted`. An inference is never recorded as a
user-confirmed fact. When evidence is weak, what would strengthen or kill it gets written down.

**Hypotheses rank by expected learning, not by likelihood of success.** Confidence enters
inverted: a 50/50 hypothesis teaches the most, a 90% one teaches almost nothing. The point is to
find out, not to be right.

**Package `vN` ↔ MVP plugin `vN`.** One event, one number, so "which version were you using?"
always has an answer. Packages are frozen at cut; later learning goes into `vN+1`.

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

## Tests

```bash
node --test plugins/prospector/test/*.test.mjs
```
