---
description: >-
  Create a new ab-bench A/B experiment environment for testing a Claude Code plugin
  against a control (status-quo) setup. Idempotent: never overwrites an existing
  experiment's env.json/seed/.dod/runs/ledger.md, only fills in what's missing. Auto-trigger
  when the user says: "new experiment", "init an ab test", "set up an A/B test for <plugin>",
  "create a test environment", "benchmark this plugin", "test <plugin> against control",
  "start an ab-bench experiment", "I want to A/B test my plugin". Creates the experiment
  folder in PROGETTI\test-environments\ (env.json contract, seed/, .dod/, ledger.md, runs/).
  Does NOT fire sessions — that is /ab-bench:fire after /ab-bench:plan.
argument-hint: "[experiment-name]"
---

# ab-bench: init experiment

Create an experiment environment under `C:\Users\tomin\OneDrive\Desktop\PROGETTI\test-environments\<experiment-name>\`.

## 0. Preflight — idempotent check (ALWAYS do this first, before any Write/mkdir)

Resolve the target path. Check what already exists BEFORE creating anything:

- **`<experiment-name>/` doesn't exist at all** → fresh create, proceed normally.
- **`env.json` already exists** → this experiment is ALREADY initialized. Do NOT overwrite it
  (matches the "never edit env.json mid-experiment" discipline below — a second init would silently
  destroy a locked contract). Read it, show the user a one-line summary (plugin under test, model,
  control/test deltas), and ask: continue straight to `/ab-bench:plan` for the next run, or start a
  NEW experiment under a different (versioned) name instead? Stop here either way — do not touch
  this folder further.
- **Folder exists but `env.json` is missing** (partial/interrupted prior init) → resume, don't restart:
  check each of `seed/`, `.dod/`, `runs/`, `ledger.md` individually and create only whichever is
  ACTUALLY missing (`mkdir` is naturally idempotent for folders — creating one that already exists
  is a no-op; for `ledger.md`, check existence first and never overwrite it if content is already
  there). Then continue the interview to produce `env.json`.

Never blind-overwrite any of `env.json`, `ledger.md`, or the contents of an existing `seed/` — check
existence first, every time, no exceptions.

## Interview the user (AskUserQuestion, batch related ones)

Collect, unless already given in $ARGUMENTS or conversation:

1. **Experiment name** — kebab-case, versioned if iterating (e.g. `blender-plugin-v0.3`).
2. **Plugin under test** — local path (→ test arm `pluginDirs`) or marketplace ref (→ test arm `plugins`).
3. **Control compensation** — what does the control arm get so it isn't crippled? (e.g. raw Blender MCP when testing a Blender plugin). Can be nothing.
4. **Common config** — plugins/MCPs BOTH arms share (caveman, context7, ...). Everything both arms need must be declared here; arms must not rely on global config (arms run `--strict-mcp-config` and explicit `enabledPlugins`).
5. **Model** — one model, both arms. No exceptions.
6. **Seed files** — starting files both workspaces should begin with (can be empty).

For MCP entries: collect the full server definition (command/args/env), not just the name —
launch composes per-arm `--mcp-config` files from the `mcpServers` pool in env.json.

## Create (idempotent — check existence per item, create only what's missing)

```
<experiment-name>/
  env.json      ← contract below. Write ONLY if absent (step 0 already handled the exists-case).
  seed/         ← seed files (or empty). mkdir only if absent; never clear an existing seed/.
  .dod/         ← empty; /ab-bench:plan fills .dod/checks/*, dod-lite fills .dod/sessions/*.
                  mkdir only if absent.
  runs/         ← empty. mkdir only if absent — never touch existing runs/run-NNN/ folders.
  ledger.md     ← header only: experiment name, plugin under test, date, table header.
                  Write ONLY if absent — an existing ledger.md holds real run history.
```

env.json schema (schema 1):

```json
{
  "schema": 1,
  "experiment": "<name>",
  "created": "<ISO date>",
  "model": "<model>",
  "mode": "interactive",
  "mcpServers": { "<name>": { "command": "...", "args": [], "env": {} } },
  "common":  { "plugins": [], "pluginDirs": [], "mcp": [] },
  "control": { "plugins": [], "pluginDirs": [], "mcp": [] },
  "test":    { "plugins": [], "pluginDirs": [], "mcp": [] }
}
```

- `plugins`: marketplace refs for `enabledPlugins` (format `name@marketplace`)
- `pluginDirs`: local plugin folders, become `--plugin-dir` flags
- `mcp`: names referencing keys in the `mcpServers` pool

ledger.md header:

```markdown
# <experiment-name> — experiment ledger
Plugin under test: <ref/path> | Model: <model> | Created: <date>

| run | date | verdict | subjective score | key delta | report |
|---|---|---|---|---|---|
```

## Discipline (tell the user after creating)

- Never edit `env.json` between runs of the same experiment version — that breaks run-over-run comparability. New config = new experiment (bump the version suffix).
- Next step: `/ab-bench:plan` to define the task and DoDs for run-001.
