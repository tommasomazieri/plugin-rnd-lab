# plugin-rnd-lab — work in progress

Open problems in the Optimizer / Prospector / dod-lite system, found while analysing
`consultant` run-007 on 2026-08-05. Everything here is evidence-backed against the
`consultant/mandate-1/env-1` experiment; citations are to real files and real numbers, not
recollection.

Two items are **already fixed** (commit `b3892fe`) and recorded at the bottom for continuity.
Everything above that line is **TODO**.

---

## 1. TODO — Nobody owns `quality-rubric.md`, so seven runs have no quality number

### The state

`quality` is one of the five pillars and, per `lab/objective.json`, carries the standing
regression guard on every run. It is scored against `.ab-bench/<mandate-id>/quality-rubric.md`.

**That file has never existed for `consultant/mandate-1`.** Seven fired runs, zero comparable
quality measurements. Every quality verdict on record is the operator's eyes, which cannot be
plotted, cannot be regressed against, and cannot resolve a hypothesis whose target pillar is
`quality` — which is why H-003, H-012 and H-016 all resolved `inconclusive` regardless of what
either arm did.

It was logged as harness defect #4 in run-006's report and not fixed before run-007, the last
run the operator had agreed to fund.

### Three half-owners

| claimant | where | what it says |
|---|---|---|
| `/optimizer:understand` | `skills/understand/SKILL.md` §3b (line 153) | "Write `quality-rubric.md` — turn 'good' into something scoreable" |
| `/optimizer:analyze` | `skills/analyze/SKILL.md` line 126 | reads `.ab-bench/mandate-N/quality-rubric.md`, "(written by `/optimizer:understand`)" |
| `/prospector:handoff` | `plugins/prospector/lib/handoff.mjs` line 90 | "Writes mandate.md (+ quality-rubric.md when a rubric was supplied)" |

A step three skills half-own is a step nobody runs.

### Correcting the record on what `understand` is

The operator's recollection is that `understand` was meant as a teaching skill — something a
user invokes to learn how the plugin works. **That is not what either skill currently is**, and
the distinction matters for where the rubric should land:

- **`/optimizer:learn`** *is* the teaching skill, but its subject is the harness:
  *"Teach the user how optimizer works end-to-end: setup, planning an experiment, firing paired
  sessions… User-invoke only — a walkthrough / reference skill, not a workflow step."*
- **`/optimizer:understand`** is an **elicitation** skill:
  *"Interview the user to map out WHAT the plugin under test is actually FOR — its domain, the
  capability gap it fills… then write mandate.md, the north-star doc that /optimizer:plan
  cross-checks every task.md and DoD against."*

So there is currently **no** skill that teaches a user about the plugin under test. That is a
genuine gap and a reasonable thing to want, separate from the rubric question.

`git log -S` shows §3b was **not** in `understand` originally. It arrived in
`0791c11 feat(ab-bench): multi-artifact pinning, a falsifiability gate, five pillars` — bolted
onto the nearest existing skill during a broad enhancement, not placed by design. The operator's
instinct that this was "a poor change from the enhancement works" is correct.

### The deeper gap: nothing MAINTAINS the rubric

Even with an owner, `quality-rubric.md` is currently **write-once**. A rubric authored at
mandate time is a snapshot, and this experiment moved underneath it repeatedly: run-002/003/004
were three re-skins of one archetype, run-005 changed the archetype outright, run-006 stepped
the difficulty tier, run-007 changed archetype again. A v1 rubric written before run-001 would
have been describing a different deliverable by run-005.

`analyze` already anticipates this — it records `rubric_version` per score and
`/optimizer:paper` "says so where the fork happens" — but there is no skill that ever bumps the
version. The pipeline has a reader, a versioning convention, and no writer.

### TODO

- [ ] **Decide the owner.** Three candidates, laid out rather than chosen:
  - **(a) Keep it in `understand`.** Defensible — a rubric is elicited from the operator's
    taste, which is exactly what that skill does. Cheapest option: it already works, it just
    never ran for mandate-1.
  - **(b) New dedicated skill, e.g. `/optimizer:rubric`.** Create / amend / version as
    first-class operations. Fits the maintenance gap above, which neither (a) nor (c) covers.
  - **(c) Prospector owns it.** Already writes one at handoff, and the design package it
    produces is the natural place a quality scale comes from. But Prospector is discovery-stage
    and is not in the loop once an experiment is running.
