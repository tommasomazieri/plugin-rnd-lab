---
description: >-
  Teach the user how this marketplace works end-to-end — Prospector (discovery: is this worth
  building at all?), Optimizer (A/B measurement: does it actually help?), how they chain, and
  why dod-lite is a separate plugin. User-invoke only — a walkthrough / reference skill, not a
  workflow step; never auto-trigger this for someone who is just trying to get work done.
  Optional argument narrows to one plugin, one stage, or answers a free-form question.
argument-hint: "[optimizer|prospector|chain|<stage name>|<free-form question>]"
disable-model-invocation: true
---

# learn: the R&D lab, end to end

This skill's job is to **teach**, not to run anything. No files get written, no other skill's
commands get executed. Route to the right reference file below, read it, then explain it to the
user in your own words, adapted to what they asked.

## The two-stage mental model — always give this first

Say this before anything else, in one short paragraph, whatever they asked:

> This marketplace holds two instruments for two different questions. **Prospector** answers
> *"is this worth building at all?"* — you arrive with a frustration and no spec, and it hunts
> for the real problem behind it, testing narrow throwaway MVPs on your own real work until a
> direction is validated. **Optimizer** answers *"does it actually help?"* — you already have a
> plugin, and it fires two paired Claude Code sessions on the same task, one with your plugin
> and one without, then fuses both transcripts into an evidence-backed report. Prospect first,
> then refine. Either works alone.

Everything either instrument ever produces is a **Claude Code plugin**. That is the medium, not
a choice to be made.

## Routing

| the user asked | do this |
|---|---|
| nothing (`$ARGUMENTS` empty) | Give the model above, then ask **which of the two they are on** — or whether they want the whole tour. Do not read a reference file before they answer, and do not dump both. |
| `optimizer`, or any optimizer stage (`setup`, `init`, `understand`, `plan`, `fire`, `parallel`, `analyze`, `status`, `discipline`) | Read `${CLAUDE_SKILL_DIR}/references/optimizer.md` |
| `prospector`, or any prospector stage (`start`, `survey`, `frame`, `design`, `build`, `review`, `handoff`, `reenter`, `status`) | Read `${CLAUDE_SKILL_DIR}/references/prospector.md` |
| `chain`, `handoff`, `mandate`, `reenter`, `dod-lite`, "how do they fit together", "how do I iterate on a plugin that already exists", "why is dod-lite separate" | Read `${CLAUDE_SKILL_DIR}/references/chain.md` |
| the full tour | All three, in order: prospector → chain → optimizer. This is long — walk it stage by stage. |
| a free-form question ("how do I compare against an old version", "what happens if I close a terminal", "why did my games question get rejected") | Read whichever file(s) cover it and answer directly. Do not walk a lifecycle they did not ask for. |

`status` is ambiguous — both plugins have one. Ask which, or cover both briefly.

## How to deliver it

- **Never dump a whole reference file as one wall of text.** Walk it stage by stage, in order,
  and pause after each stage to ask whether they want to go deeper or move on.
- Ground every answer in what the installed skills actually do. If the user asks something the
  reference does not cover, read the relevant `SKILL.md` under `plugins/<plugin>/skills/`
  rather than guessing. `plugins/dod-lite/` has no skills to read — it is a hooks-only engine;
  see `references/chain.md`.
- Keep the two vocabularies straight. Prospector has *framings*, *evidence*, *needs*, a
  *blueprint*, *hypotheses ranked by expected learning*, and *packages*. Optimizer has *mandates*,
  *envs*, *runs*, *arms*, *pillars*, and a separate *hypothesis ledger* ranked by magnitude ×
  confidence ÷ cost. Both say "hypothesis" and they are not the same object — say so if the user
  is moving between them.
- Prospector itself has **two** ranked lists that deliberately disagree: hypotheses rank by
  expected learning (confidence inverted — what to *find out* next), needs rank by value
  (uninverted — what to *build* next). If a user is asking what to build and you quote the
  hypothesis ranking, you have given them the wrong answer. `chain.md` has the three-way table.

## Closing — always end with their actual next command

Tell them the natural next move given where they are:

**Nothing built yet, only a frustration** → create an empty directory, launch Claude Code inside
it, `/prospector:start`.

**Mid-engagement in Prospector** → `/prospector:status` will say; generally
`survey` → `frame` → `design` → `build` → *(go use it for real)* → `review`, looping until a
direction holds, then `/prospector:handoff`.

**A plugin exists and needs proving** → `/optimizer:setup` if the experiments root was never
set, otherwise cd into the plugin's own repo and `/optimizer:init`.

**Mid-experiment in Optimizer** → `/optimizer:status` will say; generally `plan` → `fire` →
*(work both arms)* → `analyze`.

**A plugin exists, has been through the Optimizer, and the question is what's still missing** →
`/prospector:reenter` in the plugin's own repo. This is the loop closing, and it is the case
people miss: Prospector is not only for starting from nothing.

When this closes a walkthrough (one plugin stage by stage, or the full tour), put this line under
the next command, verbatim, on its own, once, with nothing added around it. Not after a
free-form answer:

```
Feedback on plugin-rnd-lab, mostly clicks: https://docs.google.com/forms/d/e/1FAIpQLSfINKyrAFuydl9SC-wNGceL_I-04cWqy7BkeQf0IJSwOKxFfg/viewform
```
