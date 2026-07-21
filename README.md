# plugin-rnd-lab

A Claude Code **marketplace** for plugin R&D tooling — instruments for testing, measuring, and
iterating on other Claude Code plugins. Ships two plugins: **ab-bench** (the A/B harness) and
**dod-lite** (its recommended Definition-of-Done tracker, bundled here so ab-bench always has a
working companion available — see "Recommended companion" below).

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
- Recommended: [**dod-lite**](#recommended-companion-dod-lite), bundled in this same marketplace.
  ab-bench works without it (metrics + your verdict only) but is much stronger with it — see below.

## Install

```
claude plugin marketplace add <path-to-this-repo>
claude plugin install ab-bench@plugin-rnd-lab
claude plugin install dod-lite@plugin-rnd-lab
```

This repo is typically used as a **local** marketplace source (clone it, point `marketplace add`
at the local path). Whenever you pull changes to this repo, refresh each plugin's cached copy:

```
claude plugin marketplace update plugin-rnd-lab
claude plugin update ab-bench@plugin-rnd-lab
claude plugin update dod-lite@plugin-rnd-lab
```

`plugin update` only refreshes if that plugin's `.claude-plugin/plugin.json` `version` field
changed — bump it after editing, or the update is a silent no-op. Restart Claude Code sessions
afterward to pick up the change.

**Don't run a standalone dod-lite install and this bundled one at the same time in the same
Claude Code setup** — two active copies of the same hooks (SessionStart/UserPromptSubmit/
PreToolUse/Stop) will double-fire. Pick one.

## Configure: where experiments live

ab-bench keeps every experiment it creates in one folder outside any project repo, reused across
every experiment (`env.json`, seed files, run history, transcripts). That folder is a plugin
[user configuration](https://code.claude.com/docs/en/plugins-reference#user-configuration) value
(`experiments_root`) — Claude Code prompts for it the first time you enable the plugin. If you
skipped that prompt, or want to change the folder later, run `/ab-bench:setup` (user-invoked
only) any time.

## Recommended companion: dod-lite

ab-bench integrates with **dod-lite**, a lightweight per-session Definition-of-Done tracker (script
/ AI-graded / human-judged checks, enforced turn-by-turn). It's what lets ab-bench pre-register
REAL pass/fail criteria for a run before either arm starts, instead of relying only on token/turn
metrics and your own eyeballing.

`dod-lite` ships in this same marketplace (`plugins/dod-lite/`) — `claude plugin install
dod-lite@plugin-rnd-lab` installs it, no separate repo needed. It also works standalone, outside
ab-bench, in any project.

ab-bench degrades gracefully without it: if you never declare `dod-lite` in an experiment's
`env.json` `common`/`control`/`test` plugin lists, `/ab-bench:plan` skips DoD-check authoring and
says so plainly — analysis then leans on metrics + your verdict only. It does NOT silently author
checks that nothing will ever evaluate.

Full integration contract (what ab-bench expects from dod-lite, verified against its real source):
`plugins/ab-bench/docs/dod-contract.md`.

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
   measured as bias indicators, not forbidden. Never invoke `dod-lite:planning` inside an arm
   yourself; checks are already registered.
5. Back in the **main session**: **`/ab-bench:analyze`** with your verdict ("test produced a
   cleaner mesh because xyz"). Get `analysis/report.md`: deterministic deltas, DoD pass/fail per
   arm, an LLM-contextualized root-cause read (objective findings tagged separately from the
   subjective score), and next-iteration recommendations.
6. **`/ab-bench:status`** any time — read-only state of every experiment/run.
7. Apply the report's recommendations to the plugin-under-test's OWN repo (a separate session) —
   ab-bench never edits the plugin under test. Then `/ab-bench:plan` the next run.

## Repo layout

```
.claude-plugin/marketplace.json   marketplace manifest — two entries: ab-bench, dod-lite
plugins/ab-bench/                 the A/B harness — skills, agents, hooks, docs
  README.md                       architecture / internals reference (schemas, contracts, scripts)
plugins/dod-lite/                 the DoD tracker — hooks, planning skill, status command
  README.md                       how dod-lite works standalone (outside ab-bench too)
```

For how ab-bench actually works under the hood — experiment folder layout, the DoD junction trick,
parity rules, per-script ownership — see **`plugins/ab-bench/README.md`**. This file is the
"how do I get started" doc; that one is the "how does it work" doc.

## Adding another plugin to this marketplace

Add a folder under `plugins/<name>/` with its own `.claude-plugin/plugin.json`, then add an entry
to `.claude-plugin/marketplace.json`'s `plugins[]` array. One marketplace, many R&D tools.
