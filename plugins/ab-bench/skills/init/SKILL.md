---
description: >-
  Create (or extend) an ab-bench experiment for the plugin whose repo you're CD'd into.
  Run this FROM the plugin-under-test's own repo — no path/name argument needed, ab-bench
  figures out which plugin from cwd. First run in a repo scaffolds .ab-bench/mandate-1/
  envs/env-1/ there (env.json contract) plus a paired testenv folder under the configured
  experiments root (seed/, .dod/, runs/, ledger.md), then MANDATORILY invokes
  /ab-bench:understand to produce mandate.md. Re-running in a repo that already has
  .ab-bench/ offers: continue to /ab-bench:plan, start a new env under the current mandate
  (arm config changed), or start a new mandate (the plugin's actual purpose changed).
  Auto-trigger when the user says: "new experiment", "init an ab test", "set up an A/B test
  for this plugin", "create a test environment", "benchmark this plugin", "test this plugin
  against control", "start an ab-bench experiment", "I want to A/B test my plugin".
argument-hint: "[env-only|mandate] (optional — skip the menu and go straight to one branch)"
---

# ab-bench: init experiment

Experiments root: `${user_config.experiments_root}`. If that's empty or still literally
reads `${user_config.experiments_root}`, tell the user to run `/ab-bench:setup` first and
stop. Do not guess a path or create one yourself.

**Run this from the plugin-under-test's own repo.** Resolve the repo root (not necessarily
cwd if the user is in a subdirectory):

```
node "${CLAUDE_SKILL_DIR}/scripts/ab-bench-scaffold.mjs" find-repo-root "<cwd>"
```

If it isn't a git repo yet, `repoRoot` falls back to cwd itself — that's fine, tell the user
plainly (worktree-based previous-version baselines won't be available until it is one, but
everything else works).

## 0. Detect state — ALWAYS do this first

```
node "${CLAUDE_SKILL_DIR}/scripts/ab-bench-scaffold.mjs" detect "<repoRoot>" "${user_config.experiments_root}"
```

- **`{"status":"fresh"}`** → no `.ab-bench/` here yet. Go to **1. Fresh init**.
- **`{"status":"existing", ...}`** → this repo already has an experiment. Show the user a
  one-line summary (current mandate id, current env id, whether mandate.md/env.json exist —
  flag either missing, that's a broken/interrupted prior run) and ask:
  1. **Continue** — go straight to `/ab-bench:plan` for the next run on the current env.
  2. **New env, same mandate** — the arm config needs to change (different MCP/plugins/model
     for this run) but the plugin's actual purpose hasn't. Go to **2. New env**.
  3. **New mandate** — the plugin's scope/purpose has actually changed. Go to **3. New mandate**.

  Default the suggestion to (1) unless the user's request implies otherwise — don't make them
  restate "continue" for the common case.

`$ARGUMENTS` can shortcut this menu: `env-only` → branch 2, `mandate` → branch 3.

## 1. Fresh init

Interview the user (AskUserQuestion, batch related ones). Collect, unless already given:

1. **Plugin under test** — which folder(s) INSIDE this repo are the plugin (its
   `pluginDirs`)? Run `node "${CLAUDE_SKILL_DIR}/scripts/ab-bench-scaffold.mjs" find-plugins "<repoRoot>"`
   first — if it finds exactly one, confirm that's the one; if several (monorepo shipping
   multiple plugins), ask which; if none, ask for the path by hand. `pluginUnderTestRepo` is
   always `repoRoot` now — you're standing in it, never ask for it separately.
2. **Control compensation** — what does the control arm get so it isn't crippled? (e.g. raw
   Blender MCP when testing a Blender plugin). Can be nothing.
3. **Common config** — plugins/MCPs BOTH arms share (caveman, context7, ...). Everything both
   arms need must be declared here; arms must not rely on global config (arms run
   `--strict-mcp-config` + explicit `enabledPlugins`).
4. **Model** — one model, both arms. No exceptions.
5. **Seed files** — starting files both workspaces should begin with (can be empty).

For MCP entries: collect the full server definition (command/args/env), not just the name.

Then scaffold:

