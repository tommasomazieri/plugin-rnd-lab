---
description: >-
  Plan the next A/B run of an ab-bench experiment: write the task brief (task.md, the
  identical opening assignment both arms receive) and author REAL Definition-of-Done
  checks BEFORE firing — working script/prompt/human check files (dod-lite's exact
  format), reusing the plugin-under-test's own checker scripts where it ships them.
  Auto-trigger when the user says: "plan the next run", "plan run 2", "define the task for
  the ab test", "write the task brief", "set up the next iteration", "prepare the next
  ab-bench run", "define DoDs for the experiment", "pin control to a previous version",
  "test against the last release". Creates runs/run-NNN/task.md, runs/run-NNN/baseline.json
  (control's vanilla-vs-previous-version choice), and runs/run-NNN/dod-checks.json, writes
  check files into .dod/checks/. Must run before /ab-bench:fire.
argument-hint: "[experiment-name]"
---

# ab-bench: plan next run

Experiments live under `${user_config.experiments_root}`. If that's empty or still literally
reads `${user_config.experiments_root}`, tell the user to run `/ab-bench:setup` first and stop.
Identify the experiment from $ARGUMENTS or ask. Read its `env.json` and `ledger.md` for context —
if a prior run's report exists, its "Recommendations for next iteration" section should shape
this run.

**Preflight — `mandate.md` must exist.** Read `<experiment>/mandate.md`. If it's missing (a
legacy experiment created before `/ab-bench:understand` existed), STOP: tell the user to run
`/ab-bench:understand <experiment-name>` first, and do not draft task.md or DoD checks without
it — designing tasks with no anchor to what the plugin is actually FOR is the exact failure mode
this file exists to prevent.

## 1. Create the run folder

Next number: scan `runs/`, take highest `run-NNN` + 1 (start at `run-001`). Create `runs/run-NNN/`.

## 2. Choose control's baseline for this run

Ask: **"control this run: vanilla, or pin to a previous released version of the plugin under test?"**
Default the suggestion to whatever the LAST run in this experiment used (read the previous
`runs/run-NNN-1/baseline.json` if one exists) — don't re-ask from scratch every time, just confirm
"same as last run?" first. This choice is per-run, never written to env.json.

