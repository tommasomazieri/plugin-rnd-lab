---
description: >-
  Generate lab/paper.md — the written account of how the subject under test got to where it
  is, assembled from the objective's history, the hypothesis ledger, the findings, the
  regression curve, and every analysed run. Auto-trigger when the user says things like:
  "write the paper", "generate the report on the whole project", "what have we learned so
  far", "summarize the development", "show me the development timeline", "how did we get
  here", "write up the experiments", "state of the plugin", "/optimizer:paper".
---

# optimizer: write the development record

The paper is **generated, never hand-maintained**. Every claim in it traces to a run
artifact — that is the entire point. If something is worth saying and has no citation, it
is not a finding, it is a hypothesis, and it belongs in `lab/hypotheses.json` waiting to be
tested.

## 0. Locate the env

Run `ab-bench-scaffold.mjs detect` (see `/optimizer:plan` step 0) to get `testenvRoot`. If
the user has several envs, ask which one — a paper covers exactly one experiment lineage.

## 1. Generate

```bash
node "${CLAUDE_SKILL_DIR}/scripts/build-paper.mjs" "<testenvRoot>"
```

Writes `<testenvRoot>/lab/paper.md`. Re-running overwrites it; that is safe, because
nothing in it is authored by hand.

## 2. Read it yourself before showing it

The generator is deliberately dumb — it assembles, it does not interpret. Read the output
and tell the user plainly which of these is true, because each one changes what the
document is worth:

- **No regression points.** Then there is no trajectory at all. Every row in the Runs table
  is a delta between two arms on its own task, and those are not on a common scale. Say
  this out loud rather than letting a table of percentages imply progress it cannot support.
- **More than one rubric series.** The quality scale changed mid-project. Points either
  side are not one curve, and the paper says so — make sure the user registers it.
- **Fired-but-unanalysed runs.** They contribute nothing. Either analyse them or accept the
  record has holes.
- **Dirty pins (`*`).** Those runs are replayable from their cached snapshots but are not
  reconstructible from git history alone. Fine for internal work; worth flagging if the
  paper is going anywhere.
- **Hypotheses resolved `inconclusive`.** These are not soft failures — they mean a run was
  spent and bought nothing. If there are several, the run design is the problem, not the
  subject under test.

## 3. Offer the obvious next action

The paper's Open Hypotheses table plus `lab/objective.json` is exactly the input
`/optimizer:plan` uses to pick the next run. If the top-ranked open hypothesis is stale, or
the priority pillar no longer matches what the user actually cares about, say so now —
that is the cheapest moment to correct the direction of the whole programme.

## What this skill does NOT do

It does not write findings, resolve hypotheses, or score quality. Those happen in
`/optimizer:analyze`, against the run that earned them, with the evidence in hand. Writing
them here — after the fact, from summaries — is how a record starts drifting from what
actually happened.
