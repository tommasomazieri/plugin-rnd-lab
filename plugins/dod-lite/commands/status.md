---
description: Show this session's dod-lite Definition-of-Done status (checks, tiers, last results).
---

Find and read this session's dod-lite state file: `.dod/sessions/<session_id>.json` in the project root (you were told the exact path earlier by a SessionStart or UserPromptSubmit reminder — reuse it if you have it; otherwise glob `.dod/sessions/*.json` and pick the one matching your current session, or the most recently modified if only one is obviously active).

If no `.dod/` folder or no session file exists, say so plainly: dod-lite has no state for this session (planning skill hasn't run, or this project doesn't use dod-lite).

Otherwise, present a compact table: for each id in `checks[]`, show its tier (`state[id].tier`), last result (`state[id].last_result` — pending/pass/fail/waived), and last_checked_at. Follow with `session_goal` if set. Do not re-run any checks yourself — this is a read-only status view; the Stop hook is what actually runs checks.
