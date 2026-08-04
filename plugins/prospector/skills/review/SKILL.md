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

Use `contradicted` when use disproved something previously recorded. Do not quietly delete the
old evidence — the contradiction is itself the finding, and a record that only ever agrees with
its latest state cannot show anyone how the understanding moved.

## 3. Resolve the hypothesis

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" hypothesis resolve "<cwd>" \
    --id H-003 --outcome <confirmed|partly-confirmed|refuted|inconclusive> \
    --note "<what the use actually showed>"
```

`inconclusive` is a legitimate and common outcome — they did not use it enough, or used it for
something else entirely. Record it as inconclusive rather than stretching thin use into a
verdict. A refuted hypothesis is a *good* result: it cost one narrow MVP instead of a product.

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
