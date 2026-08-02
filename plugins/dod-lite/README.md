# dod-lite (ab-bench arm engine)

**Not a standalone plugin.** This is a trimmed, hooks-only fork of dod-lite, purpose-built as the
Definition-of-Done enforcement engine ab-bench auto-injects into every control/test arm session it
fires. It is not listed in `marketplace.json` and is not meant to be installed on its own.

If you want full-featured, standalone, per-session DoD tracking for your own projects (in-session
planning interview, `/dod-lite:status`, etc.), use the free-standing DoD-lightweight install this
was forked from — never run both an independent dod-lite install and this bundled copy in the same
session, they share a hook name and would double-fire.

## What it does here

ab-bench's `/ab-bench:plan` authors real check files (`.dod/checks/`) and pre-seeds each arm's
session state (`.dod/sessions/<session_id>.json`) *before* either arm session ever starts —
checks are never designed live, in-session, by either arm. This plugin's only job is to **enforce**
that pre-authored set: at every `Stop`, it runs the session's checks in three cost-gated tiers —
script → AI-graded → human — and blocks the turn from ending until they pass (or a human explicitly
waives one).

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
    <id>.md                          type: prompt or human, via frontmatter
  sessions/
    <session_id>.json      ← seeded by ab-bench's arm-session-start.mjs, updated by this plugin's Stop hook
  config.json               ← optional, see below
.dod-answers/              ← WRITTEN BY the graded session: one file per answered human check
  <id>.json                  {"result": "pass"|"fail"|"waived", "note": "...", "answered_at": "..."}
```

An id must match exactly one file in `checks/`. `foo.py` alongside `foo.md` is the same check
declared twice at two tiers; it is reported as an error, never resolved by readdir order.

`.md` check frontmatter:
```yaml
---
type: prompt        # or: human
description: "one line"
seed_expectation: fail    # what this reports against an untouched seed. default fail
model: claude-haiku-4-5-20251001   # prompt only. FULL model id — see below
agents: '<json>'          # prompt only, optional: grade with specialist agents
plugin_dirs: '[".../p"]'  # prompt only, optional: grade with a plugin's own QA tooling
---
Body = the grading question (prompt) or the question to ask the user (human).
```

`model:` must be a full model id or a documented CLI alias (`fable`, `opus`, `sonnet`). A bare
`haiku` is **not** an alias — `--model` accepts unknown values silently and falls back to a default,
so it used to grade and bill as something nobody chose. That is now rejected outright.

`config.json` (all optional):
```json
{
  "runners":          { ".ext": "command" },
  "prompt_tier_gate": true,
  "script_timeout_ms": 30000,
  "prompt_timeout_ms": 180000,
  "hook_budget_ms":    270000
}
```

## Check tiers

| Tier | Runs | Cost | Verdict source |
|---|---|---|---|
| script | every `Stop`, always | free, local | exit code |
| prompt | all script checks pass, **or** `prompt_tier_gate: false` | $ + time (spawns a headless `claude -p` subprocess) | strict AI grader, read-only repo access, must cite `evidence` |
| human | only if script + prompt checks pass | interrupts the user | `AskUserQuestion` → session writes `.dod-answers/<id>.json` |

A failing tier skips the tiers after it that round — no point spending money or interrupting the
arm session for nothing when a free check already says not-done. **`prompt_tier_gate: false` turns
that off for the prompt tier**, which is what an A/B harness wants: mid-run a script check is red
almost by definition, so with the gate on the AI-graded tier silently never runs. ab-bench scaffolds
every experiment with the gate off for exactly this reason.

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

## Design notes

- Every hook fails open: an internal bug logs to stderr and exits 0, it never blocks an unrelated
  session.
- The prompt-tier checker runs under `--permission-mode plan`, not a hardcoded `--allowedTools`
  list — a generic read-only guarantee that also covers project-specific MCP tools, not just
  Claude Code's builtins.
- Still resolves `.dod/` as a direct child of `cwd`, no upward search — each arm workspace needs
  `.dod` linked (directory junction) to the shared experiment-root `.dod/`. See `dod-contract.md`.
