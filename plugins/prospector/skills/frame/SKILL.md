---
description: >-
  Generate competing problem framings from the evidence gathered so far, make the user react to
  them, adopt one, and convert it into ranked testable hypotheses. Also the skill to run when new
  evidence invalidates the current framing. Auto-trigger when the user says: "reframe this",
  "what's the real problem", "I don't think that's the issue", "that's not what I meant",
  "what should we test", "generate hypotheses", "/prospector:frame".
argument-hint: ""
---

# Prospector: frame and reframe

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" detect "<cwd>"
```

`{"status":"fresh"}` → nothing here yet; tell them to run `/prospector:start` and stop.

Read `.prospector/problem-model.md` and every file in `.prospector/evidence/` before drafting
anything. Framings that are not built on recorded evidence are just opinions with structure.

## 1. Generate a SMALL number of competing framings

Two to four. One framing is not a choice, and eight is a survey nobody will engage with.

They must genuinely compete — different target user, different unmet need, or different
mechanism — not three rewordings of the same sentence. If you cannot make them differ
meaningfully, you do not have enough evidence yet; go back to interviewing.

For each, state:

- **target user or stakeholder** — who specifically;
- **context** — when and where it bites;
- **unmet need** — what they cannot currently achieve;
- **desired outcome** — the observable state that means "solved";
- **supporting evidence** — cite `E-NNN` ids, not vibes;
- **unresolved assumptions** — what this framing requires to be true;
- **what it would mean** — what gets built if this is the real problem, and what does not.

At least one framing should contradict the user's own stated framing. If every candidate agrees
with what they walked in believing, you have not reframed anything — you have paraphrased.

## 2. Make them react

Present the framings and invite a blunt reaction. The useful responses are:

> "Yes, that's the real issue." · "Partly, but this is missing." · "No, that's not what I mean."
> · "This one matters more than the others."

"Partly" is the most informative answer and usually means a fifth framing is hiding between two
of yours. Chase it rather than forcing a choice between what you already wrote.

## 3. Adopt the framing

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" framing "<cwd>" \
    --statement "<the framing, one sentence>" \
    --target "<who>" --need "<unmet need>" --outcome "<what solved looks like>"
```

**If this REPLACES a previous framing**, pass what killed it:

```bash
    --killed-by "<the evidence that invalidated F1 — cite E-NNN>"
```

A reframe does **not** fork the packages. `packages/vN` stays one monotonic sequence and each
package records the framing it served, because the MVP lives at the repo root and has exactly
one git history — it cannot fork, so neither may the packages. Evidence and decisions carry over
untouched: they did not become wrong, the framing did.

Record the reasoning:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" decision "<cwd>" \
    --text "Adopted F2 over F1" --why "<what the evidence forced>"
```

## 4. Convert the framing into hypotheses — keep many, converge late

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" hypothesis add "<cwd>" \
    --statement "<what should be true>" \
    --assumption "<the specific assumption under test>" \
    --why "<why it matters — what changes if it's false>" \
    --expected "<expected user outcome>" \
    --validation "<the LOWEST-cost way to find out>" \
    --success "<signal that confirms>" --failure "<signal that refutes>" \
    --confidence 0.4
```

Every field earns its place. A hypothesis with no `--failure` signal is unfalsifiable and will
be "confirmed" by whatever happens; refuse to record one until the user can say what would
change their mind.

Do not converge on a single solution here. Breadth is cheap at this stage and expensive later.

## 5. Rank, and pick what to build

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" hypothesis rank "<cwd>"
```

Ranking is by **expected learning**, so confidence enters inverted: a hypothesis you are already
90% sure of teaches almost nothing by being tested, and one at 50/50 teaches the most. That is
the opposite of picking the thing most likely to succeed, and it is deliberate — the point is to
find out, not to be right.

The ranking is an argument, not an instruction. Present the top few with your reasoning and let
the user override; they hold context you do not.

**It answers "what should we find out next", never "what should we build next."** Inverted
confidence puts the least-understood hypothesis on top, and the least-understood one is usually
the furthest from anything the user would run daily. `/prospector:build` scopes vN from the
user's actual job and uses this ranking only to choose what to watch *inside* that job. A
hypothesis that nothing job-shaped could test is one you **ask about in session, for free** —
not one you ship as a plugin.

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" stage "<cwd>" --to hypotheses
```

Then go to `/prospector:build` to put the chosen hypothesis in front of real use. Commit.
