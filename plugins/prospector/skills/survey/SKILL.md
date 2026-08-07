---
description: >-
  Find out whether something already solves this before designing anything. Searches the plugin
  marketplaces, the web, and the user's own installed set, then returns one of three verdicts —
  including "this already exists, install it, we're done". Auto-trigger when the user says:
  "does this already exist", "has someone built this", "what's out there", "check the
  marketplace", "prior art", "am I reinventing", "/prospector:survey".
argument-hint: ""
---

# Prospector: survey the prior art

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" detect "<cwd>"
```

`{"status":"fresh"}` → nothing here yet; tell them to run `/prospector:start` and stop.

Read `problem-model.md` and the evidence recorded so far. You are searching for *the user's
problem*, in the user's words — not for the solution you have started imagining. Those diverge
fast, and searching for your own idea is how you confirm it is original.

## 0. Why this runs before framing, not after

Framing is where you commit. An hour spent generating competing framings for a problem that a
published plugin already solves is an hour spent building a case, and by the end of it you will
be too invested to hear the answer. Search while you still have nothing to defend.

It is also the cheapest stage at which "don't build this" is still a comfortable thing to say.

## 1. Search — five sources, and the last one is the best

Do all five. They fail differently, which is the point.

**a. What the user already has.** Their installed and registered set, and what it does not do:

```bash
claude plugin marketplace list
```

**b. The community marketplace.** Enumerable as raw JSON:

```
https://raw.githubusercontent.com/anthropics/claude-plugins-community/main/.claude-plugin/marketplace.json
```

Fetch it and read the plugin names and descriptions. It is a flat list — read all of it rather
than grepping for one guessed keyword, because the thing that solves their problem is very likely
filed under a word they never used.

**c. Anthropic's own demo plugins** — the `plugins/` directory of `anthropics/claude-code`.

**d. The open web.** Search the problem in the user's own phrasing, and again in the vocabulary of
their field. Include skills and MCP servers, not only plugins: "there is no plugin but there is an
MCP server that does the hard half" changes the design.

**e. Ask them what they already tried.** The cheapest source and the only one that reports *why*
something failed. "I tried X, it was too slow / it assumed I had Y / I could never remember to run
it" is worth more than the other four combined — it is a competitor analysis and a needs interview
in one sentence, from the only person whose opinion decides anything.

Do (e) even when (a)–(d) found nothing. Especially then.

## 2. There is no plugin search API — so a negative is never a fact

Verified against the Claude Code docs: there is no search endpoint, no aggregator, and no index of
third-party marketplaces. You searched a flat community list, a demo directory, and the open web.
Someone's private or unlisted marketplace is invisible to all of that.

So when you find nothing, record it as `unknown` — never `confirmed`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" evidence "<cwd>" \
    --text "PRIOR ART: searched <sources> for <terms>; nothing covering <the problem>" \
    --status unknown --source prior-art
```

The status vocabulary already has the right word. Writing `confirmed` here would be the same class
of error as a grader reporting `fail` when it could not open the artifact: absence of evidence
recorded as evidence of absence.

## 3. Three verdicts. All three are legal, and one of them ends the engagement.

### Something already does this, well enough

**Say so, tell them what to install, and stop.** Record the decision and end the engagement.

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" decision "<cwd>" \
    --text "Engagement closed at survey — <plugin> already solves this" \
    --why "<what it does, and why it is sufficient for what they described>"
```

This verdict is the reason the stage exists. **A discovery instrument that cannot return "do not
build this" is a build-justification machine** — every engagement reaches a package because
reaching a package is what it does. The user came to find out what is worth building, and "someone
already built it, here it is" is the highest-value answer they can get: it costs them one install
instead of three versions and a month.

Do not soften it into "you could still build your own, tailored version". If that is true, it is
the next verdict, and the next verdict requires you to name what is missing.

### Something exists but is insufficient

The design's job is now **the delta**, and you have to name it precisely — which need it fails to
meet, not "it's not quite right". Vague deltas produce reimplementations with a different colour.

Then mine it for needs the user never named. An existing tool's feature set is a free list of
things people in this situation turned out to want. Record those as needs, honestly labelled:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" needs add "<cwd>" \
    --statement "<the need the existing tool reveals>" \
    --kind prior-art --importance significant
```

`prior-art` needs do **not** gate a package cut. The user never asked for them; you inferred them
from someone else's product decisions, and those may have been wrong or made for a different
audience. They belong in the blueprint, and they are excellent interview material — put the
interesting ones to the user and any they confirm gets re-recorded as `stated`.

### Nothing found

Proceed, with the `unknown` evidence from §2 on the record. Say plainly what you searched and what
you could not search, so the claim can be re-examined later without being re-derived.

## 4. Report, and hand over

Tell the user, in a few lines: what you searched, what you found, the verdict, and — if the
verdict is "insufficient" — the delta in one sentence.

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" stage "<cwd>" --to survey
```

Then `/prospector:frame`. Commit.

**At re-entry this skill runs again.** `/prospector:reenter` calls it because the market moves,
and because after a cycle of real use you finally know the right words to search with — the
vocabulary you lacked the first time is exactly what the user's complaints have since taught you.
