---
description: >-
  Begin a Prospector engagement in the current directory: capture the user's stated issue
  WITHOUT accepting it as the problem, scaffold .prospector/, and run the opening contextual
  inquiry. Run this FROM the (empty) directory the future plugin will live in — no path
  argument. Auto-trigger when the user says: "I have a problem with", "I need a tool that",
  "start a prospector engagement", "help me figure out what to build", "I keep running into",
  "something's wrong with my workflow", "/prospector:start".
argument-hint: "[the situation, frustration, or idea — in their own words]"
---

# Prospector: start

## 0. Where you are

Prospector works **in place**. The user creates an empty directory before launching the session;
that directory becomes the future plugin's repo. There is no experiments root, no second root,
no path argument, and nothing to cd into.

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" detect "<cwd>"
```

- `{"status":"fresh"}` → new engagement, continue below.
- `{"status":"existing"}` → an engagement is already here. Show its `state.stage`, package count
  and open-hypothesis count, and ask whether they want to continue it (`/prospector:frame`,
  `/prospector:review`) rather than restarting. Do not re-scaffold.

If the directory is not empty and not a fresh repo, say what is in it and confirm before writing.

## 1. Capture the stated issue — verbatim, and do not believe it

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" init "<cwd>" --issue "<their words, verbatim>"
```

This `git init`s the directory if needed and creates `.prospector/`. Git is not optional here:
the record is **tracked**, which is what gives the engagement a real version history, and the
Optimizer's artifact pinning is built on git, so a non-repo directory could never be handed off.

**The stated issue is an entry point, not the problem definition.** If the user said "I need a
tool that automatically manages my tasks", you have been told a *solution*, and the problem
behind it is still unknown. Do not start designing a task manager. Record the sentence exactly
as spoken so later reframings can be checked against what was actually said.

Separate, from the very first message, and keep separate:

| stated solution | what they asked to be built |
| stated issue | what they said is wrong |
| observed symptoms | what actually happens, concretely |
| underlying need | what they are trying to achieve |
| desired outcome | how they would know it was solved |

## 2. Ask ONE question — the highest-information one available

Do not run a questionnaire. Do not dump a list. Pick the single question with the most expected
learning, ask it, and wait.

Prefer questions that can:
- challenge the biggest assumption embedded in their own wording;
- distinguish between two readings that would lead to different products;
- reveal the actual desired outcome rather than the requested mechanism;
- surface a stakeholder or context you had not been told about.

**Prefer behaviour over opinion.** Concrete past behaviour predicts far better than imagined
futures, and people are much better at reporting what they did than at predicting what they
would adopt:

> "Tell me about the last time this happened." · "What did you do instead?" · "What did that
> cost you?" · "What have you already tried?" · "What made that workaround insufficient?"

Avoid: "Would you use X?" · "Do you like Y?" · "Would a feature that does Z be useful?"

Say briefly *why* a question matters when that helps them answer accurately.

## 3. Record what you learn, with its status attached

After each substantive answer:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" evidence "<cwd>" \
    --text "<what they actually said or did>" \
    --status confirmed --source user-interview
```

`--status` is one of `confirmed`, `strongly-supported`, `tentative`, `assumption`, `unknown`,
`contradicted`. **This is the discipline that matters most.** An inference you drew is an
`assumption`, not a `confirmed` fact, and writing it down as the latter is how an engagement
ends up confidently building the wrong thing. When evidence is weak, say what would be needed
to strengthen or kill it.

Update `.prospector/problem-model.md` in place as understanding changes — rewrite sections,
don't append. It is the single source of truth, and it is meant to be read by the user.

## 4. Know when to stop asking

Present a **synthesis checkpoint**, not raw notes: a short reading of what you now believe, with
the weakest link named. Ask them to correct, rank, confirm, or reject it — that is far cheaper
for them than reviewing a transcript.

Then decide explicitly, and say which:

- keep interviewing (a decision-relevant question is still open);
- move to competing framings → `/prospector:frame`;
- go straight to a narrow MVP because the cheapest way to learn the next thing is to
  let them use something → `/prospector:build`.

Endless discovery is a failure mode. So is building on a framing nobody challenged.

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" stage "<cwd>" --to inquiry
```

## 5. Commit

Commit at this boundary — `.prospector/` is tracked, and the diffs are how the framing's
movement stays legible later.
