# plugin-rnd-lab

A Claude Code **marketplace** for plugin R&D tooling — instruments for testing, measuring, and
iterating on other Claude Code plugins.

Two instruments, operating at different stages (plus `core`, which teaches them — see Install):

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
real testing harness with a learning curve. Windows only for now (see Prerequisites for why).

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
- **Windows** right now. Two arm-specific reasons: `/optimizer:fire` opens each arm in its own
  visible, titled terminal window via `cmd.exe`/`start` — there's no cross-platform way to do
  that, macOS needs `osascript`/Terminal.app and Linux needs a specific terminal emulator, so
  porting means a second launch path, not a one-line swap. Separately, each arm's `.dod/` links to
  the shared experiment `.dod/` via a Windows directory junction (chosen because it needs no admin
  rights, unlike a Windows symlink) — trivial to swap for a plain POSIX symlink, that part isn't
  the blocker. Not yet ported to macOS/Linux.
- Node.js (bundled scripts are plain `.mjs`, no dependencies to install).

## Install

```
claude plugin marketplace add <path-to-this-repo>
claude plugin install core@plugin-rnd-lab           # start here — teaches both stages
claude plugin install optimizer@plugin-rnd-lab
claude plugin install prospector@plugin-rnd-lab     # optional — the discovery stage
claude plugin install dod-lite@plugin-rnd-lab       # required by optimizer: its arm instrument
```

`core` ships one skill, `/core:learn`, and writes nothing — it is the walkthrough for everything
below. Install it first if you have not used either instrument before.

`dod-lite` must be installed for `/optimizer:fire` to work. An installed plugin cannot reach
files outside its own directory, so the Optimizer resolves the audit instrument as a cached
sibling — and refuses to launch a run at all if it is missing, rather than producing an
uninstrumented run that looks identical to one where every check passed.

This repo is typically used as a **local** marketplace source (clone it, point `marketplace add`
at the local path). Whenever you pull changes to this repo, refresh optimizer's cached copy:

```
claude plugin marketplace update plugin-rnd-lab
claude plugin update optimizer@plugin-rnd-lab
```

`plugin update` only refreshes if `.claude-plugin/plugin.json`'s `version` field changed — bump it
after editing, or the update is a silent no-op. Restart Claude Code sessions afterward to pick up
the change. `plugins/dod-lite/` needs none of this: optimizer passes it to each arm via
`--plugin-dir`, read live off disk at launch time, not through Claude Code's install/cache
mechanism at all — pulling this repo is enough.

If you also run a fully-featured standalone dod-lite install (a different, unrelated plugin — see
`plugins/dod-lite/README.md`) in your own general Claude Code sessions, that's unaffected: it never
shares a session with the trimmed copy optimizer injects into its arms.

## Configure: where experiments live

optimizer keeps every experiment it creates in one folder outside any project repo, reused across
every experiment (`env.json`, seed files, run history, transcripts). That folder is a plugin
[user configuration](https://code.claude.com/docs/en/plugins-reference#user-configuration) value
(`experiments_root`) — Claude Code prompts for it the first time you enable the plugin. If you
skipped that prompt, or want to change the folder later, run `/optimizer:setup` (user-invoked
only) any time.

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
```

For how optimizer actually works under the hood — experiment folder layout, the DoD junction trick,
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
