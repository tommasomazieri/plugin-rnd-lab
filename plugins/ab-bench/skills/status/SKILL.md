---
description: >-
  Show the state of ab-bench experiments and runs: which experiments exist, which runs are
  planned/fired/linked/analyzed, session ids per arm, parity flags. Auto-trigger when the
  user says: "ab status", "experiment status", "how are my ab tests doing", "which runs are
  pending", "show the experiment state", "is the run linked", "list experiments". Read-only:
  reads env.json, manifests, ledger.md under PROGETTI\test-environments\.
argument-hint: "[experiment-name]"
---

# ab-bench: status

Root: `C:\Users\tomin\OneDrive\Desktop\PROGETTI\test-environments\`.

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
