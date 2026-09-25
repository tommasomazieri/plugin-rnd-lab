---
description: >-
  Analyze a finished optimizer run: deterministic metrics from both session JSONLs, DoD
  tracker comparison, LLM contextualization via the session-comparator agent, and the
  human's quality verdict — fused into analysis/report.md plus a ledger entry. Auto-trigger
  when the user returns from a run and says things like: "finished the testing", "both
  sessions are done", "analyze the run", "test session was better because...", "control won
  this time", "run the ab analysis", "compare the two sessions". Writes
  runs/run-NNN/analysis/ and appends ledger.md.
argument-hint: "[verdict statement]"
---

# optimizer: analyze run

Experiments live under `${user_config.experiments_root}`. If that's empty or still literally
reads `${user_config.experiments_root}`, tell the user to run `/optimizer:setup` first and stop.

**Resolve current env** (same two-root pattern as `/optimizer:plan`/`/optimizer:fire`):

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

### 1b. Capture DELIVERY, per arm — this is not the same question as quality

The DoD auditor observes; it never pushes an arm to finish. **The user is the gate**: they end a
session when they choose, and an arm that stopped with the job half-done looks exactly like one
that finished. Nothing in the transcript, the manifest, or the DoD state distinguishes them, so
it has to be asked.

Ask, per arm: **did this arm actually deliver the task?** Not "was it better" — an arm can lose
on quality and still have delivered, and both arms can fail to deliver, which is itself the
most useful result a run can produce ("the plugin clearly needs to improve").

Write `analysis/delivery.json`:

```json
{ "control": { "delivered": true,  "note": "" },
  "test":    { "delivered": false, "note": "stopped after scaffolding, never wired the handler" } }
```

Consequences, applied in later steps and stated in the report:

- **Any arm `delivered: false` ⇒ no regression point.** `lab/regressions/points.json` plots
  comparable completed work; a run where someone gave up is not on that scale and must never
  join the curve.
- **Any arm `delivered: false` ⇒ hypothesis outcome is `inconclusive`**, unless the hypothesis
  under test was itself about delivery. A token saving bought by an arm quitting early is not
  a win, and `classifyOutcome` sees only deltas — it cannot tell the difference.
- **Both arms `delivered: false`** is a legitimate, reportable finding about the task or the
  plugin. Report it as one. Do not stretch for a winner between two failures.

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

`PROMPT PARITY` does not end the analysis, but it **bounds every causal claim in it**. Read
`analysis/prompt-parity.json`. Both arms get the same opening brief from `task.md`, and nothing
guarantees anything after that — since the DoD auditor stopped driving arms to completion, the
turns the operator types are an uncontrolled independent variable, and there are two arms. A
`DIVERGENT` verdict means part of the delta is attributable to what was typed, not to the
plugin. Quote the diverging turns in the report and say what they could account for. Never
present a plugin attribution as clean over a divergent run.

An `opening` that diverged is a different thing entirely — the harness sends both arms the same
prompt, so that is a launch fault. Treat it like the run-ending flags above.

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

## 3b. Score quality against the rubric — the only cross-run quality number

DoD checks are per-task, so their pass counts are meaningless next to another run's. The
comparable number comes from `.ab-bench/mandate-N/quality-rubric.md` (written by
`/optimizer:understand`), which both arms are scored against every run.

For EACH arm, score every rubric dimension 0–4 using its anchored descriptors, citing the
artifacts named in that dimension's `evidence_sources`. Then show both to the user and get
confirmation — the grader proposes, the human ratifies. Write
`analysis/quality-<arm>.json`:

```json
{ "rubric_version": "<from the rubric file>", "weighted_total": 2.85,
  "dimensions": [ { "name": "...", "score": 3, "weight": 0.4,
                    "evidence": ["path:line ..."], "human_confirmed": true } ] }
```

If no rubric exists yet, say so and skip — do NOT invent a quality number from the DoD
pass rate. A number that isn't comparable across runs is worse than no number, because it
will be plotted anyway.

Do this BEFORE step 4: the comparator reasons over all five pillars, and without the quality
score it can only attribute four of them.

## 4. LLM contextualization layer

Delegate to the **session-comparator** agent (plugin agent, `optimizer:session-comparator`).
Its task prompt must contain absolute paths to:

- **both `analysis/digest-<arm>.md` files**
- **every `analysis/digest-<arm>-sub-*.md`** — one per subagent session either arm dispatched.
  List them explicitly with their `agent_type` from `comparison.json` → `digests.<arm>.subagents[]`;
  don't leave the agent to discover them. If either arm dispatched none, say so, so an empty
  Evidence-log line reads as a fact rather than a skipped step.
