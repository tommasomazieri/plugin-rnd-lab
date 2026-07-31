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

Produces `analysis/metrics-control.json`, `analysis/metrics-test.json`, `analysis/comparison.json`,
and — per arm — `analysis/digest-<arm>.md`, a bounded line-anchored narrative of that arm's
transcript. Prints the summary table. Show the table to the user.

## 3. Read the parity flags yourself — some of them END the analysis

Surface every PARITY FLAG to the user immediately. These five mean the run is **unanalyzable
as-linked**: report the defect, do NOT proceed to a verdict, do NOT ask the comparator for a
score, and tell the user what to fix before re-firing.

- `NOT AN ARM SESSION` — the selected transcript is a dod-lite prompt-checker subprocess, so
  every number describes a grader. Re-select the arm's real session from `manifest.json`.
- `STUB TRANSCRIPT` — an abandoned or restarted session got linked.
- `TRANSCRIPT SIZE ASYMMETRY` — the arms did not do comparable amounts of work.
- `MODEL PARITY VIOLATION`.
- `TEST ARM RECORDED NO PLUGIN-ATTRIBUTED ACTIVITY` — the plugin was never invoked; nothing
  this run is attributable to it.

Checks reported `pending` or `error` were never graded — say so as a harness defect, never as
a quality result.

`STALE DoD VERDICTS` does not end the analysis, but it **voids the scoreline**. It means a check
was graded BEFORE that arm last changed the deliverable, so the verdict describes an artifact that
no longer exists. Wait for the checks to settle and re-run step 2 before quoting any pass/fail
count. In run-004 a snapshot taken while the prompt tier was still executing reported test 8/10
when the true result was 10/10 — a "control won on quality" reading that contradicted the operator
and had to be retracted mid-analysis. A stale `fail` is indistinguishable from a real one, which is
why the flag exists rather than a judgement call.

**Token attribution — read the breakdown under the table.** The summary is `combined`: each arm's
own session PLUS every subagent it dispatched. Subagent sessions live outside the parent transcript
(at `<projectDir>/<sessionId>/subagents/agent-*.jsonl`), so an arm that delegates heavily would
otherwise look cheap for work it actually did. Two lines there need acting on:

- `! N dispatch(es) with no transcript — UNMEASURED` — work happened that is still not counted.
  Every cost figure for that arm is a floor, not a total; say so rather than quoting the delta flat.
- `[harness, excluded]` — dod-lite's own prompt-checker sessions, which run with `cwd` set to the
  arm workspace and therefore land in the same project directory. Grading overhead, not arm cost,
  and excluded from both arms. Report it separately if the run's full footprint matters; never fold
  it into a cost or quality verdict.

## 4. LLM contextualization layer

Delegate to the **session-comparator** agent (plugin agent, `ab-bench:session-comparator`).
Its task prompt must contain: absolute paths to **both `analysis/digest-<arm>.md` files**,
comparison.json, both metrics files, both raw transcripts (from manifest.json — last session
segment per arm; the agent uses these only to expand specific `L<n>` anchors), both
`testenvRoot/.dod/sessions/<session-id>.json` paths (note if absent),
`runs/run-NNN/dod-checks.json` path (note if absent), `configRoot/env.json` path, `mandateFile`
path (note if absent — legacy experiment; read `manifest.json`'s `mandate`/`env` fields to
confirm you're pointing at the right one if it's ambiguous), and the verbatim human verdict.
Nothing else — the agent knows its method and output format.

**Reject the agent's output and re-delegate once** if it comes back without an `## Evidence
log` section showing both digests read in full, or if any `[OBJECTIVE]` finding carries no
`L<n>` / `metric:` citation. An unanchored causal claim is the exact failure this pipeline
exists to prevent — do not paste one into the report. If the second attempt is still
unanchored, put the findings in the report under a heading that says they are unverified.

## 5. Write analysis/report.md

Structure:

```markdown
# <experiment> — run-NNN analysis (<date>)

## Human verdict (verbatim)
> ...

## Deterministic comparison
<summary table + parity flags from step 2>

## Contextualized analysis
<session-comparator output, unedited — its [OBJECTIVE]/[SUBJECTIVE]/[UNVERIFIED] tags and its
Evidence log and Not-investigated sections must all survive verbatim. Do not tidy them away:
what the analysis did NOT establish is part of the result.>

## Next-iteration actions
<the comparator's recommendations, reviewed: drop any you can refute from the metrics,
mark the rest as TODO items targeting the plugin-under-test repo>
```

If the run hit a stop condition from step 3, the report is just: human verdict, the
deterministic table, the parity flags, and a "What to fix before re-firing" list. No verdict,
no score.

## 6. Append the ledger row

Add to `testenvRoot/ledger.md`: run, control baseline (`vanilla` or `previous-version@<ref>` — read
`manifest.json`'s `arms.control.baseline`, don't re-derive it), date, one-word verdict (test-won /
control-won / wash / contaminated), subjective score, single most important delta, relative path to
report.md.

## 7. Close the loop

Tell the user the top recommendation and remind: apply fixes to the plugin-under-test in ITS OWN
repo — which, unlike before, is very likely the SAME repo this main session is already CD'd into;
don't confuse "editing the plugin" with "touching `.ab-bench/` or the testenv folder," those are
never where the plugin's actual source lives. Then `/ab-bench:plan` for the next run. ab-bench
never edits the plugin under test itself.
