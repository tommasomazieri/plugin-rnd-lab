# The chain — how the three plugins fit together

Reference for `/core:learn chain`. Short by design; read it whole.

## Prospector → Optimizer

Prospector answers *what is worth building*. Optimizer answers *whether the thing you built
helps*. They meet at exactly one place: a pre-written mandate.

`/optimizer:understand` normally interviews across seven categories. A finished Prospector
engagement has already established six of them, over an entire engagement backed by recorded
evidence and real MVP use. Re-asking them would make the user answer, one at a time, everything
they just spent that engagement answering.

So `/prospector:handoff` writes two plain files into the shared working directory:

- `.ab-bench/<mandate-id>/mandate.md`
- `.ab-bench/<mandate-id>/quality-rubric.md` (when the engagement established a rubric)

and `/optimizer:understand` **detects them and switches to import mode**:

1. Show the mandate as written, section by section.
2. Ask only for **§6 Appropriate task complexity** — deliberately left `_NOT ESTABLISHED_`,
   because it is about A/B signal strength rather than about the problem, and nothing in a
   discovery engagement answers it. Prospector does not guess at it.
3. Ask whether anything else reads wrong, and correct only what the user flags.
4. If `quality-rubric.md` is present, show it and skip rubric authoring — Prospector derived it
   from the same ranked outcomes.

Imported sections are never "improved" unprompted: they are anchored to cited evidence the
receiving session cannot see, and rewriting them from a shorter conversation loses that
grounding.

`handoff` also **refuses to overwrite an existing mandate**. If Optimizer already has one, that
is a live experiment's north star, and silently replacing it would retroactively change what
every past run was measured against.

**Either plugin works alone.** Optimizer with no Prospector engagement simply runs its own
seven-category interview. Prospector with no handoff is still a complete method for finding out
what to build.

## Why the handoff is files, not code

There is no supported way for one plugin to read another's install directory — a `dependencies`
declaration buys co-installation, not code access. So the contract is the filesystem: Prospector
writes plain files where Optimizer already looks, writes no `state.json` or `env.json`, and
touches nothing Optimizer owns.

## Why dod-lite is a separate plugin

This comes up constantly, so: **it is separate on purpose, permanently, and it is not an
unresolved boundary.**

An arm session must load the **auditor and nothing else**. Folding dod-lite into Optimizer would
enable Optimizer's own skills — `plan`, `fire`, `analyze` — inside the very sessions being
measured. An arm that can invoke `/optimizer:plan` can design its own Definition-of-Done, which
destroys the entire pre-registration guarantee, and an arm carrying the harness's own tooling is
no longer a clean control.

So dod-lite ships as a peer plugin and gets injected into both arms via `--plugin-dir` at launch
time, read live off disk. It is registered in `marketplace.json` so it caches alongside Optimizer
— an installed plugin cannot reach files outside its own directory, so as an unregistered sibling
it resolved to a dead path on every marketplace install. `launch-pair.mjs` now refuses to fire
without it, rather than producing an uninstrumented run that looks identical to one where every
check passed.

It is also **observational only**: its `Stop` hook writes nothing to stdout — no decision, no
reason, no message. Injected into both arms identically, any feedback it gave would pull control
and test toward the same output and mask the difference being measured. Two regression tests in
`plugins/dod-lite/test/tiers.test.mjs` assert that silence directly.

Source, verbatim: `plugins/optimizer/docs/dod-contract.md` and the comment block in
`plugins/optimizer/skills/fire/scripts/launch-pair.mjs`.

## Two things both called "hypothesis"

Worth flagging when a user moves between the plugins, because they are different objects with
different ranking rules:

| | Prospector hypothesis | Optimizer hypothesis |
|---|---|---|
| lives in | `.prospector/hypotheses.json` | `lab/hypotheses.json` in the testenv |
| asks | is this the real problem? | will this change move a pillar? |
| ranked by | **expected learning** — confidence *inverted*, 50/50 ranks highest | magnitude × confidence ÷ cost |
| resolved by | the user's real use of an MVP | a paired A/B run |

## Install order

`core` is the entry point and writes nothing. `prospector` if you are starting from a
frustration; `optimizer` + `dod-lite` together once something exists to measure — Optimizer will
not fire without dod-lite installed.
