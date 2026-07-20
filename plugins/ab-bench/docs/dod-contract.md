# .dod/ Integration Contract — ab-bench ⇄ dod-lite

Status: **verified against dod-lite's actual source** (read 2026-07-11 — it is a real, working
plugin, not a skeleton). This doc reflects dod-lite's REAL
file schema and hook behavior, not an invented format. If dod-lite's internals change, re-read its
`hooks/lib.mjs` + `hooks/*.mjs` + `skills/planning/SKILL.md` and update this doc before touching
either plugin's code again.

## Ownership split

- **dod-lite** owns: check file format (`.dod/checks/<id>.<ext>`), per-session state file schema
  (`.dod/sessions/<session_id>.json`), turn-per-turn evaluation (its `Stop` hook), the
  plan-mode/`ExitPlanMode` gate, goal-completion bookkeeping (`goal reached` = all checks passing).
- **ab-bench** owns: authoring REAL check files for a run (not placeholders), deciding which
  checks apply to which arm, seeding both arms' session files with the SAME check ids before dod-lite's
  own gate can steer either arm into designing its own (divergent) checks, and reading `.dod/sessions/*`
  as an analysis data source afterward.

## dod-lite's real file schema (ground truth, from its `hooks/lib.mjs`)

```
<project-root>/.dod/                  ← resolved as path.join(cwd, '.dod') — a DIRECT CHILD of the
                                         session's cwd. dod-lite does NOT walk up looking for .dod/.
  checks/
    <id>.mjs|.js|.cjs|.sh|.ps1|.py|.rb   type: script — exit code 0 = pass, nonzero = fail
    <id>.md                              type: prompt or human, via YAML frontmatter:
                                          ---
                                          type: prompt        # or: human
                                          description: "one line"
                                          model: haiku          # prompt only
                                          ---
                                          <grading question (prompt) or question-for-user (human)>
  sessions/
    <session_id>.json   {
      session_id, session_title, created_at, planning_invoked, session_goal,
      checks: [ "<id>", ... ],
      state: { "<id>": { tier, last_result: "pending"|"pass"|"fail"|"waived", last_output, last_checked_at } },
      history: [ { at, results: [ { check, result } ] } ],
      // present only on a session that dod-lite auto-migrated from a resume-forked id (0.1.1+):
      resumed_from, resumed_at,
      // present only on the frozen donor a migration copied FROM (0.1.1+) — ab-bench should treat
      // a session file with superseded_by as retired history, not a second live session:
      superseded_by, superseded_at
    }
  config.json            optional: { "runners": { ".ext": "command" } }
```

**0.1.1 addition**: dod-lite's `SessionStart` hook now auto-migrates DoD state forward when a
`source=resume` fire lands on a session id with no file yet (works around a Claude Code resume/fork
bug — see `hooks/lib.mjs` `findResumeDonor`/`migrateSession`). Irrelevant to ab-bench's own flow since
`arm-session-start.mjs` already skips `resume`/`compact` entirely (see below) — noted here only so
`.dod/sessions/*` readers (e.g. `/ab-bench:analyze`) don't mistake a `superseded_by` file for a second
live session for the same run.

Check id = filename without extension, unique within `checks/`. `checks/` is meant to accumulate
and be reused across sessions in the same project — that already matches our "DoD recycled across
runs of the same experiment" decision.

**dod-lite's own SessionStart hook is create-if-absent** for `sessions/<session_id>.json` (confirmed
in `hooks/session-start.mjs` + `createSessionIfAbsent()` in `lib.mjs`) — it never clobbers an existing
session file. Good: this half of the order-independent contract already holds, unmodified.

**What dod-lite does NOT have**: any notion of an externally-authored "template" it adopts. Its own
workflow is "the AGENT in a session invokes the `dod-lite:planning` skill itself, in plan mode, and
designs checks live." Its `PreToolUse(ExitPlanMode)` gate and `UserPromptSubmit` nudge exist
specifically to push a session toward doing that. Left alone, an ab-bench arm session that ever enters
plan mode gets pushed by dod-lite itself to invent its own checks — independently in each arm, which
is exactly the "sessions went on a tangent creating their own checkers" failure this doc exists to
prevent. **ab-bench must seed `checks[]` + `state{}` AND set `planning_invoked: true` before that can
happen**, so dod-lite's gate sees "already handled" and stays quiet.

## Filesystem layout in an ab-bench experiment

```
test-environments/<experiment>/
  .dod/
    checks/                 ← REAL check files, authored by /ab-bench:plan (script/prompt/human,
                               dod-lite's exact format). Shared + recycled across runs, same spirit
                               as dod-lite's own project-level checks/ folder.
    sessions/               ← owned by dod-lite; ab-bench only seeds into files here, never
                               overwrites wholesale.
  runs/run-NNN/
    dod-checks.json         ← THE PER-RUN ARTIFACT. Lives in the RUN folder, NOT in .dod/ — which
                               checks apply to THIS run is task-specific (changes per run), while
                               the check FILES in .dod/checks/ are experiment-level shared state.
                               Never put this in .dod/.
    control/  test/         ← arm workspaces; EACH gets .dod as a directory JUNCTION to the shared
                               <experiment>/.dod/ (see "Why a junction" below).
```

