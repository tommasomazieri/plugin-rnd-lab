---
description: >-
  Interview the user to map out WHAT the plugin under test is actually FOR — its domain,
  the capability gap it fills, the target user's workflow, what a good outcome looks like,
  explicit non-goals, appropriate task complexity, and known weak spots — then write
  mandate.md, the north-star doc that /ab-bench:plan cross-checks every task.md and DoD
  criterion against. Run from the plugin-under-test's repo (or a subdirectory of it) — no
  argument needed, resolved from .ab-bench/state.json. MANDATORY: /ab-bench:init always
  invokes this immediately after scaffolding a fresh mandate (fresh init, or its "new
  mandate" branch). Also invocable standalone at any time — "the plugin's scope changed",
  "update the mandate", "re-run understand", "what is this plugin even for" — to refresh
  the CURRENT mandate.md in place. One mandate.md is shared by every env underneath it;
  it is never duplicated per env, and a genuine scope change (a NEW mandate version) is
  decided at /ab-bench:init time, not here.
argument-hint: ""
---

# ab-bench: understand the plugin under test

This produces the ONE artifact every later planning/analysis step anchors to: without it,
`/ab-bench:plan` designs tasks and DoD checks on ad hoc judgement in the moment, which risks
tasks irrelevant to what the plugin does, or miscalibrated complexity (too trivial = no
signal, too complex = confounds unrelated to the plugin).

## 0. Figure out which mode you're in

- **Called by `/ab-bench:init` right after it scaffolds a fresh mandate** (fresh init, or
  its "new mandate" branch): init already collected the plugin dirs, control compensation,
  and common config this same session, and already ran `ab-bench-scaffold.mjs` to create
  the target `mandate.md` path. Use that context directly — do NOT re-ask "which plugin" or
  "what does control get." Go straight to the interview in section 2, write to the path
  init handed you.

- **Invoked standalone**: resolve the repo root and current state by running (reuses
  init's scaffold script — no duplicated resolution logic):
  ```
  node "${CLAUDE_SKILL_DIR}/../init/scripts/ab-bench-scaffold.mjs" find-repo-root "<cwd>"
  node "${CLAUDE_SKILL_DIR}/../init/scripts/ab-bench-scaffold.mjs" detect "<repoRoot>" "${user_config.experiments_root}"
  ```
  - `{"status":"fresh"}` → no experiment here at all. Tell the user to run `/ab-bench:init`
    first and stop.
  - `{"status":"existing", mandateFile, mandateExists, ...}`:
    - `mandateExists: false` → nothing to refresh (an interrupted init). Proceed straight to
      the interview in section 2 and write `mandateFile`.
    - `mandateExists: true` → show the user the current `mandate.md` first ("here's the
      current mandate — "), then ask ONE question before anything else: **is this a refresh
      of the current mandate (rewrite in place, same mandate id), or has the plugin's
      purpose actually changed enough to need a whole new mandate version (a new
      `mandate-N`, decoupled from every env under the current one)?**
      - Refresh in place → proceed to section 2, overwrite `mandateFile`.
      - New version → do NOT create it here. Tell the user to run `/ab-bench:init` and pick
        "new mandate" — that flow scaffolds the new mandate id AND its required first env,
        then calls this skill back automatically with the right target. Creating a bare
        mandate bump from inside this skill would leave it without an env, an inconsistent
        state `/ab-bench:plan` can't work from. Stop here.

If neither path resolves which plugin/mandate this is about, stop and ask.

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

## 3. Write `mandate.md`

Overwrite in full at the target path from section 0 (never partial-patch):

```markdown
# <plugin repo folder name> — plugin mandate (<mandate id, e.g. mandate-1>)
Plugin under test: <repoRoot> | Last updated: <ISO date>

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

This file lives at `.ab-bench/<mandate-id>/mandate.md` in the plugin repo — never inside
`seed/`, never cloned into either arm's workspace (that would break `task.md`'s plugin-blind
requirement), and shared by every env under this same mandate. It is read only by
main-session skills (`plan`, `analyze`), never by an arm session.

## 4. Confirm

Tell the user: `mandate.md written (<mandate-id>).` If this was mid-init, continue init's own
closing message. If standalone, remind them: existing runs' task.md/DoD aren't retroactively
changed — this shapes the NEXT `/ab-bench:plan`.