```
node "${CLAUDE_SKILL_DIR}/scripts/ab-bench-scaffold.mjs" create-fresh "<repoRoot>" "${user_config.experiments_root}"
```

This creates `.ab-bench/mandate-1/envs/env-1/` (empty — you write `env.json` next), the paired
testenv folder (`seed/`, `.dod/`, `runs/`, `ledger.md` header — already written, never
overwrite it), `.ab-bench/state.json` (current_mandate=mandate-1, current_env=env-1), and
appends `.ab-bench/` to the repo's `.gitignore` if it wasn't already there. It prints the
target paths (`envFile`, `mandateFile`, `testenvDir`, `displayName`) — use them below.

Write `envFile` (the `env.json` the script pointed at) with schema 1:

```json
{
  "schema": 1,
  "experiment": "<displayName from the script output>",
  "created": "<ISO date>",
  "model": "<model>",
  "mode": "interactive",
  "pluginUnderTestRepo": "<repoRoot>",
  "mcpServers": { "<name>": { "command": "...", "args": [], "env": {} } },
  "common":  { "plugins": [], "pluginDirs": [], "mcp": [] },
  "control": { "plugins": [], "pluginDirs": [], "mcp": [] },
  "test":    { "plugins": [], "pluginDirs": <the plugin dirs from step 1>, "mcp": [] }
}
```

- `plugins`: marketplace refs for `enabledPlugins` (format `name@marketplace`)
- `pluginDirs`: local plugin folders, become `--plugin-dir` flags
- `mcp`: names referencing keys in the `mcpServers` pool

Then **mandatorily** invoke `/ab-bench:understand` (no argument needed — it reads
`.ab-bench/state.json` via cwd same as this skill did) to write `mandateFile`, reusing the
plugin-dirs/control-compensation/common-config context you just collected so it doesn't
re-ask. Do not tell the user init is complete until this has run.

## 2. New env, same mandate

Re-run the same interview as step 1 items 2–5 (control compensation, common config, model,
seed) — item 1 (plugin dirs) rarely changes but ask if unsure. Then:

```
node "${CLAUDE_SKILL_DIR}/scripts/ab-bench-scaffold.mjs" create-env "<repoRoot>" "${user_config.experiments_root}"
```

Creates the new `envs/env-(N+1)/` dir + paired testenv folder, bumps `state.json`'s
`current_env`. Write the new `envFile` exactly as in step 1 (same schema). Existing envs
under this mandate are untouched — old runs stay comparable within their own env, just not
across envs (same discipline as the old "new config = new experiment" rule, just scoped to
env now instead of the whole thing).

## 3. New mandate

The plugin's actual purpose changed enough that the OLD mandate.md would misdirect task/DoD
design. Run:

```
node "${CLAUDE_SKILL_DIR}/scripts/ab-bench-scaffold.mjs" create-mandate "<repoRoot>" "${user_config.experiments_root}"
```

Creates `mandate-(N+1)/envs/env-1/` + paired testenv folder, bumps `state.json`'s
`current_mandate` AND `current_env` (a new mandate always starts with a fresh env-1 — there's
nothing to reuse). Then:

1. Mandatorily invoke `/ab-bench:understand` to write the new `mandateFile` — full
   re-interview, this is a genuine scope change, not a refresh of the old one.
2. Run the step-1 interview (items 1–5) and write the new `envFile`.

## Discipline (tell the user after creating or extending)

- **Never edit an existing `env.json` once a run has fired against it.** New arm config =
  new env (this skill's branch 2), never a silent edit.
- **mandate.md is never duplicated across envs under the same mandate** — every env under
  `mandate-N/` shares the one `mandate-N/mandate.md`. Only branch 3 (an actual scope change)
  creates a new mandate, and therefore a new mandate.md.
- `.ab-bench/` is gitignored — it's local state, not something to commit to the
  plugin-under-test's repo.
- Every future Claude Code session started from this repo (or a subdirectory of it) will see
  a one-line SessionStart reminder of the current mandate/env/testenv location — you don't
  need to re-state an experiment name to any ab-bench skill.
- Next step: `/ab-bench:plan` to define the task and DoDs for run-001 (or the next run).
