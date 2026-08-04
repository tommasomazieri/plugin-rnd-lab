# dod-lite (ab-bench arm instrument)

**Not a standalone plugin.** This is a trimmed, hooks-only fork of dod-lite, purpose-built as the
Definition-of-Done **auditor** ab-bench auto-injects into every control/test arm session it fires.
It is registered in `marketplace.json` only so that it is cached alongside ab-bench — an installed
plugin cannot reach files outside its own directory, so an unregistered sibling resolved to a dead
path on every marketplace install. It is not meant to be installed or used on its own.

It stays a separate plugin on purpose: an arm has to load the auditor and **nothing else**. Folding
it into ab-bench would mean enabling ab-bench's own skills inside the very sessions being measured.

If you want full-featured, standalone, per-session DoD tracking for your own projects (in-session
planning interview, `/dod-lite:status`, etc.), use the free-standing DoD-lightweight install this
was forked from — never run both an independent dod-lite install and this bundled copy in the same
session, they share a hook name and would double-fire.

## What it does here

ab-bench's `/ab-bench:plan` authors real check files (`.dod/checks/`) and pre-seeds each arm's
session state (`.dod/sessions/<session_id>.json`) *before* either arm session ever starts —
checks are never designed live, in-session, by either arm. This plugin's only job is to **observe**
that pre-authored set: at every `Stop` it runs the session's checks in two tiers — script and
AI-graded, both, ungated — records a complete per-turn report, and **says nothing at all** to the
session it just measured.

### It is an instrument, not a control loop

The hook writes **nothing to stdout**: no `decision`, no `reason`, no `systemMessage`. That is the
invariant this plugin exists to uphold, and it is load-bearing for the experiment:

- ab-bench injects it into **both** arms identically. Feedback would pull control and test toward
  the same output and mask the very difference being measured.
- Real vanilla Claude Code has no such feedback loop, so control-with-nudges is not control and
  nothing measured that way generalises.
- A plugin under test may ship its own `Stop` checks. Those are intrinsic to the treatment, and
  they must be the **only** checks an arm can hear.

Its predecessor blocked on failure and shipped failing-check output back into the arm. That is
correct for a DoD engine driving a job to completion, and wrong for one measuring whether the agent
got there unaided. Two regression tests assert the silence directly.

There is no human tier. The human is the gate: a session ends when it ends, and the operator either
reports the job undone at `/ab-bench:analyze` or feeds back and grants another turn. The old tier
blocked with instructions telling the arm to call `AskUserQuestion`, manufacturing the very autonomy
signal the harness measures.

There is deliberately no `SessionStart`, `UserPromptSubmit`, `PreToolUse`, or `PostToolUse` hook,
no planning skill, and no status command — an ab-bench arm must never be nudged toward, or even
able to discover, any DoD-*design* capability. All of that lives in ab-bench's own
`/ab-bench:plan` skill instead. See `plugins/ab-bench/docs/dod-contract.md` for the full contract
(schema, file layout, injection mechanics).

## `.dod/` layout (in the shared experiment root, not the plugin)

```
.dod/                      ← READ-ONLY to a graded session; never write here from an arm
  checks/                  ← authored by /ab-bench:plan, reusable across runs of the same experiment
    <id>.py|.mjs|.sh|.ps1|.rb|...   type: script — exit code is the verdict
    <id>.meta.json                   optional sidecar: declared metadata for a script check
    <id>.md                          type: prompt, via frontmatter
  sessions/
    <session_id>.json      ← seeded by ab-bench's arm-session-start.mjs, updated by this plugin's Stop hook
  config.json               ← optional, see below
```

An arm has **no write channel into DoD state at all**. It is denied writes under `.dod/`, and there
is nothing else for it to write — it is being observed, not consulted.

An id must match exactly one file in `checks/`. `foo.py` alongside `foo.md` is the same check
declared twice at two tiers; it is reported as an error, never resolved by readdir order.

`.md` check frontmatter:
```yaml
---
type: prompt
description: "one line"
seed_expectation: fail    # what this reports against an untouched seed. default fail
model: claude-haiku-4-5-20251001   # prompt only. FULL model id — see below
agents: '<json>'          # prompt only, optional: grade with specialist agents
plugin_dirs: '[".../p"]'  # prompt only, optional: grade with a plugin's own QA tooling
---
Body = the grading question. It must be answerable from files alone.
```

`model:` must be a full model id or a documented CLI alias (`fable`, `opus`, `sonnet`). A bare
`haiku` is **not** an alias — `--model` accepts unknown values silently and falls back to a default,
so it used to grade and bill as something nobody chose. That is now rejected outright.

`config.json` (all optional):
```json
{
  "runners":          { ".ext": "command" },
  "script_timeout_ms": 30000,
  "prompt_timeout_ms": 180000,
  "hook_budget_ms":    270000
}
```

## Check tiers

| Tier | Runs | Cost | Verdict source |
|---|---|---|---|
| script | every `Stop` | free, local | exit code |
| prompt | every `Stop` | $ + time (spawns a headless `claude -p` subprocess) | strict AI grader, read-only repo access, must cite `evidence` |

**There is no gate between them.** Both tiers run every turn so the per-turn series has no holes.
The old `prompt_tier_gate` skipped the graded tier whenever a script check was red — which mid-run
is the normal state — so the AI-graded tier silently never ran. That was the entire "prompt checkers
don't work" symptom.

Prompt-tier cost is therefore a **planning** concern, not a runtime one: a prompt check bills one
grader subprocess per turn per arm, so four of them over a five-turn run is forty. `/ab-bench:plan`
is instructed to be sparing and to prefer exit codes wherever a criterion can be expressed as one.

A prompt verdict carries `pass`, `reason`, `evidence` (cited `{path, line?, quote}` entries) and
`confidence`. A pass with empty `evidence` is recorded as ungrounded — a grader that cites nothing
did not look.

Infrastructure failures (spawn error, timeout, unparseable verdict, exhausted budget) record
`error`, never `fail`, and never block: a checker bug must not change what a graded session does.
The prompt tier retries once before recording `error`.

## Plugin layout

```
.claude-plugin/plugin.json
hooks/                    dod-check.mjs, lib.mjs, hooks.json (Stop only)
resources/prompt-checker-system.md   (grading rubric appended to headless checker calls)
```

## Per-turn audit

`session.history` is append-only. Every `Stop` appends a **complete** record of that turn — full
output, evidence, grader model — and earlier turns are never rewritten. `state` holds only the
latest value per check and is a convenience; the history array is the record.

That series is what makes improvement versus regression readable across turns, including a check
that went `pass` → `fail` while the arm kept working, which `state` alone cannot show. It is also
what lets `/ab-bench:analyze` separate a plugin problem from bad operator prompts in between turns.

## Design notes

- Every hook fails open: an internal bug logs to stderr and exits 0, it never blocks an unrelated
  session.
- The prompt-tier checker runs under `--permission-mode plan`, not a hardcoded `--allowedTools`
  list — a generic read-only guarantee that also covers project-specific MCP tools, not just
  Claude Code's builtins.
- Still resolves `.dod/` as a direct child of `cwd`, no upward search — each arm workspace needs
  `.dod` linked (directory junction) to the shared experiment-root `.dod/`. See `dod-contract.md`.
