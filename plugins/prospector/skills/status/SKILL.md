---
description: >-
  Show the state of the Prospector engagement in the current directory: stage, current framing,
  packages cut, open vs resolved hypotheses ranked by expected learning, evidence count, and
  whether a handoff has been written. Read-only. Auto-trigger when the user says: "where are we",
  "prospector status", "what have we established", "what's still open", "what should we test
  next", "/prospector:status".
argument-hint: ""
---

# Prospector: status

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" detect "<cwd>"
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" hypothesis rank "<cwd>"
```

`{"status":"fresh"}` → no engagement here. Say so and offer `/prospector:start`.

Read-only. Never write anything from this skill.

## What to show

Report, briefly:

- **Stage** and the **current framing** (its statement, not just `F2`).
- **Packages cut**, and which framing each served — a sequence like `v1(F1) v2(F1) v3(F2)`
  tells the whole story of the engagement at a glance.
- **Hypotheses**: resolved with their outcomes, then open ones ranked. Say explicitly that the
  ranking is by *expected learning*, so a 50/50 hypothesis outranks one you are already sure of.
- **Evidence count**, and — more usefully — anything currently marked `contradicted` or
  `assumption`. Those are where the engagement is weakest, which is the thing worth surfacing.
- **Handoff**: whether `.ab-bench/` exists yet.

## What to say about it

Do not just print the numbers. Add the read:

- If several hypotheses are open and no package has been cut, the engagement is stuck in
  discovery — the cheapest next move is usually to build something narrow and let real use
  settle it.
- If the load-bearing claims in the problem model are still `assumption` after several packages,
  say so plainly. That is an engagement building confidently on unchecked ground.
- If everything is resolved and the direction is settled, name `/prospector:handoff` as the next
  step and state the readiness test it will be checked against.

End with the single most decision-relevant open question, if there is one.
