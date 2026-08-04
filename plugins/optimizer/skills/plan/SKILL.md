---
description: >-
  Plan the next A/B run of an optimizer experiment: write the task brief (task.md, the
  identical opening assignment both arms receive) and author REAL Definition-of-Done
  checks BEFORE firing — working script/prompt check files (dod-lite's exact
  format), reusing the plugin-under-test's own checker scripts where it ships them.
  Auto-trigger when the user says: "plan the next run", "plan run 2", "define the task for
  the ab test", "write the task brief", "set up the next iteration", "prepare the next
  optimizer run", "define DoDs for the experiment", "pin control to a previous version",
  "test against the last release". Creates runs/run-NNN/task.md, runs/run-NNN/baseline.json
  (control's vanilla-vs-previous-version choice), and runs/run-NNN/dod-checks.json, writes
  check files into .dod/checks/. Must run before /optimizer:fire. Run from the plugin-under-test's
  repo (or a subdirectory) — no argument needed, resolved from .ab-bench/state.json.
argument-hint: ""
---

# optimizer: plan next run

Experiments live under `${user_config.experiments_root}`. If that's empty or still literally
reads `${user_config.experiments_root}`, tell the user to run `/optimizer:setup` first and stop.

**Resolve current env** (two roots, not one — see docs/dod-contract.md if unfamiliar):

```
node "${CLAUDE_SKILL_DIR}/../init/scripts/ab-bench-scaffold.mjs" find-repo-root "<cwd>"
node "${CLAUDE_SKILL_DIR}/../init/scripts/ab-bench-scaffold.mjs" detect "<repoRoot>" "${user_config.experiments_root}"
```

`{"status":"fresh"}` → no experiment here — tell the user to run `/optimizer:init` first, stop.
Otherwise this gives you `envFile` (**configRoot** = its parent dir — holds `env.json`),
`mandateFile`, and `testenvRoot` (holds `seed/`, `ledger.md`, `.dod/`, `baselines/`, `runs/`).
If `$ARGUMENTS` names a different env explicitly (rare — targeting something other than the
current one), resolve that env's paths the same way instead of the current pointer.

Read `configRoot/env.json` and `testenvRoot/ledger.md` for context. Prior runs reach this one
through `lab/` (step 0b), not by re-reading their reports — every actionable thing a report
produced was banked as a hypothesis or a finding at analyze time. Open a prior `report.md`
only when you need the evidence *behind* a ranked hypothesis, and read its "Harness defects"
section if the ledger row says the run was contaminated.

**Preflight — `mandateFile` must exist.** If `detect` reported `mandateExists: false` (a legacy
or interrupted setup), STOP: tell the user to run `/optimizer:understand` first, and do not draft
task.md or DoD checks without it — designing tasks with no anchor to what the plugin is actually
FOR is the exact failure mode this file exists to prevent.

## 0b. Steepest descent — decide WHAT to test before deciding how

A run that isn't pre-registered against a hypothesis produces a number nobody can act on.
Start here, always:

```bash
node "${CLAUDE_SKILL_DIR}/../../lib/lab-cli.mjs" rank "<testenvRoot>"
```

**If no priority pillar is declared**, stop and settle it with the user first. The five
pillars — `quality`, `input_tokens`, `output_tokens`, `turns`, `autonomy` — trade against
each other, so "make it better" is not a direction. Exactly one is the priority; the rest
carry regression guards.

```bash
node "${CLAUDE_SKILL_DIR}/../../lib/lab-cli.mjs" objective "<testenvRoot>" \
    --priority <pillar> --guard quality=5 --why "<why this, now>"
```

Changing the priority later is expected and cheap — the old one is retired into the record,
not erased, and that sequence of shifts is the spine of the eventual write-up. What is
*not* cheap is never declaring one.

**Then pick the top-ranked open hypothesis** (`score = predicted_magnitude × confidence ÷
cost`, with hypotheses that cannot move the priority pillar ranked below ones that can).
Confirm it with the user, or let them override — the ranking is an argument, not an
instruction. If there are no open hypotheses, say so plainly and interview for one before
going further:

```bash
node "${CLAUDE_SKILL_DIR}/../../lib/lab-cli.mjs" add "<testenvRoot>" \
    --statement "<what should move, and why>" --pillars input_tokens,turns \
    --magnitude 20 --confidence 0.6 --cost 2 --why "<reasoning>"
```

Carry the chosen hypothesis id forward: `task.md` must exercise it, and the DoD checks must
be able to tell whether it held. Note it in the run folder so `/optimizer:analyze` can
resolve the right one.

**Autonomy is measured, so don't accidentally design it away.** Every `AskUserQuestion` the
arm makes counts against the autonomy pillar. Nothing in the harness forces one any more —
the DoD auditor never speaks to an arm — so every ask is the arm's own choice.
A task written as "ask the user before each step" pins that pillar to the floor for both
arms and measures nothing.

## 1. Create the run folder

Next number: scan `testenvRoot/runs/`, take highest `run-NNN` + 1 (start at `run-001`). Create
`testenvRoot/runs/run-NNN/`. Everything below that references `runs/run-NNN/` means this folder.

## 2. Pin the artifacts for this run

An **artifact** is any git-versioned thing the experiment is testing — declared once in `env.json`
under `artifacts` (see `/optimizer:init`), with its own repo and its own delivery mode. Most
experiments have exactly one (the plugin under test) and this step is a single question. An
experiment whose subject spans several repos pins each one independently.

Read `env.json`'s artifact ids first, then ask, per arm, what each is pinned to. Default the
suggestion to whatever the LAST run used (read `runs/run-NNN-1/baseline.json` if one exists) —
don't re-ask from scratch every time, just confirm "same as last run?" first. This choice is
per-run and is never written to env.json.

```bash
node ${CLAUDE_SKILL_DIR}/scripts/resolve-baseline.mjs <configRoot> <testenvRoot> <runDir> \
    [--control <spec>] [--test <spec>]
```

`<spec>` is `vanilla`, or a comma-separated `<artifactId>=<ref>` list. An artifact not named keeps
its working tree. Omitting an arm entirely means every artifact at its working tree.

| Intent | Command |
|---|---|
| control gets nothing at all | `--control vanilla` |
| control on a previous release (one artifact) | `--control my-plugin=v0.2.0` |
| control on the previous release of everything | `--control "plugin=v0.2.0,lib=v0.2.0"` |
| hold the library fixed, vary only the plugin | `--control "plugin=v0.2.0,lib=v0.3.0" --test "lib=v0.3.0"` |

That last row is the **isolating run**, and it is worth naming explicitly to the user: when two
artifacts move together, no single run can tell you which one caused the delta. If the point of the
run is attribution rather than "is the new release better", hold everything fixed except one thing.

**Every arm is pinned to something immutable, always.** An explicit ref becomes a cached git
worktree; no ref with a clean tree becomes that tree's HEAD sha; no ref with a *dirty* tree is
copied out and content-hashed into `baselines/<id>/_wt-<hash>/`. Arms never read a live repo, so
editing a plugin while a run is in flight cannot change what that run measured. If a pin came from
a dirty tree the resolver says so — tell the user, because that run is replayable but is **not**
reconstructible from git history alone.

The resolver fails loudly on a bad ref, a non-repo, or an artifact id `env.json` never declared.
Fix and re-run rather than proceeding without pins.

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
- **Justified against `mandateFile`**: before drafting, identify which of mandate.md's sections
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

DoD tracking is mandatory, not opt-in: optimizer auto-injects the trimmed dod-lite engine into both
arms on every run (`launch-pair.mjs`, unconditional `--plugin-dir`) — there's no `env.json`
declaration to check, and no way for a check to end up inert because dod-lite wasn't loaded. The
only legitimate way to skip DoD for a specific run is to not write `dod-checks.json` at all (see
the graceful-degradation note in 4d) — say so plainly if that's what the user wants, rather than
running the interview below.

### 4a. Interview for criteria

Draft candidate criteria that would actually distinguish "done" from "not done" for THIS task. For
each, decide the tier — there are **two**:
- **script** — mechanically verifiable by exit code (file exists, build passes, output validates).
  Prefer this whenever possible. It is free.
- **prompt** — needs judgement but a read-only AI grader could resolve it by investigating.

There is no human tier. A criterion that genuinely needs this user's judgement (taste, "does this
match the ask") is not a check — it is the quality verdict, and it gets given at
`/optimizer:analyze` against the rubric. The old human tier blocked the arm with instructions to
call `AskUserQuestion`, which manufactured the autonomy signal the harness measures.

**Budget the prompt tier deliberately.** Every prompt check spawns a `claude -p` grader
**once per turn, per arm** — the auditor runs both tiers at every Stop, ungated, so the per-turn
series has no holes. Four prompt checks over a five-turn run is forty grader subprocesses. Script
checks cost nothing and can be as many as you like; each prompt check has to earn its place. If a
criterion can be expressed as an exit code, express it as an exit code.

For each candidate criterion, also state which `mandate.md` section it maps to (capability gap,
good-outcome definition, or known weak spot) — this is a hard requirement, not a nice-to-have. If
a criterion doesn't map to anything in mandate.md, flag it explicitly to the user before adding
it: either it's testing territory outside the plugin's stated purpose (drop it), or mandate.md is
incomplete and should be refreshed via `/optimizer:understand` (do that first, then resume here).

Present the list (what + tier + mandate.md mapping, not draft file contents yet) to the user,
iterate until agreed — propose before authoring, never the reverse. Zero checks can be a
legitimate outcome for a trivial task.

### 4b. Check whether the plugin-under-test ships its own checkers — BEFORE writing generic ones

For each agreed criterion, look at the plugin-under-test's repo (`repoRoot` — same as
`pluginUnderTestRepo` in env.json, and where this whole session is CD'd into) for checker-like
tooling it already ships: a
`checks/`, `qa/`, `validators/`, or similarly-named folder, or anything its README/SKILL.md
documents as QA/validation scripts meant to grade its own output (e.g. a Blender plugin shipping
mesh-validation scripts). If a plugin-native script already covers a criterion:
- use it INSTEAD of writing a generic one for that criterion.
- if control this run is **vanilla**: it goes to the **test arm only** (control has no plugin at all,
  so it can't run a checker that depends on the plugin's own tooling) — unless a generic equivalent
  can meaningfully assess the same criterion without the plugin, in which case give control that
  generic version instead.
- if control this run is pinned to an older ref (`runs/run-NNN/baseline.json` has a
  `arms.control.pins.<id>` whose `requested_ref` is set): ALSO look inside that pin's
  `resolved.path` for the SAME kind of shipped checker (the old ref may or may not
  still ship it, or may ship an older/different version of it). If found, control gets its own entry
  for the SAME check `id`, `source: "plugin-native"`, `origin` pointing INTO the worktree — this is the
  OLD checker judging the OLD code, compared against test's CURRENT checker judging CURRENT code, which
  is the accurate apples-to-apples comparison (not today's checker run against yesterday's code). If
  the old tag doesn't ship an equivalent checker at all, fall back to the vanilla-case rule above.
- this means control and test CAN legitimately end up with different check-id lists, or the same id
  with different `origin`. That's expected when driven by a plugin-native checker, not a parity
  violation — record `source`/`origin` (see 4d) so `/optimizer:analyze` explains it instead of flagging it.

List `testenvRoot/.dod/checks/` first — reuse an existing id if a prior run already covers the
same intent, don't duplicate.

### 4c. Author real check files into `testenvRoot/.dod/checks/`

dod-lite's exact format (id = filename without extension, unique within `checks/`). An id must
match exactly one file — `foo.py` and `foo.md` together are the same check declared twice and are
rejected, not silently resolved.

- **script**: `<id>.mjs|.js|.cjs|.sh|.ps1|.py|.rb` — actual working exit-code logic (0 = pass). If
  reusing a plugin-native script, copy it in verbatim (or reference it if it needs no changes to run
  standalone). Declared metadata goes in a `<id>.meta.json` sidecar, since an executable has
  nowhere to put frontmatter:
  ```json
  { "description": "one line", "seed_expectation": "fail" }
  ```
- **prompt**: `<id>.md` with frontmatter:
  ```yaml
  ---
  type: prompt
  description: "one line, shown in status/failure output"
  seed_expectation: fail    # see below — default fail, declare pass only for a regression guard
  model: claude-haiku-4-5-20251001   # prompt only; FULL model id, never a bare alias
  ---
  <self-contained grading question, answerable from files alone>
  ```
  A `prompt` checker runs with only read-only repo access and no conversation context — write the
  question so it states what "done" looks like, not just "did we do the thing." It must return
  citations (`evidence`), so the question has to be answerable from files, not from vibes.

**`model:` must be a full model id.** The CLI accepts unknown `--model` values silently and falls
back to a default, so a bare alias like `haiku` is not an error — it just quietly grades (and bills)
as something nobody chose. dod-lite now rejects anything that is neither a documented CLI alias
(`fable`, `opus`, `sonnet`) nor a full `claude-...` id. Omit the field to get the default grader.

**`seed_expectation` is what the check reports against an untouched seed workspace.** Default
`fail`: the check asserts work that has not happened yet. Declare `pass` only for a deliberate
regression guard ("the build still works"), and say why — a check that already passes on the seed
passes for both arms no matter what they do, so unless it flips it measures nothing. Step 4e
enforces the declaration against reality.

### 4d. Write `runs/run-NNN/dod-checks.json` — the per-run artifact

This lives in the RUN folder, NOT in `.dod/` — which checks apply to this run is task-specific, the
check FILES in `.dod/checks/` are the experiment-level shared/reused state.

```json
{
  "schema": 1,
  "run": "run-NNN",
  "checks": {
    "control": [ { "id": "...", "tier": "script|prompt", "source": "generic"|"plugin-native", "origin": "<path, if plugin-native>" } ],
    "test":    [ { "id": "...", "tier": "script|prompt", "source": "generic"|"plugin-native", "origin": "<path, if plugin-native>" } ]
  }
}
```

The `arm-session-start.mjs` hook reads this file at fire time and seeds each arm's
`.dod/sessions/<session_id>.json` with exactly this list — that's what makes checks apply
seamlessly without either arm ever designing its own. dod-lite ships no planning skill in this
repo at all, so there's no in-session path to invoke even if an arm wanted to.

If the user wants to skip DoD tracking for this run entirely: don't write `dod-checks.json` at all
(optimizer degrades gracefully — analysis then leans on metrics + human verdict only). Say so plainly
before moving on.

### 4e. Prove the checks discriminate — MANDATORY, before the run is fireable

Every check you just authored has never been executed. Its first run used to be inside a live arm,
where a bug becomes `fail` (blocks the arm, contaminates the run) or `error` (never blocks, silently
ungraded) — and neither surfaces until analyze, a whole run later.

Run the gate:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/probe-checks.mjs" "<testenvRoot>" "<runDir>"
```

It clones `seed/` into a throwaway workspace and executes every check against it, then rejects:

| Rejection | What it means |
|---|---|
| `CANNOT DISCRIMINATE` | it already passes on an untouched seed, so it passes for both arms no matter what they do |
| `CRASHED` | it exited non-zero because it broke, not because the criterion failed |
| `BROKEN` / `MISSING` | it errored, or the file referenced in `dod-checks.json` isn't there |
| `UNGROUNDED` | a prompt check passed while citing no evidence — it didn't actually look |
| `DECLARED A REGRESSION GUARD` | `seed_expectation: pass` but it fails on the seed |
| `UNSUPPORTED` | a `type: human` check. The tier is gone; re-author it or judge it at analyze |

**Do not proceed while anything is rejected.** Fix the check and re-run — don't relax
`seed_expectation` to make the gate quiet, which converts a real signal into a decorative one. If a
criterion genuinely can't be checked yet, drop it and say so.

This costs one seed clone plus N executions, and prompt checks are N real `claude -p` calls. Say so
before running it if the check list is large.

`/optimizer:fire` runs the same probe again and refuses to launch on a mismatch, so a check edited
between planning and firing can't slip through.

## 5. Confirm ready

Tell the user: `run-NNN planned. Fire with /optimizer:fire when ready.`
Checklist to state: control baseline this run (vanilla, or previous-version@ref), task.md written
(plugin-blind ✓), `dod-checks.json` present (with control/test counts and any plugin-native checks
called out) or explicitly skipped.
