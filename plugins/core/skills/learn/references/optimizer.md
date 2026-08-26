# Optimizer — the A/B harness, stage by stage

Reference for `/core:learn optimizer`. Walk this stage by stage; do not dump it whole.

## The one-paragraph mental model

You built (or are evaluating) a Claude Code plugin. Optimizer proves whether it actually helps
by running the SAME task twice, at the same time, in two identical-except-for-the-plugin Claude
Code sessions — a **control** arm (no plugin, or a fair compensating substitute) and a **test**
arm (your plugin) — then fuses both transcripts, both dod-lite check logs, and your own
judgement of which output was better into one evidence-backed report. Everything runs from a
third, separate **main session** — you never run Optimizer's own skills inside either arm. That
main session runs FROM the plugin-under-test's own repo (cd into it, start Claude Code there) —
Optimizer resolves which experiment you mean from cwd, via a gitignored `.ab-bench/` folder it
creates there; you never type an experiment name or path.

## Two roots — where things actually live

Each experiment splits across two places:

- **`.ab-bench/` inside the plugin repo** — identity/config only: `env.json` (arm config
  contract), `mandate.md` (what the plugin is FOR), and `quality-rubric.md` (what "good" means,
  made scoreable). Gitignored, never touched by an arm session.
- **The testenv, under `experiments_root`** — everything a run actually materializes on disk:
  `seed/`, `.dod/`, `baselines/`, `runs/`, `lab/`. Its path is auto-derived from the plugin
  repo's own folder name — nothing to name.

They are linked one level deeper too: mandate (1 per plugin, until its actual purpose changes) →
env (many — one per arm-config version) → run (many per env). `mandate.md` and
`quality-rubric.md` are shared by every env under their mandate, never duplicated; a new
`env.json` is what "new config = new experiment" now actually bumps. Full detail:
`plugins/optimizer/docs/dod-contract.md`.

## Stage: setup (`/optimizer:setup`)

One-time (or whenever you want to relocate). Optimizer needs exactly one folder OUTSIDE any
project repo where every testenv it ever creates lives — seed files, `.dod/`, run history,
transcripts, all auto-nested under `<experiments_root>/<plugin-folder-name>/mandate-N/env-M/`.
This path is stored as the plugin's `experiments_root` user-config option (Claude Code's own
per-plugin settings mechanism), not a bespoke file — it usually gets asked for automatically the
first time you enable the plugin; `/optimizer:setup` is the manual path if you skipped that
prompt or want to change it later. It is per-machine, not per-project: one shared folder reused
across every plugin you ever test. Every other Optimizer skill refuses to run until this is set.

## Stage: init (`/optimizer:init`)

Run this FROM the plugin-under-test's repo — no name or path argument. First time in a repo:
scaffolds `.ab-bench/mandate-1/envs/env-1/` there (with `env.json`, the locked-in arm-config
contract) plus the paired testenv folder, appends `.ab-bench/` to the repo's `.gitignore`, and
mandatorily chains into `/optimizer:understand`. Interviews you for: which folder(s) in this repo
are the plugin under test (auto-detected where possible), what control gets as a fair
compensation (can be nothing), config BOTH arms share (plugins/MCPs — arms run with
`--strict-mcp-config` and explicit `enabledPlugins`, so nothing leaks in from your global config
by accident), one model for both arms (no exceptions — that is a confound), and starting seed
files. `pluginUnderTestRepo` is never asked for — it is always the repo you are standing in,
which is also what unlocks previous-version baselines later automatically, no extra setup.

