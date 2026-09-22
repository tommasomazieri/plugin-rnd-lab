# Changelog

## Ready for the community directory: optimizer installs its own instrument

**`optimizer` 0.8.2 → 0.8.3, `core` 0.1.0 → 0.1.1.** Prepared for Anthropic's community
marketplace (`claude-community`), where every plugin is listed, reviewed and installed on its own.

- **optimizer declares `dod-lite` as a dependency.** Installing optimizer used to need a second,
  separate `claude plugin install dod-lite`, and without it `/optimizer:fire` refused to launch.
  `claude plugin install optimizer@…` now installs dod-lite with it ("+ 1 dependency: dod-lite",
  verified in a clean `CLAUDE_CONFIG_DIR`), and Claude Code keeps optimizer disabled while dod-lite
  is missing or disabled. The README and `/core:learn` no longer list dod-lite as its own step.
- **The "dod-lite not found" message names the right marketplace.** It told everyone to run
  `claude plugin install dod-lite@plugin-rnd-lab`, which is wrong for anyone who installed from
  the community directory. It now reads the marketplace from where optimizer was installed
  (`lib/dod-lite-dir.mjs`, `installedMarketplace`), and a test runs the real probe from a
  `claude-community` cache layout.

## The install-from-GitHub release — the first install nobody but the author had done

**`optimizer` 0.8.0 → 0.8.2.** Found by installing the marketplace from the public repo into an
isolated `CLAUDE_CONFIG_DIR`, exactly as a stranger would, before telling anyone it exists, and
by CI's first runs on three platforms. (0.8.1 was on `master` for part of 2026-09-22 with the
dod-lite and security fixes only; 0.8.2 adds everything under "CI on three platforms".)

### Fixed: Optimizer could not find dod-lite after a GitHub install

A marketplace added from a local directory loads its plugins in place, so dod-lite sits next to
optimizer. A marketplace added from GitHub copies every plugin into its own **versioned** cache
folder (`cache/plugin-rnd-lab/optimizer/0.8.0/`, `cache/plugin-rnd-lab/dod-lite/0.4.1/`), and
optimizer only ever looked for the first layout. For every GitHub install, `/optimizer:fire`
refused to launch ("DoD audit engine not found") and `/optimizer:plan`'s check probe crashed on
its import. The author's own setup is a local marketplace, so no test and no real run ever saw it.

`lib/dod-lite-dir.mjs` now owns both layouts, newest cached version first, and the launcher and
the probe both go through it. The new suite builds the cached layout from the real plugin files
and runs the real launcher and probe inside it.

### Fixed: two injection paths, from the pre-launch security review

- PowerShell ends a single-quoted literal on the typographic quotes `‘ ’ ‚ ‛` as well as on `'`.
  The Windows arm launcher escaped only `'`, so an experiment named with a phone-typed apostrophe
  broke the launcher, and a crafted name could run code in it. All four are escaped now, and a
  test round-trips hostile values through a real `powershell.exe`.
- A pinned ref that began with `-` reached `git worktree add` as an option. Git allows no such
  ref name, so they are refused.

### CI on three platforms, with real terminal windows

`.github/workflows/ci.yml` runs every suite on Windows, macOS and Linux, and
`test/smoke-window.mjs` opens a real window through the real launcher on macOS (Terminal.app)
and Linux (xterm), with a stub `claude` that records the workspace, env and argv it arrived
with. Its first runs found three defects, all fixed, and retired one path:

- **macOS arm windows needed a permission prompt.** They were opened with AppleScript, which
  needs the user's Automation consent: the first `/optimizer:fire` on a Mac stopped on a system
  dialog, and "Don't Allow" broke every later run. The launcher is now handed over with
  `open -a`, which needs no consent, and is named `.command`, the type Terminal.app runs.
- **iTerm2 is no longer used for arm windows.** Handed the launcher with `open -a`, iTerm2
  reported success and never ran it: no window ran the arm within 90 seconds. In a real run that
  is a manifest saying "launched" over an arm that never started. Its only other route is the
  AppleScript that needed consent. Arms now always open in Terminal.app on macOS, the path CI
  proves; `OPTIMIZER_TERMINAL` still overrides.
- **Windows: a cached worktree was not recognised when its path was spelled differently** from
  how git prints it (an 8.3 short name, other casing), so the second arm pinning the same ref
  was refused. Paths are now compared after realpath, case-insensitively on Windows.

### Install instructions point at GitHub, over HTTPS

The README described a local clone. It now leads with the public repo, and uses the HTTPS URL
rather than the `owner/repo` shorthand: the shorthand clones over SSH and fails with "Host key
verification failed" on any machine without an SSH key set up for GitHub.

