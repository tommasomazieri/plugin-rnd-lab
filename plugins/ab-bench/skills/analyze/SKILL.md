---
description: >-
  Analyze a finished ab-bench run: deterministic metrics from both session JSONLs, DoD
  tracker comparison, LLM contextualization via the session-comparator agent, and the
  human's quality verdict — fused into analysis/report.md plus a ledger entry. Auto-trigger
  when the user returns from a run and says things like: "finished the testing", "both
  sessions are done", "analyze the run", "test session was better because...", "control won
  this time", "run the ab analysis", "compare the two sessions". Writes
  runs/run-NNN/analysis/ and appends ledger.md.
argument-hint: "[experiment-name] [verdict statement]"
---

# ab-bench: analyze run

Experiments live under `${user_config.experiments_root}`. If that's empty or still literally
reads `${user_config.experiments_root}`, tell the user to run `/ab-bench:setup` first and stop.
Identify experiment + run (default: latest fired run with linked arms and no `analysis/report.md`).

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
`.dod/sessions/<session-id>.json` paths (note if absent), `runs/run-NNN/dod-checks.json` path
(note if absent), env.json path, `mandate.md` path (note if absent — legacy experiment), and the
verbatim human verdict. Nothing else — the agent knows its method and output format.

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

Add to `<experiment>/ledger.md`: run, control baseline (`vanilla` or `previous-version@<ref>` — read
`manifest.json`'s `arms.control.baseline`, don't re-derive it), date, one-word verdict (test-won /
control-won / wash / contaminated), subjective score, single most important delta, relative path to
report.md.

## 6. Close the loop

Tell the user the top recommendation and remind: apply fixes to the plugin-under-test in its own
repo (separate dev session), then `/ab-bench:plan` for the next run. ab-bench never edits the
plugin under test itself.