- [ ] **Whoever owns it, add amend + version-bump**, not just create. A rubric that cannot
  change is one archetype shift away from being wrong, and a wrong rubric is worse than none
  because it will be plotted anyway.
- [ ] **Fix the dangling reference** in `analyze/SKILL.md:126` once the owner is decided — it
  currently names `understand` as the author in prose.
- [ ] **Backfill mandate-1's rubric** before run-008, or accept that run-008's quality result
  will be as unscorable as the previous seven.
- [ ] **Separately: decide whether to build the missing "teach the user about the plugin under
  test" skill**, and whether `learn` (which teaches about optimizer) belongs in a shared core
  plugin alongside it. This is the operator's stated original intent for `understand` and it is
  currently served by nothing.

---

## 2. TODO — Partition of concerns across the three plugins is undeclared

There are now three plugins (`optimizer`, `prospector`, `dod-lite`) and no document states
which owns what. The rubric mess in §1 is the first symptom; it will not be the last. Observed
overlaps:

- **Rubric authoring** — `optimizer:understand` and `prospector:handoff` both write it.
- **`mandate.md` authoring** — same two.
- **Teaching** — `optimizer:learn` teaches the harness; nothing teaches the artifact.
- **dod-lite's boundary** — dod-lite is injected unconditionally into both arms by
  `launch-pair.mjs`, and its `.dod/` resolution is a known problem (§4). It is an engine
  optimizer drives, but it ships as a peer plugin.

### TODO

- [ ] Write a short ownership table into the repo root README: for each artifact
      (`mandate.md`, `quality-rubric.md`, `dod-checks.json`, `.dod/checks/*`, `env.json`,
      `lab/*`), exactly one plugin and one skill that writes it, plus who reads it.
- [ ] Anything with two writers gets one removed, not documented as "both are fine".

---

## 3. TODO — **Investigate: what is the report actually FOR?**

*Operator's question, verbatim: "8 runs, not one tackled the main issue: cost. not ONCE cost has
been structurally cut down. the fuck is the report doing since after a run I have the plugin
manager Claude Code read it and implement the suggested fixes?"*

This is the highest-value item in this document. Preliminary evidence below; it needs a proper
investigation, but three concrete causes are already visible.

### 3a. The report has no actions section. It used to.

**run-004's report** (`runs/run-004/analysis/report.md`) ended with `## Next-iteration actions`:

> ### PRIORITY 1 — cost
>
> 1. **TODO — collapse front-loaded schema discovery.** Test spent ~15.5 min / ~22 tool calls
>    reading 6 reference docs, `render_pptx.py`, `layout.json` twice… Inline the `pptx_lib` /
>    `render_pptx` call signatures and the deck-spec schema directly into `SKILL.md`…
> 3. **TODO — fix the `qa_check.py` / `each-slide-earns-place` collision.**
>    `check_table_availability`'s `min_table_slide_fraction` floor pushed the model to pad slide
>    9 with a table duplicating slide 8's figures…

Numbered TODOs. Absolute file paths. Named functions. Measured evidence. Expected effect.
Priority ordering. An implementer can act on that without opening anything else.

**runs 005, 006 and 007 have no such section**, because the template formalised in
`analyze/SKILL.md` step 5 does not include one. Its sections are: What was compared, Hypothesis,
Pillar scoreline, Human verdict, Deterministic comparison, Contextualized analysis, Hypotheses
opened, Harness defects.

What the plugin-manager session gets instead, in full (run-006):

> - **H-013** — batch-collect all QA issues and fix them before the next render, instead of
>   fix-one-then-re-render. `input_tokens,output_tokens,turns` · mag 25 · conf 0.55 · cost 2.
> - **H-014** — cheap pre-render static lint over `deck_spec.json` reusing `qa_check.py`
>   arithmetic… `input_tokens,turns` · mag 20 · conf 0.5 · cost 3.

No file paths. No implementation detail. No acceptance criteria. No priority. To act on it, the
implementer must find `lab/hypotheses.json`, then find the report the hypothesis came from, then
reconstruct the evidence from the `Contextualized analysis` section.

**And the genre is wrong.** A hypothesis is a thing to *test*. The operator is feeding the report
to Claude Code as a *work order*. The document was retargeted from "what to build next" to "what
to experiment on next" without anyone deciding that, and the consumer never changed.

### 3b. The top-ranked cost hypotheses have never once been fired

Full ledger, `lab/hypotheses.json`, score = magnitude × confidence ÷ cost:

