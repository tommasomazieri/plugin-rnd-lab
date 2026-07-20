---
description: >-
  Teach the user how ab-bench works end-to-end: setup, planning an
  experiment, firing paired sessions, working both in parallel, analyzing
  results, and how dod-lite fits in. User-invoke only — a walkthrough /
  reference skill, not a workflow step; never auto-trigger this for someone
  who's just trying to run an experiment. Optional topic argument narrows to
  one stage instead of the full tour.
argument-hint: "[topic: setup|init|plan|fire|parallel|analyze|status|dod-lite|discipline]"
disable-model-invocation: true
---

# ab-bench: learn

This skill's job is to teach, not to run anything — no files get written, no
commands from other skills get executed. Read the reference material below,
then explain it to the user in your own words, adapted to what they asked.

## How to run this

- **No $ARGUMENTS**: give the one-paragraph mental model first (below), then
  walk the full lifecycle stage by stage, in order (setup → init → plan →
  fire → parallel → analyze → status → dod-lite → discipline). Pause after
  each stage and ask if they want to go deeper or move to the next one —
  don't dump the whole thing as one wall of text.
- **$ARGUMENTS names one topic** (setup/init/plan/fire/parallel/analyze/
  status/dod-lite/discipline): give the one-paragraph mental model in one
  line for orientation, then go deep on just that section.
- **$ARGUMENTS is a free-form question** ("how do I compare against an old
  version", "what happens if I close a terminal"): answer it directly using
  the material below; pull in whichever sections are relevant.

Always ground answers in what the installed skills actually do — if the user
asks something this doc doesn't cover, read the relevant `SKILL.md` under
`plugins/ab-bench/skills/` or `plugins/dod-lite/skills/` rather than
guessing.

## The one-paragraph mental model

You built (or are evaluating) a Claude Code plugin. ab-bench proves whether
it actually helps by running the SAME task twice, at the same time, in two
identical-except-for-the-plugin Claude Code sessions — a **control** arm
(no plugin, or a fair compensating substitute) and a **test** arm (your
plugin) — then fuses both transcripts, both dod-lite check logs, and your
own judgement of which output was better into one evidence-backed report.
Everything runs from a third, separate **main session** — you never run
ab-bench's own skills inside either arm.

## Stage: setup (`/ab-bench:setup`)

One-time (or whenever you want to relocate). ab-bench needs exactly one
folder OUTSIDE any project repo where every experiment it ever creates lives
— `env.json`, seed files, `.dod/`, run history, transcripts, all under
`<experiments_root>/<experiment-name>/`. This path is stored as the
plugin's `experiments_root` user-config option (Claude Code's own
per-plugin settings mechanism), not a bespoke file — it usually gets asked
for automatically the first time you enable the plugin; `/ab-bench:setup`
is the manual path if you skipped that prompt or want to change it later.
It's per-machine, not per-project: one shared folder reused across every
plugin you ever test. Every other ab-bench skill refuses to run until this
is set.

## Stage: init (`/ab-bench:init <name>`)

Creates one experiment's folder and its `env.json` "contract" — the
locked-in config for both arms. Interviews you for: experiment name
(kebab-case, versioned if you expect to iterate, e.g. `my-plugin-v0.3`),
the plugin under test (local path or marketplace ref), what control gets as
a fair compensation (can be nothing), config BOTH arms share (plugins/MCPs
— arms run with `--strict-mcp-config` and explicit `enabledPlugins`, so
nothing leaks in from your global config by accident), one model for both
arms (no exceptions — that's a confound), starting seed files, and
optionally the plugin-under-test's own git repo path (unlocks
previous-version baselines later, see below).

**Idempotent by design**: re-running init on an experiment that already has
an `env.json` never overwrites it — it offers to jump to `/ab-bench:plan`
for the next run, or to start a new versioned experiment instead. This is
the first place the central discipline shows up: **`env.json` is never
edited once a run has fired against it.** New config = new experiment
(bump the version suffix in the name), never a silent edit — otherwise
later runs stop being comparable to earlier ones.