## The portability release — the harness leaves Windows

**`optimizer` 0.7.0 → 0.8.0, `dod-lite` 0.4.0 → 0.4.1.**
The marketplace ran on one operating system. Nothing about the *method* was Windows-specific —
only the fifty lines that open a terminal window. Those are now one module with three branches.

|  | before | after |
|---|---|---|
| platforms | Windows | Windows, macOS, Linux |
| arm launcher | a generated `.ps1` under `cmd.exe`/`start` | a generated `.ps1` (Windows) or `.sh` (macOS/Linux) |
| terminal hosts | Windows Terminal, `pwsh`, `powershell` | + Terminal.app, iTerm2, and ten Linux emulators, or `OPTIMIZER_TERMINAL` |
| no terminal available | not a considered case | run is staged, `fire` prints the commands to start the arms by hand |
| tests | 154 | 162 |

### `/optimizer:fire` runs on macOS and Linux

All platform-specific launch code moved out of `launch-pair.mjs` into
`skills/fire/scripts/terminal.mjs`: the script dialect, the terminal probe, and the spawn.
`launch-pair.mjs` reads as one flow again instead of a fork.

- **macOS** — iTerm2 if installed, else Terminal.app, both via `osascript`. iTerm2 is driven
  synchronously and falls back to Terminal.app if its scripting interface refuses, because a
  silent AppleScript error would otherwise leave a manifest claiming an arm launched with no
  window anywhere.
- **Linux** — the first of GNOME Terminal, Konsole, Xfce Terminal, kitty, Alacritty, WezTerm,
  Tilix, Terminator, `x-terminal-emulator` or xterm found on `PATH`.
- **`OPTIMIZER_TERMINAL`** overrides the probe on every platform.
- Window titles are set by the script itself with an OSC 0 escape, so no host branch has to
  know how its emulator spells `--title`.
- The POSIX launcher preserves argv with `set --` plus `"$@"`, the exact counterpart of the
  PowerShell array-and-splat. Paths in an experiments root have spaces in them and the opening
  prompt has punctuation in it; neither dialect hand-quotes a command line.

### A run with nowhere to open a window is staged, not failed

Headless boxes, SSH sessions, and emulators the probe does not know used to be outside the
harness's world. Now the workspaces, artifacts, prepare steps and manifest are all still built,
both arms are recorded as `staged`, and `fire` prints the two commands to run. If one arm's
window opens and the other's does not, **both** fall back — one arm in a terminal and one
nowhere looks like a fired run and analyzes as a broken one.

### Fixed: the `.dod` link failing silently on a filesystem that cannot hold it

`fs.symlinkSync(target, link, 'junction')` was already correct everywhere — Node ignores the
`type` argument off Windows and produces a plain symlink, which needs no privilege there either.
What was missing was the failure path: a network share or exFAT experiments root would throw and
take the run down with an unreadable stack. It now aborts before launching, names the platform's
likely cause, and says no arms were started.

### Fixed: `dod-lite` leaked processes on macOS and Linux

A check script's *children* survived `child.kill()`, held the inherited pipes open, and outlived
the hook — so `close` never fired and the script timeout bought nothing. Windows had `taskkill /T`
for this; POSIX had nothing. Check subprocesses are now spawned `detached` so they lead their own
process group, and the timeout signals the group. This is the same defect the Windows branch was
written to fix, on the two platforms nobody had run it on.

### Fixed: default check runners that do not exist off Windows

`.ps1` mapped to `powershell -ExecutionPolicy Bypass`, a spelling and a flag that both fail on
macOS and Linux (`pwsh`, and `-ExecutionPolicy` is Windows-only). `.py` mapped to `python`, which
on current macOS and most Linux distros is absent or a stub. Both are now platform-aware, and
both remain overridable per experiment in `.dod/config.json`.

### The platform matrix is tested from any platform

`terminal.mjs`'s script builders take an explicit platform, so all three dialects are asserted
from whichever one is running — the branch its author cannot run being the one most likely to
be wrong. Eight new tests cover the three quoting dialects, PATH probing, and dialect isolation.
The POSIX launcher is additionally **executed** under `sh` against a stub `claude` that records
its argv, cwd and environment: `sh` ships with Git for Windows, so the Linux/macOS arm launcher
runs for real on every commit regardless of who is committing.

### Removed

`idea.txt` — the design brief for the two-plugin split, written before that split shipped and
fully superseded by the README and the release notes below. It is in the history.

---

## The discovery release — `ab-bench` becomes a two-instrument loop

