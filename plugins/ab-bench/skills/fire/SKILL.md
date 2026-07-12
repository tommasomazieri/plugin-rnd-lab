---
description: >-
  Fire the planned A/B run: launch the control and test Claude Code sessions in two
  detached terminals with everything-else-equal configs. User-invoke only (side effects:
  spawns terminals). Use after /ab-bench:plan. Runs scripts/launch-pair.mjs which clones
  seed/ into twin workspaces, composes per-arm --settings + --mcp-config, injects the
  SessionStart linkage hook, and writes the run manifest.
argument-hint: "[experiment-name]"
disable-model-invocation: true
allowed-tools: Bash(node *) Read
---

# ab-bench: fire the run pair

Experiments live in `C:\Users\tomin\OneDrive\Desktop\PROGETTI\test-environments\`. Identify the
experiment from $ARGUMENTS or ask.

## 1. Preflight — dry run first

```
node "${CLAUDE_SKILL_DIR}/scripts/launch-pair.mjs" "<envRoot>" --dry-run
```

Then read `runs/run-NNN/.launch/parity-report.json` and show the user a terse summary:
- what BOTH arms share (model, prompt, common plugins/MCPs)
- what ONLY control gets, what ONLY test gets
- `dod_checks` + `dod_checks_note`: whether `dod-checks.json` exists (warn if missing: run proceeds
  without DoD tracking) and whether control/test check lists differ. A difference is fine IF it's
  explained by a plugin-native checker (check each item's `source`) — surface it as a fact, not
  automatically as a problem.

If anything looks asymmetric beyond the declared deltas AND beyond a documented plugin-native
checker difference, STOP and fix env.json or `dod-checks.json` before firing.

## 2. Fire

On user confirmation:

```
node "${CLAUDE_SKILL_DIR}/scripts/launch-pair.mjs" "<envRoot>"
```

Two titled terminals open ("AB <experiment> control run-NNN" / "... test ..."). Each arm's
SessionStart hook links its session id + transcript path into `manifest.json` and registers the
DoD tracker. Verify linkage after ~30s: read `manifest.json` — both arms should show
`status: "linked"` with a sessions entry. If an arm stays `launched`, check
`runs/run-NNN/.launch/hooks.log`.

## 3. Hand off to the user — state the discipline

- Work BOTH sessions as you naturally would. Divergent prompts to rescue a stalled arm are fine
  and expected — they are measured as bias indicators, not forbidden.
- Do NOT open extra Claude sessions inside the workspaces, and don't edit workspace files by hand
  mid-run — both contaminate the transcript-based metrics.
- Compact/clear when you'd naturally do it; asymmetry is recorded, not punished.
- When both arms are done (DoD says goal reached, or you decide), come back to the MAIN session
  and run `/ab-bench:analyze` with your verdict on output quality.
