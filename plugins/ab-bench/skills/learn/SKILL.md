---
description: >-
  Teach the user how ab-bench works end-to-end: setup, planning an
  experiment, firing paired sessions, working both in parallel, analyzing
  results, and how dod-lite fits in. User-invoke only — a walkthrough /
  reference skill, not a workflow step; never auto-trigger this for someone
  who's just trying to run an experiment. Optional topic argument narrows to
  one stage instead of the full tour.
argument-hint: "[topic: setup|init|understand|plan|fire|parallel|analyze|status|dod-lite|discipline]"
disable-model-invocation: true
---

# ab-bench: learn

This skill's job is to teach, not to run anything — no files get written, no
commands from other skills get executed. Read the reference material below,
then explain it to the user in your own words, adapted to what they asked.

## How to run this

- **No $ARGUMENTS**: give the one-paragraph mental model first (below), then
  walk the full lifecycle stage by stage, in order (setup → init →
  understand → plan → fire → parallel → analyze → status → dod-lite →
  discipline). Pause after each stage and ask if they want to go deeper or
  move to the next one — don't dump the whole thing as one wall of text.
- **$ARGUMENTS names one topic** (setup/init/understand/plan/fire/parallel/
  analyze/status/dod-lite/discipline): give the one-paragraph mental model
  in one line for orientation, then go deep on just that section.
- **$ARGUMENTS is a free-form question** ("how do I compare against an old
  version", "what happens if I close a terminal"): answer it directly using
  the material below; pull in whichever sections are relevant.

Always ground answers in what the installed skills actually do — if the user
asks something this doc doesn't cover, read the relevant `SKILL.md` under
`plugins/ab-bench/skills/` rather than guessing. `plugins/dod-lite/` has no
skills of its own to read — it's a hooks-only engine, see the dod-lite
section below.

## The one-paragraph mental model

You built (or are evaluating) a Claude Code plugin. ab-bench proves whether
it actually helps by running the SAME task twice, at the same time, in two
identical-except-for-the-plugin Claude Code sessions — a **control** arm
(no plugin, or a fair compensating substitute) and a **test** arm (your
plugin) — then fuses both transcripts, both dod-lite check logs, and your
own judgement of which output was better into one evidence-backed report.
Everything runs from a third, separate **main session** — you never run
ab-bench's own skills inside either arm. That main session runs FROM the
plugin-under-test's own repo (cd into it, start Claude Code there) — ab-bench
resolves which experiment you mean from cwd, via a gitignored `.ab-bench/`
folder it creates there; you never type an experiment name or path.

## Two roots — where things actually live

Each experiment splits across two places:
- **`.ab-bench/` inside the plugin repo** — identity/config only: `env.json`
  (arm config contract) and `mandate.md` (what the plugin's FOR). Gitignored,
  never touched by an arm session.
- **The testenv, under `experiments_root`** — everything a run actually
  materializes on disk: `seed/`, `.dod/`, `baselines/`, `runs/`. Its path is
  auto-derived from the plugin repo's own folder name — nothing to name.

They're linked one level deeper too: mandate (1 per plugin, until its actual
purpose changes) → env (many — one per arm-config version) → run (many per
env). `mandate.md` is shared by every env under it, never duplicated; a new
`env.json` is what "new config = new experiment" now actually bumps.
Full detail: `docs/dod-contract.md`.

## Stage: setup (`/ab-bench:setup`)

One-time (or whenever you want to relocate). ab-bench needs exactly one
folder OUTSIDE any project repo where every testenv it ever creates lives —
seed files, `.dod/`, run history, transcripts, all auto-nested under
`<experiments_root>/<plugin-folder-name>/mandate-N/env-M/`. This path is
stored as the plugin's `experiments_root` user-config option (Claude Code's
own per-plugin settings mechanism), not a bespoke file — it usually gets
asked for automatically the first time you enable the plugin; `/ab-bench:setup`
is the manual path if you skipped that prompt or want to change it later.
It's per-machine, not per-project: one shared folder reused across every
plugin you ever test. Every other ab-bench skill refuses to run until this
is set.

## Stage: init (`/ab-bench:init`)