**Comparing `8d6a671` (2026-08-04) → `5b99069` (2026-08-07).**
Baseline: the marketplace when it shipped **one instrument** — `ab-bench 0.4.0`, plus `dod-lite
0.3.0` as its arm-side auditor. Everything below is the difference between that state and the
current one, stated end-to-end rather than as the path taken.

|  | before | after |
|---|---|---|
| plugins | 2 — `ab-bench` 0.4.0, `dod-lite` 0.3.0 | 4 — `core` 0.1.0, `prospector` 0.5.0, `optimizer` 0.7.0, `dod-lite` 0.4.0 |
| skills | 9 (all `ab-bench`) | 18 |
| tests | 104 | 154 |
| what it answered | *does the thing I built help?* | *is this worth building at all?* **and** *does it help?* |
| shape | a linear harness | a loop |

71 files changed, +6,350 / −1,082.

---

## ⚠ Breaking

### `ab-bench` is renamed to `optimizer`

Every command moves: `/ab-bench:init` → `/optimizer:init`, and so on for `setup`, `understand`,
`plan`, `fire`, `analyze`, `paper`, `status`. The plugin directory is `plugins/optimizer/`.

**Four tokens are deliberately NOT renamed, and must stay frozen:**

- `.ab-bench/` — the on-disk identity directory
- `AB_BENCH_DIR` in `lib/state.mjs`
- `ab-bench-scaffold.mjs`
- `.ab-bench-snapshot.json`

These are data-format identifiers, not branding. Renaming them orphans every experiment already on
disk, and the repo would gain nothing but tidiness in exchange.

### `/ab-bench:learn` is deleted, not moved

Teaching now lives in the new `core` plugin as `/core:learn`, because it has to cover *two*
instruments and the chain between them. A skill inside one instrument cannot be the entry point
for both.

---

## Added

### `prospector` — the discovery stage (new plugin, 0.5.0, 9 skills)

The Optimizer starts from an already-defined artifact and makes its execution efficient; it
assumes the right problem has already been chosen. Prospector starts one step earlier, from
ambiguity, and decides what is worth solving at all. It optimises for **effectiveness**, the
Optimizer for **efficiency**.

```
/prospector:start     record what they walked in with, verbatim; open the inquiry
/prospector:survey    does this already exist? — three verdicts, one ends the engagement
/prospector:frame     competing framings → adopt one → ranked hypotheses
/prospector:design    blueprint.md — the WHOLE plugin, before anything is built
/prospector:build     cut package vN + build MVP plugin vN, shallow on purpose
/prospector:review    turn real use into evidence; resolve or refute
/prospector:handoff   write mandate.md + quality-rubric.md for the Optimizer
/prospector:reenter   after an Optimizer cycle: what's still missing, what's next
/prospector:status    where the engagement stands, read-only
```

It runs **in place**, in the directory the future plugin will live in — no experiments root, no
second root, nothing to cd into, because it never runs paired sessions. `.prospector/` is
**tracked in git**, unlike the Optimizer's `.ab-bench/`: that one is ignored because its
`state.json` holds absolute machine paths, and Prospector stores none. The record ships as
provenance with the plugin it produced.

The load-bearing rules:

- **Four layers arrive together and only two are ever challenged.** The *medium* ("a plugin") is
  constant. The *symptom* ("my output comes out bad") is accepted as fact — the user is the sole
  authority on their own dissatisfaction. The *diagnosis* is a hypothesis, and testing it is what
  the engagement is for. The *prescription* is held loosest. So "my output is bad and I don't know
  why" is the **strongest** possible opening, not a deficient one.
- **The need list is the denominator, and the agent that builds does not author it.** Every need
  the user states is recorded during the interview as `N-NNN`, citing the evidence file it came
  from; the CLI refuses a `stated` need with no `E-NNN`. `/prospector:build` **cannot cut a
  package** while any core stated need is neither covered nor deferred — no override flag.
  Deferring with a written reason *is* the override, and it lands in the frozen changelog.
- **The MVP is narrow in DEPTH, never in BREADTH.** It must span everything the user asked for,
  roughly, rather than nail one part of it. What gets cut is polish, generality, configurability,
  and edge cases — the hard half of each need before any need entirely.
- **The design is a separate stage from the build.** `blueprint.md` is written while there is
  nothing to be loyal to; `build` reads it. An agent that designs and implements in one turn
  writes a design its implementation happens to satisfy.
- **Uncertainty is labelled, always** — `confirmed`, `strongly-supported`, `tentative`,
  `assumption`, `unknown`, `contradicted`. An inference is never recorded as user-confirmed fact.
