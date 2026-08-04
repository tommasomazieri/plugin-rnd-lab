---
description: >-
  Fire the planned A/B run: launch the control and test Claude Code sessions in two
  detached terminals with everything-else-equal configs. User-invoke only (side effects:
  spawns terminals). Use after /optimizer:plan. Runs scripts/launch-pair.mjs which clones
  seed/ into twin workspaces, composes per-arm --settings + --mcp-config, injects the
  SessionStart linkage hook and the Stop turn-counter hook, and writes the run manifest,
  then gates handoff on scripts/verify-launch.mjs proving both arms are linked and counting. Run from the plugin-under-test's
  repo (or a subdirectory) — no argument needed, resolved from .ab-bench/state.json.
argument-hint: ""
disable-model-invocation: true
allowed-tools: Bash(node *) Read
---

# optimizer: fire the run pair

Experiments live under `${user_config.experiments_root}`. If that's empty or still literally
reads `${user_config.experiments_root}`, tell the user to run `/optimizer:setup` first and stop.

**Resolve current env** (same two-root pattern as `/optimizer:plan`):

```
node "${CLAUDE_SKILL_DIR}/../init/scripts/ab-bench-scaffold.mjs" find-repo-root "<cwd>"
node "${CLAUDE_SKILL_DIR}/../init/scripts/ab-bench-scaffold.mjs" detect "<repoRoot>" "${user_config.experiments_root}"
```

`{"status":"fresh"}` → tell the user to run `/optimizer:init` first, stop. Otherwise this gives
you `envFile`'s parent (**configRoot**, holds `env.json`) and `testenvRoot` (holds `seed/`,
`.dod/`, `baselines/`, `runs/` — where arm workspaces actually get created).

## 1. Preflight — dry run first

```
node "${CLAUDE_SKILL_DIR}/scripts/launch-pair.mjs" "<configRoot>" "<testenvRoot>" --dry-run
```

Then read `runs/run-NNN/.launch/parity-report.json` and show the user a terse summary:
- what BOTH arms share (model, prompt, common plugins/MCPs)
- what ONLY control gets, what ONLY test gets
- `dod_checks` + `dod_checks_note`: whether `dod-checks.json` exists (warn if missing: run proceeds
  without DoD tracking) and whether control/test check lists differ. A difference is fine IF it's
  explained by a plugin-native checker (check each item's `source`) — surface it as a fact, not
  automatically as a problem.

Also read and report `pins`, `pins_symmetric` and `pins_dirty`:
- **`pins`** — the resolved identity of every artifact on both arms. This is what the run is
  actually comparing; state it in plain terms ("control on my-plugin@v0.2.0, test on the
  current working tree").
- **`pins_dirty`** — any arm pinned to a snapshot of an uncommitted tree. The run IS
  replayable (the snapshot is cached and immutable, and editing the repo now cannot affect
  it), but it is **not reconstructible from git history alone**. Say so; offer to commit
  first if the run matters.
- **`prepare_cost`** — if any artifact declares a `prepare` command, its build time and
  output are excluded from the arm's metrics. Mention it, because it changes how the
  numbers should be read.

If anything looks asymmetric beyond the declared deltas AND beyond a documented plugin-native
checker difference, STOP and fix env.json or `dod-checks.json` before firing.

## 1b. Re-prove the DoD checks still discriminate

`/optimizer:plan` gated on this, but checks can be edited between planning and firing — and a
check that stopped discriminating produces a green run that measured nothing.

```
node "${CLAUDE_SKILL_DIR}/../plan/scripts/probe-checks.mjs" "<testenvRoot>" "<runDir>"
```

Non-zero exit means **do not fire**. Report which check was rejected and why, then hand back
to `/optimizer:plan` step 4 to fix it. Skip only if the run has no `dod-checks.json` at all.

## 2. Fire

On user confirmation:

```
node "${CLAUDE_SKILL_DIR}/scripts/launch-pair.mjs" "<configRoot>" "<testenvRoot>"
```

Two titled terminals open ("AB <experiment> control run-NNN" / "... test ..."). Each arm's
SessionStart hook links its session id + transcript path into `manifest.json`, registers the
DoD tracker, and **arms that arm's turn counter**.

## 3. Verify BOTH arms are measurable — before handing off

Wait ~30s for both terminals to reach their first prompt, then:

```
node "${CLAUDE_SKILL_DIR}/scripts/verify-launch.mjs" "<runDir>"
```

Exit 0 means both arms are linked and counting. Exit 2 means at least one arm is not, and the
output names which — **do not hand the run over in that state**. An arm with no counter cannot
be compared at the end: `/optimizer:analyze` has no real turn number for it, and the statusline
footer falls back to counting assistant transcript entries, which is one per tool-call round
trip, not one per turn (this is what produced a control reading "1 turn" against a test reading
"135"). Re-run the verify a few times if a terminal is slow; if an arm stays uncounted, read
`runs/run-NNN/.launch/hooks.log` and fix before working the run.

Turn counts live in `runs/run-NNN/.launch/turns/<session_id>.json` — `turns` (stop signals that
ended a user turn), `stops_total`, and `blocked_continuations` (stops dod-lite refused). The same
number is mirrored into `~/.claude/turn-counts/<session_id>.count`, which is where the footer
reads it, so the footer and the analysis agree by construction.

## 4. Hand off to the user — state the discipline

- Work BOTH sessions as you naturally would. Divergent prompts to rescue a stalled arm are fine
  and expected — they are measured as bias indicators, not forbidden.
- Do NOT open extra Claude sessions inside the workspaces, and don't edit workspace files by hand
  mid-run — both contaminate the transcript-based metrics.
- Compact/clear when you'd naturally do it; asymmetry is recorded, not punished.
- When both arms are done (DoD says goal reached, or you decide), come back to the MAIN session
  and run `/optimizer:analyze` with your verdict on output quality.