- **Vanilla** (or no prior baseline.json exists and the user doesn't want to pin one):
  `node ${CLAUDE_SKILL_DIR}/scripts/resolve-baseline.mjs <envRoot> <runDir> --vanilla`
- **Previous version**: needs `env.json.pluginUnderTestRepo` — if absent, tell the user to add it (a
  git repo path) before this is possible, and fall back to vanilla for now. Otherwise ask for the
  tag/commit to pin, then:
  `node ${CLAUDE_SKILL_DIR}/scripts/resolve-baseline.mjs <envRoot> <runDir> --ref <tag-or-commit>`
  This checks out (or reuses, if already cached) a git worktree at `<envRoot>/baselines/<ref>/` and
  writes `runs/run-NNN/baseline.json` with the resolved `pluginDirs` for control. It fails loudly on a
  bad ref or missing repo — fix and re-run rather than proceeding without a baseline.

Either way you now have a real `runs/run-NNN/baseline.json` — `/ab-bench:fire` reads it to compose
control's config; nothing else in this skill needs to touch it again except step 4b below.

## 3. Write task.md — THE PARITY-CRITICAL ARTIFACT

`task.md` is copied verbatim into both workspaces as `TASK.md` and both arms open with the same
fixed prompt telling them to execute it. Rules:

- **Plugin-blind**: the brief must NEVER mention the plugin under test, its tools, or hint at a
  preferred workflow. It describes the JOB (what to build/produce, acceptance criteria, constraints),
  as a real user would state it to either setup. One mention of the plugin = contaminated run.
- Self-contained: assume the reading agent has ONLY this file plus the seed files.
- Concrete deliverables: name the output files/artifacts expected in the workspace.
- Same task complexity as prior runs if iterating (comparable ledger rows); note in the ledger if
  task difficulty changed.
- **Justified against `mandate.md`**: before drafting, identify which of mandate.md's sections
  (capability gap / good-outcome definition / appropriate complexity) this task is meant to
  exercise. State that justification when you show the draft to the user — if you can't point at
  a mandate.md section the task exercises, the task is probably testing something irrelevant to
  the plugin under test; narrow it until it does.

Draft it, show the user, iterate until approved.

## 4. Define REAL DoD checks — no placeholders

The DoD checks are the pre-registered success criteria — defined NOW, in the main session, before
any output exists, so post-hoc rationalization can't creep in. Every check file you write here is
executed FOR REAL by dod-lite's `Stop` hook, every turn, in both arm sessions. Never write a
placeholder/invented check "to fill the schema" — if a criterion can't be checked for real yet,
leave it out and say so.

Full schema and rationale: `${CLAUDE_SKILL_DIR}/../../docs/dod-contract.md`. Read it if unsure of
dod-lite's exact file formats before writing anything.

### 4.0 Preflight — is dod-lite actually going to run for this experiment?

Check `env.json`'s `common`/`control`/`test` blocks (`plugins` + `pluginDirs` arrays) for an entry
that resolves to the `dod-lite` plugin, for whichever arm(s) you're about to write checks for. If
it's missing from an arm's config:

**STOP — do not run the interview below.** Writing check files nobody will ever evaluate is worse
than writing none: dod-lite's hooks won't be loaded in that arm, so every check sits at `pending`
forever and `/ab-bench:analyze` will misreport it as "nothing passed" instead of "tracking was
never active." Tell the user plainly: dod-lite isn't declared for this arm, DoD checks would be
inert, and offer the legitimate options —
- **No run has fired yet for this experiment** (this would be run-001): adding `dod-lite` to
  `env.json` now is fine, nothing to break comparability with yet — add it, then continue with 4a.
- **A prior run already fired** (run-002+): adding `dod-lite` to `env.json` now IS a mid-experiment
  edit and breaks run-over-run comparability — the existing "never edit env.json mid-experiment"
  lock applies here same as anywhere else, this is an actual arm config delta, not metadata like
  `pluginUnderTestRepo`. Don't do it. Offer instead: skip DoD entirely for this run (don't write
  `dod-checks.json` — see the graceful-degradation note at the end of this section), or start a
  NEW experiment version with dod-lite declared from the start (`/ab-bench:init` again, bumped
  version suffix, per the existing discipline).

Do not silently proceed with authoring checks in any case.

### 4a. Interview for criteria (same rigor as dod-lite's own planning skill)

Draft candidate criteria that would actually distinguish "done" from "not done" for THIS task. For
each, decide the tier:
- **script** — mechanically verifiable by exit code (file exists, build passes, output validates).
  Prefer this whenever possible.
- **prompt** — needs judgement but a read-only AI grader could resolve it by investigating.
- **human** — genuinely needs this user's judgement (taste, "does this match the ask"). Use sparingly.

For each candidate criterion, also state which `mandate.md` section it maps to (capability gap,
good-outcome definition, or known weak spot) — this is a hard requirement, not a nice-to-have. If
a criterion doesn't map to anything in mandate.md, flag it explicitly to the user before adding
it: either it's testing territory outside the plugin's stated purpose (drop it), or mandate.md is
incomplete and should be refreshed via `/ab-bench:understand` (do that first, then resume here).

Present the list (what + tier + mandate.md mapping, not draft file contents yet) to the user,
iterate until agreed — same proposal-then-author order as dod-lite's `planning` skill. Zero
checks can be a legitimate outcome for a trivial task.

### 4b. Check whether the plugin-under-test ships its own checkers — BEFORE writing generic ones