- **Two ranked lists that deliberately disagree.** Hypotheses rank by *expected learning* with
  confidence **inverted** (a 50/50 teaches most) — that answers *what to find out next*. Needs
  rank by *value*, uninverted — that answers *what to build next*. Using the first to decide
  builds aims every version at the least-understood thing on the page.

### `core` — the teaching plugin (new, 0.1.0)

`/core:learn [optimizer|prospector|chain|<stage>|<question>]`. A router: a short `SKILL.md` plus
reference files read on demand. **Writes nothing**, never auto-triggers, walks a lifecycle stage
by stage rather than dumping a wall of text.

### `/prospector:survey` — prior art, with an honest negative

Checks whether the thing already exists **before** any framing work commits you to building it.
Five sources: what the user already has registered, the community marketplace's `marketplace.json`
(fetchable as raw JSON), Anthropic's demo plugins, the open web, and — the best of the five —
asking what they already tried, because it is the only one that reports *why* something failed.

Three verdicts, all legal, and one is **terminal**: *"this already exists, install it, we're
done."* A discovery instrument that cannot return "don't build this" is a build-justification
machine, and one install beats three versions and a month.

Negative results record as `unknown`, never `confirmed`. There is no plugin search API and no
aggregator of third-party marketplaces, so absence of evidence is not evidence of absence — the
same split `dod-lite` makes between a failing artifact and a grader that could not open one.

### The loop — `/prospector:reenter` and the Optimizer's return path

The pipeline was linear and greenfield-only. It is now a cycle:

```
prospector: start → survey → frame → design → build → review → handoff
                                ↑                                 ↓
                                └───── reenter ←── optimizer: init → plan → fire → analyze
```

`prospector-cli detect` gains a third status, **`post-optimizer`** — a blueprint exists *and* at
least one run has been analysed (both, because a handoff with no analysed run has produced nothing
new to re-enter on). Re-entry reads `.ab-bench/state.json`'s `testenv_root`, the mirror image of
what `handoff` already does writing `mandate.md` into that same directory: still a filesystem
contract in a shared working dir, still no cross-plugin code access, which is not available in
either direction. It scans **every** mandate and env, not just the current one, because that
pointer only moves forward and reading only the current mandate would discard everything learned
before the last scope change.

It ingests the A/B evidence, diffs the shipped surface against the blueprint's build order,
re-interviews on real use, re-runs the survey, revises the blueprint, and ranks the next slice by
value.

`analysis/fix-list.md` is deliberately **not** re-entry's to execute — its reader is the operator,
by hand, in the plugin's own repo, and that is by design. Re-entry reads it only to classify: an
item meaning *"does the wrong thing"* is a discovery finding, *"does the right thing slowly"* is
named and handed back untouched. Mixing efficiency fixes into `vN+1` makes the user's reaction to
that version unattributable.

`/optimizer:analyze` gains **§7b**, the return path specified from the start and never built: when
the finding is that the plugin is aimed at the wrong job rather than executing it badly, it says so
and names `/prospector:reenter`. The Optimizer still never redefines the problem itself — it is
simply the instrument most likely to notice that the problem needs redefining, and silence there is
not neutrality.

### The handoff — Prospector writes the Optimizer's mandate

`/optimizer:understand` interviews seven categories. A finished discovery engagement has already
established six, so `/prospector:handoff` writes `mandate.md` and `quality-rubric.md` directly and
`understand` detects them and switches to **import mode** — confirming section by section and
asking only for **§6 Appropriate task complexity**, the one category about A/B signal strength
rather than about the problem.

`handoff` refuses to overwrite an existing mandate: that is a live experiment's north star, and
replacing it would retroactively change what every past run was measured against.

---

## Changed — `optimizer` 0.4.0 → 0.7.0

### A DoD check may never be the artifact's own gate

Plugin-native checkers are now **forbidden**, not preferred. `plan` step 4b used to say: if the
plugin under test ships a checker covering a criterion, use it instead of writing a generic one.
A real run followed that and shipped a check that shelled out to the plugin's own validator —
while the same plugin shipped a Stop hook blocking until that validator returned clean. The check
could only ever report `pass`. It did, on 3 of 3 turns, while the delivered artifact scored zero.

Three reasons, any one sufficient: a check only one arm can run grades only one arm, so that
column holds no comparison; a criterion the artifact already enforces internally cannot fail; and
the artifact under test must function autonomously, as if no DoDs existed.

`source` now has exactly one legal value, `generic`, both arms' lists must be identical, and
`fire` blocks on any asymmetry.

