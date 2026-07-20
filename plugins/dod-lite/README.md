# dod-lite

Lightweight, per-session Definition-of-Done tracking for Claude Code — no PM app, no MCP server, no external backend. Everything lives in a `.dod/` folder in your project and a handful of hooks.

Extracted from a heavier PM-app-coupled DoD engine (`agentic_pm_app` + `project-management-OS-harness`) whose authors deliberately kept the checking logic liftable into a standalone package. This is that extraction.

## What it does

1. At session start, scaffolds `.dod/` in your project and a per-session state file, and reminds you to design this session's DoD checks in plan mode.
2. While you're in plan mode, nudges you to invoke the `dod-lite:planning` skill — a grill-me-style interview that also decides what "done" means for this session and authors the checks for it.
3. **Soft-nudges `ExitPlanMode`**: if the planning skill hasn't run yet this session, a reminder is attached to the call — it does not block the call. Skip it freely if the session doesn't need DoD checks.
4. At every `Stop`, runs the session's checks in three cost-gated tiers — script → AI-graded → human — and blocks the turn from ending until they pass (or the human explicitly waives one).

## `.dod/` layout (in your project, not the plugin)

```
.dod/
  checks/                  ← author-written, reusable across sessions
    <id>.py|.mjs|.sh|.ps1|.rb|...   type: script — exit code is the verdict
    <id>.md                          type: prompt or human, via frontmatter
  sessions/
    <session_id>.json      ← machine-owned, one per session
  config.json               ← optional: {"runners": {".ext": "command"}}
```

Check id = filename without extension, must be unique within `checks/`.

`.md` check frontmatter:
```yaml
---
type: prompt        # or: human
description: "one line"
model: haiku          # prompt only, default haiku, override e.g. sonnet for nuanced calls
---
Body = the grading question (prompt) or the question to ask the user (human).
```

## Check tiers

| Tier | Runs | Cost | Verdict source |
|---|---|---|---|
| script | every `Stop`, always | free, local | exit code |
| prompt | only if all script checks pass | $ + time (spawns a headless `claude -p` subprocess) | strict, conservative AI grader with read-only repo access |
| human | only if script + prompt checks pass | interrupts the user | `AskUserQuestion`: Done / Not done (+notes) / Stop anyway |

A failing tier skips the tiers after it that round — no point spending money or interrupting the user when a free check already says not-done.

## Install / try locally

```
claude --plugin-dir <path-to-this-repo>
claude --debug   # confirm all 5 hooks register: SessionStart, UserPromptSubmit, PostToolUse(Skill), PreToolUse(ExitPlanMode), Stop
```

## Optional: start sessions in plan mode

dod-lite can't force your session's startup permission mode — that's a settings/CLI concern, not something a hook can intercept. If you want that behavior, add to your project's `.claude/settings.json`:

```json
{
  "permissions": { "defaultMode": "plan" }
}
```

Without this, dod-lite still works — it just nags (via the `SessionStart` reminder) rather than starting you in plan mode automatically. If you skip plan mode entirely for a session, dod-lite simply stays inactive for it: nothing to gate, nothing to check.

## Commands

- `/dod-lite:status` — read-only summary of the current session's checks and their last results.

## Known implementation risk

`mark-planning.mjs` matches the `Skill` tool's `tool_input.skill` field against `dod-lite:planning` to detect that the planning skill was invoked (confirmed against the tool's own parameter schema at build time: `{skill, args}`). If a future Claude Code version renames this field, the hook falls back to a substring scan of the whole `tool_input`, but verify with `claude --debug` after any Claude Code upgrade if the plan-mode gate stops recognizing the skill.

## Plugin layout

```
.claude-plugin/plugin.json
hooks/                    session-start.mjs, prompt-nudge.mjs, mark-planning.mjs,
                           plan-gate.mjs, dod-check.mjs, lib.mjs, hooks.json
skills/planning/SKILL.md
commands/status.md
resources/prompt-checker-system.md   (grading rubric appended to headless checker calls)
```

## Design notes

- No custom stall/cooldown counter anywhere — Claude Code's native cap (stops issuing further `Stop` blocks after 8 consecutive ones) is the safety net. Script checks intentionally re-run every turn uncached, since any edit can regress a previously-passing one.
- The prompt-tier checker runs under `--permission-mode plan`, not a hardcoded `--allowedTools` list — that's a generic read-only guarantee that also covers project-specific MCP tools (e.g. a Blender MCP server's read-only tools), not just Claude Code's builtins.
- Every hook fails open: an internal dod-lite bug logs to stderr and exits 0, it never blocks an unrelated session.
