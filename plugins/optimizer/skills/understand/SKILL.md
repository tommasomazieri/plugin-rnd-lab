---
description: >-
  Interview the user to map out WHAT the plugin under test is actually FOR — its domain,
  the capability gap it fills, the target user's workflow, what a good outcome looks like,
  explicit non-goals, appropriate task complexity, and known weak spots — then write
  mandate.md, the north-star doc that /optimizer:plan cross-checks every task.md and DoD
  criterion against. Run from the plugin-under-test's repo (or a subdirectory of it) — no
  argument needed, resolved from .ab-bench/state.json. MANDATORY: /optimizer:init always
  invokes this immediately after scaffolding a fresh mandate (fresh init, or its "new
  mandate" branch). Also invocable standalone at any time — "the plugin's scope changed",
  "update the mandate", "re-run understand", "what is this plugin even for" — to refresh
  the CURRENT mandate.md in place. One mandate.md is shared by every env underneath it;
  it is never duplicated per env, and a genuine scope change (a NEW mandate version) is
  decided at /optimizer:init time, not here.
argument-hint: ""
---

# optimizer: understand the plugin under test

This produces the ONE artifact every later planning/analysis step anchors to: without it,
`/optimizer:plan` designs tasks and DoD checks on ad hoc judgement in the moment, which risks
tasks irrelevant to what the plugin does, or miscalibrated complexity (too trivial = no
signal, too complex = confounds unrelated to the plugin).

## 0. Figure out which mode you're in

- **Called by `/optimizer:init` right after it scaffolds a fresh mandate** (fresh init, or
  its "new mandate" branch): init already collected the plugin dirs, control compensation,
  and common config this same session, and already ran `ab-bench-scaffold.mjs` to create
  the target `mandate.md` path. Use that context directly — do NOT re-ask "which plugin" or
  "what does control get."

  **First, check whether `mandate.md` already exists at that path.** `create-fresh` only
  mkdirs and writes `state.json`; it never writes a mandate. So a file being there means
  something else authored it — in practice `/prospector:handoff`, which writes
  `.ab-bench/<mandate-id>/mandate.md` and `quality-rubric.md` directly from a finished
  discovery engagement.

  - **It exists → IMPORT MODE. Do not run the interview.** Six of the seven categories below
    were established over an entire engagement backed by recorded evidence and real MVP use;
    re-asking them would make the user answer, one at a time, everything they just spent that
    engagement answering. Instead:
    1. Show them the mandate as written, section by section.
    2. Ask ONLY for **§6 Appropriate task complexity**. It is deliberately left as
       `_NOT ESTABLISHED_` because it is about A/B signal strength, not about the problem —
       nothing in a discovery engagement answers it, so Prospector does not guess. Interview
       for it as described in section 2.6 and replace that placeholder.
    3. Ask whether anything else reads wrong, and correct only what they flag.
    4. If `quality-rubric.md` is present, show it too and skip section 3b — Prospector derived
       it from the same ranked outcomes. Only author one if it is missing.

    Do not "improve" imported sections unprompted. They are anchored to cited evidence you
    cannot see, and rewriting them from a shorter conversation loses that grounding.

  - **It does not exist** → go straight to the interview in section 2 and write to the path
    init handed you.

- **Invoked standalone**: resolve the repo root and current state by running (reuses
  init's scaffold script — no duplicated resolution logic):
  ```
  node "${CLAUDE_SKILL_DIR}/../init/scripts/ab-bench-scaffold.mjs" find-repo-root "<cwd>"
  node "${CLAUDE_SKILL_DIR}/../init/scripts/ab-bench-scaffold.mjs" detect "<repoRoot>" "${user_config.experiments_root}"
  ```
  - `{"status":"fresh"}` → no experiment here at all. Tell the user to run `/optimizer:init`
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
      - New version → do NOT create it here. Tell the user to run `/optimizer:init` and pick
        "new mandate" — that flow scaffolds the new mandate id AND its required first env,
        then calls this skill back automatically with the right target. Creating a bare
        mandate bump from inside this skill would leave it without an env, an inconsistent
        state `/optimizer:plan` can't work from. Stop here.

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

Write in prose, specific enough that `/optimizer:plan` can quote a line from this file as the
justification for a task or a DoD criterion. Vague filler ("helps the user be more
productive") defeats the entire point — push back on vague answers during the interview
rather than writing them down as-is.

This file lives at `.ab-bench/<mandate-id>/mandate.md` in the plugin repo — never inside
`seed/`, never cloned into either arm's workspace (that would break `task.md`'s plugin-blind
requirement), and shared by every env under this same mandate. It is read only by
main-session skills (`plan`, `analyze`), never by an arm session.

## 3b. Write `quality-rubric.md` — turn "good" into something scoreable

`mandate.md` says what good looks like in prose. Prose cannot be compared across runs, and
"quality" is the pillar the whole programme is ultimately steering on — so the vague version
has to be made concrete exactly once, here, and then held still.

Derive the rubric from the mandate's **Definition of a good outcome** and **Known weak
spots**. Write `.ab-bench/<mandate-id>/quality-rubric.md`:

```markdown
# <plugin> — quality rubric (rubric_version: v1)

## <dimension name>   weight: 0.4
evidence_sources: <what a grader must open to score this — files, outputs, artifacts>

- 0 — <observable state, phrased so two people would agree it applies>
- 1 — ...
- 2 — ...
- 3 — ...
- 4 — <what excellent actually looks like, concretely>
```

Rules that make it usable:

- **Anchors must be observable, not evaluative.** "Handles errors well" is unscoreable.
  "Every failure path returns a message naming the file and the fix" is scoreable.
- **Weights sum to 1.** If everything matters equally, the rubric isn't saying anything.
- **3–6 dimensions.** More than that and nobody scores it consistently.
- **Level 4 is the destination.** This is the answer to "what should good look like" —
  if you can't write level 4 concretely, the mandate is still too vague; go back and
  interview for it rather than writing filler.

Bumping `rubric_version` later **forks the trajectory**: quality scores either side of the
bump are on different scales and are never plotted as one curve. That is fine and expected
as understanding improves — but say so when you do it, because it costs comparability with
everything measured before.

### 3b-ii. If a rubric already exists — amend it, do not silently rewrite it

A rubric authored once and never revisited is a snapshot, and the experiment moves underneath
it. consultant is the worked example: runs 002/003/004 were three re-skins of one archetype,
005 changed the archetype outright, 006 stepped the difficulty tier, 007 changed archetype
again. A v1 written before run-001 would have been describing a different deliverable by 005.
`/optimizer:analyze` records `rubric_version` per score and `/optimizer:paper` reports where
the trajectory forks — so the pipeline has a reader and a versioning convention, and until now
had **no writer**. Nothing ever bumped the version.

When `quality-rubric.md` is already present at the target path:

1. **Show it to the user in full** and ask the one question that matters: *does this still
   describe what a good outcome looks like, given what the last few runs actually produced?*
2. Then classify what they want, and say which you are doing:
   - **No change** — the rubric still fits. Say so and move on. This is a legitimate and
     common answer; do not manufacture edits to look busy.
   - **Clarification** — the dimensions and weights are right, but an anchor was ambiguous
     and two graders could have disagreed. Edit the wording in place and **keep the version**.
     Scores stay comparable because the scale did not move.
   - **Scale change** — a dimension added or removed, a weight changed, or an anchor moved to
     a different level. **Bump `rubric_version`** (`v1` → `v2`) and rewrite the file.
3. On a bump, write a `## Changelog` section at the bottom of the rubric — one entry per
   version, naming what changed, why, and the run after which it changed:

   ```markdown
   ## Changelog
   - **v2** (after run-007) — split "structure" into "structure" and "narrative flow";
     the status-pack archetype made them independently bad in a way v1 scored as one number.
   ```
4. Tell the user, plainly, what the bump costs: *"quality scores from run-001 to run-007 are
   on v1 and scores from run-008 on are on v2; they are two curves, and `/optimizer:paper`
   will show the fork rather than a single line."* A bump is the right call often enough — it
   just must never be an accident.

**Never bump the version for a wording fix, and never edit anchors in place for a scale
change.** The first throws away comparability that was still valid; the second silently
invalidates every past score while the version number claims they are comparable, which is
strictly worse than having no rubric at all — a wrong rubric gets plotted anyway.

## 4. Confirm

Tell the user: `mandate.md + quality-rubric.md written (<mandate-id>).` If this was mid-init,
continue init's own closing message. If standalone, remind them: existing runs' task.md/DoD
aren't retroactively changed — this shapes the NEXT `/optimizer:plan`. If you bumped
`rubric_version`, say explicitly that past quality scores are no longer on the same scale.
