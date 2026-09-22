# plugin-rnd-lab

**Does your Claude Code plugin actually help, or does it just feel that way?**

Two instruments for finding out, one on each side of building a plugin:

- **Prospector**, before you build it: *is this worth building at all?* It interviews you for
  what you actually did, not what you'd like, checks whether the thing already exists, and ships
  narrow MVPs you then use in your real work.
- **Optimizer**, after you build it: *does it actually help?* It opens two paired Claude Code
  sessions on the same task, one with your plugin and one without, and you work both. Then it
  turns the two transcripts, Definition-of-Done checks written before either session started, and
  your own verdict into one evidence-backed report.

## How is this different from `claude plugin eval`?

Claude Code now ships [`claude plugin eval`](https://code.claude.com/docs/en/plugin-evals), and
for many plugins it is the right tool. Each case is a fresh, non-interactive session that gets one
prompt and is graded automatically, three times with the plugin and three times without. It is
cheap to repeat and it can gate CI.

Optimizer measures what a single headless prompt cannot reach: a plugin whose value shows up only
when a person is in the conversation.

| | `claude plugin eval` | Optimizer |
|---|---|---|
| the session | non-interactive, one prompt | interactive, as long as the work takes |
| who is in the loop | nobody | you, working both sessions |
| the workspace | empty, or built by a scaffold script | your seed files, copied into both sessions |
| grading | regex, tool-use and model-judged graders | Definition-of-Done checks (script, model-judged, human), transcript comparison, your verdict |
| sample size | 3 runs per case per side, by default | one paired run at a time |
| built for | skills that should trigger and finish on one request; CI | planning, brainstorming, interview and review workflows; real multi-turn work |

The price of that is sample size: a paired run is one data point, and you are part of it. Every
prompt you type into one session but not the other is recorded as a bias indicator rather than
hidden. Use both tools: `plugin eval` for regressions on every change, Optimizer for whether the
plugin makes your real sessions better.

**Tried it, or stopped halfway?** [Tell me how it went](https://docs.google.com/forms/d/e/1FAIpQLSfINKyrAFuydl9SC-wNGceL_I-04cWqy7BkeQf0IJSwOKxFfg/viewform):
mostly clicks, 2 to 10 minutes depending on how far you got.

## The two instruments

A Claude Code **marketplace** for plugin R&D tooling. Two instruments, operating at different
stages (plus `core`, which teaches them — see Install):

| | **Prospector** | **Optimizer** |
|---|---|---|
| starts from | a situation, frustration, or hunch | an already-defined artifact |
| answers | *is this worth building at all?* | *does it actually help?* |
| optimises for | **effectiveness** | **efficiency** |
| evidence | your real use of narrow MVPs | paired A/B runs across five pillars |
| output | a validated direction + a written `mandate.md` | an evidence-backed improvement report |

> Prospect first. Then refine. Then prospect again.

They chain, and the chain is a **loop**: Prospector hands the Optimizer a pre-written mandate, so
`/optimizer:understand` confirms rather than re-interviewing you on everything you just
established — and when the Optimizer's evidence is in, `/prospector:reenter` picks it back up,
reassesses what is still missing, and scopes the next version. Either works alone.

```
prospector: start → survey → frame → design → build → review → handoff
                                ↑                                 ↓
                                └───── reenter ←── optimizer: init → plan → fire → analyze
```

A third plugin, `dod-lite`, is the Optimizer's arm-side **audit instrument**. It is registered so
it installs alongside, but it is internal — you never invoke it. See "DoD tracking" below.

**Who this is for:** you're building (or evaluating) a Claude Code plugin and want proof it
actually helps — not just a feeling. Not a general-purpose plugin, not a 2-minute install: it's a
real testing harness with a learning curve. Runs on Windows, macOS, and Linux.

## What's Prospector, in one paragraph

You have a problem, not a spec. Prospector refuses to take your first framing at face value —
"I need a tool that manages my tasks" is a *solution*, and the problem behind it is still unknown.
It interviews you for concrete past behaviour rather than opinions, checks whether the thing
already exists before designing anything, keeps competing problem framings alive instead of
collapsing to the first one, labels every claim with its actual confidence (`confirmed` …
`assumption`), designs the **whole** plugin before building any of it, and then ships MVPs that
are shallow on purpose but never narrow: every core need you actually stated is either covered or
deferred with a reason you can read. You install those MVPs and use them in your own real
projects, and your use of them — especially the parts you quietly abandoned — is the evidence.
Runs in place, in the directory the future plugin will live in. See
`plugins/prospector/README.md`.

Two mechanisms carry most of the weight. **The need list is the denominator, and the agent that
builds does not author it**: needs are recorded during the interview, each citing the evidence it
came from, and `/prospector:build` cannot cut a package leaving a core one unaccounted for. **The
design is a separate stage from the build**, because an agent that does both in one turn writes a
design its build happens to satisfy — which is how two hours of interview used to become an MVP
addressing a fraction of one thing you asked for.

## What's Optimizer, in one paragraph

You built a Claude Code plugin. Does it actually make sessions better, or does it just feel that
way? optimizer answers that with an A/B test: it fires two paired Claude Code sessions — a
**control** arm (status quo / no plugin, or a compensating baseline) and a **test** arm (your
plugin) — with everything else identical (model, prompt, seed files, MCP config). You work both
sessions normally. optimizer then fuses the two session transcripts, Definition-of-Done tracker
logs, and your own quality verdict into one evidence-backed report telling you whether the plugin
earned its keep, and what to fix before the next iteration.

## Prerequisites

- [Claude Code](https://code.claude.com) CLI installed and on `PATH` as `claude`.
- **Windows, macOS, or Linux.** Only `/optimizer:fire` touches anything platform-specific: it
  opens each arm in its own visible, titled terminal window, because an A/B run is something you
  sit and watch two of, side by side.
  - **Windows** — Windows Terminal if installed, otherwise a `powershell.exe` console.
  - **macOS** — Terminal.app.
  - **Linux** — the first of GNOME Terminal, Konsole, Xfce Terminal, kitty, Alacritty, WezTerm,
    Tilix, Terminator, `x-terminal-emulator`, or xterm found on `PATH`. Set `OPTIMIZER_TERMINAL`
    to the command for anything else; it takes precedence on every platform.

  If none can be opened — a headless box, an SSH session, an emulator not on that list — the run
  is still fully staged and `fire` prints the two commands to start the arms yourself.
- Node.js (bundled scripts are plain `.mjs`, no dependencies to install).

## Install

```
claude plugin marketplace add https://github.com/tommasomazieri/plugin-rnd-lab.git
claude plugin install core@plugin-rnd-lab           # start here — teaches both stages
claude plugin install optimizer@plugin-rnd-lab      # also installs dod-lite, its arm instrument
claude plugin install prospector@plugin-rnd-lab     # optional — the discovery stage
```

Use the full HTTPS URL. The `tommasomazieri/plugin-rnd-lab` shorthand clones over SSH, and fails
with "Host key verification failed" on a machine without an SSH key set up for GitHub.

Restart Claude Code (or run `/reload-plugins`) afterwards so the new skills load.

`core` ships one skill, `/core:learn`, and writes nothing — it is the walkthrough for everything
below. Install it first if you have not used either instrument before.

**Upgrading from the `ab-bench` era?** Every command was renamed (`/ab-bench:*` → `/optimizer:*`)
and two plugins are new. See [CHANGELOG.md](CHANGELOG.md) — existing experiments need no
migration, but leave your `.ab-bench/` directories alone.

`dod-lite` is optimizer's declared dependency, so installing optimizer installs it too, and it has
to stay enabled: Claude Code disables optimizer while dod-lite is missing or disabled. The
Optimizer finds the audit instrument next to its own install, and refuses to launch a run at all
if it is missing, rather than producing an uninstrumented run that looks identical to one where
every check passed.

To update later:

```
claude plugin marketplace update plugin-rnd-lab
claude plugin update optimizer@plugin-rnd-lab       # and each other plugin you installed
```

### Working from a clone

If you are changing the plugins themselves, clone the repo and add the marketplace from the local
path instead: `claude plugin marketplace add <path-to-your-clone>`. A marketplace added from a
local directory loads its plugins in place, so your edits are live after a Claude Code restart,
and dod-lite is read straight from `plugins/dod-lite/` at each launch.

`plugin update` only refreshes a *cached* install if `.claude-plugin/plugin.json`'s `version`
field changed. Bump it whenever you change a plugin, or everyone who installed from GitHub keeps
the old copy and the update is a silent no-op.

If you also run a fully-featured standalone dod-lite install (a different, unrelated plugin — see
`plugins/dod-lite/README.md`) in your own general Claude Code sessions, that's unaffected: it never
shares a session with the trimmed copy optimizer injects into its arms.

## Configure: where experiments live

optimizer keeps every experiment it creates in one folder outside any project repo, reused across
every experiment (`env.json`, seed files, run history, transcripts). That folder is a plugin
[user configuration](https://code.claude.com/docs/en/plugins-reference#user-configuration) value
(`experiments_root`). Installing from the `/plugin` menu prompts for it; `claude plugin install`
from a shell does not, and prints a reminder instead. Either set it at install time:

```
claude plugin install optimizer@plugin-rnd-lab --config experiments_root=<folder>
```

or run `/optimizer:setup` (user-invoked only) any time, which is also how you change it later.

## DoD tracking (built in)

Every run gets a Definition-of-Done engine (script / AI-graded / human-judged checks, enforced
turn-by-turn) in both arms — it's how optimizer pre-registers REAL pass/fail criteria before either
arm starts, instead of relying only on token/turn metrics and your own eyeballing. This is
mandatory, not something you enable per experiment: `/optimizer:fire` injects it into both arms
every time.

The engine itself (`plugins/dod-lite/` in this repo) is a trimmed, hooks-only fork — it enforces
checks at `Stop`, nothing else. All check *design* happens in `/optimizer:plan`, in your main
session, before either arm ever starts; the engine ships no in-session planning skill for an arm
to invoke, by design — an arm must never design or touch its own DoD.

If `/optimizer:plan` decides a given run needs zero checks (a legitimate outcome for a trivial
task), it simply doesn't write `dod-checks.json` — the engine is still loaded, it just has nothing
to enforce, and `/optimizer:analyze` leans on metrics + your verdict only for that run.

Full integration contract: `plugins/optimizer/docs/dod-contract.md`.

## Optional: faster analysis with context-mode

`/optimizer:analyze`'s comparator agent filters two full session transcripts down to the relevant
excerpts. It always works with built-in Grep/Read alone — nothing extra required. If you also
have the third-party [**context-mode**](https://github.com/mksglu/context-mode) MCP plugin (by
Mert Koseoğlu, not affiliated with or bundled in this marketplace) installed and enabled, the
agent uses its sandboxed filtering tools opportunistically for the same job, faster. Purely
optional:

```
claude plugin marketplace add mksglu/context-mode
claude plugin install context-mode@context-mode
```

## Quickstart

Experiments live OUTSIDE this repo, under your configured `experiments_root\<experiment-name>\`
(see "Configure" above) — this keeps the plugin repo clean of test artifacts. Everything below
runs from your **main** Claude Code session (a third session, separate from the two arms it
spawns).

New here? **`/core:learn`** walks through both instruments in plain language — Prospector's
discovery loop, Optimizer's full lifecycle (setup, planning, firing the paired sessions, working
them in parallel, analyzing), how the two chain, and why dod-lite is separate. Narrow it to one
plugin or one stage too, e.g. `/core:learn optimizer` or `/core:learn fire`.

0. **`/optimizer:setup`** — first time only (or to change the folder later): pick/create the
   experiments root. Skip if Claude Code already prompted you for it on install.
1. **`/optimizer:init my-plugin-v1`** — interviews you (plugin under test, control compensation,
   shared plugins/MCPs, model, seed files), creates the experiment folder.
2. **`/optimizer:plan`** — writes `task.md` (the plugin-blind assignment both arms get) and designs
   real DoD checks for this run (script/prompt/human), reusing the plugin-under-test's own checker
   scripts where it ships them.
3. **`/optimizer:fire`** — shows a parity preflight, then on confirmation spawns two titled terminals
   ("... control run-001" / "... test run-001"). Each arm starts with its task and DoD checks
   already wired in — you don't touch either workspace's setup.
4. **Work both sessions like normal work.** Divergent prompts to unstick one arm are fine — they're
   measured as bias indicators, not forbidden. DoD checks are already registered before either arm
   starts, and dod-lite ships no in-session design skill at all — there's nothing to invoke.
5. Back in the **main session**: **`/optimizer:analyze`** with your verdict ("test produced a
   cleaner mesh because xyz"). Get `analysis/report.md`: deterministic deltas, DoD pass/fail per
   arm, an LLM-contextualized root-cause read (objective findings tagged separately from the
   subjective score), and next-iteration recommendations.
6. **`/optimizer:status`** any time — read-only state of every experiment/run.
7. Apply the report's recommendations to the plugin-under-test's OWN repo (a separate session) —
   optimizer never edits the plugin under test. Then `/optimizer:plan` the next run.

## Repo layout

```
.claude-plugin/marketplace.json   marketplace manifest — four entries
plugins/core/                     the teaching plugin — one skill, /core:learn, writes nothing
  skills/learn/references/        optimizer.md, prospector.md, chain.md
plugins/prospector/               the discovery stage — skills, lib, tests
  README.md                       method + layout reference
plugins/optimizer/                the A/B harness — skills, agents, hooks, docs
  README.md                       architecture / internals reference (schemas, contracts, scripts)
plugins/dod-lite/                 optimizer's arm-side DoD auditor — hooks-only, no skill/command,
                                   registered so it caches alongside optimizer, not for standalone use
  README.md                       what it does inside an optimizer arm session
test/                             repo-wide checks: every copy of the feedback link is the same
```

For how optimizer actually works under the hood — experiment folder layout, the shared-`.dod` link,
parity rules, per-script ownership — see **`plugins/optimizer/README.md`**. This file is the
"how do I get started" doc; that one is the "how does it work" doc.

## Who writes what

Four plugins share a working directory, so every artifact has exactly one writer. Anything with
two unreconciled writers is a bug, not a feature.

| artifact | written by | read by | notes |
|---|---|---|---|
| `.ab-bench/state.json` | `optimizer:init` | every optimizer skill | absolute machine paths — why `.ab-bench/` is gitignored |
| `.ab-bench/<mandate>/mandate.md` | `optimizer:understand` | `plan`, `analyze`, the comparator agent | `prospector:handoff` may **seed** it; `understand` §0 then imports rather than re-interviewing, and `handoff` refuses to overwrite a mandate a live experiment is anchored to |
| `.ab-bench/<mandate>/quality-rubric.md` | `optimizer:understand` §3b | `analyze` §3b, `paper` | same seed-then-import path as `mandate.md`. §3b-ii owns amendments and `rubric_version` bumps |
| `.ab-bench/<mandate>/envs/<env>/env.json` | `optimizer:init` | `fire`, `analyze` | **never edited after a run fires against it** — new config = new env |
| `runs/run-NNN/task.md` | `optimizer:plan` | both arms (verbatim) | must stay plugin-blind |
| `runs/run-NNN/dod-checks.json` | `optimizer:plan` | `fire`, dod-lite | both arms get an identical list, all `source: generic` |
| `.dod/checks/*` | `optimizer:plan` | dod-lite's Stop hook | arms can neither read nor write these |
| `.dod/sessions/*.json` | `optimizer` seeds, dod-lite updates `state`/`history` | `analyze` | the sole shared-state exception, and the reason `.dod/` is denied to arms in both directions |
| `runs/run-NNN/analysis/report.md` | `optimizer:analyze` | you, `paper` | the evidentiary record |
| `runs/run-NNN/analysis/fix-list.md` | `optimizer:analyze` §5b | the plugin-manager session (you, by hand, in the plugin's repo) | the work order — different reader, on purpose. `prospector:reenter` reads it to *classify* items, never to execute them |
| `lab/objective.json` | `optimizer:plan` step 0b | `plan`, `analyze`, `paper` | one priority pillar + guards |
| `lab/hypotheses.json` | `optimizer:analyze` §4d (add), `plan` (resolve) | `plan` step 0b ranking | |
| `lab/regressions/points.json` | `optimizer:analyze` | `plan` step 0b coverage, `paper` | one point per run, `kind: frozen` vs `run` |
| `.prospector/needs.json` | `prospector:start`/`frame`/`survey`/`design`/`review`/`reenter` | `design`, `build`, `status`, and the `cutPackage` gate | the denominator. A `stated` need must cite its evidence; `build` may not author it |
| `.prospector/blueprint.md` | `prospector:design` only | `build`, `reenter` | **living**, not frozen — revised each cycle; each package records its git sha at cut |
| `.prospector/packages/vN/**` | `prospector:build` | you, `handoff` | frozen at cut, deferral reasons included |
| `.prospector/**` (rest) | prospector skills only | `prospector:handoff` | tracked in git — the record is part of the deliverable |

`core` writes nothing. `dod-lite` writes only `state`/`history` inside `.dod/sessions/*.json`.
`prospector:reenter` **reads** the Optimizer's testenv (via `.ab-bench/state.json`'s
`testenv_root`) and writes nothing there — the mirror of `handoff` writing `mandate.md` and
nothing else.

### Settled — do not re-open

**dod-lite is a separate plugin, permanently.** An arm session must load the auditor and
nothing else; folding it into optimizer would enable optimizer's own skills — `plan`, `fire`,
`analyze` — inside the very sessions being measured, and an arm that can invoke `/optimizer:plan`
can design its own Definition-of-Done. It is registered in `marketplace.json` only so it caches
alongside optimizer, because an installed plugin cannot reach files outside its own directory.
Full rationale: `plugins/optimizer/docs/dod-contract.md`, and `/core:learn chain`.

**`quality-rubric.md` has one owner:** `/optimizer:understand` §3b, with §3b-ii owning
amendments and `rubric_version` bumps. `/prospector:handoff` may seed it at handoff; `understand`
§0 then imports rather than re-interviewing, and `handoff` refuses to overwrite a mandate a live
experiment is anchored to. One writer per entry path, reconciled explicitly — not a conflict.

**A DoD check may never be the artifact's own gate.** `source` has one legal value, `generic`,
and both arms get an identical check list. A check that shells out to the plugin's own validator,
where that plugin also ships a Stop hook blocking until the same validator passes, can only ever
report `pass`. Everything that lives in the plugin must function autonomously, as if no DoDs
existed.

**Prospector's design stage is separate from its build stage, permanently.** They were one skill,
and the coverage rule it enforced — *every need is listed as covered or uncovered* — was airtight
and worthless, because the same agent wrote the need list thirty seconds earlier, in the same turn
as the MVP. A short list makes coverage complete by construction. The denominator now lives in
`needs.json`, is accumulated during the interview, and the building agent reads it rather than
writing it. Do not merge these stages back together to save a turn.

**The MVP is narrow in depth, never in breadth**, and `cutPackage` enforces it with no override
flag — deferring a named need with a written reason *is* the override, and it lands in the frozen
changelog. An earlier ceiling ("only enough of the job to expose the chosen hypothesis") was right
about depth and disastrous about breadth.

## Adding another plugin to this marketplace

Add a folder under `plugins/<name>/` with its own `.claude-plugin/plugin.json`, then add an entry
to `.claude-plugin/marketplace.json`'s `plugins[]` array. One marketplace, many R&D tools.

## Feedback

**Tried it, or stopped halfway?** [Tell me how it went](https://docs.google.com/forms/d/e/1FAIpQLSfINKyrAFuydl9SC-wNGceL_I-04cWqy7BkeQf0IJSwOKxFfg/viewform):
mostly clicks, 2 to 10 minutes depending on how far you got. Bugs go in
[issues](https://github.com/tommasomazieri/plugin-rnd-lab/issues).

The plugins print the same link as the last line of a few replies, never mid-task: after your
first analysed Optimizer run, in `/optimizer:paper`, after Prospector's first MVP, at
`/prospector:handoff`, and at the close of a `/core:learn` walkthrough.