| id | opened | resolved by | status | pillars | score |
|---|---|---|---|---|---|
| H-004 | run-004 | **never** | open | input_tokens | 3.75 |
| H-005 | run-005 | **never** | open | input_tokens, turns | **9.75** |
| H-006 | run-005 | **never** | open | input_tokens, output_tokens | **12.00** |
| H-013 | run-006 | run-007 | refuted | input_tokens, output_tokens, turns | 6.88 |
| H-014 | run-006 | run-007 | confirmed | input_tokens, turns | 3.33 |
| H-017 | run-007 | — | open | input_tokens | 8.33 |
| H-018 | run-007 | — | open | input_tokens | 3.38 |

**run-007 fired H-013 (6.88) and H-014 (3.33) while H-006 (12.00) and H-005 (9.75) sat open,
on-priority, and higher-ranked.** Both had already been skipped by run-006. `/optimizer:plan`
step 0b explicitly says to take the top-ranked open hypothesis; three runs running, it didn't.

The mechanism is visible: every `analyze` cycle **banks new hypotheses**, and every `plan` cycle
picks from the freshest evidence — the run just analysed — because the newest idea is always the
one backed by the most recent transcript. The ledger grows, the top of the rank ages, and the
highest-scoring items are permanently crowded out by whatever was found yesterday.

### 3c. Every cost hypothesis for 8 runs attacked the wrong term

Cost hypotheses ever fired: H-001 (refuted), H-002 (refuted), H-011 (inconclusive), H-013
(refuted), H-014 (confirmed — mechanism worked, cost did not move). **Not one has ever
confirmed a cost reduction.**

Look at what they all target:

- H-001, H-002 — *how much is read per round* (reference docs, `build-api.md`)
- H-004, H-005, H-006 — *how much is re-read*, *round count*
- H-013 — *round count*
- H-014 — *round count*

Every single one attacks **how many times** something happens, or **how much is read each time**.

run-007 measured the actual cost function for the first time:

```
                 control      test
API calls          109         118   (+8%)
context, median  167,959    326,824  (+95%)
context, max     244,351    439,327
compactions          0           0
```

Cost = **Σ(context per call)**. Call count is +8%; context size is +95%. And 78% of the test
arm's cache-creation — $8.92, 54% of the entire $16.65 gap — is **four turns** bracketing two
background `deck-critic` dispatches, each re-writing the full ~400k context from scratch.

**Not one hypothesis in twenty targeted context accumulation** until H-017 was banked on
2026-08-05. So the honest answer to "why has cost never been structurally cut" is: **the
structural term was never identified, so nothing could have cut it.** Eight runs of optimising
round count against a cost function dominated by context size.

### TODO

- [ ] **Restore an actions section to the report template** (`analyze/SKILL.md` step 5), in
      run-004's shape: numbered, prioritised, absolute file paths, named functions, measured
      evidence, expected effect. Explicitly written for an implementer who has read nothing else.
- [ ] **Separate the two audiences.** `Hypotheses opened` is for the next `plan` cycle. The
      actions section is for the plugin-manager session. They are different documents' worth of
      content sharing one file — decide whether the report carries both, or whether analyze emits
      a second artifact (e.g. `analysis/fix-list.md`) that is the thing handed to the implementer.
- [ ] **Investigate why `plan` step 0b's ranking keeps being overridden.** Either the skill needs
      to hard-refuse a lower-ranked pick without an explicit written justification, or the ranking
      formula is wrong and freshness genuinely should weigh — but not both silently.
- [ ] **Audit whether run-004's actions were implemented**, since it is the one report that had
      them. Preliminary: action 1 became H-002 (build-api.md shipped, then *refuted* in run-005
      because nothing enforced it) and action 2 became H-006 (still open, never fired). That
      pattern — an action becomes a hypothesis and then never gets built — may be the whole
      failure in miniature and is worth confirming properly.
- [ ] **Add a pillar-coverage check to `plan`.** Eight runs, priority pillar `input_tokens` since
      2026-08-03, zero confirmed cost reductions. Something should notice out loud that the
      priority pillar has never once moved the right way, rather than leaving it to be spotted in
      a report's ledger row.

---

## 4. TODO — smaller harness defects, all from run-007

- [ ] **`task-notification` re-entries are counted as user turns.** One root cause, four wrong
      numbers: `pillars.test.turns` = 3 (real: 1), `autonomy.hitl_elective` = 2 (real: 0, both
      arms called `AskUserQuestion` zero times, grep-confirmed), `prompt-parity.json` verdict
      `DIVERGENT` (real: clean — one identical 113-char brief per arm), and
      `bias_indicators.user_chars` = 21,427 (real: ~113). Fix by excluding `task-notification`
      bodies from the turn/user-message classifier.
      **This systematically penalises whichever arm delegates — which is only ever the test arm.**
