# plugin-rnd-lab

A Claude Code **marketplace** for plugin R&D tooling — instruments for testing, measuring, and
iterating on other Claude Code plugins. Ships one plugin: **ab-bench** (the A/B harness). A
trimmed, hooks-only Definition-of-Done engine (`plugins/dod-lite/`) ships alongside it in this
repo but is not separately installed — ab-bench loads it directly into every arm session it fires.
See "DoD tracking" below.

**Who this is for:** you're building (or evaluating) a Claude Code plugin and want proof it
actually helps — not just a feeling. Not a general-purpose plugin, not a 2-minute install: it's a
real testing harness with a learning curve. Windows only for now (see Prerequisites for why).

## What's ab-bench, in one paragraph

You built a Claude Code plugin. Does it actually make sessions better, or does it just feel that
way? ab-bench answers that with an A/B test: it fires two paired Claude Code sessions — a
**control** arm (status quo / no plugin, or a compensating baseline) and a **test** arm (your
plugin) — with everything else identical (model, prompt, seed files, MCP config). You work both
sessions normally. ab-bench then fuses the two session transcripts, Definition-of-Done tracker
logs, and your own quality verdict into one evidence-backed report telling you whether the plugin
earned its keep, and what to fix before the next iteration.

## Prerequisites

- [Claude Code](https://code.claude.com) CLI installed and on `PATH` as `claude`.
- **Windows** right now. Two arm-specific reasons: `/ab-bench:fire` opens each arm in its own
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
claude plugin install ab-bench@plugin-rnd-lab
```

This repo is typically used as a **local** marketplace source (clone it, point `marketplace add`
at the local path). Whenever you pull changes to this repo, refresh ab-bench's cached copy:

```
claude plugin marketplace update plugin-rnd-lab
claude plugin update ab-bench@plugin-rnd-lab
```

`plugin update` only refreshes if `.claude-plugin/plugin.json`'s `version` field changed — bump it
after editing, or the update is a silent no-op. Restart Claude Code sessions afterward to pick up
the change. `plugins/dod-lite/` needs none of this: ab-bench passes it to each arm via
`--plugin-dir`, read live off disk at launch time, not through Claude Code's install/cache
mechanism at all — pulling this repo is enough.

If you also run a fully-featured standalone dod-lite install (a different, unrelated plugin — see
`plugins/dod-lite/README.md`) in your own general Claude Code sessions, that's unaffected: it never
shares a session with the trimmed copy ab-bench injects into its arms.

## Configure: where experiments live

ab-bench keeps every experiment it creates in one folder outside any project repo, reused across
every experiment (`env.json`, seed files, run history, transcripts). That folder is a plugin
[user configuration](https://code.claude.com/docs/en/plugins-reference#user-configuration) value
(`experiments_root`) — Claude Code prompts for it the first time you enable the plugin. If you
skipped that prompt, or want to change the folder later, run `/ab-bench:setup` (user-invoked
only) any time.

## DoD tracking (built in)

Every run gets a Definition-of-Done engine (script / AI-graded / human-judged checks, enforced
turn-by-turn) in both arms — it's how ab-bench pre-registers REAL pass/fail criteria before either
arm starts, instead of relying only on token/turn metrics and your own eyeballing. This is
mandatory, not something you enable per experiment: `/ab-bench:fire` injects it into both arms
every time.

The engine itself (`plugins/dod-lite/` in this repo) is a trimmed, hooks-only fork — it enforces
checks at `Stop`, nothing else. All check *design* happens in `/ab-bench:plan`, in your main
session, before either arm ever starts; the engine ships no in-session planning skill for an arm
to invoke, by design — an arm must never design or touch its own DoD.

If `/ab-bench:plan` decides a given run needs zero checks (a legitimate outcome for a trivial
task), it simply doesn't write `dod-checks.json` — the engine is still loaded, it just has nothing
to enforce, and `/ab-bench:analyze` leans on metrics + your verdict only for that run.

Full integration contract: `plugins/ab-bench/docs/dod-contract.md`.

## Optional: faster analysis with context-mode

`/ab-bench:analyze`'s comparator agent filters two full session transcripts down to the relevant
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

New here? **`/ab-bench:learn`** walks through this whole lifecycle in plain language — setup,
planning, firing the paired sessions, working them in parallel, analyzing, and how dod-lite fits
in. Ask it about one stage specifically too, e.g. `/ab-bench:learn fire`.

0. **`/ab-bench:setup`** — first time only (or to change the folder later): pick/create the
   experiments root. Skip if Claude Code already prompted you for it on install.
1. **`/ab-bench:init my-plugin-v1`** — interviews you (plugin under test, control compensation,
   shared plugins/MCPs, model, seed files), creates the experiment folder.
2. **`/ab-bench:plan`** — writes `task.md` (the plugin-blind assignment both arms get) and designs
   real DoD checks for this run (script/prompt/human), reusing the plugin-under-test's own checker
   scripts where it ships them.
3. **`/ab-bench:fire`** — shows a parity preflight, then on confirmation spawns two titled terminals
   ("... control run-001" / "... test run-001"). Each arm starts with its task and DoD checks
   already wired in — you don't touch either workspace's setup.
4. **Work both sessions like normal work.** Divergent prompts to unstick one arm are fine — they're
   measured as bias indicators, not forbidden. DoD checks are already registered before either arm
   starts, and dod-lite ships no in-session design skill at all — there's nothing to invoke.
5. Back in the **main session**: **`/ab-bench:analyze`** with your verdict ("test produced a
   cleaner mesh because xyz"). Get `analysis/report.md`: deterministic deltas, DoD pass/fail per
   arm, an LLM-contextualized root-cause read (objective findings tagged separately from the
   subjective score), and next-iteration recommendations.
6. **`/ab-bench:status`** any time — read-only state of every experiment/run.
7. Apply the report's recommendations to the plugin-under-test's OWN repo (a separate session) —
   ab-bench never edits the plugin under test. Then `/ab-bench:plan` the next run.

## Repo layout

```
.claude-plugin/marketplace.json   marketplace manifest — one entry: ab-bench
plugins/ab-bench/                 the A/B harness — skills, agents, hooks, docs
  README.md                       architecture / internals reference (schemas, contracts, scripts)
plugins/dod-lite/                 ab-bench's internal DoD engine — hooks-only, no skill/command,
                                   not listed in marketplace.json, not for standalone use
  README.md                       what it does inside an ab-bench arm session
```

For how ab-bench actually works under the hood — experiment folder layout, the DoD junction trick,
parity rules, per-script ownership — see **`plugins/ab-bench/README.md`**. This file is the
"how do I get started" doc; that one is the "how does it work" doc.

## Adding another plugin to this marketplace

Add a folder under `plugins/<name>/` with its own `.claude-plugin/plugin.json`, then add an entry
to `.claude-plugin/marketplace.json`'s `plugins[]` array. One marketplace, many R&D tools.