`dod-checks.json` shape (written by `/ab-bench:plan`, read by the `arm-session-start.mjs` hook):

```json
{
  "schema": 1,
  "run": "run-003",
  "checks": {
    "control": [
      { "id": "output-file-exists", "tier": "script", "source": "generic" }
    ],
    "test": [
      { "id": "output-file-exists", "tier": "script", "source": "generic" },
      { "id": "blender-mesh-valid", "tier": "script", "source": "plugin-native",
        "origin": "blender-plugin/checks/mesh-valid.py" }
    ]
  }
}
```

**Control and test check lists are allowed to differ.** When a criterion is genuinely checkable only
via a checker script the plugin-under-test ships (its own QA/validation tooling), the TEST arm uses
that native checker and CONTROL either gets a generic equivalent (if one can meaningfully assess the
same criterion without the plugin) or no check for that criterion at all. `source` records which case
applies so `/ab-bench:analyze` can EXPLAIN the asymmetry instead of misreading it as a broken parity.
This is a deliberate design decision, not a bug — see the corrected grilling notes.

## Why a junction is required (not optional)

Since dod-lite resolves `.dod` as `path.join(cwd, '.dod')` with **no upward directory search**, an arm
session running with cwd = `runs/run-NNN/control/` would get its OWN private `.dod/` inside that
workspace if left alone — breaking the shared/recycled-across-runs design entirely and silently
forking checks/sessions per arm per run.

Fix (entirely on ab-bench's side, zero changes needed to dod-lite): `launch-pair.mjs` creates
`runs/run-NNN/<arm>/.dod` as a Windows directory junction (`fs.symlinkSync(target, link, 'junction')`,
no admin rights required) pointing at `<experiment>/.dod`. Junctions are transparent at the filesystem
driver level — dod-lite's hooks, running with cwd = the arm workspace, read/write/execute through the
junction exactly as if `.dod/` were physically there, including running check scripts with the arm's
own cwd (so a check script's relative-path repo inspection is scoped to that arm's actual files, as
intended).

## Registration protocol (order-independent, real schema)

1. **dod-lite side**: its `SessionStart` hook creates `.dod/sessions/<session_id>.json`
   (create-if-absent) via the junction — lands in the shared folder transparently.
2. **ab-bench side** (`skills/fire/scripts/arm-session-start.mjs`), fires only for SessionStart source
   `startup` or `clear` (never `resume`/`compact` — would fight dod-lite's own accumulated `history`):
   - reads `runs/run-NNN/dod-checks.json`; if absent, or no entry for this arm, skip silently
     (ab-bench degrades gracefully without DoD tracking);
   - polls up to 5s for `.dod/sessions/<session_id>.json` to appear;
   - **merges in** (never overwrites wholesale): appends this arm's check ids into `checks[]`
     (dedup against whatever's already there), seeds `state[id]` for any new id using the tier
     recorded in `dod-checks.json` (`{tier, last_result:"pending", last_output:null,
     last_checked_at:null}` — dod-lite's exact scaffold shape for a fresh check), sets
     `planning_invoked: true` (neutralizes dod-lite's own plan-mode gate/nudge for this arm);
   - if the session file never appears within 5s, creates it from scratch using dod-lite's exact
     scaffold (`{session_id, created_at, planning_invoked:false, session_goal:null, checks:[],
     state:{}, history:[]}`) before merging in the same way.

Either hook order lands in the same final state: session file exists with the SAME check ids seeded
into both arms (except where `dod-checks.json` intentionally differs them), `planning_invoked: true`
so dod-lite's Stop hook enforces/tracks them turn-by-turn without either arm ever needing to invoke
`dod-lite:planning` itself. Registration costs ZERO agent tokens in either arm (pure hook work).

## What ab-bench:plan must actually do (the fix for "fake checkers")

`_template.json` with invented content was wrong — dod-lite has no concept of it and nothing ever
consumed it. `/ab-bench:plan` must instead:

1. Interview for real script/prompt/human criteria (same rigor as dod-lite's own `dod-lite:planning`
   skill) for what "done" means for this run's task.
2. Check whether the plugin-under-test ships its own checker-like scripts (a `checks/`, `qa/`,
   `validators/` folder, or anything its README/SKILL.md documents as QA/validation tooling) BEFORE
   writing a generic check for a criterion those scripts already cover — use the plugin's own script
   instead, tagged `source: "plugin-native"` in `dod-checks.json`.
3. Write REAL, working check files into `<experiment>/.dod/checks/<id>.<ext>` — scripts with actual
   exit-code logic, `.md` files with real self-contained grading/human questions. These get executed
   for real by dod-lite's `Stop` hook every turn. No placeholders.
4. Write `runs/run-NNN/dod-checks.json` recording the final control/test id lists + tier + source.

## What ab-analyze reads

- `.dod/sessions/<session-id>.json` per arm (semi-opaque past `checks`/`state`/`history` — anything
  else dod-lite adds is passed through to the session-comparator agent untouched).
- `runs/run-NNN/dod-checks.json` — to explain (not flag as a violation) any control/test check-list
  asymmetry sourced from a plugin-native checker.

If dod-lite's format changes, update this doc, `arm-session-start.mjs`, and the `analyze` skill's
instructions together — they all assume the same schema.