- [ ] **`STUB TRANSCRIPT` false-positives on every background-Agent subagent digest.** The
      "0 real user turns" heuristic is definitional for those sessions. Logged as run-006 defect
      #3; still unfixed.
- [ ] **`.dod/` is shared between both arm workspaces.** `launch-pair.mjs` junctions each arm's
      `.dod` to the same `<testenvRoot>/.dod`, so `.dod/sessions/` holds every session's scorecard
      and **either arm can read the other's**. Not exploited in run-007's transcripts. The
      junction is required (dod-lite resolves `.dod` as a direct child of cwd with no upward
      search) — the fix is to scope what lands inside it, not to remove it.
- [ ] **The prompt tier can fail on its own tooling and it reads as a quality result.**
      run-007's `movement-explained` failed on both arms with *"blocked by permission
      requirements"* / *"cannot parse the required binary Office files"*, and flipped `pass` →
      `fail` between turns 2 and 3 with no deck change. A grader that cannot open the artifact
      should report `error`, not `fail`.
- [ ] **The instrument may be causing the cost it measures.** dod-lite's Stop hook runs 12 checks
      including two `claude -p` graders, occupying ~3.5 minutes in each gap where run-007's test
      arm fully re-cached its context ($8.92, 54% of that run's cost gap). Stop timestamps
      (12:31:57, 12:42:55, 12:51:43) land squarely between the cache-creation spikes (12:28:16,
      12:34:32, 12:39:02, 12:45:55). **Not established as causal** — the alternative is that
      resuming after a background-Agent notification rebuilds the prefix regardless — and run-007
      cannot separate them, because control had one Stop and never resumed after it. Any run
      testing H-017 must vary the Stop-hook cost too, or it will confound the two.

---

## Fixed — 2026-08-05, commit `b3892fe`

Recorded so nobody re-opens them.

**DoD checks may never run the artifact's own tooling.** `/optimizer:plan` step 4b used to
*instruct* preferring a plugin-native checker over writing a generic one, with the resulting
asymmetric check list recorded so `analyze` would explain rather than flag it. Stale
marketplace-era text. run-007 followed it and shipped `qa-gate-clean`, which shelled out to the
plugin's `qa_check.py` — while the same plugin ships a `stop_qa.py` Stop hook that blocks the arm
until `qa_check` returns clean. The check could only ever report `pass`. It did, 3 of 3 turns.

Now: `source` has one legal value, `"generic"`; both arms' check lists must be identical;
`launch-pair.mjs` reports `dod_checks_asymmetric` / `dod_checks_non_generic` and `/optimizer:fire`
blocks on either. Propagated through `compare-runs.mjs`, `fire`, `learn`, the session-comparator,
the README and the DoD contract. The governing principle, operator's words: **everything that
lives in the plugin must function autonomously, as if no DoDs existed.**

**The 4e gate is two-sided and mechanical.** The seed probe proves a check can FAIL; it cannot
prove a check can ever PASS, and that is where every real defect has been. run-007 reported seven
DoD failures and **three were the checkers being wrong** — `status-rules-applied` failed both arms
on the run's central trap while both decks carried all seven correct statuses (it read a "Lead's
own view" column as the deck's own assertion), and `escalation-cap-honoured` failed the arm that
had escalated exactly the right four items, by reading its *working* slide and counting the
rejects.

Hand-built fixtures existed for that run and caught none of it, because they modelled the artifact
shape the author imagined rather than the shapes the arms produce.

`probe-checks.mjs` now discovers `runs/run-NNN/fixtures/pass*` and `fail*`, runs every check
against every one, and rejects `NO PASS FIXTURE`, `FALSE NEGATIVE` and `FALSE POSITIVE` alongside
the existing seed verdicts. At least one pass fixture is required and there is no flag to skip it.
An optional `expect.json` scopes a fixture to named checks — `pass*` strict by default, `fail*`
informational unless scoped, because a semantically wrong artifact is still a structurally valid
file and a file-validity check should pass on it.

Verified against the real defect: pointed at run-007's own two delivered decks as pass fixtures,
the gate rejects `status-rules-applied` and `escalation-cap-honoured` as FALSE NEGATIVE and clears
the four sound checks. **It would have blocked run-007 from firing.**
