---
description: >-
  Show the state of the ab-bench experiment tracked in the repo you're CD'd into: current
  mandate/env, which runs are planned/fired/linked/analyzed, session ids per arm, parity
  flags. Auto-trigger when the user says: "ab status", "experiment status", "how are my ab
  tests doing", "which runs are pending", "show the experiment state", "is the run linked",
  "list experiments". Read-only: reads .ab-bench/state.json, env.json, mandate.md, manifests,
  ledger.md.
argument-hint: "[mandate-N/env-M — optional, defaults to current]"
---

# ab-bench: status

Root: `${user_config.experiments_root}`. If that's empty or still literally reads
`${user_config.experiments_root}`, tell the user to run `/ab-bench:setup` first and stop.

**Resolve state**:

```
node "${CLAUDE_SKILL_DIR}/../init/scripts/ab-bench-scaffold.mjs" find-repo-root "<cwd>"
node "${CLAUDE_SKILL_DIR}/../init/scripts/ab-bench-scaffold.mjs" detect "<repoRoot>" "${user_config.experiments_root}"
```

`{"status":"fresh"}` → no experiment in this repo — tell the user `/ab-bench:init` first, stop.

Report, in order:

1. **Header**: `mandates` list (from `detect`'s output) with the current one marked, current
   env under it, `mandateExists`/`envExists` flags (either `false` = broken/interrupted setup —
   say so plainly), and `testenvRoot`.
2. **Per-run table** (scan `testenvRoot/runs/`), state derived from files on disk, never guessed:

| state | evidence |
|---|---|
| planned | `task.md` exists, no `manifest.json` |
| fired | `manifest.json` exists, an arm still `status: "launched"` |
| linked | both arms `status: "linked"` in manifest |
| analyzed | `analysis/report.md` exists |

If `$ARGUMENTS` names a different `mandate-N/env-M` than the current one, resolve and report
that instead (same `.ab-bench/<mandate>/envs/<env>/` + testenv pairing, just not the pointer in
`state.json`) — useful for checking an older env's history without switching the active one
(there's no "switch active env" operation; state.json's pointer only moves forward via
`/ab-bench:init`'s create-env/create-mandate branches).

Detail view per run: arms table (arm, session_id of last segment, #segments — flag >1, transcript
found on disk yes/no), DoD template present?, parity flags from `analysis/comparison.json` if it
exists. If an arm is fired-but-not-linked for a while, point at `runs/run-NNN/.launch/hooks.log`.

Keep output to one screen. Tables, no prose padding.
