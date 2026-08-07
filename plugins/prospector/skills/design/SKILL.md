---
description: >-
  Write blueprint.md — the design for the WHOLE plugin, covering every need the user actually
  stated, before any MVP exists and while nothing is being built. Also the skill that revises the
  blueprint on re-entry. Auto-trigger when the user says: "design the plugin", "what should this
  actually do", "the full picture", "what does the finished thing look like", "update the design",
  "/prospector:design".
argument-hint: ""
---

# Prospector: design the whole plugin

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" detect "<cwd>"
```

`{"status":"fresh"}` → tell them to run `/prospector:start` and stop.

Read `problem-model.md`, `framings.md`, every file in `evidence/`, and the full needs list:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" needs list "<cwd>"
```

## 0. Why this is a separate skill from `/prospector:build`

It used to be one. `package.md` section 3 listed the needs and section 10 claimed to cover them,
and both were written inside `build`, in the same turn as the MVP, by the agent that had already
decided what to build. Section 10's rule was airtight — *every need in (3) appears in one list or
the other* — and completely worthless, because (3) was whatever had been written thirty seconds
earlier. **A small section 3 makes coverage complete by construction.**

The result was an engagement that interviewed the user for two hours and shipped something
addressing a fraction of one of the several things they had named.

So the design is written **here**, in its own turn, before any MVP exists and while there is
nothing to be loyal to. Then `build` reads it. The agent that builds does not get to author the
list it will be measured against.

## 1. The denominator is what they SAID — not what you can imagine

This is the whole discipline of this skill, and it cuts both ways.

**The floor.** Every need in `needs.json` with `kind: stated` is answered somewhere in this
design. Not "considered". Answered — there is a part of the plugin that addresses it, or a
sentence saying it is out of scope and why. They told you these things; a design that quietly
drops one is the original defect wearing a longer document.

**The ceiling.** You are not designing the best conceivable plugin in this space. You are
designing an answer to *this* user's stated problem, bounded by what they told you and what you
found by working through it. A blueprint that grows past that is not more thorough — it is a
different project with the user's name on it, and every item you invent is one more thing that
must be built, deferred with a reason, or explained.

This is why the denominator is on disk and machine-readable. It is finite, it came from them, and
it does not move because you thought of something clever at midnight.

**If you notice a gap while writing, do not silently design around it — go ask.** A question costs
one turn now; an assumption costs a version.

## 2. Find the needs they did NOT state — walk the job end to end

Stated needs are the gate. They are not the whole design, because nobody lists the parts of their
own job they have stopped noticing. Three probes, all cheap, all done at the desk:

**a. Narrate one complete real instance of their job, start to finish, using only the plugin you
are designing.** Not a summary — the actual sequence, in order, on a real case they described.
Every point where the user has to drop out and do something by hand is either a need you are about
to design for or a boundary you are about to name. A design you cannot narrate end to end is not
finished; it is a list of features.

**b. What does the user do on the day it gets it wrong?** Every plugin is wrong sometimes. If the
answer is *"they wouldn't be able to tell"*, that is not an edge case, that is a **need** — record
it. If the answer is "they'd have to redo the whole thing by hand", the design owes them a way
back.

**c. Run (a) again on a differently-shaped case.** Their other project, their worst week, the
input that arrives malformed. What breaks is an edge case the design owes an answer to.

Everything these turn up goes in as `--kind inferred`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" needs add "<cwd>" \
    --statement "<the need>" --kind inferred --importance <core|significant|peripheral>
```

`inferred` needs shape the design and **never gate a build** — you found them, not the user, and
gating on them would let you write your own denominator, which is the defect this whole stage
exists to prevent. Put the important ones to the user; anything they confirm, re-record as
`stated` with the evidence id.

## 3. Write `.prospector/blueprint.md`

Seven sections:

1. **The job, end to end** — the narration from §2a, as prose. This is the section that makes the
   rest checkable.
2. **Need coverage map** — every `stated` need by id, and where in this design it is answered.
   Then the `inferred` and `prior-art` ones, same treatment, marked as yours.
3. **Edge cases and failure modes** — from §2b and §2c. Including what the user does when the
   plugin is wrong, and how they find out that it was.
4. **Workflow implications** — where this sits in their day, what it touches, what it replaces,
   what breaks if they stop using it, and the install/config surface. The things that are nobody's
   feature and sink a plugin anyway.
5. **Prior art and the delta** — the verdict from `/prospector:survey`, and precisely what this
   does that the existing thing does not.
6. **The full surface** — every skill, command, hook, and file the finished plugin needs. One
   paragraph each: what it does, which needs it serves, why it is separate from its neighbours.
7. **Build order** — which slice is v1, what each later version adds, and a reason per deferral.
   Ordered by what the user needs first, not by what is easiest to write.

### The ceiling on section 6 — enumerate, never specify

One paragraph per surface item. Not a signature, not a schema, not an algorithm.

The failure mode here is real and it is the mirror of the one in §0: an agent told to be complete
will write a specification, spend the session on it, and produce a document the user has to read
in full before anything exists to run. **Completeness is about breadth of coverage, not depth of
detail.** If you are writing pseudocode, you have left the stage.

`blueprint.md` is **living** — unlike `packages/vN/`, it is revised every cycle and git carries
its history. Rewrite it in place; do not append. Each package records the blueprint's git sha at
cut, so "which design was v2 built against" stays answerable.

## 4. Read it back and let them attack it

Show them section 2 (need coverage) and section 7 (build order) first — those are the two they can
actually check. Ask straight out: **what did I miss, and is v1 the right first slice?**

Their answer to the second question routinely overrides the ranking, and it should: `frame` §5
ranks by expected learning, and the user knows which part of their week hurts most.

Record what moved:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" decision "<cwd>" \
    --text "Blueprint v<n> — v1 scoped to <slice>" --why "<what the user's reaction forced>"
```

Anything new they name in this conversation is a `stated` need. Record the evidence, then the
need — it is not an amendment, it is the interview continuing.

## 5. Hand over

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" stage "<cwd>" --to design
```

**Commit before building** — the blueprint sha is recorded at cut, and an uncommitted blueprint
records as `(uncommitted at cut)`, which loses the link between design and package permanently.

Then `/prospector:build`, which will refuse to cut a package leaving any core stated need
unaccounted for. If that refusal fires, this stage was not finished — come back rather than
deferring your way past it.
