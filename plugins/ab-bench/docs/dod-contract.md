# .dod/ Integration Contract — ab-bench ⇄ dod-lite (arm engine)

Status: **redesigned** (this session) — `plugins/dod-lite` in this repo is no longer a copy of the
standalone dod-lite plugin. It is a trimmed, hooks-only fork built specifically to be ab-bench's
arm-side DoD enforcement engine. It is not listed in `marketplace.json`, is not independently
installable, and shares no runtime relationship with the free-standing DoD-lightweight project it
was originally forked from. If this contract or dod-lite's schema ever changes, re-read
`plugins/dod-lite/hooks/lib.mjs` + `hooks/dod-check.mjs` and update this doc, `arm-session-start.mjs`,
and the `plan`/`analyze` skills together — they all assume the same schema.

**Also redesigned (same session, layered on top of the above): the two-root split.** ab-bench no
longer works out of one experiment folder. The main session now runs FROM the plugin-under-test's
own repo, which holds a gitignored `.ab-bench/` folder (mandate/env identity: `env.json`,
`mandate.md` — never touched by an arm). Everything an arm session or `launch-pair.mjs` actually
materializes on disk — `seed/`, `.dod/`, `baselines/`, `runs/` — stays in the paired **testenv**
folder under `${user_config.experiments_root}`, auto-derived from the plugin repo's folder name
(no experiment name to invent). `.dod/`'s own schema and the junction requirement below are
UNCHANGED by this — only WHERE the folder that gets junction-linked lives moved (from a
user-named experiment folder to an auto-derived testenv folder). See `lib/state.mjs` for the
shared path-resolution helpers every skill/script uses.

## Ownership split

