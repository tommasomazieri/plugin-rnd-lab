---
name: planning
description: Interview the user relentlessly about a plan or design until reaching shared understanding, then decide whether the work needs Definition-of-Done checks (script/AI-graded/human-judged) and design them if so. Use when in plan mode, when the dod-lite plan-mode gate requires it before ExitPlanMode, or when the user wants to be grilled on a plan/design.
---

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time.

If a question can be answered by exploring the codebase, explore the codebase instead.

Once the interview reaches shared understanding, move to DoD design. Don't skip straight there — the interview is what tells you what "done" should even mean for this plan.

## Phase B — DoD design

Never jump straight to writing check files. This phase is a proposal-and-feedback loop with the user first; authoring files is the last step, not the first.

1. Draft a list of candidate criteria that would actually distinguish "done" from "not done" for this plan (not every plan has any — a trivial change may legitimately need zero checks, and that's a fine outcome). For each candidate, work out:
   - **what** it's checking, in plain language.
   - **which tier** it belongs to, and roughly **how** it'd be checked at that tier — not the code/script itself, just the approach:
     - **script** — mechanically verifiable by running something with an exit code (tests pass, lints clean, a file exists, a build succeeds). Prefer this whenever possible — it's free and runs every turn.
     - **prompt** — needs judgement to verify but is something an AI grader with read-only repo access could actually check by investigating (naming conventions followed, error handling consistent with the rest of the file, docs actually explain the new behavior). Not for things a script could check instead.
     - **human** — genuinely requires this specific user's judgement and nothing else can substitute: taste calls, business/priority calls, "does this match what I asked for" when the ask was inherently subjective, facts about the outside world the repo can't reveal. Use sparingly — every human check costs the user an interruption at Stop.

2. Present this list to the user — what each criterion is, its proposed tier, and the general approach — and ask for feedback. Do not present draft code or draft check-file contents at this stage, only the what/tier/how-in-general. Iterate on their feedback (add, drop, reclassify, merge criteria) until they agree on the final set. Skip this back-and-forth only if the user has explicitly pre-approved the checks or said not to ask.

3. Once the set is agreed, check whether an existing file in `.dod/checks/` already covers each criterion (same intent, reusable as-is) — reuse its id rather than duplicating. List the directory before assuming nothing fits.

4. For anything not already covered, author a new check file in `.dod/checks/<id>.<ext>`:
   - **id** = the filename without extension, must be unique within `.dod/checks/`. Pick something short and descriptive (`build-passes`, `no-leftover-todos`, `readme-updated`).
   - **script**: any extension with a runner (`.py`, `.mjs`/`.js`/`.cjs`, `.sh`, `.ps1`, `.rb`, or a custom one declared in `.dod/config.json`). Exit code 0 = pass, nonzero = fail. Write an actual working script — this will be executed for real, every turn, by the Stop hook.
   - **prompt** or **human**: a `.md` file with frontmatter:
     ```yaml
     ---
     type: prompt        # or: human
     description: "one line, shown in status/failure output"
     model: haiku         # prompt only, optional — default haiku, set sonnet for nuanced judgement calls
     ---
     The grading question (prompt) or the question to ask the user (human) goes here as the body.
     ```
     For `type: prompt`, write the body as a question a fresh grader with only read-only repo access could resolve by investigating — it won't have this conversation's context, so make it self-contained (state what "done" looks like, not just "did we do the thing").
     For `type: human`, write the body as the actual question to put in front of the user later.

## Phase C — persist

Re-read the session's DoD state file right before editing it (it may have changed since Phase B started, e.g. a prior Stop already ran checks, or this is a second planning-skill pass in the same session) — path given to you earlier by the SessionStart or UserPromptSubmit hook's reminder, `<project>/.dod/sessions/<session_id>.json`. Every write below must be idempotent: re-running Phase C with the same decided set must not change the file at all.

- Append each decided check's id to `checks[]` **only if not already present** — never add a duplicate id.
- Seed `state[id]` **only for ids that don't already have a `state[id]` entry**: `{"tier": "<script|prompt|human>", "last_result": "pending", "last_output": null, "last_checked_at": null}`. Never overwrite an existing `state[id]` here — the Stop hook owns that field once a check has actually run, and clobbering it would erase a real pass/fail/waived result back to `pending`.
- Optionally set `session_goal` to a one-line summary of what this session is trying to accomplish, only if it's currently `null` — never overwrite a goal that's already set.

Do **not** touch `planning_invoked` — a hook owns that field and sets it automatically as soon as this skill is invoked, regardless of what this phase produces.

If Phase B concluded zero checks are needed, still do this phase with an empty `checks[]` addition (i.e. nothing to append) — invoking the skill is what satisfies the plan-mode nudge, not the presence of checks.
