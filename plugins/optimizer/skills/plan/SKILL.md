---
description: >-
  Plan the next A/B run of an optimizer experiment: write the task brief (task.md, the
  identical opening assignment both arms receive) and author REAL Definition-of-Done
  checks BEFORE firing — working script/prompt check files (dod-lite's exact
  format), reusing the plugin-under-test's own checker scripts where it ships them.
  Auto-trigger when the user says: "plan the next run", "plan run 2", "define the task for
  the ab test", "write the task brief", "set up the next iteration", "prepare the next
  optimizer run", "define DoDs for the experiment", "pin control to a previous version",
  "test against the last release". Creates runs/run-NNN/task.md, runs/run-NNN/baseline.json
  (control's vanilla-vs-previous-version choice), and runs/run-NNN/dod-checks.json, writes
  check files into .dod/checks/. Must run before /optimizer:fire. Run from the plugin-under-test's
  repo (or a subdirectory) — no argument needed, resolved from .ab-bench/state.json.
argument-hint: ""
---

# optimizer: plan next run

Experiments live under `${user_config.experiments_root}`. If that's empty or still literally
reads `${user_config.experiments_root}`, tell the user to run `/optimizer:setup` first and stop.

**Resolve current env** (two roots, not one — see docs/dod-contract.md if unfamiliar):

```
node "${CLAUDE_SKILL_DIR}/../init/scripts/ab-bench-scaffold.mjs" find-repo-root "<cwd>"
node "${CLAUDE_SKILL_DIR}/../init/scripts/ab-bench-scaffold.mjs" detect "<repoRoot>" "${user_config.experiments_root}"
```

`{"status":"fresh"}` → no experiment here — tell the user to run `/optimizer:init` first, stop.
Otherwise this gives you `envFile` (**configRoot** = its parent dir — holds `env.json`),
`mandateFile`, and `testenvRoot` (holds `seed/`, `ledger.md`, `.dod/`, `baselines/`, `runs/`).
If `$ARGUMENTS` names a different env explicitly (rare — targeting something other than the
current one), resolve that env's paths the same way instead of the current pointer.

Read `configRoot/env.json` and `testenvRoot/ledger.md` for context. Prior runs reach this one
through `lab/` (step 0b), not by re-reading their reports — every actionable thing a report
produced was banked as a hypothesis or a finding at analyze time. Open a prior `report.md`
only when you need the evidence *behind* a ranked hypothesis, and read its "Harness defects"
section if the ledger row says the run was contaminated.

**Preflight — `mandateFile` must exist.** If `detect` reported `mandateExists: false` (a legacy
or interrupted setup), STOP: tell the user to run `/optimizer:understand` first, and do not draft
task.md or DoD checks without it — designing tasks with no anchor to what the plugin is actually
FOR is the exact failure mode this file exists to prevent.

## 0b. Steepest descent — decide WHAT to test before deciding how

A run that isn't pre-registered against a hypothesis produces a number nobody can act on.
Start here, always:

```bash
node "${CLAUDE_SKILL_DIR}/../../lib/lab-cli.mjs" rank "<testenvRoot>"
```

**If no priority pillar is declared**, stop and settle it with the user first. The five
pillars — `quality`, `unique_tokens`, `api_calls`, `turns`, `autonomy` — trade against
each other, so "make it better" is not a direction. Exactly one is the priority; the rest
carry regression guards.

```bash
node "${CLAUDE_SKILL_DIR}/../../lib/lab-cli.mjs" objective "<testenvRoot>" \
    --priority <pillar> --guard quality=5 --why "<why this, now>"
```

Changing the priority later is expected and cheap — the old one is retired into the record,
not erased, and that sequence of shifts is the spine of the eventual write-up. What is
*not* cheap is never declaring one.

**Then take the top-ranked open hypothesis** (`score = predicted_magnitude × confidence ÷
cost`, with hypotheses that cannot move the priority pillar ranked below ones that can).

**Picking anything other than rank 1 requires a written reason, recorded in the run folder.**
The ranking is still an argument rather than an instruction — but an argument you can ignore
silently is not an argument, it is decoration. Observed failure: run-005 through run-007 each
fired a fresh, lower-ranked hypothesis while H-006 (score 12.00) and H-005 (9.75) sat open and
on-priority the whole time. The mechanism is structural, not carelessness — every `analyze`
cycle banks new hypotheses from the run just examined, so the freshest idea always arrives with
the most vivid evidence attached, and the top of the ledger ages out of attention while never
being rejected.

So, when the pick is not rank 1:

1. Say the delta out loud: *"taking H-014 (3.33) over H-006 (12.00)."*
2. Write the reason into `runs/run-NNN/hypothesis.md` under `## Why not the top rank`. One or
   two sentences. "It's fresher" is not a reason. "H-006 needs a fixture we don't have yet" is.
3. If the top-ranked hypothesis has now been skipped **twice or more**, stop and put it to the
   user directly: fire it, or resolve it as `withdrawn` with a reason. It does not get to keep
   sitting at the top being skipped — that is how the highest-value work becomes permanently
   invisible.

If the ranking formula is the thing that is wrong — if freshness genuinely should weigh — change
the formula deliberately and say so in the record. What is not acceptable is the formula saying
one thing and the runs doing another, silently, indefinitely.

If there are no open hypotheses, say so plainly and interview for one before going further:

```bash
node "${CLAUDE_SKILL_DIR}/../../lib/lab-cli.mjs" add "<testenvRoot>" \
    --statement "<what should move, and why>" --pillars api_calls,turns \
    --magnitude 20 --confidence 0.6 --cost 2 --why "<reasoning>"
```

Carry the chosen hypothesis id forward: `task.md` must exercise it, and the DoD checks must
be able to tell whether it held. Note it in the run folder so `/optimizer:analyze` can
resolve the right one.

**If the hypothesis is about context, caching, or session re-entry, the instrument is inside
the experiment.** dod-lite's Stop hook runs every check including any `claude -p` graders, and
it occupies real wall-time in exactly the gaps where a resumed session rebuilds its context
prefix. run-007: the Stop hook took ~3.5 minutes per turn across 12 checks with two prompt-tier
graders, and its timestamps (12:31:57, 12:42:55, 12:51:43) land squarely between the test arm's
cache-creation spikes (12:28:16, 12:34:32, 12:39:02, 12:45:55) — the four turns bracketing two
background dispatches accounted for $8.92, 54% of that run's entire cost gap.

That run **cannot** separate "background dispatch forces a re-cache" from "the Stop hook's
duration forces a re-cache", because control had one Stop and never resumed after it. Not
established as causal in either direction, and a run that varies only the artifact will not
establish it either — it will confirm whichever story you walked in with.

So when planning such a run, **vary the Stop-hook cost deliberately too**: same checks on both
arms as always, but either drop the prompt-tier graders to script-tier for the run, or plan a
second pairing that changes only the hook cost. Say in `hypothesis.md` which confound the design
separates and which it does not. A cost hypothesis that leaves this uncontrolled produces a
number that is not about the plugin.

**Autonomy is measured, so don't accidentally design it away.** Every `AskUserQuestion` the
arm makes counts against the autonomy pillar. Nothing in the harness forces one any more —
the DoD auditor never speaks to an arm — so every ask is the arm's own choice.
A task written as "ask the user before each step" pins that pillar to the floor for both
arms and measures nothing.

## 1. Create the run folder

Next number: scan `testenvRoot/runs/`, take highest `run-NNN` + 1 (start at `run-001`). Create
`testenvRoot/runs/run-NNN/`. Everything below that references `runs/run-NNN/` means this folder.

## 2. Pin the artifacts for this run

An **artifact** is any git-versioned thing the experiment is testing — declared once in `env.json`
under `artifacts` (see `/optimizer:init`), with its own repo and its own delivery mode. Most
experiments have exactly one (the plugin under test) and this step is a single question. An
experiment whose subject spans several repos pins each one independently.

Read `env.json`'s artifact ids first, then ask, per arm, what each is pinned to. Default the
suggestion to whatever the LAST run used (read `runs/run-NNN-1/baseline.json` if one exists) —
don't re-ask from scratch every time, just confirm "same as last run?" first. This choice is
per-run and is never written to env.json.

```bash
node ${CLAUDE_SKILL_DIR}/scripts/resolve-baseline.mjs <configRoot> <testenvRoot> <runDir> \
    [--control <spec>] [--test <spec>]
```

`<spec>` is `vanilla`, or a comma-separated `<artifactId>=<ref>` list. An artifact not named keeps
its working tree. Omitting an arm entirely means every artifact at its working tree.

| Intent | Command |
|---|---|
| control gets nothing at all | `--control vanilla` |
| control on a previous release (one artifact) | `--control my-plugin=v0.2.0` |
| control on the previous release of everything | `--control "plugin=v0.2.0,lib=v0.2.0"` |
| hold the library fixed, vary only the plugin | `--control "plugin=v0.2.0,lib=v0.3.0" --test "lib=v0.3.0"` |

That last row is the **isolating run**, and it is worth naming explicitly to the user: when two
artifacts move together, no single run can tell you which one caused the delta. If the point of the
run is attribution rather than "is the new release better", hold everything fixed except one thing.

**Every arm is pinned to something immutable, always.** An explicit ref becomes a cached git
worktree; no ref with a clean tree becomes that tree's HEAD sha; no ref with a *dirty* tree is
copied out and content-hashed into `baselines/<id>/_wt-<hash>/`. Arms never read a live repo, so
editing a plugin while a run is in flight cannot change what that run measured. If a pin came from
a dirty tree the resolver says so — tell the user, because that run is replayable but is **not**
reconstructible from git history alone.

The resolver fails loudly on a bad ref, a non-repo, or an artifact id `env.json` never declared.
Fix and re-run rather than proceeding without pins.

## 3. Write task.md — THE PARITY-CRITICAL ARTIFACT

`task.md` is copied verbatim into both workspaces as `TASK.md` and both arms open with the same
fixed prompt telling them to execute it. Rules:

- **Plugin-blind**: the brief must NEVER mention the plugin under test, its tools, or hint at a
  preferred workflow. It describes the JOB (what to build/produce, acceptance criteria, constraints),
  as a real user would state it to either setup. One mention of the plugin = contaminated run.
- Self-contained: assume the reading agent has ONLY this file plus the seed files.
- Concrete deliverables: name the output files/artifacts expected in the workspace.
- Same task complexity as prior runs if iterating (comparable ledger rows); note in the ledger if
  task difficulty changed.
- **Justified against `mandateFile`**: before drafting, identify which of mandate.md's sections
  (capability gap / good-outcome definition / appropriate complexity) this task is meant to
  exercise. State that justification when you show the draft to the user — if you can't point at
  a mandate.md section the task exercises, the task is probably testing something irrelevant to
  the plugin under test; narrow it until it does.

Draft it, show the user, iterate until approved.

## 4. Define REAL DoD checks — no placeholders

The DoD checks are the pre-registered success criteria — defined NOW, in the main session, before
any output exists, so post-hoc rationalization can't creep in. Every check file you write here is
executed FOR REAL by dod-lite's `Stop` hook, every turn, in both arm sessions. Never write a
placeholder/invented check "to fill the schema" — if a criterion can't be checked for real yet,
leave it out and say so.

Full schema and rationale: `${CLAUDE_SKILL_DIR}/../../docs/dod-contract.md`. Read it if unsure of
dod-lite's exact file formats before writing anything.

DoD tracking is mandatory, not opt-in: optimizer auto-injects the trimmed dod-lite engine into both
arms on every run (`launch-pair.mjs`, unconditional `--plugin-dir`) — there's no `env.json`
declaration to check, and no way for a check to end up inert because dod-lite wasn't loaded. The
only legitimate way to skip DoD for a specific run is to not write `dod-checks.json` at all (see
the graceful-degradation note in 4d) — say so plainly if that's what the user wants, rather than
running the interview below.

### 4a. Interview for criteria

Draft candidate criteria that would actually distinguish "done" from "not done" for THIS task. For
each, decide the tier — there are **two**:
- **script** — mechanically verifiable by exit code (file exists, build passes, output validates).
  Prefer this whenever possible. It is free.
- **prompt** — needs judgement but a read-only AI grader could resolve it by investigating.

There is no human tier. A criterion that genuinely needs this user's judgement (taste, "does this
match the ask") is not a check — it is the quality verdict, and it gets given at
`/optimizer:analyze` against the rubric. The old human tier blocked the arm with instructions to
call `AskUserQuestion`, which manufactured the autonomy signal the harness measures.

**Budget the prompt tier deliberately.** Every prompt check spawns a `claude -p` grader
**once per turn, per arm** — the auditor runs both tiers at every Stop, ungated, so the per-turn
series has no holes. Four prompt checks over a five-turn run is forty grader subprocesses. Script
checks cost nothing and can be as many as you like; each prompt check has to earn its place. If a
criterion can be expressed as an exit code, express it as an exit code.

For each candidate criterion, also state which `mandate.md` section it maps to (capability gap,
good-outcome definition, or known weak spot) — this is a hard requirement, not a nice-to-have. If
a criterion doesn't map to anything in mandate.md, flag it explicitly to the user before adding
it: either it's testing territory outside the plugin's stated purpose (drop it), or mandate.md is
incomplete and should be refreshed via `/optimizer:understand` (do that first, then resume here).

Present the list (what + tier + mandate.md mapping, not draft file contents yet) to the user,
iterate until agreed — propose before authoring, never the reverse. Zero checks can be a
legitimate outcome for a trivial task.

### 4b. NEVER use the artifact's own checkers as DoD checks

**Every DoD check is generic. It grades the OUTPUT using tooling that exists independently of
the artifact under test, and it runs identically in both arms.**

Do not import, copy, shell out to, or reference any script the plugin-under-test ships to grade
its own work — its `checks/`, `qa/`, `validators/` folder, its Stop-hook gate, its lint, its
self-scoring rubric. Not for one arm, not for both, not with an `origin` note explaining it. If
a criterion can only be expressed by running the artifact's own tooling, it is not a DoD
criterion. Drop it and say so.

**Three independent reasons, any one sufficient:**

1. **The artifact must function autonomously, as if no DoDs existed.** DoD checks are the
   operator's acceptance criteria, fixed before the run, from outside. The moment a check *is*
   the plugin's own gate, the experiment stops asking "did this produce good work" and starts
   asking "did this satisfy itself."

2. **A criterion the artifact already enforces internally cannot fail, so it measures nothing.**
   run-007 shipped `qa-gate-clean`, which shelled out to the plugin's `qa_check.py`. That same
   plugin ships a `stop_qa.py` Stop hook which **blocks the arm until `qa_check` returns clean**.
   The check could therefore only ever report `pass`. It did — 3 of 3 turns — and the delivered
   deck scored `count: 0`. A guaranteed-green row occupying a slot and looking like a criterion.

3. **It forces an asymmetric check list, which breaks the comparison.** A check only one arm can
   run grades only one arm. There is no comparison in that column, and every downstream
   pass-count silently stops being like-for-like.

**If the criterion is real, write a generic checker for it.** The plugin validates its own
export? Write a check that opens the output file and asserts what a good export looks like,
using a library that can measure either arm's output. That check grades control too, which is
the entire point.

List `testenvRoot/.dod/checks/` first — reuse an existing id if a prior run already covers the
same intent, don't duplicate. **Reusing an id does not inherit its correctness.** A check
written against a prior run's artifact shape has never seen this run's; step 4e is what settles
that, and it is the step that has failed most often.

### 4c. Author real check files into `testenvRoot/.dod/checks/`

dod-lite's exact format (id = filename without extension, unique within `checks/`). An id must
match exactly one file — `foo.py` and `foo.md` together are the same check declared twice and are
rejected, not silently resolved.

- **script**: `<id>.mjs|.js|.cjs|.sh|.ps1|.py|.rb` — actual working exit-code logic (0 = pass).
  Written here, from scratch or from a prior run's generic check — never lifted from the
  artifact under test (4b). Declared metadata goes in a `<id>.meta.json` sidecar, since an
  executable has nowhere to put frontmatter:
  ```json
  { "description": "one line", "seed_expectation": "fail" }
  ```
- **prompt**: `<id>.md` with frontmatter:
  ```yaml
  ---
  type: prompt
  description: "one line, shown in status/failure output"
  seed_expectation: fail    # see below — default fail, declare pass only for a regression guard
  model: claude-haiku-4-5-20251001   # prompt only; FULL model id, never a bare alias
  ---
  <self-contained grading question, answerable from files alone>
  ```
  A `prompt` checker runs with only read-only repo access and no conversation context — write the
  question so it states what "done" looks like, not just "did we do the thing." It must return
  citations (`evidence`), so the question has to be answerable from files, not from vibes.

**`model:` must be a full model id.** The CLI accepts unknown `--model` values silently and falls
back to a default, so a bare alias like `haiku` is not an error — it just quietly grades (and bills)
as something nobody chose. dod-lite now rejects anything that is neither a documented CLI alias
(`fable`, `opus`, `sonnet`) nor a full `claude-...` id. Omit the field to get the default grader.

**`seed_expectation` is what the check reports against an untouched seed workspace.** Default
`fail`: the check asserts work that has not happened yet. Declare `pass` only for a deliberate
regression guard ("the build still works"), and say why — a check that already passes on the seed
passes for both arms no matter what they do, so unless it flips it measures nothing. Step 4e
enforces the declaration against reality.

### 4d. Write `runs/run-NNN/dod-checks.json` — the per-run artifact

This lives in the RUN folder, NOT in `.dod/` — which checks apply to this run is task-specific, the
check FILES in `.dod/checks/` are the experiment-level shared/reused state.

```json
{
  "schema": 1,
  "run": "run-NNN",
  "checks": {
    "control": [ { "id": "...", "tier": "script|prompt", "source": "generic" } ],
    "test":    [ { "id": "...", "tier": "script|prompt", "source": "generic" } ]
  }
}
```

**`source` has exactly one legal value: `"generic"`.** `"plugin-native"` and its companion
`origin` field are RETIRED — see 4b. Anything downstream that still describes an asymmetric
check list as expected is describing behaviour that no longer exists.

**The two arms' lists must be identical.** Same ids, same tiers, same order. If you are about
to write different lists, the criterion driving the difference belongs in 4b's bin, not here.

The `arm-session-start.mjs` hook reads this file at fire time and seeds each arm's
`.dod/sessions/<session_id>.json` with exactly this list — that's what makes checks apply
seamlessly without either arm ever designing its own. dod-lite ships no planning skill in this
repo at all, so there's no in-session path to invoke even if an arm wanted to.

If the user wants to skip DoD tracking for this run entirely: don't write `dod-checks.json` at all
(optimizer degrades gracefully — analysis then leans on metrics + human verdict only). Say so plainly
before moving on.

### 4e. Prove every check works — TWO-SIDED, MANDATORY, before the run is fireable

**This is the step that has failed more than any other, and it has failed the same way every
time.** Read this before writing a fixture, not after.

A check must be proven in BOTH directions:

- **negative side** — it FAILS on work that is wrong (or absent). The seed probe does this.
- **positive side** — it PASSES on work that is right. **Nothing before run-008 tested this
  mechanically, and it is where every real defect has been.**

A check that fails on everything looks exactly like a strict criterion. It grades both arms
identically, it reads as a real result in the report, and nothing anywhere says otherwise.

**run-007, the run that made this mandatory.** Three of seven reported DoD failures were the
checkers being wrong, not the decks:

| check | what it did | what was true |
|---|---|---|
| `status-rules-applied` | failed BOTH arms on the run's central trap | both decks carried all seven correct statuses. It read a *"Lead's own view"* column as the deck's own assertion |
| `escalation-cap-honoured` | failed control | control escalated exactly the right four. The check read control's *working* slide — the one showing which items failed the test — and counted the rejects as escalations. It penalised the arm for showing its reasoning |
| `movement-explained` | failed both arms, flipped pass→fail mid-run with no deck change | a prompt-tier check that cannot open `.pptx` in its own spawn environment. It was grading its own tooling |

Fixtures **were** built and run before that run fired. They still missed it, for one reason
worth internalising: **the fixtures modelled the artifact shape I imagined, not the shapes the
arms actually produce.** Control put its statuses in floating text boxes over an empty-celled
table. Test put them in badge cards beside a table with an extra lead's-view column. One correct
answer, two renderings, one check, both misread.

#### Build the fixtures — from real artifacts, not from imagination

Under `runs/run-NNN/fixtures/`:

```
fixtures/
  pass/          a workspace whose artifact is CORRECT on every graded criterion
  pass-alt/      the same correct answers, a STRUCTURALLY DIFFERENT rendering
  fail/          a workspace that gets the traps wrong
  fail-alt/      (optional) a different way of being wrong
```

`pass*` and `fail*` are matched by prefix, so add as many variants as the criteria need.

**Scoping, via an optional `expect.json` inside a fixture dir:**

```json
{ "checks": ["status-rules-applied", "escalation-cap-honoured"] }
```

The two sides default differently, because they guard different things:

- **`pass*` is strict by default** — every check must pass on correct work. Declare `checks`
  only when a fixture genuinely cannot satisfy something (no rendered images to score, say);
  needing an exemption is a claim about the fixture and should be written down.
- **`fail*` is informational by default** — "wrong" is per-criterion. A fixture that is
  semantically wrong on every trap is still a structurally valid file, so a
  file-validity check passes on it and should. Requiring every check to fail on every fail
  fixture forces one fixture per check for no gain: the seed probe already rejects any check
  that can never fail. Declare `checks` to make a fail fixture a **hard** gate for exactly the
  checks it was built to trip.

Results outside a fixture's declared scope still print, marked `~`, so a surprising cell is
never hidden behind a blank.

Three rules, all learned the expensive way:

1. **At least one `pass*` fixture is required.** The gate refuses to green without one. There
   is no flag to skip it.
2. **Where a prior run's delivered artifact exists, build a variant from IT** — copy the real
   file in and correct only the graded values. That is the one source of artifact shapes you
   did not invent. run-006's two decks were sitting on disk during run-007's planning and were
   never used.
3. **Any check that parses structured output needs ≥2 `pass*` variants** rendering the same
   correct answer differently — table vs. prose, cells vs. overlaid boxes, merged vs. split
   columns. The gate warns when it sees only one; take the warning seriously, because a
   single-shape fixture is exactly what passed before run-007 and caught nothing.

#### Run the gate

```bash
node "${CLAUDE_SKILL_DIR}/scripts/probe-checks.mjs" "<testenvRoot>" "<runDir>"
```

It clones `seed/` into a throwaway workspace, runs every check against it, then runs every
check against every `pass*` and `fail*` fixture, and rejects:

| Rejection | What it means |
|---|---|
| `NO PASS FIXTURE` | nothing proves this check can ever pass. Build one (see above) |
| `FALSE NEGATIVE` | it failed on a fixture declared correct. **This is the run-007 defect.** The check is wrong, not the fixture — fix the check first, and only edit the fixture if the fixture is genuinely not correct work |
| `FALSE POSITIVE` | it passed on a `fail*` fixture — it does not detect the thing it exists for |
| `CANNOT DISCRIMINATE` | it already passes on an untouched seed, so it passes for both arms no matter what they do |
| `CRASHED` | it exited non-zero because it broke, not because the criterion failed |
| `BROKEN` / `MISSING` | it errored, or the file referenced in `dod-checks.json` isn't there |
| `UNGROUNDED` | a prompt check passed while citing no evidence — it didn't actually look |
| `DECLARED A REGRESSION GUARD` | `seed_expectation: pass` but it fails on the seed |
| `UNSUPPORTED` | a `type: human` check. The tier is gone; re-author it or judge it at analyze |

**Do not proceed while anything is rejected, and do not make the gate quiet instead of
correct.** Relaxing `seed_expectation`, deleting a fixture, or loosening a fixture's expected
values to get green converts a real signal into a decorative one — which is the failure this
whole step exists to prevent.

**Report the gate's output to the user before saying the run is ready.** Not "checks verified"
— the actual table, with the fixture count per check. Seven runs of "verified" that meant
"probed against the seed once" is why this paragraph is here.

This costs one seed clone, N fixture workspaces, and N×(1+fixtures) executions; prompt checks
are that many real `claude -p` calls. Say so before running it if the list is large. It is
cheaper than one contaminated run by two orders of magnitude.

`/optimizer:fire` runs the same probe again and refuses to launch on a mismatch, so a check
edited between planning and firing can't slip through.

## 5. Confirm ready

Tell the user: `run-NNN planned. Fire with /optimizer:fire when ready.`
Checklist to state:
- control baseline this run (vanilla, or previous-version@ref)
- `task.md` written, plugin-blind ✓
- `dod-checks.json` present — state the check count, confirm **both arms' lists are identical**,
  and confirm **every check is `source: "generic"`** — or say DoD was explicitly skipped
- **the 4e gate's actual output table**, including how many `pass*` and `fail*` fixtures each
  check was proven against. Do not summarise this as "checks verified"; paste the table.
