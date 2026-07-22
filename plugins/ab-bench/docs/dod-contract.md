# .dod/ Integration Contract — ab-bench ⇄ dod-lite (arm engine)

Status: **redesigned** (this session) — `plugins/dod-lite` in this repo is no longer a copy of the
standalone dod-lite plugin. It is a trimmed, hooks-only fork built specifically to be ab-bench's
arm-side DoD enforcement engine. It is not listed in `marketplace.json`, is not independently
installable, and shares no runtime relationship with the free-standing DoD-lightweight project it
was originally forked from. If this contract or dod-lite's schema ever changes, re-read
`plugins/dod-lite/hooks/lib.mjs` + `hooks/dod-check.mjs` and update this doc, `arm-session-start.mjs`,
and the `plan`/`analyze` skills together — they all assume the same schema.

## Ownership split

- **dod-lite (this repo's trimmed copy)** owns: check file format (`.dod/checks/<id>.<ext>`), the
  three-tier `Stop`-hook evaluation (script → prompt → human). Nothing else — it ships no
  `SessionStart`, `UserPromptSubmit`, `PreToolUse`, or `PostToolUse` hook, no skill, no command.
- **ab-bench** owns everything else: authoring REAL check files for a run (never placeholders),
  deciding which checks apply to which arm, writing/seeding `.dod/sessions/<session_id>.json`
  directly (the sole writer — dod-lite never touches this file except to update `state`/`history`
  from the Stop hook), injecting the engine into both arms unconditionally, and reading
  `.dod/sessions/*` as an analysis data source afterward.

## dod-lite's file schema (ground truth, from its `hooks/lib.mjs` and `hooks/dod-check.mjs`)

```
<project-root>/.dod/                  ← resolved as path.join(cwd, '.dod') — a DIRECT CHILD of the
                                         session's cwd. The engine does NOT walk up looking for .dod/.
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
      session_id, created_at, planning_invoked, session_goal,
      checks: [ "<id>", ... ],
      state: { "<id>": { tier, last_result: "pending"|"pass"|"fail"|"waived", last_output, last_checked_at } },
      history: [ { at, results: [ { check, result } ] } ]
    }
  config.json            optional: { "runners": { ".ext": "command" } }
```

`planning_invoked` is written `true` by `arm-session-start.mjs` for schema-shape consistency with
what `/ab-bench:analyze` expects, but it is purely cosmetic now — dod-lite ships no gate hook that
ever reads it. Check id = filename without extension, unique within `checks/`. `checks/` accumulates
and is reused across runs of the same experiment.

## Filesystem layout in an ab-bench experiment

```
<experiment>/
  .dod/
    checks/                 ← REAL check files, authored by /ab-bench:plan (script/prompt/human,
                               dod-lite's exact format). Shared + recycled across runs.
    sessions/                ← owned entirely by ab-bench's arm-session-start.mjs (sole writer of
                               checks[]/session_goal), updated in place by dod-lite's Stop hook
                               (state{}/history[] only).
  runs/run-NNN/
    dod-checks.json         ← THE PER-RUN ARTIFACT. Lives in the RUN folder, NOT in .dod/ — which
                               checks apply to THIS run is task-specific, while the check FILES in
                               .dod/checks/ are experiment-level shared state.
    control/  test/         ← arm workspaces; EACH gets .dod as a directory JUNCTION to the shared
                               <experiment>/.dod/ (see "Why a junction" below — still required).
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
that native checker and CONTROL either gets a generic equivalent or no check for that criterion at
all. `source` records which case applies so `/ab-bench:analyze` can EXPLAIN the asymmetry instead of
misreading it as a broken parity. Deliberate design, not a bug.

## Why a junction is still required

dod-lite's `Stop` hook (`dod-check.mjs`) is unforked/untouched code and still resolves `.dod` as
`path.join(cwd, '.dod')` with **no upward directory search**. An arm session running with cwd =
`runs/run-NNN/control/` would get its OWN private `.dod/` inside that workspace if left alone —
breaking the shared/recycled-across-runs design entirely.

Fix (entirely on ab-bench's side): `launch-pair.mjs` creates `runs/run-NNN/<arm>/.dod` as a Windows
directory junction (`fs.symlinkSync(target, link, 'junction')`, no admin rights required) pointing
at `<experiment>/.dod`. Junctions are transparent at the filesystem driver level — the Stop hook,
running with cwd = the arm workspace, reads/writes/executes through the junction exactly as if
`.dod/` were physically there, including running check scripts with the arm's own cwd.

## Injection: mandatory, not opt-in

`launch-pair.mjs` unconditionally appends `plugins/dod-lite`'s absolute path to **both** arms'
`pluginDirs` (`--plugin-dir`, same mechanism already used for a previous-version control baseline's
worktree) — there is no `env.json` declaration to make and no way for it to be silently absent from
one arm. Any legacy `env.json` that still lists a `dod-lite` marketplace ref or raw path is
defensively stripped before composing each arm's config (`stripDodLite()`), so an old experiment
can never end up loading it twice.

The only remaining way to skip DoD tracking is per-run: if `/ab-bench:plan` doesn't write
`runs/run-NNN/dod-checks.json` (or writes no entries for an arm), `arm-session-start.mjs` skips
registration silently for that arm and `/ab-bench:analyze` leans on metrics + human verdict only.
The engine is always loaded regardless; it just has nothing to enforce.

## Registration protocol (single writer, no race)

`arm-session-start.mjs` (`skills/fire/scripts/arm-session-start.mjs`), fires only for SessionStart
source `startup` or `clear` (never `resume`/`compact` — would fight the accumulated `history`):
- reads `runs/run-NNN/dod-checks.json`; if absent, or no entry for this arm, skip silently
  (ab-bench degrades gracefully without DoD tracking);
- reads `.dod/sessions/<session_id>.json` through the junction — since dod-lite ships no
  `SessionStart` hook of its own, this file will never already exist for a brand-new session id;
  this hook is the sole creator;
- creates it from dod-lite's documented scaffold shape if absent, or merges into it if present
  (never overwrites wholesale) — appends this arm's check ids into `checks[]` (dedup against
  whatever's already there), seeds `state[id]` for any new id using the tier recorded in
  `dod-checks.json`, sets `planning_invoked: true` (cosmetic — see above).

No polling, no 5-second wait, no ordering dependency on a foreign hook — this hook is the only thing
that ever writes `checks[]`/`session_goal`/the initial scaffold. dod-lite's `Stop` hook only ever
updates `state{}`/`history[]` on top of what's already there. Registration costs ZERO agent tokens
in either arm (pure hook work), and neither arm's available-skill listing shows any DoD-design
capability — dod-lite ships none.

## What `/ab-bench:plan` must actually do

1. Interview for real script/prompt/human criteria for what "done" means for this run's task,
   each mapped to a `mandate.md` section.
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