- `comparison.json` and both metrics files
- both `analysis/quality-<arm>.json` from step 3b (note if the rubric didn't exist)
- both raw transcripts (from manifest.json — last session segment per arm; the agent uses
  these only to expand specific `L<n>` anchors)
- both `testenvRoot/.dod/sessions/<session-id>.json` paths (note if absent). Tell the agent to
  read `history` as a per-turn trajectory, not a final score — it is append-only, one complete
  entry per turn, so a check that regressed `pass` → `fail` mid-run is visible there and nowhere else
- `analysis/prompt-parity.json` and `analysis/delivery.json` — both bound what may be attributed
  to the plugin at all, so the agent must read them before ranking anything
- `runs/run-NNN/dod-checks.json` path (note if absent), `configRoot/env.json` path
- `mandateFile` path (note if absent — legacy experiment; read `manifest.json`'s
  `mandate`/`env` fields to confirm you're pointing at the right one if it's ambiguous)
- `testenvRoot/lab/objective.json` — the declared priority pillar and its guards
- **the hypothesis this run was fired to test**, verbatim: its id, statement and predicted
  mechanism from `lab/hypotheses.json`. If the run tested none, say that explicitly rather
  than omitting it, or the agent will assume you forgot.
- the verbatim human verdict

Nothing else — the agent knows its method and output format.

**Reject the agent's output and re-delegate once** if any of these hold. Each is a failure the
rest of the pipeline cannot recover from:

- no `## Evidence log` showing both arm digests AND every subagent digest read in full
- any `[OBJECTIVE]` finding with no `L<n>` / `metric:` citation
- a `## What was compared` that names a cause when more than one artifact differed in `pins`
- `## Candidate hypotheses` entries missing `PILLARS` / `MAGNITUDE` / `CONFIDENCE` / `COST`,
  or naming a pillar outside the five — step 4c feeds these straight into `lab-cli.mjs add`
  and a malformed one is dropped silently

An unanchored causal claim is the exact failure this pipeline exists to prevent — do not paste
one into the report. If the second attempt is still unanchored, put the findings in the report
under a heading that says they are unverified.

## 4c. Resolve the hypothesis this run was fired to test

```bash
node "${CLAUDE_SKILL_DIR}/../../lib/lab-cli.mjs" classify "<testenvRoot>" \
    --deltas '{"quality":<Δ>,"unique_tokens":<Δ>,"api_calls":<Δ>,"turns":<Δ>,"autonomy":<Δ>}' \
    [--contaminated]
```

Deltas are test-vs-control percentages: take the four countable ones straight from
`comparison.json`'s `pillars.deltas_test_vs_control`, and quality from step 3b. Pass
`--contaminated` if step 3 hit any stop condition — a run that cannot be trusted must
resolve `inconclusive` rather than quietly confirming something.

The classifier returns one of:

| outcome | meaning |
|---|---|
| `confirmed` | the priority pillar moved the right way and every guard held |
| `won-at-a-cost` | the priority moved, but another pillar regressed past its guard — a real result, and not a win |
| `refuted` | the priority did not move as predicted |
| `inconclusive` | contaminated, underpowered, or the priority pillar wasn't measured |

Record it, and record what was learned:

```bash
node ".../lab-cli.mjs" resolve "<testenvRoot>" --id <H-NNN> --run run-NNN --outcome <o> --note "..."
node ".../lab-cli.mjs" finding "<testenvRoot>" --text "<what is now known>" --run run-NNN --hypothesis <H-NNN>
```

Only write a finding you could defend from this run's artifacts alone. If the run suggested
something you can't yet support, that is a new hypothesis — see 4d, not a finding.

**The comparator's hypothesis reading can veto a `confirmed`.** If its `## Hypothesis
evidence` section says the predicted number moved for a reason other than the predicted
mechanism, do NOT record `confirmed`. Re-run `classify --contaminated`, resolve
`inconclusive`, and put the comparator's sentence verbatim in the `--note`. The classifier
sees only deltas; a delta that arrived by the wrong road is the one failure it cannot detect,
and recording it as a confirmation puts a false result into the permanent record that every
later run reasons from.

## 4d. Bank the comparator's candidate hypotheses

The comparator's `## Candidate hypotheses` section is already in the shape `lab-cli.mjs add`
takes. Transcribe each one — do not paraphrase, do not re-derive, do not invent extras:

```bash
node ".../lab-cli.mjs" add "<testenvRoot>" --statement "<STATEMENT>" --pillars <PILLARS> \
    --magnitude <MAGNITUDE> --confidence <CONFIDENCE> --cost <COST> \
    --why "<BASIS, including its citation>" --run run-NNN
```

Drop any whose `BASIS` cites nothing, and say which you dropped. An unsupported hypothesis
that enters the ledger gets ranked against real ones and can win on a fabricated magnitude —
this is the one place where a plausible guess does lasting damage, because `/optimizer:plan`
will spend a whole run on whatever ranks first.

Its `## Harness defects` section goes nowhere near the ledger. Those are optimizer/dod-lite
bugs — report them to the user in step 7 and leave the artifact's ledger clean.

**Record the absolute point for EVERY run.** Not only regression runs — this is what makes
"has the priority pillar ever actually moved?" a question with an answer:

```bash
node ".../lab-cli.mjs" regression "<testenvRoot>" --run run-NNN --rubric-version <v> \
    --kind <frozen|run> --arms '{"control":{...},"test":{...}}'
```

- `--kind frozen` — this run used the frozen regression task from `lab/regressions/`. These
  points are the only true like-for-like curve.
- `--kind run` — an ordinary run. Its task differs from every other run's, so these are **not
  a curve** and must never be plotted as one. They are the per-run record that lets anyone ask
  the question at all.

This used to be conditional on being a regression run, and consultant consequently reached
run-007 with an empty `lab/regressions/` and eight runs of unmeasured trajectory — the priority
pillar was missed eight times consecutively with nothing anywhere saying so. `/optimizer:plan`
now reports coverage from these points at step 0b, so a run that skips this hides the miss from
the next planner too.

## 5. Write analysis/report.md

Structure:

```markdown
# <experiment> — run-NNN analysis (<date>)

## What was compared
<the comparator's one-liner from `pins`: which artifacts differed, which were held constant.
A reader six months from now cannot reconstruct this from anywhere else.>

## Hypothesis
<the id and statement this run was fired to test, the classifier's outcome, and its
`why` string verbatim. If the comparator's mechanism reading forced a downgrade under 4c,
say that here with its sentence quoted. If the run tested no pre-registered hypothesis, say
exactly that — it means the result cannot feed the development record.>

## Pillar scoreline
<a 5-row table: pillar | control | test | delta | source. Countable four from
`comparison.json`'s `pillars`, quality from `analysis/quality-<arm>.json`. Mark the priority
pillar and any breached guard. Write "not scored" for quality if no rubric exists — never a
number derived from anything else.>

## Human verdict (verbatim)
> ...

## Deterministic comparison
<summary table + parity flags from step 2>

## Contextualized analysis
<session-comparator output, unedited — its [OBJECTIVE]/[SUBJECTIVE]/[UNVERIFIED] tags and its
Evidence log, Pillar attribution and Not-investigated sections must all survive verbatim. Do
not tidy them away: what the analysis did NOT establish is part of the result.>

## Hypotheses opened
<the ids `lab-cli.mjs add` returned in 4d, one line each, plus any candidate you dropped and
why. If none were opened on a run that produced findings, say why not.>

## Harness defects
<the comparator's Harness defects section, plus anything you hit yourself running this
analysis. These target optimizer/dod-lite, NOT the artifact under test. Empty is valid.>
```

If the run hit a stop condition from step 3, the report is just: what was compared, human
verdict, the deterministic table, the parity flags, and a "What to fix before re-firing" list.
No verdict, no score, no hypotheses opened.

## 5b. Write analysis/fix-list.md — the work order

**This file has a different reader than report.md, and that is the entire point.**

`report.md` is the evidentiary record: it answers *what happened*, and its `Hypotheses opened`
section feeds the next `/optimizer:plan` cycle. A hypothesis is a thing to **test**.

`fix-list.md` is handed to a separate plugin-manager session that is going to **build**. That
session has read nothing else — not the report, not the transcripts, not `lab/hypotheses.json`.
Handing it hypothesis one-liners (`H-014 — cheap pre-render static lint · mag 20 · conf 0.5 ·
cost 3`) makes it go find the report, find the run, and reconstruct the evidence before it can
touch a file. Runs 005–007 shipped exactly that and nothing structural was ever built from them.

Write it in the shape run-004 used, which an implementer could act on cold:

```markdown
# <experiment> — run-NNN fix list (<date>)

Generated for a session that has read nothing else. Every path is absolute.
Ordered by priority. Nothing here is a hypothesis to test — these are changes to make.

## PRIORITY 1 — <pillar this moves, e.g. api_calls>

### 1. <imperative one-line title>
- **File(s):** `<absolute path>`, function/symbol `<name>` where applicable
- **Change:** <what to do, concretely enough to start typing>
- **Evidence:** <the measured number from THIS run that justifies it, with its source —
  "test spent ~15.5 min / ~22 tool calls reading 6 reference docs (digest-test.json,
  L104-L212)". Never "the analysis suggests">
- **Expected effect:** <which pillar, roughly how much, and what would show it worked>
- **Do NOT:** <the adjacent change that would break something — omit if none>

### 2. ...

## PRIORITY 2 — ...

## Deliberately not doing
<changes the evidence points at that you are choosing to skip, and why. Keeps the next run
from re-opening them.>
```

Rules that keep it actionable:

- **Absolute paths, named functions.** A path the implementer has to search for is a path
  they will guess at.
- **Every item cites a measured number from this run**, with where it came from. An item with
  no number is a hunch and belongs in `Hypotheses opened` instead.
- **Priority is by the objective's priority pillar**, not by how interesting the finding is.
- **Harness defects never appear here.** They target optimizer/dod-lite and go to the report's
  own section — a plugin-manager session editing the artifact must not be handed instrument
  bugs it has no business touching.
- **An item may legitimately also be a hypothesis.** Say so and cross-reference the id: build
  it now, and let the next run measure whether it worked.
- If the evidence genuinely supports no concrete change, write `No actionable changes this
  run` and say what would have been needed. Do not pad it.

Then tell the user this file exists and what it is for — it is the artifact they hand onward.

## 6. Append the ledger row

Add to `testenvRoot/ledger.md`: run, the pins both arms ran against (read
`comparison.json`'s `pins` — don't re-derive them; mark a `dirty: true` pin with `*`), date,
one-word verdict (test-won / control-won / wash / contaminated), the hypothesis id and its
outcome, subjective score, single most important delta, relative path to report.md.

`ledger.md` stays a flat index of runs. The narrative lives in `lab/` and is assembled by
`/optimizer:paper` — never maintain the same fact in both.

## 7. Close the loop

Tell the user these things, in this order:

1. **`analysis/fix-list.md`** — the work order from 5b, by absolute path, described as the
   thing to hand to the session that will edit the plugin. This goes first because it is the
   only output of the whole run that changes the artifact.
2. **The top-ranked open hypothesis** — run `node ".../lab-cli.mjs" rank "<testenvRoot>"` after
   4d rather than guessing which of the new ones wins. That is the answer to "what to test next",
   which is a different question from "what to build next".
3. **Any harness defect** from the report's last section, separately and plainly. A broken
   check or a mis-scoped deny rule silently distorts every future run, so it outranks the
   artifact work even though it is less interesting.
4. The reminder below.

Apply fixes to the plugin-under-test in ITS OWN repo — which, unlike before, is very likely the SAME repo this main session is already CD'd into;
don't confuse "editing the plugin" with "touching `.ab-bench/` or the testenv folder," those are
never where the plugin's actual source lives. Then `/optimizer:plan` for the next run. optimizer
never edits the plugin under test itself.

### 7b. When the finding is not about efficiency at all — send it back

Everything above assumes the plugin is doing the right thing and the question is how well. Check
whether that assumption still holds, because this is the one failure the harness cannot see: every
pillar is a measure of execution, and a plugin aimed at the wrong job can post clean numbers on all
five while being worthless.

The signals, from the run you just analysed:

- the fix-list is mostly *"the user had to redo this"* / *"it solved a problem they didn't have"*
  rather than *"this costs too many turns"*;
- an arm delivered, scored well, and the operator's verdict was still that the output was not what
  they wanted;
- `mandate.md`'s capability gap no longer describes what the plugin is actually being used for;
- successive runs keep confirming hypotheses while the plugin gets no more useful.

**Say so explicitly and name `/prospector:reenter` as the next step**, in the plugin's own repo.
Optimizing an artifact aimed at the wrong problem makes the wrong thing arrive faster, and eight
efficient runs is an expensive way to find that out.

This is the return path the chain has always specified — the Optimizer never redefines the problem
itself, but it is the instrument most likely to notice that the problem needs redefining, and
staying silent about it is not neutrality. Prospector re-opens discovery, revises the design, and
hands back a new mandate; a scope change on this side is `/optimizer:init mandate`.

If Prospector was never used on this plugin, the same signal means the mandate needs re-interviewing
— `/optimizer:understand`. Do not simply keep planning runs against it.

## 8. The feedback line — first analysed run in this env only

If the row you appended in step 6 is the only run row in `ledger.md`, end your reply with this
line, verbatim, on its own, after everything in step 7 (and 7b, if it applied):

```
Feedback on plugin-rnd-lab, mostly clicks: https://docs.google.com/forms/d/e/1FAIpQLSfINKyrAFuydl9SC-wNGceL_I-04cWqy7BkeQf0IJSwOKxFfg/viewform
```

Once per env, never on a later run, never before the report and the fix-list are delivered, and
with nothing added around it. The form is how the author of optimizer learns what to fix;
asking every run would turn it into noise.
