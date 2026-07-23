---
description: >-
  Analyze a finished ab-bench run: deterministic metrics from both session JSONLs, DoD
  tracker comparison, LLM contextualization via the session-comparator agent, and the
  human's quality verdict — fused into analysis/report.md plus a ledger entry. Auto-trigger
  when the user returns from a run and says things like: "finished the testing", "both
  sessions are done", "analyze the run", "test session was better because...", "control won
  this time", "run the ab analysis", "compare the two sessions". Writes
  runs/run-NNN/analysis/ and appends ledger.md.
argument-hint: "[verdict statement]"
---

# ab-bench: analyze run

Experiments live under `${user_config.experiments_root}`. If that's empty or still literally
reads `${user_config.experiments_root}`, tell the user to run `/ab-bench:setup` first and stop.

**Resolve current env** (same two-root pattern as `/ab-bench:plan`/`/ab-bench:fire`):

```
node "${CLAUDE_SKILL_DIR}/../init/scripts/ab-bench-scaffold.mjs" find-repo-root "<cwd>"
node "${CLAUDE_SKILL_DIR}/../init/scripts/ab-bench-scaffold.mjs" detect "<repoRoot>" "${user_config.experiments_root}"
```

Gives you `configRoot` (env.json's parent), `mandateFile`, and `testenvRoot` (where
`runs/run-NNN/` actually lives — `compare-runs.mjs` derives it back out of `runDir` itself, so
you only need `testenvRoot` to locate the run). Identify the run (default: latest fired run
under `testenvRoot/runs/` with linked arms and no `analysis/report.md`).

## 1. Capture the human verdict

$ARGUMENTS usually contains it ("test delivered better output because xyz"). If the user gave no
quality verdict, ask ONE question: which arm produced the better output and why (free-form).
Record it verbatim — it goes to the comparator and into the report as-is.

## 2. Deterministic layer

```
node "${CLAUDE_SKILL_DIR}/scripts/compare-runs.mjs" "<runDir>"
```

Produces `analysis/metrics-control.json`, `analysis/metrics-test.json`, `analysis/comparison.json`
and prints the summary table. Show the table to the user. If PARITY FLAGS are printed, surface
them immediately — a model mismatch or missing transcript may invalidate the run.

## 3. LLM contextualization layer

Delegate to the **session-comparator** agent (plugin agent, `ab-bench:session-comparator`).
Its task prompt must contain: absolute paths to comparison.json, both metrics files, both
transcripts (from manifest.json — last session segment per arm), both
`testenvRoot/.dod/sessions/<session-id>.json` paths (note if absent),
`runs/run-NNN/dod-checks.json` path (note if absent), `configRoot/env.json` path, `mandateFile`
path (note if absent — legacy experiment; read `manifest.json`'s `mandate`/`env` fields to
confirm you're pointing at the right one if it's ambiguous), and the verbatim human verdict.
Nothing else — the agent knows its method and output format.

## 4. Write analysis/report.md

Structure:

```markdown
# <experiment> — run-NNN analysis (<date>)

## Human verdict (verbatim)
> ...

## Deterministic comparison
<summary table + parity flags from step 2>

## Contextualized analysis
<session-comparator output, unedited — its [OBJECTIVE]/[SUBJECTIVE] tags must survive>

## Next-iteration actions
<the comparator's recommendations, reviewed: drop any you can refute from the metrics,
mark the rest as TODO items targeting the plugin-under-test repo>
```

## 5. Append the ledger row

Add to `testenvRoot/ledger.md`: run, control baseline (`vanilla` or `previous-version@<ref>` — read
`manifest.json`'s `arms.control.baseline`, don't re-derive it), date, one-word verdict (test-won /
control-won / wash / contaminated), subjective score, single most important delta, relative path to
report.md.

## 6. Close the loop

Tell the user the top recommendation and remind: apply fixes to the plugin-under-test in ITS OWN
repo — which, unlike before, is very likely the SAME repo this main session is already CD'd into;
don't confuse "editing the plugin" with "touching `.ab-bench/` or the testenv folder," those are
never where the plugin's actual source lives. Then `/ab-bench:plan` for the next run. ab-bench
never edits the plugin under test itself.
