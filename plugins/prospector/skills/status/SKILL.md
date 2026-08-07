---
description: >-
  Show the state of the Prospector engagement in the current directory: stage, current framing,
  needs coverage, packages cut, open vs resolved hypotheses ranked by expected learning, evidence
  count, and whether a handoff or an Optimizer cycle has happened. Read-only. Auto-trigger when
  the user says: "where are we", "prospector status", "what have we established", "what's still
  open", "what should we test next", "what did we drop", "/prospector:status".
argument-hint: ""
---

# Prospector: status

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" detect "<cwd>"
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" hypothesis rank "<cwd>"
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" needs list "<cwd>"
```

`{"status":"fresh"}` → no engagement here. Say so and offer `/prospector:start`.

Read-only. Never write anything from this skill.

## What to show

Report, briefly:

- **Stage** and the **current framing** (its statement, not just `F2`).
- **Needs coverage** — the headline number, as `covered / deferred / open` out of the total, and
  whether a blueprint exists. Then name the ids in `needs_blocking_a_cut`: those are the things
  the user asked for that the next package cannot ship without accounting for. This is the most
  actionable line in the report, so put it near the top.
- **What was deliberately dropped** — the `deferred` needs with their reasons. Nobody remembers
  these, and they are exactly what a user means by "whatever happened to…".
- **Packages cut**, and which framing each served — a sequence like `v1(F1) v2(F1) v3(F2)`
  tells the whole story of the engagement at a glance.
- **Hypotheses**: resolved with their outcomes, then open ones ranked. Say explicitly that the
  ranking is by *expected learning*, so a 50/50 hypothesis outranks one you are already sure of —
  and that it is a different question from `needs rank`, which orders by value.
- **Evidence count**, and — more usefully — anything currently marked `contradicted` or
  `assumption`. Those are where the engagement is weakest, which is the thing worth surfacing.
- **Handoff and cycle**: whether `.ab-bench/` exists, and how many Optimizer runs have been
  analysed (`optimizer.analyzed_runs`).

## What to say about it

Do not just print the numbers. Add the read:

- If `needs_blocking_a_cut` is non-empty, that is the headline: name them and say the next package
  cannot be cut until each is covered or deferred with a reason.
- If most needs are `stated` but the blueprint is missing, the engagement has a list of wants and
  no design — `/prospector:design` is the next move, not `/prospector:build`.
- If a lot of needs are `inferred` and few are `stated`, the agent has been designing rather than
  interviewing. Say so; the denominator is supposed to come from the user.
- If several hypotheses are open and no package has been cut, the engagement is stuck in
  discovery — the cheapest next move is usually to build something narrow and let real use
  settle it.
- If the load-bearing claims in the problem model are still `assumption` after several packages,
  say so plainly. That is an engagement building confidently on unchecked ground.
- If everything is resolved and the direction is settled, name `/prospector:handoff` as the next
  step and state the readiness test it will be checked against.
- If `status` is `post-optimizer`, the next move is `/prospector:reenter` — a full cycle has closed
  and there is A/B evidence waiting that no other skill reads.

End with the single most decision-relevant open question, if there is one.