Run this FROM the plugin-under-test's repo — no name or path argument. First
time in a repo: scaffolds `.ab-bench/mandate-1/envs/env-1/` there (with
`env.json`, the locked-in arm-config contract) plus the paired testenv
folder, appends `.ab-bench/` to the repo's `.gitignore`, and mandatorily
chains into `/ab-bench:understand` to write `mandate.md`. Interviews you for:
which folder(s) in this repo are the plugin under test (auto-detected where
possible), what control gets as a fair compensation (can be nothing), config
BOTH arms share (plugins/MCPs — arms run with `--strict-mcp-config` and
explicit `enabledPlugins`, so nothing leaks in from your global config by
accident), one model for both arms (no exceptions — that's a confound), and
starting seed files. `pluginUnderTestRepo` is never asked for — it's always
the repo you're standing in, which is also what unlocks previous-version
baselines later (see below) automatically, no extra setup.

**Idempotent by design**: re-running init in a repo that already has
`.ab-bench/` never overwrites the current `env.json` — it offers three
branches: continue to `/ab-bench:plan` for the next run, start a **new env**
under the current mandate (the arm config needs to change — different
MCP/plugins/model — but the plugin's purpose hasn't), or start a **new
mandate** (the plugin's actual purpose changed, chains into
`/ab-bench:understand` for a full re-interview). This is where the central
discipline lives: **`env.json` is never edited once a run has fired against
it.** New config = new env, never a silent edit — otherwise later runs stop
being comparable to earlier ones. Unlike before, that no longer means
inventing a new mandate.md too when only the arm config changed — mandate.md
bumps only on the "new mandate" branch, when it actually should.

## Stage: understand (`/ab-bench:understand`)

Closes a gap the rest of the lifecycle used to have: init captured WHICH plugin is under test,
but never WHAT it's actually for — so plan had no anchor beyond in-the-moment judgement when
drafting task.md or picking DoD checks. `/ab-bench:init` now MANDATORILY invokes this right
after scaffolding a fresh mandate (a fresh repo's first init, or its "new mandate" branch —
reusing context init already collected: plugin dirs, control compensation, repo path — never
re-asking). It's a grill-me-style interview across seven categories: domain/environment, the
capability gap the plugin fills, the target user's before/after workflow, a concrete definition
of a good outcome, explicit non-goals, the appropriate task-complexity ceiling, and known weak
spots worth stress-testing. Output: `.ab-bench/mandate-N/mandate.md` — read-only background for
main-session skills, shared by every env under that mandate, never cloned into either arm's
workspace (would break task.md's plugin-blind requirement).

Unlike `env.json`, mandate.md is safe to edit anytime — it's metadata about purpose, not an arm
config delta. Re-invoke it standalone (`/ab-bench:understand`, run from the plugin repo) whenever
the plugin's scope evolves — it'll offer to refresh the CURRENT mandate in place, or point you at
`/ab-bench:init`'s "new mandate" branch if the change is big enough to warrant a whole new version
instead. Full re-interview either way, never a partial patch. `/ab-bench:plan` refuses to draft a
task or DoD checks if mandate.md is missing (a legacy setup predating this feature) — it'll tell
you to run this first.

## Stage: plan (`/ab-bench:plan`)

Two things happen here, in the main session, BEFORE either arm ever starts:

1. **`task.md`** — the exact opening assignment both arms receive, copied
   verbatim into both workspaces. It must be plugin-blind: it describes the
   job (what to build, acceptance criteria, constraints) the way a real user
   would state it, with zero mention of the plugin under test or its tools.
   One leak = contaminated run. Must also be justified against `mandate.md`
   — which capability gap or good-outcome definition is this task meant to
   exercise? If it can't point at one, the task is probably testing
   something irrelevant to the plugin. Drafted with you, iterated until
   approved.
2. **Real Definition-of-Done checks** — pre-registered pass/fail criteria,
   defined now so post-hoc rationalization can't creep in later. This is
   where dod-lite comes in (see that section) — checks get tiered as
   **script** (mechanical, exit-code — preferred whenever possible),
   **prompt** (an AI grader with read-only access can judge it), or
   **human** (genuinely needs your taste — used sparingly). Where the
   plugin under test ships its own checker scripts (a `checks/`/`qa/`
   folder, etc.), plan reuses those instead of writing generic ones — this
   can legitimately give control and test different check lists; that's
   recorded, not treated as a parity violation. Every criterion must also
   name which `mandate.md` section it maps to — one without a mapping gets
   flagged before it's added, not silently included.

Before any of that: plan checks whether `mandate.md` exists at all (see the
understand section above). DoD tracking itself needs no such preflight
anymore — the engine is mandatory, injected into both arms on every run —
but plan still stops and asks if a criterion has no anchor to the plugin's
purpose rather than authoring it anyway.

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
   transcripts, both metrics files, both DoD states, and `mandate.md` (the
   plugin's stated purpose, if present), and produces a root-cause read with
   findings explicitly tagged `[OBJECTIVE]` (from the data) vs `[SUBJECTIVE]`
   (your stated verdict/interpretation) — kept separate on purpose, never
   blended into one unlabeled score. `mandate.md` doesn't get its own tag; it
   sharpens WHY a finding matters (squarely in the plugin's stated capability
   gap, vs. incidental to it).

This agent filters two full transcripts down to relevant excerpts using Grep/
Read — always works, nothing extra needed. If the optional third-party
`context-mode` MCP plugin (`mksglu/context-mode`, not affiliated with or
bundled in this marketplace) happens to be installed, it uses that instead
where available, purely for speed. Not required; see "Optional dependency"
below if the user wants it.

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

dod-lite (`plugins/dod-lite/` in this same repo) tracks real
Definition-of-Done checks per session — script/AI-graded/human-judged,
enforced every turn via its Stop hook. It's what lets `/ab-bench:plan`
pre-register actual pass/fail criteria for a run before either arm starts,
instead of relying purely on token/turn counts and eyeballing.

Unlike the standalone dod-lite you may know from other projects, this copy
is trimmed down to hooks only — no planning skill, no status command, not
separately installed. It's mandatory on every run: `/ab-bench:fire` injects
it into both arms automatically (`--plugin-dir`, read live off this repo's
disk — nothing to install or update separately), and `/ab-bench:plan` is
the sole place checks ever get designed, always in your main session,
never live inside an arm. If a run genuinely needs zero checks, plan just
doesn't write `dod-checks.json` for it — the engine stays loaded either
way, it just has nothing to enforce.

Full technical contract (exact files/schema the engine expects):
`plugins/ab-bench/docs/dod-contract.md`.

## Optional dependency: context-mode

ab-bench and dod-lite together need nothing beyond Node builtins and Claude
Code itself — no npm packages, no other plugins required. The one optional
exception: `/ab-bench:analyze`'s comparator agent can use the third-party
`context-mode` MCP plugin (`mksglu/context-mode`, unaffiliated, not bundled
here) to filter large session transcripts faster than plain Grep/Read. It
degrades gracefully if absent — analysis is not blocked or degraded in
quality, just potentially a bit slower on very long sessions. Install only
if wanted:

```
claude plugin marketplace add mksglu/context-mode
claude plugin install context-mode@context-mode
```

## Discipline — the rules that keep runs comparable

State these plainly if the user seems headed toward breaking one:

- **Never edit `env.json` after a run has fired against that experiment.**
  A config change mid-experiment invalidates comparability between runs.
  New config → new experiment (versioned name), not an edit. The one
  exception is `pluginUnderTestRepo`: pure pointer metadata, not an arm
  config delta, safe to add/edit any time. `mandate.md` is the same kind of
  exception — refresh it anytime via `/ab-bench:understand`, no version bump.
- **`task.md` must stay plugin-blind.** Any mention of the plugin under
  test, its tools, or a hinted workflow contaminates the run.
- **`/ab-bench:plan` won't draft anything without `mandate.md`.** It's the
  anchor for task relevance and DoD-criterion relevance — a run planned
  without it risks testing something the plugin was never meant to help
  with.
- **One model, both arms, always.**
- **Arms declare their own config explicitly** (`common`/`control`/`test`
  in `env.json`) — they run with `--strict-mcp-config` and explicit
  `enabledPlugins`, so nothing from your global setup leaks in unevenly.
- **DoD tracking is mandatory, not something to declare in `env.json`** —
  the trimmed engine is injected into both arms on every run automatically.
  There's no "forgot to enable dod-lite" failure mode anymore; the only
  per-run choice is whether `/ab-bench:plan` writes any checks at all.
- **Windows only, for now** — fire spawns detached `cmd.exe` terminals and
  links each arm's `.dod/` via a Windows directory junction.

## Closing

After the walkthrough (or the focused answer), tell the user the natural
next command given where they are: nothing set up yet → `/ab-bench:setup`;
set up but no experiment in this repo yet → cd into the plugin repo, run
`/ab-bench:init`; experiment exists, no plan → `/ab-bench:plan`; planned but
not fired → `/ab-bench:fire`; fired →
go work both arms; both arms done → `/ab-bench:analyze`.
