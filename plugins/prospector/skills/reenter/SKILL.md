---
description: >-
  Re-open discovery on a plugin that already exists and has been through the Optimizer. Ingests
  the A/B evidence, diffs what shipped against the design, re-interviews on real use, re-runs the
  prior-art survey, and ranks the next slice by VALUE rather than by expected learning.
  Auto-trigger when the user says: "what's next for this plugin", "we've optimized it, now what",
  "what's still missing", "next version", "re-open discovery", "/prospector:reenter".
argument-hint: "[what you've noticed since shipping it]"
---

# Prospector: re-enter on a plugin that already exists

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" detect "<cwd>"
```

Look at `status` and `optimizer.analyzed_runs`:

- `post-optimizer` → this is the skill. Continue.
- `existing` with `optimizer.analyzed_runs: []` → the Optimizer has run nothing yet. There is no
  new evidence to re-enter *on*. If they have been using the MVP, that is `/prospector:review`.
- `fresh` → `/prospector:start`.

## 0. What makes this different from `/prospector:start`

At `start` the problem is unknown, so everything ranks by expected learning and the cheapest move
is usually to build something narrow and watch. Here the problem is largely known, a working
plugin exists, and it has been measured. **Two things invert.**

**Ranking inverts.** `/prospector:frame` §5 ranks hypotheses by expected learning with confidence
*inverted* — it says outright that it answers "what should we find out next, never what should we
build next". That is right when you are lost. It is wrong now: it would aim the next version at
the least-understood thing on the page, on a plugin that already works. Here you rank **needs by
value** (§6), and confidence enters the normal way round.

**The design is revised, not authored.** `blueprint.md` already exists. You are looking for what
it got wrong and what it never contained — not starting a page.

What does *not* change: the four layers from `start` still hold. The symptom is accepted as fact,
the diagnosis is a hypothesis, the prescription is held loosest. "v1 is fine but I stopped using
it" is a symptom, and it is the most valuable sentence in this skill.

## 1. Ingest what the Optimizer learned

`detect` gives you the paths under `optimizer`. Read, in this order:

- `analyzed_runs[].report` — `analysis/report.md`, the evidentiary record per run
- `lab/findings.md` and `lab/hypotheses.json` — what accumulated across runs
- `ledger.md` — the run-by-run history

Record what bears on *what the plugin should be* as evidence — not everything, only what changes
the problem model:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" evidence "<cwd>" \
    --text "run-004: <the observation>" \
    --status strongly-supported --source optimizer-run
```

**These are observations, not instructions.** The Optimizer measures how the plugin executes. It
does not know what the plugin is for, and it is not entitled to an opinion on that — that is this
plugin's job, and `mandate.md` exists precisely because the Optimizer needed to be told.

### `analysis/fix-list.md` — read it, classify it, do not execute it

The fix-list is the Optimizer's work order, and its reader is **the operator, by hand, in the
plugin's own repo**. `/optimizer:analyze` says so. It is not yours to run.

Read it for exactly one thing: **a category error**. Every item is one of two kinds.

| the item says | means | whose problem |
|---|---|---|
| "does the right thing, expensively / slowly / in too many turns" | an efficiency defect | the Optimizer's, and the operator's to apply. Leave it alone. |
| "does the wrong thing", "the user had to redo it", "it solved a problem they didn't have" | an effectiveness defect | **yours.** Record it as evidence and carry it into the design. |

A fix-list that is mostly the second kind is the finding: the plugin is being optimised in the
wrong direction, and no amount of A/B tuning will fix a thing aimed at the wrong job. Say that out
loud to the user — it is the single most useful thing this skill can tell them.

When you hand back, name the efficiency items in one line each and leave them there. Do not fold
them into vN+1: an MVP that mixes "new capability" with "same capability, faster" cannot tell you
which half the user reacted to.

## 2. Diff what shipped against what was designed

Read `blueprint.md` §6 (the full surface) and §7 (build order), then look at what is actually at
the repo root — the plugin's skills, commands, hooks, and `plugin.json`.

Three questions:

1. **What was deferred and never came back?** Check `needs list` for `deferred` needs and the
   "Deliberately not covered" section of each package changelog. These were decisions, with
   reasons, and the reasons have expiry dates.
2. **What shipped that is not in the blueprint?** Drift. Usually it is a real need discovered
   mid-build and never recorded — find out which, and record it as a need now.
3. **What is in the blueprint, marked as shipped, that does not actually work?** Rarer, worse, and
   only visible if you look.

## 3. Interview on real use — the strongest evidence available anywhere

They have now used the thing for real, which is a position no earlier stage could reach. Ask about
behaviour, never about opinion:

- Which parts do you use every time? Which have you not opened in weeks?
- What do you still do by hand around it?
- When did you last go around it entirely, and what were you doing?
- What did you expect it to do that it doesn't?
- Has anything it does become annoying rather than helpful?

**Abandonment is still the strongest signal the engagement gets.** A feature that shipped and is
never used is more informative than one that was never built, because it cost something and
answered a question. Record it; do not let it be embarrassing.

Everything they say here is a `stated` need or a contradiction of one. Record the evidence, then
the need. A need they now contradict gets `needs withdraw` — with their reason, and only ever on
their say-so.

## 4. Re-run the survey

```
/prospector:survey
```

Two reasons, both real. The market moved — a year of plugins exists that did not before. And you
finally know the right words: the vocabulary you lacked at `start` is exactly what a cycle of
their complaints has since taught you. Searches that found nothing then often find something now.

The terminal verdict is still available. "Someone has since built this properly, switch to it" is
a legitimate and valuable end to a second cycle.

## 5. Revise the blueprint

```
/prospector:design
```

It rewrites `blueprint.md` in place — living, unlike the frozen packages. Reopen the deferred
needs that are now due:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" needs reopen "<cwd>" --id N-004
```

And record what the cycle changed:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" decision "<cwd>" \
    --text "Re-entry after <runs> — blueprint revised" \
    --why "<what the real use and the A/B evidence forced>"
```

## 6. Rank the next slice by VALUE

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" needs rank "<cwd>"
```

Importance × provenance × confidence, highest first. A need the user stated, marked core, that you
are sure about, outranks everything — which is the opposite of the hypothesis ranking, and correct
here for the reason in §0.

The ranking is an argument, not an instruction. Present the top few with your reasoning and let
them override; they know which part of their week hurts most, and they are right about it more
often than the arithmetic.

If a genuine *uncertainty* has opened up — something the cycle revealed that nobody understands —
that is a hypothesis, and `/prospector:frame` still owns it. Re-entry does not mean the problem is
solved, only that it is no longer unknown.

## 7. Hand over

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" stage "<cwd>" --to reentry
```

Then `/prospector:build` for vN+1. The breadth gate applies unchanged: every core stated need,
including the ones this session just reopened, is covered or deferred with a reason.

Tell them plainly what the next version is for, in one sentence, and which of their own complaints
it answers. Commit.
