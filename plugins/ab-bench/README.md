# ab-bench

A/B testing harness for Claude Code plugins: does your plugin actually beat the status-quo way
of doing the same job? ab-bench fires **paired sessions** — control arm (status quo, e.g. raw
Blender MCP) vs test arm (plugin under test) — with *everything else equal*, then fuses session
JSONLs, DoD tracker logs, and the human's quality verdict into an evidence-backed report that
drives the plugin's next iteration.

## Lifecycle

```
/ab-bench:setup      configure experiments_root (once, or to change it later)       ← one-time
/ab-bench:init       create experiment env (env.json, seed/, .dod/, ledger.md),
                     then MANDATORILY runs /ab-bench:understand below
/ab-bench:understand interview → mandate.md: what the plugin is FOR (domain, capability
                     gap, good-outcome definition, non-goals, complexity ceiling, weak
                     spots). Also standalone, re-invokable anytime scope changes.
/ab-bench:plan     write plugin-blind task.md + pre-register DoD checks,
                     each justified against mandate.md                    ← per run
/ab-bench:fire     launch both arms in detached terminals                 ← per run
   (user drives both sessions as normal work; DoD tracks goal completion)
/ab-bench:analyze  deterministic metrics + session-comparator agent + human verdict
                   → analysis/report.md + ledger row                      ← per run
   (apply report recommendations to the plugin's own repo, then plan the next run)
/ab-bench:status   state of all experiments/runs at any time
```

## Experiment layout (`<experiments_root>\<experiment>\`, see `/ab-bench:setup`)

```
env.json            experiment contract: model + common/control/test config deltas (locked for the
                     experiment's life) + optional pluginUnderTestRepo (git repo, for baselines below)
mandate.md          what the plugin under test is FOR — produced by /ab-bench:understand,
                     mandatory before /ab-bench:plan will draft anything. Metadata, not an arm
                     config delta, so it's editable anytime (unlike env.json). Never cloned into
                     seed/ or either arm's workspace.
seed/               starting files cloned into both workspaces each run
.dod/               dod-lite's real layout, SHARED across runs via a junction per arm:
                      checks/    real check files authored by /ab-bench:plan (script/prompt/human)
                      sessions/  per-session trackers, owned by dod-lite, seeded by our hook
baselines/<ref>/    git worktree checkouts of pluginUnderTestRepo at a pinned tag/commit — cached,
                     reused across every run that pins the same ref (see "Previous-version baselines")
ledger.md           run-over-run history table
runs/run-NNN/
  task.md           the assignment — identical for both arms, plugin-blind
  baseline.json     control's baseline this run: vanilla, or previous-version + resolved pluginDirs —
                     per-run (unlike env.json), written by /ab-bench:plan's resolve-baseline.mjs
  dod-checks.json   which check ids apply to control/test this run (+ tier + source/origin) — per-run,
                     NOT inside .dod/ (task-specific, unlike the shared check files)
  manifest.json     arm → session_id, transcript_path (linked by SessionStart hook); control also
                     records {type, ref} for its baseline this run
  .launch/          composed settings/mcp/batch files + parity-report.json + hooks.log
  control/  test/   twin workspaces (each gets TASK.md, .claude/settings.json hook, .dod junction)
  analysis/         metrics-*.json, comparison.json, report.md
```

## Parity model (what makes a run valid)

- Both arms: same model, same opening prompt (fixed constant), same seed files, same task.md,
  `--strict-mcp-config` + explicit `enabledPlugins` (no global-config bleed).
- Arms differ ONLY in the `control`/`test` blocks of env.json — PLUS, deliberately, in DoD checks
  that depend on the plugin-under-test's own checker tooling (`dod-checks.json` "source":
  "plugin-native"). `.launch/parity-report.json` records exactly this split per run, including
  whether the DoD check lists differ and why.
- User behavior after the opening prompt is free — asymmetries (extra prompts, compactions,
  /clear) are measured as bias indicators, never silently ignored.
- Registration/linkage is pure hook work (`skills/fire/scripts/arm-session-start.mjs`) — zero agent
  tokens, symmetric by construction (except the intentional plugin-native check asymmetry above).
- Control's IDENTITY (vanilla vs a previous released version) can vary run to run within the same
  experiment — never silently assumed, always recorded in `manifest.json` + a `ledger.md` column.
  See "Previous-version baselines" below.

## Previous-version baselines

Once a plugin under test is far enough along, "does it beat nothing" stops being the interesting
question — "does it beat the last release" is. `/ab-bench:plan` can pin control to a previous
tag/commit of the plugin under test instead of vanilla, per run:

- Requires `env.json.pluginUnderTestRepo` (a git repo path) — optional, set at `/ab-bench:init` or
  added later (it's metadata, not an arm config delta, so it isn't covered by the "never edit env.json"
  lock).
