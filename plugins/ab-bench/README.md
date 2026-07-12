# ab-bench

A/B testing harness for Claude Code plugins: does your plugin actually beat the status-quo way
of doing the same job? ab-bench fires **paired sessions** — control arm (status quo, e.g. raw
Blender MCP) vs test arm (plugin under test) — with *everything else equal*, then fuses session
JSONLs, DoD tracker logs, and the human's quality verdict into an evidence-backed report that
drives the plugin's next iteration.

## Lifecycle

```
/ab-bench:init     create experiment env (env.json contract, seed/, .dod/, ledger.md)
/ab-bench:plan     write plugin-blind task.md + pre-register DoD checks   ← per run
/ab-bench:fire     launch both arms in detached terminals                 ← per run
   (user drives both sessions as normal work; DoD tracks goal completion)
/ab-bench:analyze  deterministic metrics + session-comparator agent + human verdict
                   → analysis/report.md + ledger row                      ← per run
   (apply report recommendations to the plugin's own repo, then plan the next run)
/ab-bench:status   state of all experiments/runs at any time
```

## Experiment layout (`PROGETTI\test-environments\<experiment>\`)

```
env.json            experiment contract: model + common/control/test config deltas
seed/               starting files cloned into both workspaces each run
.dod/               dod-lite's real layout, SHARED across runs via a junction per arm:
                      checks/    real check files authored by /ab-bench:plan (script/prompt/human)
                      sessions/  per-session trackers, owned by dod-lite, seeded by our hook
ledger.md           run-over-run history table
runs/run-NNN/
  task.md           the assignment — identical for both arms, plugin-blind
  dod-checks.json   which check ids apply to control/test this run (+ tier + source) — per-run,
                     NOT inside .dod/ (task-specific, unlike the shared check files)
  manifest.json     arm → session_id, transcript_path (linked by SessionStart hook)
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

## Components

Scripts live inside the skill that fires them (`${CLAUDE_SKILL_DIR}/scripts/…`):

| piece | fired by | role |
|---|---|---|
| `skills/fire/scripts/launch-pair.mjs` | agent, in `/ab-bench:fire` | compose per-arm configs, spawn detached titled terminals (recipe ported from agentic_pm_app) |
| `skills/fire/scripts/arm-session-start.mjs` | hook runtime in each ARM session | SessionStart hook injected per workspace: manifest linkage + DoD registration (launch-pair wires its sibling path into workspace settings) |
| `skills/analyze/scripts/compare-runs.mjs` | agent, in `/ab-bench:analyze` | pair arms, deltas, bias indicators, parity flags |
| `skills/analyze/scripts/analyze-jsonl.mjs` | library of compare-runs (+ standalone CLI) | deterministic metrics from one session JSONL (usage deduped by message id) |
| `agents/session-comparator.md` | delegated by `/ab-bench:analyze` | LLM layer: root-cause findings tied to transcript evidence, [SUBJECTIVE]-tagged score |
| `docs/dod-contract.md` | — | cross-plugin contract with DoD-lightweight (order-independent registration) |

## dod-lite integration

See `docs/dod-contract.md` — read against dod-lite's REAL source, not assumed. dod-lite's
SessionStart hook is already create-if-absent (verified), but it has NO concept of an externally
authored template: left alone, its own plan-mode gate pushes each arm session to invent its own
checks independently. ab-bench prevents that by:
1. authoring REAL check files in `/ab-bench:plan` (never placeholders — reusing the
   plugin-under-test's own checker scripts where it ships them),
2. linking each arm workspace's `.dod` to the shared experiment `.dod/` via a directory junction
   (required — dod-lite resolves `.dod` as a direct child of cwd, no upward search),
3. seeding both arms' `.dod/sessions/<session_id>.json` with the SAME check ids (or intentionally
   different ones, per plugin-native provenance) and `planning_invoked: true` before either arm's
   session ever gets nudged toward `dod-lite:planning`.

ab-bench degrades gracefully when no `dod-checks.json` exists for a run — analysis then leans on
metrics + human verdict only.

## v2 (designed-for, not built)

Headless mode: `env.json.mode = "headless"` reserved; the opening prompt already lives in task.md;
the analyzer only reads files. Autonomous loop = one extra launch mode + a loop skill, no refactor.
