---
description: >-
  Hand the validated direction to the Optimizer: write .ab-bench/<mandate>/mandate.md and
  quality-rubric.md directly from the design package, so /optimizer:understand confirms rather
  than re-interviewing the user on six categories they already answered. Auto-trigger when the
  user says: "hand this to the optimizer", "it's ready for A/B testing", "let's optimise it now",
  "we know what we're building", "/prospector:handoff".
argument-hint: ""
---

# Prospector: hand off to the Optimizer

## 0. Check this is actually ready

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" detect "<cwd>"
```

Handing off early is the expensive mistake here: the Optimizer will make the execution of a
wrong idea extremely efficient, and every run it burns will be measuring the wrong thing.

Refuse to proceed unless all of these exist, and say which one is missing if not:

- a problem statement supported by recorded evidence, not by the opening conversation;
- prioritised desired outcomes;
- measurable success criteria;
- known constraints;
- clear scope and **explicit non-goals**;
- a chosen solution direction;
- the known unresolved risks, stated rather than buried;
- a `blueprint.md`, and every core stated need either covered by a shipped version or deferred
  with a reason.

At least one hypothesis should have been tested through real MVP use and resolved. An engagement
with everything still `open` has produced a plan, not a validated direction.

**Say the still-deferred needs out loud before handing off.** They are about to become invisible:
the Optimizer measures how well the plugin does what it does, and has no way to notice a thing it
was never built to do. A need deferred at v1 and forgotten at handoff is a need that gets
efficiently executed out of existence — and the user, three months and eight A/B runs later, will
ask what happened to it. Read the list, and let them promote any of it into scope before the
mandate freezes.

## 1. Why this writes mandate.md itself

`/optimizer:understand` interviews seven categories. A finished engagement already establishes
six of them:

| understand category | comes from |
|---|---|
| 1 Domain / environment | user & stakeholder model |
| 2 Capability gap | problem statement + current alternatives and their failure modes |
| 3 Target user & workflow | user & stakeholder model |
| 4 Definition of a good outcome | needs & desired outcomes + measurable success criteria |
| 5 Non-goals | constraints & non-goals |
| 6 **Appropriate task complexity** | **nothing** — it is about A/B signal strength, not the problem |
| 7 Known weak spots | ranked hypotheses + unresolved risks |

Without this step the user gets asked, one at a time, for everything they just spent an entire
engagement answering. Category 6 is genuinely new and is deliberately left for `understand`.

## 2. Build the payload from the package — not from memory

Read `packages/vN/package.md` and quote it. Write a temp JSON file:

```json
{
  "domain": "<concrete world this operates in — a tool, a format, a codebase. Not 'productivity'>",
  "capability_gap": "<what Claude Code specifically cannot do well WITHOUT this. Name the actual friction, not a feature list>",
  "target_user": "<who, and their workflow before vs after>",
  "good_outcome": "<observable signal, stated so two people grading the same output would agree>",
  "non_goals": "<what it explicitly does not claim to help with>",
  "weak_spots": "<what is already suspected fragile — from unresolved risks and refuted hypotheses>",
  "rubric": [
    { "dimension": "<name>", "weight": 0.4,
      "evidence_sources": "<what a grader must open to score this>",
      "anchors": ["0 — <observable state>", "1 — ...", "2 — ...", "3 — ...", "4 — <what excellent concretely looks like>"] }
  ]
}
```

Rubric rules, enforced or checked:
- **weights must sum to 1** — the CLI rejects the handoff otherwise. If everything matters
  equally, the rubric says nothing.
- **3–6 dimensions.** More and nobody scores consistently.
- **Anchors must be observable, not evaluative.** "Handles errors well" is unscoreable; "every
  failure path names the file and the fix" is scoreable.
- **Level 4 is the destination.** If you cannot write it concretely, the good-outcome definition
  is still too vague — go back rather than writing filler.

## 3. Write it

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" handoff "<cwd>" --payload "<tmp>/handoff.json"
```

This writes `.ab-bench/<mandate-id>/mandate.md` and `quality-rubric.md` into this same directory.
It deliberately writes **no** `state.json` and **no** `env.json` — those need `experiments_root`,
which is the Optimizer's own userConfig and none of Prospector's business.

It refuses to overwrite an existing `mandate.md`. If one is there, a live experiment is already
anchored to it and every past run was planned and analysed against it; silently replacing it
would retroactively change what those runs were measured against. Use `--force` only deliberately,
or run `/optimizer:init` and choose "new mandate" if the purpose genuinely changed.

## 4. Tell them what happens next

```
Run /optimizer:init here.
```

`understand` will show the mandate Prospector wrote, ask only for **appropriate task
complexity**, and let them correct anything that reads wrong. From there the Optimizer takes
over: it makes the execution of this direction efficient, and it must never redefine the problem
— if it finds a contradiction or a missing requirement, it sends the work back here.

End your reply with this line, verbatim, on its own, below the next step, with nothing added
around it:

```
Feedback on plugin-rnd-lab, mostly clicks: https://docs.google.com/forms/d/e/1FAIpQLSfINKyrAFuydl9SC-wNGceL_I-04cWqy7BkeQf0IJSwOKxFfg/viewform
```

Record the transition and commit:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" decision "<cwd>" \
    --text "Handed off to the Optimizer at package vN" --why "<why the direction is settled enough>"
```
