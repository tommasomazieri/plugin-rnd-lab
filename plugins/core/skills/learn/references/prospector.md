# Prospector — the discovery stage, stage by stage

Reference for `/core:learn prospector`. Walk this stage by stage; do not dump it whole.

## The one-paragraph mental model

You have a problem, not a spec. Prospector refuses to take your first *explanation* at face
value: "I need a tool that manages my tasks" is a solution, and the problem behind it is still
unknown. It interviews you for concrete past behaviour rather than opinions, keeps competing
problem framings alive instead of collapsing to the first one, labels every claim with its
actual confidence (`confirmed` … `assumption`), and builds deliberately narrow MVP plugins that
you install and use in your own real projects. **Your use of those MVPs — especially the parts
you quietly abandoned — is the evidence.** It runs in place, in the directory the future plugin
will live in.

## What you are allowed to walk in with

This is the part users get wrong, because the skill used to get it wrong too. An opening
message is a mix of up to four layers, and **only two of them are ever challenged**:

| layer | example | how Prospector treats it |
|---|---|---|
| **medium** | "a plugin" | **constant.** The deliverable is always a Claude Code plugin — that is what invoking Prospector means. Never questioned, never even remarked on. |
| **symptom** | "my games come out bad — flat pacing, samey levels, boring enemies" | **accepted as fact.** You are the sole authority on your own dissatisfaction. |
| **diagnosis** | "because Claude doesn't understand game feel" | **treated as a hypothesis.** This is what the engagement exists to test. |
| **prescription** | "so build me a tool that does X" | **held loosest.** A solution named before the problem is known. |

So the answer to *"what am I even supposed to tell it?"* is: **the symptom, in as much concrete
detail as you can, and nothing you do not actually know.** "My output is bad and I don't know
why" is the strongest possible opening — a clean symptom with no diagnosis welded on top of it,
which is exactly the raw material the engagement needs.

Prospector must never reply that you have given it a solution instead of a problem. That
disbelief is internal posture, not conversation — a user told their framing is wrong, and handed
no legal alternative, has nothing left to say. Naming the problem is the job they came here for.

## Where it runs

**In place, in the directory the future plugin will live in.** Create an empty dir, launch
Claude Code inside it, start. There is no experiments root, no path argument, no second root,
nothing to cd into — Prospector never runs paired sessions, so it has no execution root to
separate.

```
<your dir>/                  git init'd by Prospector — not optional
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

`.prospector/` is **tracked**, unlike Optimizer's gitignored `.ab-bench/`. That one is ignored
because its `state.json` holds absolute machine paths; Prospector stores none, so it inherits
none of the reason — and here the record *is* part of the deliverable: git gives it a real
version history, diffs show how the framing moved, and it ships as provenance with the plugin it
produced.

## Stage: start (`/prospector:start`)

Records what you walked in with, verbatim, `git init`s the directory, scaffolds `.prospector/`,
and opens the inquiry. Then it asks **one** question — not a questionnaire, not a list: the
single question with the most expected learning, then it waits.

Good questions challenge the biggest assumption in your own wording, distinguish two readings
that would lead to different products, or surface a stakeholder nobody mentioned. And they
**prefer behaviour over opinion**, because people report what they did far better than they
predict what they would adopt:

> "Tell me about the last time this happened." · "What did you do instead?" · "What did that
> cost you?" · "What have you already tried?" · "What made that workaround insufficient?"

Avoided: "Would you use X?" · "Do you like Y?" · "Would a feature that does Z be useful?"

Every substantive answer gets recorded as an evidence entry with a status label attached.

## Stage: frame (`/prospector:frame`)

Generates **two to four competing framings** from the recorded evidence — one framing is not a
choice, eight is a survey nobody engages with. They must genuinely compete: different target
user, different unmet need, or different mechanism, not three rewordings of one sentence. At
least one must contradict your own stated framing; if every candidate agrees with what you
walked in believing, nothing has been reframed, only paraphrased.

Each states target user, context, unmet need, desired outcome, supporting evidence by `E-NNN`
id, unresolved assumptions, and what would get built if it is the real problem.

Then you react bluntly. **"Partly, but this is missing" is the most informative answer** and
usually means a fifth framing is hiding between two of the drafted ones — it gets chased rather
than forced into a choice among what was already written.

The adopted framing converts into ranked hypotheses, each with a statement, the specific
assumption under test, why it matters, the lowest-cost validation, and explicit success AND
failure signals. **A hypothesis with no failure signal is unfalsifiable** and gets refused until
you can say what would change your mind.

Also the skill to re-run when new evidence invalidates the current framing. A reframe does not
fork the packages — evidence and decisions carry over untouched, because they did not become
wrong; the framing did.

## Stage: build (`/prospector:build`)

Cuts design package `vN` and builds the paired MVP plugin `vN` that tests the highest-value open
hypothesis, then gets it installed so you can actually use it. **Package `vN` ↔ MVP plugin
`vN`** — one event, one number, so "which version were you using?" always has an answer.
Packages freeze at cut; later learning goes into `vN+1`.

Narrow on purpose. The MVP is not a small version of the product; it is the cheapest object that
makes one hypothesis survive or die in real use.

## Stage: review (`/prospector:review`)

Turns your real use of an MVP into evidence. Interviews for behaviour, not opinion — what you
actually did, what you stopped doing, what you went back to doing by hand. **The parts you
quietly abandoned are the highest-signal data in the entire method**, because nobody reports
abandonment spontaneously. Resolves or refutes the hypothesis the MVP tested, updates the living
problem model, and decides the next move: another iteration, a reframe, or handoff.

## Stage: handoff (`/prospector:handoff`)

Writes `.ab-bench/<mandate>/mandate.md` and `quality-rubric.md` directly from the design package,
so Optimizer confirms rather than re-interviewing you on everything you just established. See
`chain.md` for how the receiving side treats them.

## Stage: status (`/prospector:status`)

Read-only. Stage, current framing, packages cut, open vs resolved hypotheses ranked by expected
learning, evidence count, and whether a handoff has been written.

## The rules that make it work

- **Uncertainty is labelled, always.** Every claim carries `confirmed`, `strongly-supported`,
  `tentative`, `assumption`, `unknown`, or `contradicted`. An inference is never recorded as a
  user-confirmed fact — that is how an engagement ends up confidently building the wrong thing.
  When evidence is weak, what would strengthen or kill it gets written down.
- **Behaviour over opinion**, at every stage, not just the first interview.
- **Hypotheses rank by expected learning, not likelihood of success.** Confidence enters
  *inverted*: a 50/50 hypothesis teaches the most, a 90% one teaches almost nothing. That is the
  opposite of picking the thing most likely to succeed, and it is deliberate — the point is to
  find out, not to be right.
- **Converge late.** Breadth is cheap at this stage and expensive later.
- **Endless discovery is a failure mode.** So is building on a framing nobody challenged. Each
  checkpoint ends with an explicit decision about which of the two risks is currently larger.
