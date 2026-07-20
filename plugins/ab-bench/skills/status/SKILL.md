---
description: >-
  Show the state of ab-bench experiments and runs: which experiments exist, which runs are
  planned/fired/linked/analyzed, session ids per arm, parity flags. Auto-trigger when the
  user says: "ab status", "experiment status", "how are my ab tests doing", "which runs are
  pending", "show the experiment state", "is the run linked", "list experiments". Read-only:
  reads env.json, manifests, ledger.md under the configured experiments root.
argument-hint: "[experiment-name]"
---

# ab-bench: status

Root: `${user_config.experiments_root}`. If that's empty or still literally reads
`${user_config.experiments_root}`, tell the user to run `/ab-bench:setup` first and stop.

If $ARGUMENTS names an experiment, report that one in detail; otherwise list all experiments
(one line each: name, model, plugin under test, #runs, last run state) and detail the most
recently active.

Per run, derive state from files (never guess):

| state | evidence |
|---|---|
| planned | `task.md` exists, no `manifest.json` |
| fired | `manifest.json` exists, an arm still `status: "launched"` |
| linked | both arms `status: "linked"` in manifest |
| analyzed | `analysis/report.md` exists |

Detail view per run: arms table (arm, session_id of last segment, #segments — flag >1, transcript
found on disk yes/no), DoD template present?, parity flags from `analysis/comparison.json` if it
exists. If an arm is fired-but-not-linked for a while, point at `runs/run-NNN/.launch/hooks.log`.

Keep output to one screen. Tables, no prose padding.