**Idempotent by design**: re-running init in a repo that already has `.ab-bench/` never
overwrites the current `env.json` — it offers three branches: continue to `/optimizer:plan` for
the next run, start a **new env** under the current mandate (the arm config needs to change —
different MCP/plugins/model — but the plugin's purpose has not), or start a **new mandate** (the
plugin's actual purpose changed, chains into `/optimizer:understand` for a full re-interview).
This is where the central discipline lives: **`env.json` is never edited once a run has fired
against it.** New config = new env, never a silent edit — otherwise later runs stop being
comparable to earlier ones. That no longer means inventing a new `mandate.md` too when only the
arm config changed — the mandate bumps only on the "new mandate" branch, when it actually should.

## Stage: understand (`/optimizer:understand`)

Closes a gap the rest of the lifecycle used to have: init captured WHICH plugin is under test,
but never WHAT it is for — so plan had no anchor beyond in-the-moment judgement when drafting
`task.md` or picking DoD checks. `/optimizer:init` MANDATORILY invokes this right after
scaffolding a fresh mandate (a fresh repo's first init, or its "new mandate" branch — reusing
context init already collected: plugin dirs, control compensation, repo path — never re-asking).
It is a grill-me-style interview across seven categories: domain/environment, the capability gap
the plugin fills, the target user's before/after workflow, a concrete definition of a good
outcome, explicit non-goals, the appropriate task-complexity ceiling, and known weak spots worth
stress-testing.

**It writes two files, not one:**

1. **`.ab-bench/mandate-N/mandate.md`** — the north star, in prose. Read-only background for
   main-session skills, shared by every env under that mandate, never cloned into either arm's
   workspace (that would break `task.md`'s plugin-blind requirement).
2. **`.ab-bench/mandate-N/quality-rubric.md`** — the same "what good looks like", turned into
   something scoreable: 3–6 weighted dimensions, weights summing to 1, each with observable 0–4
   anchors phrased so two people would agree which one applies. Prose cannot be compared across
   runs, and quality is the pillar the whole programme steers on, so the vague version gets made
   concrete exactly once and then held still. `/optimizer:analyze` scores against it and records
   the `rubric_version` alongside every score.

**Without the rubric there is no quality number** — only your eyes, which cannot be plotted or
regressed against, and any hypothesis whose target pillar is `quality` resolves `inconclusive`
no matter what either arm did.

Unlike `env.json`, both files are safe to edit anytime — they are metadata about purpose, not an
arm config delta. Re-invoke the skill standalone (`/optimizer:understand`, run from the plugin
repo) whenever the plugin's scope evolves — it will offer to refresh the CURRENT mandate in
place, or point you at `/optimizer:init`'s "new mandate" branch if the change is big enough to
warrant a whole new version. Full re-interview either way, never a partial patch.
`/optimizer:plan` refuses to draft a task or DoD checks if `mandate.md` is missing.

If Prospector already wrote these files, `understand` detects that and switches to **import
mode** instead of re-interviewing — see `chain.md`.

## Stage: plan (`/optimizer:plan`)

Two things happen here, in the main session, BEFORE either arm ever starts:

1. **`task.md`** — the exact opening assignment both arms receive, copied verbatim into both
   workspaces. It must be plugin-blind: it describes the job (what to build, acceptance
   criteria, constraints) the way a real user would state it, with zero mention of the plugin
   under test or its tools. One leak = contaminated run. Must also be justified against
   `mandate.md` — which capability gap or good-outcome definition is this task meant to
   exercise? If it cannot point at one, the task is probably testing something irrelevant to the
   plugin. Drafted with you, iterated until approved.
2. **Real Definition-of-Done checks** — pre-registered pass/fail criteria, defined now so
   post-hoc rationalization cannot creep in later. Checks are tiered as **script** (mechanical,
   exit-code — preferred whenever possible), **prompt** (an AI grader with read-only access can
   judge it), or **human** (genuinely needs your taste — used sparingly). Every criterion must
   name which `mandate.md` section it maps to; one without a mapping gets flagged before it is
   added, not silently included.

**Two hard rules on checks, both learned the expensive way:**

- **A check may never run the artifact's own tooling.** `source` has exactly one legal value,
  `generic`. If a check shells out to the plugin's own validator, and that plugin also ships a
  `Stop` hook that blocks the arm until the same validator passes, the check can only ever report
  `pass` — it is measuring its own gate. The governing principle: everything that lives in the
  plugin must function autonomously, as if no DoDs existed.
- **Both arms get an identical check list.** Any asymmetry stops the run at `fire`.

You also choose control's **baseline** for this run here: vanilla (no plugin) or pinned to a
previous released version of the plugin under test — a per-run choice, never written into
`env.json`.

`plan` also reads the accumulated hypothesis ledger (`lab/hypotheses.json`) and is meant to take
the top-ranked open hypothesis, ranked by magnitude × confidence ÷ cost.

## Stage: fire (`/optimizer:fire`) — and how "parallel" actually works

This is the only skill that spawns anything. Two steps:

1. **Dry run first** — shows a parity report: what both arms share, what only control gets, what
   only test gets, and whether the DoD checks are identical across arms and all generic. Any
   asymmetry, or any check that runs the artifact's own tooling, stops you here to fix `env.json`
   or the check list before anything launches. A seed-probe gate also proves every check can
   both FAIL and PASS against real fixtures — a check that cannot do both is a broken instrument
   and blocks the run.
2. **Real fire, on your confirmation** — opens **two separate, titled, detached terminal
   windows** at the same time: `"AB <experiment> control run-NNN"` and `"AB <experiment> test
   run-NNN"`. Each is its own independent Claude Code session, in its own cloned workspace (seed
   files copied fresh into twin folders), with its own composed `--settings` / `--mcp-config`,
   already holding its `TASK.md` and its registered DoD checks — you do not set up either
   workspace by hand. A linkage hook fires at each arm's session start that records its session
   id + transcript path back into the experiment's `manifest.json`; give it ~30 seconds and check
   both arms show `status: "linked"` (if one does not, its `.launch/hooks.log` says why).

**"Parallel" means literally that**: you now have two terminal windows open side by side, both
live Claude Code sessions, and you work them yourself — Optimizer does not automate either arm's
conversation. Practical rules while both are running:

- Work each one as you naturally would. Nudging a stalled arm with an extra prompt is fine and
  expected — it gets measured as a bias indicator, not forbidden or penalized.
- Do not open a THIRD Claude session inside either workspace, and do not hand-edit workspace
  files yourself mid-run — both break the transcript-based metrics the analysis depends on.
- Compact or `/clear` in either arm whenever you naturally would; any asymmetry between arms
  gets recorded, not treated as an error.
- You decide when a run is "done" — DoD reaching goal state, or your own call. Then you go back
  to the (third) **main session** — not either arm — to run analyze.

## Stage: analyze (`/optimizer:analyze [verdict]`)

Run from the main session once both arms are done. Fuses three layers:

1. **Your verdict** — free-form, which arm produced the better output and why. Recorded
   verbatim, feeds the next two layers.
2. **Deterministic metrics** — computed straight from both session JSONL transcripts (turns,
   tokens, tool calls, etc.) plus DoD pass/fail state from both arms' `.dod/sessions/*.json`,
   plus a quality score per arm against `quality-rubric.md`. Any parity flags (a model mismatch,
   a missing transcript) get surfaced immediately since they can invalidate the whole run.
3. **LLM contextualization** — a dedicated comparator agent reads both transcripts, both metrics
   files, both DoD states, and `mandate.md`, and produces a root-cause read with findings
   explicitly tagged `[OBJECTIVE]` (from the data) vs `[SUBJECTIVE]` (your stated verdict) —
   kept separate on purpose, never blended into one unlabeled score.

Output: `runs/run-NNN/analysis/report.md` plus a new row in the experiment's ledger and new
entries in the hypothesis ledger. Recommendations get applied to the plugin under test in ITS
OWN repo, in a separate session — Optimizer never edits the plugin under test. Then
`/optimizer:plan` again for the next run.

## Stage: status (`/optimizer:status [experiment]`)

Read-only, any time. Lists experiments (or details one) with per-run state derived from files on
disk, never guessed: `planned` (task.md, no manifest) → `fired` (manifest exists, an arm still
`launched`) → `linked` (both arms linked) → `analyzed` (report.md exists). Use this to check
whether a run actually linked before walking away from it.

## The five pillars

Every run scores both arms on: **quality** (rubric-scored), **input_tokens**, **output_tokens**,
**turns**, **autonomy**. `lab/objective.json` declares one *priority* pillar plus *guards* —
maximum tolerated regression percentages on the others — so a cost win that trashes quality is
caught rather than celebrated.

## dod-lite — the arm-side instrument

dod-lite (`plugins/dod-lite/` in this same repo) records real Definition-of-Done checks per
session — script/AI-graded/human-judged, evaluated every turn via its `Stop` hook. It is what
lets `/optimizer:plan` pre-register actual pass/fail criteria for a run before either arm starts.

**It is an instrument, not a control loop.** Its `Stop` hook writes NOTHING to stdout — no
decision, no reason, no message. It is injected into both arms identically, so any feedback it
gave would pull control and test toward the same output and mask the difference being measured.
It observes; it never speaks to the session it measures.

It is mandatory on every run: `/optimizer:fire` injects it into both arms automatically
(`--plugin-dir`, read live off this repo's disk — nothing to install or update separately), and
`/optimizer:plan` is the sole place checks are ever designed, always in your main session, never
inside an arm. If a run genuinely needs zero checks, plan just does not write `dod-checks.json` —
the engine stays loaded, it just has nothing to record.

**Why it is a separate plugin rather than part of Optimizer**: see `chain.md`. Full technical
contract: `plugins/optimizer/docs/dod-contract.md`.

## Optional dependency: context-mode

Optimizer and dod-lite together need nothing beyond Node builtins and Claude Code itself — no npm
packages, no other plugins required. The one optional exception: `/optimizer:analyze`'s comparator
agent can use the third-party `context-mode` MCP plugin (`mksglu/context-mode`, unaffiliated, not
bundled here) to filter large session transcripts faster than plain Grep/Read. It degrades
gracefully if absent — analysis is not blocked or degraded in quality, just potentially slower on
very long sessions.

```
claude plugin marketplace add mksglu/context-mode
claude plugin install context-mode@context-mode
```

## Discipline — the rules that keep runs comparable

State these plainly if the user seems headed toward breaking one:

- **Never edit `env.json` after a run has fired against that experiment.** A config change
  mid-experiment invalidates comparability between runs. New config → new env, not an edit. The
  one exception is `pluginUnderTestRepo`: pure pointer metadata, safe to add/edit any time.
  `mandate.md` and `quality-rubric.md` are the same kind of exception — refresh them anytime via
  `/optimizer:understand`. Bumping `rubric_version` **forks the quality trajectory**: scores
  either side of the bump are on different scales and are never plotted as one curve.
- **`task.md` must stay plugin-blind.** Any mention of the plugin under test, its tools, or a
  hinted workflow contaminates the run.
- **`/optimizer:plan` will not draft anything without `mandate.md`.**
- **A DoD check may never be the artifact's own gate**, and both arms' check lists must match.
- **One model, both arms, always.**
- **Arms declare their own config explicitly** (`common`/`control`/`test` in `env.json`) — they
  run with `--strict-mcp-config` and explicit `enabledPlugins`, so nothing from your global setup
  leaks in unevenly.
- **DoD tracking is mandatory** — the trimmed engine is injected into both arms on every run
  automatically. There is no "forgot to enable dod-lite" failure mode.
- **Windows, macOS and Linux** — fire opens each arm in its own titled terminal window using
  whatever the platform provides (Windows Terminal, Terminal.app/iTerm2, or the first Linux
  emulator found on `PATH`; `OPTIMIZER_TERMINAL` overrides). Where none can be opened the run is
  staged and fire prints the two commands to start the arms by hand.
