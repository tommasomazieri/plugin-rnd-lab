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

## Optimizer → Prospector — the loop closes

The chain is a **loop**, not a one-way pipeline:

```
prospector: start → survey → frame → design → build → review → handoff
                                 ↑                                 ↓
                                 │                          optimizer: init →
                                 │                          plan → fire → analyze
                                 │                                 ↓
                                 └────────── reenter ──────────────┘
```

`/prospector:reenter` reads the same shared directory in the other direction. `.ab-bench/state.json`
names `testenv_root`; every `runs/*/analysis/report.md` under it, plus `lab/findings.md`,
`lab/hypotheses.json`, and `ledger.md`, is evidence about how the shipped plugin actually behaved.
`prospector-cli detect` reports **`post-optimizer`** once a blueprint exists and at least one run
has been analysed — both conditions, because a handoff with no analysed run has produced nothing
new to re-enter on.

Re-entry ingests that evidence, diffs the shipped surface against the blueprint's build order,
interviews on real use, re-runs the prior-art survey, revises the blueprint, and ranks the next
slice by **value** rather than by expected learning.

`analysis/fix-list.md` is deliberately **not** re-entry's to execute. Its reader is the operator,
by hand, in the plugin's own repo — that is by design, not an oversight. Re-entry reads it only to
classify: an item meaning *"does the wrong thing"* is a discovery finding and comes back into the
needs list; *"does the right thing slowly"* is named and left alone. Folding efficiency fixes into
`vN+1` makes the user's reaction to that version unattributable between "new capability" and "same
capability, faster".

The Optimizer holds up its own half at `/optimizer:analyze` §7b. When the finding is that the
plugin is aimed at the wrong job rather than executing it badly — a fix-list full of "the user had
to redo this", a mandate that no longer describes actual use, runs that keep confirming hypotheses
while the plugin gets no more useful — it says so and names `/prospector:reenter`. It still never
redefines the problem itself; it is simply the instrument most likely to notice that the problem
needs redefining, and silence there is not neutrality. (If Prospector was never used on that
plugin, the same signal means `/optimizer:understand` needs re-running.)

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

## Three ranked lists, three different questions

Worth flagging when a user moves between the plugins and the stages, because these are different
objects and the rankings deliberately disagree:

| | Prospector hypothesis | Prospector need | Optimizer hypothesis |
|---|---|---|---|
| lives in | `.prospector/hypotheses.json` | `.prospector/needs.json` | `lab/hypotheses.json` in the testenv |
| asks | is this the real problem? | what can't the user do? | will this change move a pillar? |
| answers | what to **find out** next | what to **build** next | what to **try** next |
| ranked by | **expected learning** — confidence *inverted*, 50/50 ranks highest | **value** — importance × provenance × confidence, uninverted | magnitude × confidence ÷ cost |
| resolved by | the user's real use of an MVP | being covered by a version, or deferred with a reason | a paired A/B run |

The inversion is the thing to get right. Ranking builds by expected learning aims each version at
the least-understood item on the page, which is usually the furthest from anything the user would
run daily — correct while the problem is unknown, actively wrong once a working plugin exists.
That is why `/prospector:reenter` uses `needs rank` and not `hypothesis rank`.

## Install order

`core` is the entry point and writes nothing. `prospector` if you are starting from a
frustration; `optimizer` + `dod-lite` together once something exists to measure — Optimizer will
not fire without dod-lite installed.
