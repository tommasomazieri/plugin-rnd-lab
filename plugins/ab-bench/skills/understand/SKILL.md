---
description: >-
  Interview the user to map out WHAT the plugin under test is actually FOR — its domain,
  the capability gap it fills, the target user's workflow, what a good outcome looks like,
  explicit non-goals, appropriate task complexity, and known weak spots — then write
  `<experiment>/mandate.md`, the north-star doc that /ab-bench:plan cross-checks every
  task.md and DoD criterion against. MANDATORY: /ab-bench:init always invokes this
  immediately after scaffolding a fresh experiment (reusing context init already collected —
  do not re-ask what init already knows). Also invocable standalone at any time — "the
  plugin's scope changed", "update the mandate", "re-run understand", "what is this plugin
  even for" — to refresh mandate.md on an EXISTING experiment without bumping its version
  (mandate.md is metadata, not an arm-config delta, so editing it anytime is safe). Full
  re-interview each invocation, no partial patching.
argument-hint: "[experiment-name]"
---

# ab-bench: understand the plugin under test

This produces the ONE artifact every later planning/analysis step anchors to: without it,
`/ab-bench:plan` designs tasks and DoD checks on ad hoc judgement in the moment, which risks
tasks irrelevant to what the plugin does, or miscalibrated complexity (too trivial = no
signal, too complex = confounds unrelated to the plugin).

## 0. Figure out which mode you're in

- **Called by `/ab-bench:init` right after it scaffolds a fresh experiment**: init already
  collected the plugin path/ref, control compensation, common config, and (if given) the
  plugin-under-test's repo path this same session. Use that context directly — do NOT re-ask
  "which plugin" or "what does control get." Go straight to the interview in section 2.
- **Invoked standalone** (`/ab-bench:understand <experiment-name>`, no experiment name → ask):
  read `<experiment>/env.json` for the plugin path/ref, control compensation, and repo path.
  If `<experiment>/mandate.md` already exists, show it to the user first ("here's the current
  mandate — re-interviewing to refresh it") so they know what's being replaced, then proceed
  to a full re-interview — never patch individual sections, the categories are interdependent
  enough that a partial edit risks internal inconsistency.

If neither init's context nor an experiment's `env.json` resolves which plugin this is about,
stop and ask which experiment (or run `/ab-bench:init` first if none exists yet).

## 1. Ground rule for this interview

These are open judgement calls only the user can answer — not closed-option choices. Ask
conversationally, one question at a time, same rigor as `/grill-me`: if an answer is vague or
could cut multiple ways, push back and narrow it before moving to the next category. Don't
rubber-stamp a one-line answer into a whole section if it's actually underspecified.

## 2. The seven categories

Work through these in order — later ones build on earlier answers:

1. **Domain / environment** — what world does the plugin operate in? (e.g. Blender, LinkedIn,
   a specific codebase/language, a CLI, a document format). Concrete, not "productivity."
2. **Capability gap** — what can Claude Code specifically NOT do well WITHOUT this plugin?
   Name the actual friction (missing tool access, missing domain knowledge, missing workflow
   scaffolding) — not a restatement of the plugin's feature list.
3. **Target user & workflow** — who uses this, and what does their workflow look like before
   vs. after the plugin exists? If the user IS the target user, ask them to narrate their own
   before/after.
4. **Definition of a good outcome** — a concrete, observable signal that "this worked," stated
   so specifically that two different people grading the same output would agree on the verdict.
5. **Non-goals** — what the plugin explicitly does NOT claim to help with. This matters as much
   as the capability gap: it keeps later tasks from testing territory the plugin was never
   meant to cover.
6. **Appropriate task complexity** — where's the sweet spot? Too trivial and neither arm shows
   a difference (no signal); too complex and failures come from unrelated confounds, not the
   plugin. Ask for a concrete example of a task that would be "about right."
7. **Known weak spots** — anything the user/plugin author already suspects is fragile or
   undertested, worth deliberately stress-testing rather than avoiding.

## 3. Write `<experiment>/mandate.md`

Overwrite in full (never partial-patch — see section 0):

```markdown
# <experiment-name> — plugin mandate
Plugin under test: <ref/path> | Repo: <repo path, or "n/a"> | Last updated: <ISO date>

## Domain / environment
...

## Capability gap
...

## Target user & workflow
...

## Definition of a good outcome
...

## Non-goals (explicitly out of scope)
...

## Appropriate task complexity
...

## Known weak spots to stress-test
...
```

Write in prose, specific enough that `/ab-bench:plan` can quote a line from this file as the
justification for a task or a DoD criterion. Vague filler ("helps the user be more
productive") defeats the entire point — push back on vague answers during the interview
rather than writing them down as-is.

This file lives at the experiment ROOT, never inside `seed/` — it must never be cloned into
either arm's workspace (that would break `task.md`'s plugin-blind requirement). It is read
only by main-session skills (`plan`, `analyze`), never by an arm session.

## 4. Confirm

Tell the user: `mandate.md written for <experiment-name>.` If this was mid-init, continue
init's own closing message. If standalone, remind them: existing runs' task.md/DoD aren't
retroactively changed — this shapes the NEXT `/ab-bench:plan`.