## Stage: plan (`/ab-bench:plan`)

Two things happen here, in the main session, BEFORE either arm ever starts:

1. **`task.md`** — the exact opening assignment both arms receive, copied
   verbatim into both workspaces. It must be plugin-blind: it describes the
   job (what to build, acceptance criteria, constraints) the way a real user
   would state it, with zero mention of the plugin under test or its tools.
   One leak = contaminated run. Drafted with you, iterated until approved.
2. **Real Definition-of-Done checks** — pre-registered pass/fail criteria,
   defined now so post-hoc rationalization can't creep in later. This is
   where dod-lite comes in (see that section) — checks get tiered as
   **script** (mechanical, exit-code — preferred whenever possible),
   **prompt** (an AI grader with read-only access can judge it), or
   **human** (genuinely needs your taste — used sparingly). Where the
   plugin under test ships its own checker scripts (a `checks/`/`qa/`
   folder, etc.), plan reuses those instead of writing generic ones — this
   can legitimately give control and test different check lists; that's
   recorded, not treated as a parity violation.

Before any of that: plan checks whether dod-lite is even declared for the
arms it's about to write checks for. If it isn't, it stops and asks rather
than authoring checks nobody will ever evaluate — see the dod-lite section.

You also choose control's **baseline** for this run here: vanilla (no
plugin) or pinned to a previous released version of the plugin under test
(needs `pluginUnderTestRepo` from init) — this is a per-run choice, never
written into `env.json`.

## Stage: fire (`/ab-bench:fire`) — and how "parallel" actually works

This is the only skill that spawns anything. Two steps:

1. **Dry run first** — shows a parity report: what both arms share, what
   only control gets, what only test gets, and whether DoD checks apply
   symmetrically (or asymmetrically for a documented plugin-native-checker
   reason). Anything asymmetric that ISN'T explained stops you here to fix
   `env.json` or the check list before anything launches.
2. **Real fire, on your confirmation** — opens **two separate, titled,
   detached terminal windows** at the same time: `"AB <experiment> control
   run-NNN"` and `"AB <experiment> test run-NNN"`. Each is its own
   independent Claude Code session, in its own cloned workspace (seed files
   copied fresh into twin folders), with its own composed `--settings` /
   `--mcp-config`, already holding its `TASK.md` and its registered DoD
   checks — you don't set up either workspace by hand. A linkage hook fires
   at each arm's session start that records its session id + transcript
   path back into the experiment's `manifest.json`; give it ~30 seconds and
   check both arms show `status: "linked"` (if one doesn't, its
   `.launch/hooks.log` says why).

**"Parallel" means literally that**: you now have two terminal windows open
side by side, both live Claude Code sessions, and you work them yourself —
ab-bench doesn't automate either arm's conversation. Practical rules while
both are running:
- Work each one as you naturally would. Nudging a stalled arm with an extra
  prompt is fine and expected — it gets measured as a bias indicator, not
  forbidden or penalized.
- Don't open a THIRD Claude session inside either workspace, and don't hand-
  edit workspace files yourself mid-run — both break the transcript-based
  metrics the analysis depends on.
- Compact or `/clear` in either arm whenever you naturally would; any
  asymmetry between arms gets recorded, not treated as an error.
- You decide when a run is "done" — DoD reaching goal state, or your own
  call. Then you go back to the (third) **main session** — not either arm —
  to run analyze.

## Stage: analyze (`/ab-bench:analyze [verdict]`)

Run from the main session once both arms are done. Fuses three layers:

1. **Your verdict** — free-form, which arm produced the better output and
   why. Recorded verbatim, feeds the next two layers.
