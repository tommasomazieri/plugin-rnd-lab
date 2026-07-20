---
description: >-
  Configure (or change) ab-bench's experiments root: the one folder on this
  machine where every A/B experiment environment gets created and reused
  (env.json, seed files, run history, transcripts — kept outside any project
  repo). User-invoke only. Run this once after installing ab-bench, before
  /ab-bench:init. Safe to re-run any time to change the location.
argument-hint: "[absolute-path]"
disable-model-invocation: true
allowed-tools: Bash(node *) Read Write
---

# ab-bench: setup

ab-bench needs ONE folder outside any project repo to hold every experiment it ever creates
(`<experiments_root>/<experiment-name>/…` — env.json, seed files, `.dod/`, run history,
transcripts). This is stored as the plugin's `experiments_root` [user configuration](
https://code.claude.com/docs/en/plugins-reference#user-configuration) option — the official
Claude Code mechanism for exactly this, not a bespoke config file. Claude Code normally prompts
for it automatically the first time you enable the plugin; this skill exists for anyone who
skipped that prompt, or wants to change the folder later.

## 1. Check the current value

Look at `${user_config.experiments_root}` as it appears in this very sentence. Three cases:

- **Resolves to a real absolute path** → tell the user what it currently is, ask: keep it, or
  pick a new one? If keeping it, confirm and stop here.
- **Empty, or still literally reads `${user_config.experiments_root}`** → not configured yet,
  continue to step 2.
- User passed a path directly as `$ARGUMENTS` → skip the interview, use it (still run step 3).

## 2. Ask for the folder (skip if $ARGUMENTS supplied one)

Suggest a sensible default (e.g. a sibling folder next to this plugin's marketplace clone, or
`~/claude-ab-bench-experiments`) and ask the user to confirm or give a different absolute path.
Plain path input — free text works fine, or use AskUserQuestion with the suggestion as one option
and "Other" for a custom path if that reads better in context.

## 3. Create the folder if missing

```
node -e "require('fs').mkdirSync(process.argv[1], { recursive: true })" "<resolved-path>"
```

Don't refuse or warn if the folder already exists and has content — it's meant to be reused
across every experiment; each experiment gets its own named subfolder later, nothing here writes
outside that.

## 4. Save it — merge into `~/.claude/settings.json`, never blind-overwrite

This file usually has hooks, permissions, and other plugins' config already in it. Do the write
as a JSON parse-merge-write round trip, never a text-level edit, so nothing else in the file is
touched:

```
node -e "
const fs = require('fs'), os = require('os'), path = require('path');
const p = path.join(os.homedir(), '.claude', 'settings.json');
const s = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
s.pluginConfigs = s.pluginConfigs || {};
s.pluginConfigs['ab-bench@plugin-rnd-lab'] = s.pluginConfigs['ab-bench@plugin-rnd-lab'] || {};
s.pluginConfigs['ab-bench@plugin-rnd-lab'].options = s.pluginConfigs['ab-bench@plugin-rnd-lab'].options || {};
s.pluginConfigs['ab-bench@plugin-rnd-lab'].options.experiments_root = process.argv[1];
fs.writeFileSync(p, JSON.stringify(s, null, 2) + '\n');
console.log('experiments_root ->', process.argv[1]);
" "<resolved-path>"
```

If this plugin was installed from a marketplace under a different name than `plugin-rnd-lab`
(a fork, a rename), use that name instead of `plugin-rnd-lab` in the key above — ask the user if
unsure, don't guess silently.

## 5. Confirm

Tell the user: experiments root saved to `<resolved-path>`. If this session already loaded
`${user_config.experiments_root}` as empty earlier in this same conversation, a session restart
(or `/reload-plugins`) may be needed before other ab-bench skills pick up the new value — mention
it, don't assume. Next step: `/ab-bench:init <experiment-name>`.

Mention once, briefly, as optional (not required — don't dwell on it): the third-party
`context-mode` MCP plugin (`mksglu/context-mode`) speeds up `/ab-bench:analyze`'s transcript
filtering if installed, but ab-bench works fully without it. See README "Optional: faster
analysis with context-mode" or `/ab-bench:learn analyze` for details.
