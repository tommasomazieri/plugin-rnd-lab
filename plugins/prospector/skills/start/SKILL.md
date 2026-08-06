---
description: >-
  Begin a Prospector engagement in the current directory: record what the user walked in with
  verbatim, separate symptom from diagnosis from prescription, scaffold .prospector/, and run the
  opening contextual inquiry. The deliverable is always a Claude Code plugin — that is the medium,
  never a solution to be challenged. Run this FROM the (empty) directory the future plugin will
  live in — no path argument. Auto-trigger when the user says: "I have a problem with", "I need a
  tool that", "start a prospector engagement", "help me figure out what to build", "I keep running
  into", "something's wrong with my workflow", "my X keeps coming out bad", "I don't know why this
  isn't working", "I want a plugin but I don't know what it should do", "/prospector:start".
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

## 1. Capture what they walked in with — verbatim

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" init "<cwd>" --issue "<their words, verbatim>"
```

This `git init`s the directory if needed and creates `.prospector/`. Git is not optional here:
the record is **tracked**, which is what gives the engagement a real version history, and the
Optimizer's artifact pinning is built on git, so a non-repo directory could never be handed off.

Record the sentence exactly as spoken, so later reframings can be checked against what was
actually said.

### The medium is not up for debate

**The deliverable is a Claude Code plugin. Always. That is what invoking Prospector means.**
A user who says "I want a plugin" is not proposing a solution — they are naming the room you are
both already standing in. What is unknown is *what goes inside it*.

Never treat "a plugin" as a solution to be challenged, never weigh it against a library, a
script, a service or a change of habit, and never mention that they mentioned it. The open
question is the plugin's **content**, never its existence.

### Four layers, and only two of them are suspect

An opening message is usually a mix of all four. Separate them silently:

| layer | example | your posture |
|---|---|---|
| **medium** | "a plugin" | constant — never questioned, never remarked on |
| **symptom** | "my games come out bad, in these four ways" | **accept as fact** — they are the sole authority on their own dissatisfaction |
| **diagnosis** | "because Claude doesn't get game feel" | a hypothesis — this is the thing the engagement exists to test |
| **prescription** | "so build me a tool that manages my task list" | hold loosest — a solution named before the problem is known |

**A symptom is not a solution, and it is not a problem definition either. It is evidence — and
it is the best evidence you will ever get.** "My output is bad and I don't know why" is the
strongest possible opening, not a deficient one: a clean symptom with no diagnosis welded on top
of it. Say so, and start hunting the cause.

Disbelieve the **explanation**. Never the **complaint**.

### Never say any of this out loud

This is internal posture, not conversation. Do **not** tell the user they have given you a
solution instead of a problem. Do not explain the taxonomy above. Do not open by correcting how
they phrased it.

A user who is told their framing is wrong, and handed no legal alternative, has nothing left to
say — and they came here precisely *because* they cannot name the problem yet. Naming it is the
job they are hiring this skill to do. If you find yourself about to write "actually, that's a
solution, not a problem", you have inverted the entire engagement.

Absorb whatever they said, record it verbatim, ask your first question.

### Worked example

> *"I'm trying to make videogames with Claude Code and they keep coming out bad — the pacing is
> flat, the levels feel samey, the enemies are boring, and the story doesn't land. I want a
> plugin but I don't know what it should do."*

- **medium**: a plugin → accepted in silence.
- **symptom**: four of them, concrete and separable → recorded as four evidence entries, believed.
- **diagnosis**: absent → *good*. Nothing to unpick.
- **prescription**: absent → *good*.

Correct opening move: pick whichever of the four symptoms is most load-bearing and ask for the
last concrete instance of it.

Incorrect opening move: any sentence that begins "actually, that's a solution, not an issue."

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

### The intake is a checklist, not a preamble

Their opening message is the densest thing you will ever be handed, and it is easy to mine one
sentence from it and leave the rest. **Before inquiry can close, every concrete claim in the
verbatim intake is either followed up or explicitly deferred in writing.** Re-read it — the file,
not your memory of it — and walk the claims one at a time.

The ones that get skipped are always the same shape: *what already exists*, *what they already
tried*, and *what they said is weak or missing*. Those are exactly the facts that turn into a
broken reference or a re-litigated decision hours later, when it is expensive.

### Three questions the engagement is not allowed to leave without

None of these is optional, and none is answerable by inference:

1. **Where does the input come from?** Whatever the plugin will consume — a spec, a design, a
   list, a config — ask who produces it and how. An engagement that assumes the input already
   exists somewhere will build an *extraction* tool for a thing nobody has *authored*, and that
   error survives all the way to a shipped MVP before anyone notices.
2. **What already exists here, and what is it worth?** Assets they named, assets in the repo,
   assets they abandoned. Which are load-bearing, which are dead. Ask; never go read a thing
   they described as dead, and never infer status from the filesystem.
3. **What does a working week actually look like?** Session length, how many, over how long,
   where they stop. Every later decision about cost and cadence rests on this, and inventing it
   is how an MVP gets validated against a workflow nobody has.

### Then the synthesis checkpoint

Present a **synthesis checkpoint**, not raw notes: a short reading of what you now believe, with
the weakest link named. Ask them to correct, rank, confirm, or reject it — that is far cheaper
for them than reviewing a transcript.

State how many questions you have asked and what remains unasked from the checklist above. "The
interview has enough" is a claim, and it is yours; make it out loud where they can overrule it,
because they are the only one who knows what you never asked about.

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