2. **Deterministic metrics** — computed straight from both session JSONL
   transcripts (turns, tokens, tool calls, etc.) plus DoD pass/fail state
   from both arms' `.dod/sessions/*.json`. Any parity flags (e.g. a model
   mismatch, a missing transcript) get surfaced immediately since they can
   invalidate the whole run.
3. **LLM contextualization** — a dedicated comparator agent reads both
   transcripts, both metrics files, and both DoD states, and produces a
   root-cause read with findings explicitly tagged `[OBJECTIVE]` (from the
   data) vs `[SUBJECTIVE]` (your stated verdict/interpretation) — kept
   separate on purpose, never blended into one unlabeled score.

Output: `runs/run-NNN/analysis/report.md` (verdict, metrics table, tagged
analysis, next-iteration recommendations) plus a new row in the
experiment's `ledger.md`. Recommendations get applied to the plugin under
test in ITS OWN repo, in a separate session — ab-bench never edits the
plugin under test. Then `/ab-bench:plan` again for the next run.

## Stage: status (`/ab-bench:status [experiment]`)

Read-only, any time. Lists experiments (or details one) with per-run state
derived from files on disk, never guessed: `planned` (task.md, no
manifest) → `fired` (manifest exists, an arm still `launched`) → `linked`
(both arms linked) → `analyzed` (report.md exists). Use this to check
whether a run actually linked before walking away from it, or to get your
bearings on an experiment you haven't touched in a while.

## dod-lite — why ab-bench leans on it

dod-lite is a separate plugin (bundled in this same marketplace,
`dod-lite@plugin-rnd-lab`) that tracks real Definition-of-Done checks
per session — script/AI-graded/human-judged, enforced every turn via its
own Stop hook. Without it, ab-bench can still run (metrics + your verdict
only), but WITH it, `/ab-bench:plan` can pre-register actual pass/fail
criteria for a run before either arm starts, instead of relying purely on
token/turn counts and eyeballing.

The integration is intentionally soft-gated, not silent: `/ab-bench:plan`
checks `env.json` for a declared `dod-lite` before authoring any check
files, and refuses to write checks nobody will evaluate. If it's missing
and no run has fired yet for that experiment, plan offers to add it (safe
pre-first-run). If a run already fired, adding it now would be a real
arm-config change — plan offers to skip DoD for this run instead, or start
a new experiment version with it declared from the start.

Full technical contract (exact files/schema dod-lite expects, verified
against its real source): `plugins/ab-bench/docs/dod-contract.md`.

## Discipline — the rules that keep runs comparable

State these plainly if the user seems headed toward breaking one:

- **Never edit `env.json` after a run has fired against that experiment.**
  A config change mid-experiment invalidates comparability between runs.
  New config → new experiment (versioned name), not an edit. The one
  exception is `pluginUnderTestRepo`: pure pointer metadata, not an arm
  config delta, safe to add/edit any time.
- **`task.md` must stay plugin-blind.** Any mention of the plugin under
  test, its tools, or a hinted workflow contaminates the run.
- **One model, both arms, always.**
- **Arms declare their own config explicitly** (`common`/`control`/`test`
  in `env.json`) — they run with `--strict-mcp-config` and explicit
  `enabledPlugins`, so nothing from your global setup leaks in unevenly.
- **Never run both a free-standing dod-lite install and this bundled
  `dod-lite@plugin-rnd-lab` copy at the same time** — identical hook set,
  they'd double-fire. Pick one per machine/session.
- **Windows only, for now** — fire spawns detached `cmd.exe` terminals and
  links each arm's `.dod/` via a Windows directory junction.

## Closing

After the walkthrough (or the focused answer), tell the user the natural
next command given where they are: nothing set up yet → `/ab-bench:setup`;
set up but no experiment → `/ab-bench:init <name>`; experiment exists, no
plan → `/ab-bench:plan`; planned but not fired → `/ab-bench:fire`; fired →
go work both arms; both arms done → `/ab-bench:analyze`.
