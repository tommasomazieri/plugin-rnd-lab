---
description: >-
  Turn the user's real use of an MVP into evidence: interview for behaviour rather than opinion,
  resolve or refute the hypothesis it tested, update the living problem model, and decide whether
  the next move is another iteration, a reframe, or handoff. Auto-trigger when the user says: "I
  used it", "it didn't work", "that was annoying", "it was fine but", "I stopped using it", "I
  went back to doing it manually", "here's what happened", "/prospector:review".
argument-hint: "[what happened when they used it]"
---

# Prospector: review real use

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" detect "<cwd>"
```

Read the current package's `package.md` and the hypothesis it was built to test before asking
anything. You are checking a specific prediction, not collecting general impressions.

## 1. Interview for behaviour, not for verdicts

"Did you like it?" produces a polite answer that predicts nothing. What actually happened does.

> "Walk me through the last time you used it." · "Where did you stop and do something else?"
> · "What did you expect it to do at that moment?" · "Did you go back to the old way — when?"
> · "What did you not use at all?"

**The most valuable signal is abandonment.** If they stopped using it, or quietly worked around
part of it, that is a stronger result than any praise — and people rarely volunteer it, because
it feels like reporting their own failure rather than the tool's. Ask directly and make it
comfortable to say.

**Silence is data too.** A feature nobody mentioned is usually a feature nobody used.

**Ask first whether vN was usable at all**, before any question that presumes it was:

> "Was there anything here you could actually point at real work and run?"

If the answer is no — it ran once, it produced a document rather than the work, they had to do
the whole job by hand anyway — **stop interviewing about the hypothesis.** Nothing they say next
is evidence about it. That is a build defect against `/prospector:build` §2's floor test, it
resolves as `not-testable` in §3, and the fix is vN+1, not a reframe.

Be alert to a real possibility: the MVP worked exactly as designed and the user still did not
want it. That refutes the *framing*, not the implementation, and it is the single most useful
thing an engagement can discover early.

## 2. Record it as evidence, with honest status labels

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" evidence "<cwd>" \
    --text "<what they did, concretely>" \
    --status <confirmed|strongly-supported|tentative|assumption|unknown|contradicted> \
    --source mvp-use --hypotheses H-003
```

Use `--source mvp-rejected` instead when they refused vN on delivery without running it. Both
close the package for `/prospector:build`'s §0 gate; nothing else does. A rejection on sight is
not a failed review — it is a fast one, and it carries more information per second than any other
answer you will get, because they could see it was useless without spending a day proving it.

Use `contradicted` when use disproved something previously recorded. Do not quietly delete the
old evidence — the contradiction is itself the finding, and a record that only ever agrees with
its latest state cannot show anyone how the understanding moved.

## 3. Resolve the hypothesis

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" hypothesis resolve "<cwd>" \
    --id H-003 --outcome <confirmed|partly-confirmed|refuted|inconclusive|not-testable> \
    --note "<what the use actually showed>"
```

`inconclusive` is a legitimate and common outcome — they did not use it enough, or used it for
something else entirely. Record it as inconclusive rather than stretching thin use into a
verdict. A refuted hypothesis is a *good* result: it cost one narrow MVP instead of a product.

**`not-testable` is about the MVP, not about them.** Use it when vN could not carry the test at
all: not usable on real work, run once and done, produced a description instead of the work.
Reaching for `inconclusive` there quietly puts a build defect on the user's tab — it reads as
"they did not use it enough" when the truth is there was nothing to use. The hypothesis **stays
open and keeps its rank**, because nothing was learned about it and, by inverted-confidence
ranking, it is probably still the thing you least understand. Say so out loud in §4: vN failed
the floor test, the question is untouched, vN+1 owes it a working artifact.

## 4. Say plainly what changed

Tell the user, in a few lines:

- what the feedback **confirms**;
- what it **contradicts**;
- what it leaves **unresolved**;
- what you changed in the problem model as a result, and what you deliberately did not.

Then update `problem-model.md` in place. Do not restart the engagement over one bad session —
`/prospector:frame` with `--killed-by` exists for genuine framing invalidation, and everything
short of that is an iteration.

## 5. Decide the next move, explicitly

State which and why:

- **iterate** → `/prospector:build` for vN+1 against the next-ranked hypothesis;
- **rebuild** → `/prospector:build` for vN+1 against the **same** hypothesis, when §3 resolved
  `not-testable`. The question is untouched; what failed was the artifact carrying it. Never
  reframe off a `not-testable` — you have no evidence to reframe from;
- **reframe** → `/prospector:frame`, when the evidence broke the framing itself and not just
  the implementation;
- **more discovery** → back to interviewing, when use raised a question nothing can answer yet;
- **hand off** → `/prospector:handoff`, when the direction is validated enough that the
  remaining questions are about efficiency rather than desirability.

The handoff test is specific: can you state a supported problem, prioritised outcomes,
measurable success criteria, constraints, scope, explicit non-goals, and the known unresolved
risks? If any of those is still hand-waving, you are not done finding out.

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" decision "<cwd>" \
    --text "<the decision>" --why "<the evidence behind it>"
```

Commit.