- `skills/plan/scripts/resolve-baseline.mjs` does an idempotent `git worktree add` at the chosen ref,
  cached under `<experiment>/baselines/<ref>/` and reused by every later run pinning the same ref —
  never installs a second copy of the plugin, sidestepping the plugin cache entirely (Claude Code only
  ever tracks ONE "current" version per plugin name; `--plugin-dir` loads straight from a folder
  instead, bypassing that limitation completely).
- It globs the worktree for `plugin.json` files and feeds each containing folder into control's
  `pluginDirs` for that run only, via `runs/run-NNN/baseline.json` — `env.json`'s own `control` block
  is never touched.
- `/ab-bench:plan`'s checker-discovery step (3b/4b) also looks inside the pinned worktree for the
  plugin's OWN shipped checker scripts, so a previous-version control's plugin-native DoD checks run
  the OLD checker against the OLD code — not today's checker against yesterday's code.

## Components

Scripts live inside the skill that fires them (`${CLAUDE_SKILL_DIR}/scripts/…`):

| piece | fired by | role |
|---|---|---|
| `skills/fire/scripts/launch-pair.mjs` | agent, in `/ab-bench:fire` | compose per-arm configs, spawn detached titled terminals (recipe ported from agentic_pm_app) |
| `skills/fire/scripts/arm-session-start.mjs` | hook runtime in each ARM session | SessionStart hook injected per workspace: manifest linkage + DoD registration (launch-pair wires its sibling path into workspace settings) |
| `skills/plan/scripts/resolve-baseline.mjs` | agent, in `/ab-bench:plan` | resolve control's baseline this run: vanilla, or an idempotent git-worktree checkout of the plugin-under-test at a pinned ref, feeding `pluginDirs` |
| `skills/analyze/scripts/compare-runs.mjs` | agent, in `/ab-bench:analyze` | pair arms, deltas, bias indicators, parity flags |
| `skills/analyze/scripts/analyze-jsonl.mjs` | library of compare-runs (+ standalone CLI) | deterministic metrics from one session JSONL (usage deduped by message id) |
| `agents/session-comparator.md` | delegated by `/ab-bench:analyze` | LLM layer: root-cause findings tied to transcript evidence, [SUBJECTIVE]-tagged score |
| `docs/dod-contract.md` | — | contract with the trimmed, hooks-only dod-lite engine ab-bench owns and auto-injects |

## dod-lite integration

See `docs/dod-contract.md`. `plugins/dod-lite` in this repo is not the standalone dod-lite — it's a
trimmed, hooks-only fork purpose-built as ab-bench's arm-side DoD enforcement engine, mandatory on
every run:
1. `/ab-bench:plan` authors REAL check files itself (never placeholders — reusing the
   plugin-under-test's own checker scripts where it ships them) — dod-lite ships no planning skill
   in this repo at all, so there is no in-session path for an arm to design its own,
2. `launch-pair.mjs` unconditionally injects `plugins/dod-lite` into both arms via `--plugin-dir`
   (never an `env.json` declaration) and links each arm workspace's `.dod` to the shared experiment
   `.dod/` via a directory junction (still required — the engine resolves `.dod` as a direct child
   of cwd, no upward search),
3. `arm-session-start.mjs` is the sole writer of `.dod/sessions/<session_id>.json` — it seeds both
   arms with the SAME check ids (or intentionally different ones, per plugin-native provenance)
   directly, with no foreign hook to race or wait for.

ab-bench degrades gracefully when no `dod-checks.json` exists for a run — analysis then leans on
metrics + human verdict only. That's the only way to skip DoD tracking now; the engine itself is
always present.

## Known gotcha: transcripts silently missing (fixed)

`/ab-bench:fire` runs `launch-pair.mjs` via the Bash tool, inside a live Claude Code session.
`CLAUDE_CODE_CHILD_SESSION`/`CLAUDECODE` inherit down through `cmd.exe -> start -> cmd /k` into
each arm's `claude.exe`, which then misclassifies the arm as a nested/child session and silently
skips transcript persistence — while hooks, DoD tracking, and cost accounting (separate subsystems)
keep working normally, so nothing *looks* broken until `/ab-bench:analyze` needs the JSONL. Fixed by
setting `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1` in each arm's launch batch file — the documented
override for exactly this "background launcher first started by Claude Code's Bash tool" case (see
`code.claude.com/docs/en/env-vars`, requires Claude Code v2.1.172+).

## v2 (designed-for, not built)

Headless mode: `env.json.mode = "headless"` reserved; the opening prompt already lives in task.md;
the analyzer only reads files. Autonomous loop = one extra launch mode + a loop skill, no refactor.
