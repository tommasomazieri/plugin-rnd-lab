---
description: >-
  Cut design package vN and build the paired MVP plugin vN that tests the highest-value
  hypothesis in the user's real workflow, then get it installed so they can actually use it.
  Auto-trigger when the user says: "build the MVP", "make me something to try", "cut a package",
  "let's test this", "ship a version", "/prospector:build".
argument-hint: ""
---

# Prospector: cut a package and build the MVP

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" detect "<cwd>"
```

Read `problem-model.md`, the ranked hypotheses, and `framings.md` first. Confirm with the user
**which hypothesis this MVP exists to test** before writing a line of it. An MVP that tests
nothing in particular produces feedback nobody can act on.

## 1. Design the package

The package is the readable artifact the user reacts to. Write `packages/vN/package.md` with:

1. **Defined problem statement** — evidence-based, citing `E-NNN`.
2. **User and stakeholder model** — who, in what context, why.
3. **Needs and desired outcomes** — ordered by importance AND by confidence, separately. A
   high-importance/low-confidence need is the most valuable thing on the page.
4. **Constraints and non-goals** — what the solution must respect, and what it deliberately
   does not attempt. Non-goals are as load-bearing as needs.
5. **Current alternatives and failure modes** — what they do today and precisely why it is
   insufficient. "Nothing" is almost never the true answer; find the workaround.
6. **Opportunity areas** — the promising directions, without crowning one.
7. **Ranked hypotheses** — with evidence, uncertainty, and recommended validation.
8. **Recommended next experiment** — the smallest step that reduces the biggest uncertainty.
9. **Handoff readiness** — one of: more discovery · validation · concept design ·
   implementation · ready for the Optimizer.
10. **MVP plugin** — what vN actually does, and the single hypothesis it exists to test.

## 2. Build the MVP — deliberately narrow

It goes at the **repo root**, not inside `.prospector/`: `.claude-plugin/plugin.json`, `skills/`,
and whatever else it needs. `.prospector/` is the engagement's record; the root is the product.

Narrow is the whole point. An MVP that covers the full imagined product tests the framing and
five other things at once, and when the user dislikes it you will not know which part failed.
Build the thinnest thing that can produce a real signal about the chosen hypothesis.

**Set `plugin.json`'s version to `N.0.0` matching package vN.** Package vN and MVP vN are one
event and one number, so "which version were you using?" always has an answer.

## 3. Cut the package

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" package "<cwd>" \
    --changed "<what changed since the previous package>" \
    --why "<why it changed>" \
    --evidence "<the evidence that triggered it — E-NNN>" \
    --unresolved "<assumptions still open>" \
    --confidence "<up | down | unchanged, and in what>"
```

`packages/vN/` is **frozen** once cut. Later learning goes into `vN+1`, never back into a
shipped package — a record that gets edited after the fact cannot show how understanding moved.

## 4. Get it into their real workflow

An MVP nobody installs produces no evidence. It must run in the user's own projects, over real
work, for days — not in a demo.

On first build, write a single-plugin `.claude-plugin/marketplace.json` at the repo root, then:

```bash
claude plugin marketplace add "<cwd>"
claude plugin install <mvp-name>
```

On every later build, they bump to the new version:

```bash
claude plugin update <mvp-name>
```

Installed plugins are **copied into the plugin cache**, so each installed version is an immutable
snapshot rather than a live view of this directory. That is what makes feedback attributable: "v2
was worse than v1" means something because v2 cannot have changed underneath them.

Tell them plainly: **use it for real, and notice when it annoys you.** Then come back to
`/prospector:review`.

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/prospector-cli.mjs" stage "<cwd>" --to review
```

Commit — package cut and MVP build are one checkpoint.