For each agreed criterion, look at the plugin-under-test's repo (path from env.json
`pluginUnderTestRepo` / test arm's `pluginDirs`) for checker-like tooling it already ships: a
`checks/`, `qa/`, `validators/`, or similarly-named folder, or anything its README/SKILL.md
documents as QA/validation scripts meant to grade its own output (e.g. a Blender plugin shipping
mesh-validation scripts). If a plugin-native script already covers a criterion:
- use it INSTEAD of writing a generic one for that criterion.
- if control this run is **vanilla**: it goes to the **test arm only** (control has no plugin at all,
  so it can't run a checker that depends on the plugin's own tooling) — unless a generic equivalent
  can meaningfully assess the same criterion without the plugin, in which case give control that
  generic version instead.
- if control this run is a **previous-version baseline** (`runs/run-NNN/baseline.json` has
  `control_baseline.type: "previous-version"`): ALSO look inside
  `control_baseline.worktreePath` for the SAME kind of shipped checker (the old tag may or may not
  still ship it, or may ship an older/different version of it). If found, control gets its own entry
  for the SAME check `id`, `source: "plugin-native"`, `origin` pointing INTO the worktree — this is the
  OLD checker judging the OLD code, compared against test's CURRENT checker judging CURRENT code, which
  is the accurate apples-to-apples comparison (not today's checker run against yesterday's code). If
  the old tag doesn't ship an equivalent checker at all, fall back to the vanilla-case rule above.
- this means control and test CAN legitimately end up with different check-id lists, or the same id
  with different `origin`. That's expected when driven by a plugin-native checker, not a parity
  violation — record `source`/`origin` (see 4d) so `/ab-bench:analyze` explains it instead of flagging it.

List `.dod/checks/` first (same as dod-lite's own skill) — reuse an existing id if a prior run
already covers the same intent, don't duplicate.

### 4c. Author real check files into `<experiment>/.dod/checks/`

dod-lite's exact format (id = filename without extension, unique within `checks/`):
- **script**: `<id>.mjs|.js|.cjs|.sh|.ps1|.py|.rb` — actual working exit-code logic (0 = pass). If
  reusing a plugin-native script, copy it in verbatim (or reference it if it needs no changes to run
  standalone).
- **prompt** / **human**: `<id>.md` with frontmatter:
  ```yaml
  ---
  type: prompt        # or: human
  description: "one line, shown in status/failure output"
  model: haiku         # prompt only, default haiku, sonnet for nuanced calls
  ---
  <self-contained grading question (prompt) or question-for-user (human)>
  ```
  A `prompt` checker runs with only read-only repo access and no conversation context — write the
  question so it states what "done" looks like, not just "did we do the thing."

### 4d. Write `runs/run-NNN/dod-checks.json` — the per-run artifact

This lives in the RUN folder, NOT in `.dod/` — which checks apply to this run is task-specific, the
check FILES in `.dod/checks/` are the experiment-level shared/reused state.

```json
{
  "schema": 1,
  "run": "run-NNN",
  "checks": {
    "control": [ { "id": "...", "tier": "script|prompt|human", "source": "generic"|"plugin-native", "origin": "<path, if plugin-native>" } ],
    "test":    [ { "id": "...", "tier": "script|prompt|human", "source": "generic"|"plugin-native", "origin": "<path, if plugin-native>" } ]
  }
}
```

The `arm-session-start.mjs` hook reads this file at fire time and seeds each arm's
`.dod/sessions/<session_id>.json` with exactly this list — that's what makes checks apply seamlessly
without either arm ever needing to invoke `dod-lite:planning` itself.

If the user wants to skip DoD tracking for this run entirely: don't write `dod-checks.json` at all
(ab-bench degrades gracefully — analysis then leans on metrics + human verdict only). Say so plainly
before moving on.

## 5. Confirm ready

Tell the user: `run-NNN planned. Fire with /ab-bench:fire when ready.`
Checklist to state: control baseline this run (vanilla, or previous-version@ref), task.md written
(plugin-blind ✓), `dod-checks.json` present (with control/test counts and any plugin-native checks
called out) or explicitly skipped.