### The probe gate is two-sided

The seed probe proved a check could **fail**. It could not prove a check could ever **pass**, and
that is where the real defects were. `probe-checks.mjs` now proves both directions mechanically.

### Measurement bugs that were corrupting results

- **Background-Agent completions were being scored as operator turns.** A finished Agent re-enters
  the session as a plain `type: "user"` entry — not meta, not a tool_result, not a sidechain — and
  fell straight through to `user_real`. It corrupted four numbers from one root cause. Not a
  symmetric error: only an arm that *delegates* receives these, and that is always the test arm,
  so the instrument penalised the behaviour under test. The count now lives in its own
  `user_system_reentry` field rather than being dropped, because a large asymmetry there *is* the
  delegation signal.
- **`.dod/` is now opaque to arms in both directions.** It denied writes; reads were open, and both
  arms junction to the *same* shared `.dod`, so either arm could read the other's scorecard.
- **A grader that cannot open the artifact records `error`, not `fail`.** The verdict contract
  gains `gradeable`. The checker system prompt said "inconclusive or unverifiable is a fail" with
  no exception for the grader's own blindness.
- **`STUB TRANSCRIPT` no longer fires on subagent digests** — a subagent session has no operator
  turns by construction, so "0 real user turns" was definitional rather than diagnostic.

### The report gained a second reader

`analyze` now emits `analysis/fix-list.md` beside `report.md`, on purpose for a different reader:
`report.md` is the evidentiary record and feeds the next planning cycle; `fix-list.md` is the work
order for a session that has read nothing else — absolute paths, named functions, a measured number
per item, expected effect, priority by the objective's pillar.

### Continuity fixes

- `plan` step 0b: picking anything below rank 1 requires a written reason, and a hypothesis
  skipped twice goes to the user to fire or withdraw. Hypotheses on the priority pillar were
  ageing out of attention without ever being rejected, because every `analyze` banks fresh ones
  carrying the most vivid evidence.
- **Regression points are recorded for every run**, tagged `frozen` vs `run`, instead of only on
  regression runs — which never fired, leaving the curve empty while eight consecutive misses of
  the priority pillar went unnoticed.
- `understand` §3b-ii: the quality rubric can now be **amended**, not only authored. Clarifications
  keep the version; scale changes bump it and write a changelog entry, and a bump forks the quality
  trajectory.

### Ownership is written down

The root README gains a **"Who writes what"** table — four plugins share a working directory, so
every artifact has exactly one writer, and anything with two unreconciled writers is a bug. Plus a
**"Settled — do not re-open"** section for the decisions that kept getting re-litigated.

---

## Changed — `dod-lite` 0.3.0 → 0.4.0

The checker verdict contract gains `gradeable`, separating "the artifact failed" from "the grader
could not see the artifact". Absent field is treated as gradeable, so older checks keep working.

`dod-lite` remains **a separate plugin, permanently, and this is not an unresolved boundary.** An
arm session must load the auditor and nothing else; folding it into the Optimizer would enable
`plan`, `fire`, and `analyze` inside the very sessions being measured, and an arm that can invoke
`/optimizer:plan` can design its own Definition-of-Done.

---

## Unchanged, and worth restating

These were already true at the baseline and remain load-bearing:

- **DoD checks are observational only.** The `Stop` hook writes nothing to stdout — no decision, no
  reason, no message. Injected into both arms identically, any feedback would pull control and test
  toward the same output and mask the difference being measured. Two regression tests assert that
  silence directly.
- **Every arm is pinned to something immutable**: a ref → cached worktree, a clean tree → HEAD sha,
  a dirty tree → content-hashed copy. Arms never read a live repo.
- **No aggregate score.** One declared priority pillar plus regression guards on the other four,
  across `quality`, `input_tokens`, `output_tokens`, `turns`, `autonomy`.

---

## Upgrading

```bash
claude plugin marketplace update plugin-rnd-lab
claude plugin install core@plugin-rnd-lab           # new — teaches both stages
claude plugin install prospector@plugin-rnd-lab     # new — the discovery stage
```

`optimizer` and `dod-lite` update in place. Then:

- Replace `/ab-bench:*` with `/optimizer:*` in any notes or scripts.
- **Leave `.ab-bench/` directories exactly as they are.** Existing experiments keep working;
  renaming that directory orphans them.
- `/ab-bench:learn` no longer exists — use `/core:learn`.
- `optimizer` will not fire without `dod-lite` installed; that was already true.

Existing experiments need no migration. `env.json` schema 1 is still synthesized into a single
`plugin-dir` artifact, and backward compatibility is tested.