- **dod-lite (this repo's trimmed copy)** owns: check file format (`.dod/checks/<id>.<ext>`), the
  two-tier `Stop`-hook evaluation (script and prompt, both, ungated), and the per-turn audit
  record. Nothing else — it ships no `SessionStart`, `UserPromptSubmit`, `PreToolUse`, or
  `PostToolUse` hook, no skill, no command.

  **It is an instrument, not a control loop.** Its Stop hook writes NOTHING to stdout: no
  `decision`, no `reason`, no `systemMessage`. It is injected into both arms identically, so any
  feedback it gave would pull control and test toward the same output and mask the difference
  being measured; real vanilla Claude Code has no such loop, so control-with-nudges is not
  control; and a plugin under test that ships its own `Stop` checks must be the only thing an arm
  can hear. Two regression tests in `plugins/dod-lite/test/tiers.test.mjs` assert the silence
  directly, including a canary that must reach the session file and never the control channel.

  It stays a SEPARATE plugin for one reason: an arm must load the auditor and nothing else.
  Folding it into ab-bench would enable ab-bench's own skills inside the sessions being measured.
  It is registered in `marketplace.json` so it caches alongside ab-bench — an installed plugin
  cannot reach files outside its own directory, so as an unregistered sibling it resolved to a
  dead path on every marketplace install, and `launch-pair.mjs` now refuses to fire without it.
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
    <id>.meta.json                       optional sidecar for a script check:
                                          { "seed_expectation": "fail",     // see below
                                            "description": "one line" }
    <id>.md                              type: prompt, via YAML frontmatter:
                                          ---
                                          type: prompt
                                          description: "one line"
                                          model: claude-haiku-4-5-20251001   # prompt only, FULL id
                                                                # or a documented CLI alias
                                                                # (fable|opus|sonnet). 'haiku' is
                                                                # NOT an alias — it silently
                                                                # resolved to Sonnet at ~4x, so it
                                                                # is now REJECTED at gate time
                                                                # rather than paid for.
                                          seed_expectation: fail   # fail (default) | pass
                                          agents: <name>,<name>    # optional, → --agents
                                          plugin_dirs: <abs>,<abs> # optional, → --plugin-dir
                                          ---
                                          <grading question, answerable from files alone>
  sessions/
    <session_id>.json   {
      session_id, created_at, planning_invoked, session_goal,
      checks: [ "<id>", ... ],
      state: { "<id>": { tier, last_result: "pending"|"pass"|"fail"|"waived"|"error", last_output,
                         last_checked_at,
                         evidence: [ { path, line?, quote } ],   // prompt tier, verdict v2
                         confidence: "high"|"low" } },           // prompt tier, verdict v2
      // APPEND-ONLY per-turn audit. One entry per Stop, never rewritten. `state` above is a
      // latest-value convenience; THIS is the record, and it carries full output/evidence so a
      // check that regressed pass -> fail between turns stays visible.
      history: [ { turn, at, results: [ { check, result, tier, output,
                                          evidence?, confidence?, grader_model?, retried? } ] } ]
    }
  config.json            WRITTEN AT SCAFFOLD TIME by ab-bench — not optional here: {
                           "runners":          { ".ext": "command" },
                           "hook_budget_ms":   270000,    // hook self-terminates here so its writes always land
                           "prompt_timeout_ms": 180000,   // per prompt-checker subprocess
                           "script_timeout_ms": 30000     // per script check
                         }
```

**Both tiers run at every Stop, ungated.** `prompt_tier_gate` is gone. It defaulted to `true` —
skip AI grading whenever any script check is red — which is correct for a normal project and
wrong here: mid-run a script check is red almost by definition, so the entire AI-graded tier
silently never executed. That was the whole "prompt checkers don't work" symptom. The per-turn
series must have no holes, so the gate was removed outright rather than configured off.

Prompt-tier cost is therefore a **planning** concern. Each prompt check bills one `claude -p`
grader subprocess per turn per arm, so four checks over a five-turn run is forty subprocesses.
`/ab-bench:plan` budgets them deliberately and prefers an exit code wherever a criterion can be
expressed as one. Script checks are free and can be as many as you like.

**`seed_expectation` is what makes a check falsifiable.** It declares what the check must
report against a pristine `seed/` — `fail` (the default: the task is not yet done, so the check
is red) or `pass` (a regression guard, which contributes nothing to the A/B unless it flips and
therefore needs a justification). `probe-checks.mjs` executes every check against a throwaway
seed clone at plan time and again at fire time, and refuses to proceed on: `MISSING`, `BROKEN`
(the check errored), `CRASHED` (a stack trace or parser error in the output — a crashing check
exits non-zero, which otherwise reads as an honest `fail` and sails through), `CANNOT
DISCRIMINATE` (result ≠ declaration), `DECLARED A REGRESSION GUARD` (a `pass` declaration with
no justification), `UNGROUNDED` (a prompt check that passed citing no evidence), or `UNSUPPORTED`
(a `type: human` check — that tier no longer exists). A check that passes on an untouched seed passes for every arm
regardless of what they did — it looks green and measures nothing.

`error` ≠ `fail`. `fail` is a grader verdict; `error` means the check could not be evaluated at all
(checker subprocess timed out, crashed, returned no structured verdict, or the hook ran out of
budget). **`error` never blocks the arm** — a dod-lite defect must not change what an arm does, or it
stops being an A/B result and becomes a harness artifact — but it is recorded so `/ab-bench:analyze`
can flag the dimension as ungraded. `pending` (tier never ran) reads the same way.

`planning_invoked` is written `true` by `arm-session-start.mjs` for schema-shape consistency with
what `/ab-bench:analyze` expects, but it is purely cosmetic now — dod-lite ships no gate hook that
ever reads it. Check id = filename without extension, unique within `checks/`. `checks/` accumulates
and is reused across runs of the same experiment.

## Filesystem layout — two roots, not one

```
<plugin-under-test repo>/          ← where the MAIN session runs, and where .git lives
  .gitignore                       ← ab-bench appends ".ab-bench/" here at first /ab-bench:init
  .ab-bench/                       ← gitignored. Identity/config only — an arm NEVER reads this.
    state.json                     ← { plugin_repo, experiments_root, testenv_root,
                                        current_mandate, current_env }
    mandate-N/
      mandate.md                   ← written by /ab-bench:understand. ONE per mandate, shared by
                                       every env underneath — never duplicated per env.
      envs/
        env-M/
          env.json                 ← the arm-config contract (model + artifacts + common/control/
                                       test blocks). Locked once a run has fired against it — a
                                       config change means a new env-(M+1), never an edit.
      quality-rubric.md            ← written by /ab-bench:understand. The versioned anchored
                                       scale the `quality` pillar is scored on. Main-session
                                       only; an arm never sees it.

${user_config.experiments_root}/<plugin-folder-name>/mandate-N/env-M/    ← the TESTENV root,
    auto-derived (plugin repo's own folder basename — nothing the user names)
  seed/                    starting files cloned into both workspaces each run
  ledger.md                flat run index for this env — one row per run
  lab/                     run-over-run layer: objective.json, hypotheses.json, findings.md,
                             regressions/, paper.md. Main-session only; an arm never sees it.
  baselines/<id>/<ref>/    per-artifact immutable snapshots — a worktree at a pinned ref or HEAD
                             sha, or `_wt-<hash>/` for a content-hashed copy of a dirty tree.
                             Namespaced by artifact id: two artifacts may share a ref name.
                             Cached and reused by every run resolving the same identity.
  .dod/
    checks/                 ← REAL check files, authored by /ab-bench:plan (script or prompt,
                               dod-lite's exact format). Shared + recycled across runs of this env.
    sessions/                ← owned entirely by ab-bench's arm-session-start.mjs (sole writer of
                               checks[]/session_goal), updated in place by dod-lite's Stop hook
                               (state{}/history[] only).
    config.json              ← written at scaffold time (runners + timeouts; no tier gate exists).
  runs/run-NNN/
    dod-checks.json         ← THE PER-RUN ARTIFACT. Lives in the RUN folder, NOT in .dod/ — which
                               checks apply to THIS run is task-specific, while the check FILES in
                               .dod/checks/ are env-level shared state.
    baseline.json           ← schema 2: arms.{control,test}.pins — every declared artifact's
                               resolved, immutable identity for each arm this run.
    manifest.json            ← arm→session linkage, PLUS mandate/env lineage fields (which
                               mandate-N/env-M this run belongs to — redundant with folder
                               location, but makes a stray copy of manifest.json self-describing),
                               PLUS arms.<arm>.artifacts[] and env_vars.
    control/  test/         ← arm workspaces; EACH gets .dod as a directory JUNCTION to THIS
                               testenv's own .dod/ (see "Why a junction" below — still required).
                               An arm has NO write channel into DoD state: settings deny
                               Edit/Write/MultiEdit under /.dod/**, and nothing else exists for
                               it to write. It is observed, never consulted.
```

Every skill/script resolves both roots the same way: `find-repo-root` (walk up for `.git`) +
`detect` against `.ab-bench/state.json` (`skills/init/scripts/ab-bench-scaffold.mjs`), backed by
`lib/state.mjs`'s `currentPaths()`. `configRoot` always means the `env-M/` folder under
`.ab-bench/`; `testenvRoot` always means its paired folder under `experiments_root`. A
SessionStart hook (`hooks/session-context.mjs`) injects the current mandate/env/testenv location
into every session started from inside the plugin repo, so no skill needs an experiment name
passed in by hand anymore.

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
at `<testenvRoot>/.dod`. Junctions are transparent at the filesystem driver level — the Stop hook,
running with cwd = the arm workspace, reads/writes/executes through the junction exactly as if
`.dod/` were physically there, including running check scripts with the arm's own cwd.

## Injection: mandatory, not opt-in

`launch-pair.mjs` unconditionally appends `plugins/dod-lite`'s absolute path to **both** arms'
`pluginDirs` (`--plugin-dir`, same mechanism used to deliver any `plugin-dir` artifact's pinned
snapshot) — there is no `env.json` declaration to make and no way for it to be silently absent
from one arm. Any legacy `env.json` that still lists a `dod-lite` marketplace ref or raw path is
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

### Prompt tier execution budget

The prompt tier runs its checkers **in parallel** (4 at a time) and dod-lite persists every result to
the session file **the moment it lands**, not in one write at the end. Both exist because consultant
run-002 lost an entire prompt tier: four checkers ran sequentially at 120 s each against a 300 s
`Stop`-hook timeout, Claude Code killed the hook mid-tier, and the single end-of-run `writeSession()`
never executed — the session file still read `last_checked_at: null` for all four prompt checks while
`.launch/hooks.log` showed three checker subprocesses had actually spawned. The hook now stops itself
at `hook_budget_ms` (270 s, under the 600 s hook timeout) so its writes always land, and any check it
could not reach is recorded `error` rather than silently left `pending`.

### Verdict contract v2 — a grader that cites nothing did not look

A prompt checker returns JSON matching `VERDICT_SCHEMA`: `pass` (bool), `reason` (string),
`evidence` (array of `{path, line?, quote}`), `confidence` (`high`|`low`) — all four required.
`resources/prompt-checker-system.md` requires the citations. A `pass` with an empty `evidence`
array is recorded as-is and **flagged ungrounded** by both `probe-checks.mjs` and
`/ab-bench:analyze`; it is never silently accepted, because an uncited pass and a real pass are
indistinguishable in the session file otherwise.

`model` is validated before the subprocess spawns: a documented CLI alias (`fable`, `opus`,
`sonnet`) or a full `claude-*` id. Anything else errors loudly at gate time rather than
resolving to a bigger model and quietly costing ~4x. `DOD_LITE_CLAUDE_CMD` (a JSON array,
`[exe, ...prefixArgs]`) substitutes the checker binary — the supported way to pin a specific
`claude`, and what the test suite uses. Never shadow PATH: `spawn` runs with `shell:false`, so
on Windows a `.cmd` shim is skipped and the real binary runs anyway.

### The human tier is gone, and the arm has no write channel at all

There used to be a third tier that blocked the turn and instructed the arm to ask the user via
`AskUserQuestion`, writing the answer to `<workspace>/.dod-answers/<id>.json`. It is removed
entirely, along with that directory.

It was removed for the same reason as the blocking: it **manufactured the autonomy signal the
harness measures**. Forcing an arm to call `AskUserQuestion` and then subtracting those calls
back out via `hitl_harness` was a correction for damage the instrument itself caused. Not
causing it is strictly better.

**The human is the gate now.** A session ends when it ends. The operator either stops and reports
the job undone at `/ab-bench:analyze` (recorded per arm in `analysis/delivery.json`), or feeds
back and grants another turn — which the per-turn audit then captures separately, so improvement
and regression across turns stay attributable. `probe-checks.mjs` rejects any surviving
`type: human` check as `UNSUPPORTED` rather than letting it record an ungraded error every turn.

`hitl_harness` is retained in `compare-runs.mjs` as a legacy reader: runs already on disk carry
`answer_source: "arm-reported"` entries, and their autonomy numbers must stay reproducible. It is
always 0 for anything fired since. Those older answers are subtracted because an arm must
not be penalised for interruptions the harness itself caused.

### Checker subprocesses are not arm sessions

A prompt-tier check runs `claude -p` **inside the arm workspace**, so that subprocess inherits
`<workspace>/.claude/settings.json` and fires ab-bench's own SessionStart and Stop hooks. dod-lite
marks those subprocesses with `DOD_LITE_CHECKER=1` (its own recursion guard uses the same marker),
and both ab-bench arm hooks bail on it: no manifest entry, no `.dod` registration, no turn count.
Without that guard the manifest fills with checker sessions — consultant run-001's test arm logged
23 "sessions", most of them checkers — and since `compare-runs.mjs` analyzes the LAST session
segment, the arm's real work gets replaced by a 13-line checker transcript.

## Turn counting (`.launch/turns/`)

Each arm workspace also gets a `Stop` hook, `arm-turn-count.mjs`, writing
`runs/run-NNN/.launch/turns/<session_id>.json`: `turns` (stops where `stop_hook_active` was false —
one real user-turn-to-final-response cycle), `stops_total`, `blocked_continuations` (stops dod-lite
refused because checks were failing). The same `turns` value is mirrored, as an absolute write, into
`~/.claude/turn-counts/<session_id>.count` — the path a Claude Code statusline conventionally reads —
so the live footer and the final analysis cannot disagree.

ab-bench counts its own stop signals rather than trusting an operator's global counter hook: measured
across three fired runs, arm sessions with 300–620 transcript lines had either no count file or one
frozen at 1, which left footers deriving turns from raw JSONL (one entry per tool-call round trip, so
"135 turns" against another arm's "1"). `/ab-bench:fire` will not hand a run over until
`verify-launch.mjs` shows both arms linked AND counting; `compare-runs.mjs` raises a parity flag and
marks `turn_counts.note` INCOMPLETE if a counter is ever missing at analyze time.

## What `/ab-bench:plan` must actually do

1. Interview for real script/prompt criteria for what "done" means for this run's task, each
   mapped to a `mandate.md` section. There are two tiers; a criterion needing this user's taste
   is not a check, it is the quality verdict given at `/ab-bench:analyze` against the rubric.
   Budget the prompt tier: each prompt check bills one grader subprocess per turn per arm.
2. Check whether the plugin-under-test ships its own checker-like scripts (a `checks/`, `qa/`,
   `validators/` folder, or anything its README/SKILL.md documents as QA/validation tooling) BEFORE
   writing a generic check for a criterion those scripts already cover — use the plugin's own script
   instead, tagged `source: "plugin-native"` in `dod-checks.json`.
3. Write REAL, working check files into `<testenvRoot>/.dod/checks/<id>.<ext>` — scripts with actual
   exit-code logic, `.md` files with real self-contained grading questions. These get executed
   for real by dod-lite's `Stop` hook every turn. No placeholders. Every check declares a
   `seed_expectation`.
4. **Run `probe-checks.mjs` and pass it.** Every check is executed against a pristine clone of
   `seed/` and must match its declaration. A rejection aborts — do not write `dod-checks.json`
   until the gate is green. `/ab-bench:fire` re-runs the same probe, because a check edited
   between planning and firing can stop discriminating without anyone noticing.
5. Write `runs/run-NNN/dod-checks.json` recording the final control/test id lists + tier + source.

Cost is real and worth stating: one seed clone plus N check executions per plan, and prompt
checks are N genuine `claude -p` calls. It buys the only guarantee that a green run measured
anything.

## What ab-analyze reads

- `<testenvRoot>/.dod/sessions/<session-id>.json` per arm (semi-opaque past `checks`/`state`/
  `history` — anything else dod-lite adds is passed through to the session-comparator agent
  untouched). `evidence`/`confidence` feed the ungrounded-verdict check. `history` is the
  **per-turn append-only series**: read as a trajectory (when each check turned green, and which
  ones regressed pass -> fail between turns), not as a final score.
- `analysis/prompt-parity.json` — every user turn from both transcripts, diffed. Since nothing
  drives an arm to completion any more, the operator's between-turn prompts are an uncontrolled
  independent variable across two arms; a `DIVERGENT` verdict bounds every causal claim.
- `analysis/delivery.json` — per arm, did it actually deliver. An arm that quit early looks cheap
  and fast on every countable pillar, so a run with any `delivered: false` yields no regression
  point and an `inconclusive` hypothesis.
- `runs/run-NNN/dod-checks.json` — to explain (not flag as a violation) any control/test check-list
  asymmetry sourced from a plugin-native checker.
- `runs/run-NNN/manifest.json` → `arms.<arm>.artifacts[]` — what each arm actually ran against.
  This is what `comparison.json`'s `pins` is derived from, and what tells the comparator which
  artifact is even eligible to be named as a cause.
- `<configRoot>/env.json` and `<mandateFile>` (from `.ab-bench/` in the plugin repo, not
  `testenvRoot`) — the only two artifacts analyze reads from the config side rather than testenv.
