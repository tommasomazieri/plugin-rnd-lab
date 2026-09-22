# Launch Plan

This file is the entry point for a Claude Code session working IN this repo to get
prospector/optimizer/dod-lite in front of the real audience that already exists for them
(Claude Code plugin builders), with real distribution and honest, verifiable outcomes.

This is also being run as a personal case study (GTM/PM proof of work), so one constraint
overrides everything below: **real numbers only, ever.** No invented installs, stars, users,
or engagement, anywhere this feeds a CV, a post, or an interview answer. If a number is
underwhelming, report it underwhelming.

## Pre-flight audit already run (2026-08-25)

Fast pass, done before writing this plan, not a substitute for the real audit below:

- `git status` clean, nothing uncommitted.
- All 154 tests pass: prospector 44/44, optimizer 76/76, dod-lite 34/34.
- Scanned all tracked files for personal paths / secrets (`git grep` for the author's
  username, `C:\Users\...`, email, api-key/password patterns): nothing found. The only
  "secret"/"password" hits are dod-lite's own leak-detection test fixtures, which is the
  system working as intended, not a leak.
- Repo is already public on GitHub (`tommasomazieri/plugin-rnd-lab`), MIT licensed.

Verified distribution channels (searched 2026-08-25, re-verify if this file is acted on much
later, links and member counts drift):
- Official Anthropic plugin directory submission: `clau.de/plugin-directory-submission`.
- Community marketplace: `github.com/anthropics/claude-plugins-community` (read-only mirror,
  same submission form).
- Third-party directory: `claudemarketplaces.com` (claims 380k+ monthly visitors; that number
  is the site's own claim, not independently verified here).
- `r/ClaudeCode` (387k members, community-run, not Anthropic-official) and `r/ClaudeAI` (1.1M
  members, same caveat).

Re-verified 2026-09-22 — what changed the plan:
- **Anthropic shipped `claude plugin eval`** (Claude Code v2.1.269, ~2026-09-11,
  code.claude.com/docs/en/plugin-evals): with/without-plugin runs, 3 per case by default,
  regex/tool/LLM graders, CI gating. Each run is "a fresh, isolated non-interactive session" in
  "an empty working directory" with one prompt. It is the first thing any commenter will raise.
  Optimizer's honest distinction: interactive, human-in-the-loop, real multi-turn work — the
  plugins whose value only appears in a conversation. Its honest cost: one paired run is one data
  point, with the operator in it. Both now lead the README.
- **Show HN does not take writeups** ("blog posts… and other reading material" are off topic,
  news.ycombinator.com/showhn.html). A findings post is a regular submission; Show HN is for the
  repo itself, and only once a stranger can install and run it.
- **Demand exists and is documented.** r/ClaudeCode 2026-04-22 "Has anyone actually benchmarked
  whether superpowers improves performance?"; r/ClaudeAI 2026-04-15 "Has anyone actually run
  controlled A/B tests on Claude skills and prompt plugins?". A 12-session headless review of
  superpowers (mejba.me, 2026-04-14) concedes its protocol "bypassed the framework's best
  feature", the human-in-the-loop moments.
- **What gets upvoted.** Tool authors posting their own benchmarks: 1 point (Ouroboros, r/ClaudeAI)
  and 5 points (Nelson, r/ClaudeCode, opened with "v2.2.3 shipped"). An experience post about the
  plugin people already use, "Claude Code's Superpowers plugin actually delivers": 171 points,
  54 comments. People upvote the plugin they use, not the tool that measured it.
- Reddit blocks automated fetches of subreddit rules; they were not read. Read both sidebars by
  hand before posting.
- **Always-on context cost**, from `claude plugin details` on a GitHub install: optimizer ~1554
  tokens per session, prospector ~1076, core ~115, dod-lite 0. Someone will ask.

## Before anything goes public: finish the audit

The fast pass above is not sufficient. Before submitting anywhere or posting anything, do a
real pass:

1. Full security review of the repo, not just a diff — `/security-review` or an equivalent
   manual pass. The real risk surface is `launch-pair.mjs` spawning terminals/subprocesses and
   anywhere `env.json` / `config.json` values get read into a shell command or file path.
   Check for injection or path-escape if any of those values could ever be attacker- or
   careless-user-supplied.
2. ~~Re-read `plugins/optimizer/README.md`'s "Windows only" disclosure against the actual code.~~
   **Closed 2026-08-26 by porting rather than by disclosing** — see the audit log below.
3. Do one full clean-install dry run of the documented Quickstart exactly as written, as a
   first-time stranger would follow it (`marketplace add` -> install `core` -> `/core:learn`),
   in a scratch directory. Fix anything that doesn't work as documented.
4. ~~Skim every plugin's skill files for leftover TODO/FIXME/placeholder text.~~ **Clean as of
   2026-08-26** — see below.

If this turns up a real defect, fix it and let the test suite and a re-run of this checklist
confirm the fix before moving to step 1 of the plan. Do not publicize a plugin with a known,
unresolved defect.

### Audit log

**2026-08-26 — cross-platform port + tidy-up.** What was checked and what came of it:

- **Item 2 resolved by fixing, not documenting.** The "Windows only" disclosure was accurate,
  and the underlying limit was ~50 lines of terminal-spawning code, not anything about the
  method. Ported to macOS and Linux; all platform-specific code now lives in
  `plugins/optimizer/skills/fire/scripts/terminal.mjs`. Two latent POSIX defects in `dod-lite`
  were found while porting and fixed (leaked check-script process trees; default `.ps1`/`.py`
  runners that do not exist off Windows). See the CHANGELOG's portability release.
- **Item 4 clean.** No TODO/FIXME/XXX/HACK/placeholder/TBD anywhere outside test fixtures.
- **Partial on item 1.** The specific surface this file names was reviewed and is sound:
  `parseDeliver` already validates env var names against `/^[A-Za-z_][A-Za-z0-9_]*$/` and
  already rejects absolute paths and `..` in workspace subpaths, so no `env.json` value reaches
  a shell unquoted. The one place an `env.json` value still lands on a command line rather than
  in an argv slot — the `cmd.exe`/`start` fallback window title — is now reduced to a plain
  label first. **A full repo-wide `/security-review` has still not been run.**
- **Partial on item 3.** The repo was cloned to a scratch directory and the full suite run from
  the clone, which proves nothing untracked is load-bearing. `claude plugin validate --strict`
  passes on the marketplace manifest and on all four plugins. **The documented Quickstart has
  not been walked end to end as a stranger** (`marketplace add` -> install -> `/core:learn`).
- 162 tests pass: prospector 44, optimizer 84, dod-lite 34.
- **Not verified: the macOS and Linux launch paths have never been run on a Mac or a Linux
  box.** The POSIX launcher script is executed for real by the test suite (under `sh`, against
  a stub `claude`, asserting argv/cwd/env), so the *script* is known good. What is unproven is
  the window-opening layer: `osascript` against Terminal.app and iTerm2, and each Linux
  emulator's argument spelling. First run on either platform should be treated as a smoke test.

**2026-09-22 — the pre-launch pass. Items 1 and 3 closed; the stranger path was broken.**

- **The public repo showed the old product.** GitHub's default branch `master` sat at `d113a81`
  (2026-08-02): ab-bench only, Windows only, no Prospector, no `core`. Every commit since lived on
  `feat/observational-dod-and-prospector`. Fast-forwarded `master`; repo description rewritten to
  name both instruments. Work now lands on `master` once CI is green.
- **Item 1, security review — closed.** Every subprocess, shell and path sink read by hand. Two
  fixes, `061c553`: PowerShell literals now escape the typographic quotes `‘ ’ ‚ ‛` (verified on
  a real parser: an experiment name with a curly apostrophe broke the Windows launcher and could
  inject); refs starting with `-` refused before `git worktree add`. Reviewed and sound: the
  `prepare` shell command is the operator's own and shown in the parity preflight before launch;
  dod-lite runs nothing without a session file keyed to Claude Code's random session id, so a
  cloned repo cannot pre-plant checks; the SessionStart hook's injected text is no wider a channel
  than any repo's own CLAUDE.md.
- **Item 3, stranger dry run — closed, and it found the launch blocker.** Installed from the
  public repo into an isolated `CLAUDE_CONFIG_DIR`. Three findings, all fixed in `17b3ca2`:
  1. **Optimizer could not run at all from a GitHub install.** Local marketplaces load in place;
     GitHub ones copy each plugin into a versioned cache folder, and optimizer only looked for
     dod-lite as a plain sibling. `fire` refused to launch, `plan`'s probe crashed on import.
     Nobody but the author had ever installed it, and the author's install is local.
  2. The `owner/repo` shorthand clones over SSH and fails without a GitHub SSH key. README now
     gives the HTTPS URL.
  3. `claude plugin install` from a shell does not prompt for `experiments_root`. README now
     gives `--config experiments_root=<folder>` and `/optimizer:setup`.
  Re-run after the fix against the live repo: all four plugins install, `plugin update` delivers
  0.8.1, and both scripts get past dod-lite from the cached copy.
- **CI added** (`.github/workflows/ci.yml`): all suites on Windows, macOS and Linux, plus
  `test/smoke-window.mjs`, which opens a real terminal window through the real launcher with a
  stub `claude` that records the cwd, env and argv it arrived with. The first runs found two more
  defects, both fixed: a Windows path compare that broke whenever the experiments root was
  spelled differently from git's output (8.3 short names, casing), and the macOS launch using
  AppleScript, which needs Automation consent and hung without it. macOS now uses
  `open -a Terminal`, **verified in CI: a real Terminal.app window ran the arm with its cwd,
  env and argv intact.** Linux: **verified with xterm** under Xvfb. iTerm2 was dropped: handed a
  file with `open -a` it reported success and never ran it, which in a real run is a silent
  non-launch. Still unexercised: GNOME Terminal, Konsole and the other Linux emulators, and any
  Mac that is not a CI VM. First real use on those is still a smoke test.

## The plan

**Decided by the operator, 2026-09-22: launch as a demo that asks for help, not as a showcase.**
The message: built this a couple of months ago (first commit 2026-07-12); Claude Code now ships
its own `plugin eval`, which does not cover the interactive case; here it is, try it, tell me
where it breaks, help make it better. Feedback comes in through a form, so it is structured and
collected in one place instead of scattered through comment threads.

### 1. Sharpen the hook — DONE 2026-09-22 (`17b3ca2`)

README opens with the question, then a plain comparison with `claude plugin eval`: what it does
well, what Optimizer adds, and what Optimizer costs.

### 2. The feedback form — LIVE 2026-09-22

https://docs.google.com/forms/d/e/1FAIpQLSfINKyrAFuydl9SC-wNGceL_I-04cWqy7BkeQf0IJSwOKxFfg/viewform
(linked from the README). Responses land in the Sheet the form was created with.

The first version asked for opinions ("which would you reach for?", "what one change would make
you use it again?", "was it worth it?") and the operator threw it out: a survey is an interview,
and it follows Prospector's rule, behaviour over opinion. `launch/feedback-form.gs` rebuilds the
same form in place, same link.

The second version was still too thin ("too few questions… ALL ANGLES of what has been done, how
has been done, and how it felt"). The third branches. Question 1, "What did you do with it?",
routes each respondent to a section about what they actually did: only read it, install broke,
installed and idle, `/core:learn` only, Prospector, Optimizer. Prospector users are then asked
whether they also used Optimizer. Each path covers what they did, how they did it and how it felt,
step by step, and the form never asks the two things it exists to learn:

- **Does Prospector help develop a new plugin?** Read off: MVP built, times used on real work,
  still installed, the problem came back and the MVP handled it, the survey sent them to an
  existing tool, a real example ready versus a made-up one.
- **Does Optimizer help optimize one?** Read off: real-work task, runs fired, what they did after
  the report, whether the change came from the report or from what they saw themselves, certainty
  before and after, their own call against the report's.
- **Frustrated or happy?** Read off: feeling per step (grids), where they stopped and what was
  going on, the most frustrating moment and its kind, the best moment, what they did when lost.

Everyone ends on "About you" (usage, plugins written and installed, how they judged plugins
before, OS, where they found it) and one optional open question plus the chat opt-in. Paths run
15 to 64 questions, mostly clicks: about 2 minutes for someone who only read it, 6 for one
tool, 10 for both. The key to reading the answers is in the script's header comment. Rerun
`rebuildFeedbackForm` after editing the questions; it keeps the link.

### 3. The first real paired run

A demo with nothing to look at is an announcement. The post needs one real output: a real
`report.md` and a screenshot of the two arm windows side by side. This needs the operator in the
chair, working both arms. That is the method, and it is not something to delegate.

Recommended target: **superpowers** (`superpowers@claude-plugins-official`), the plugin both April
threads asked about. It is interactive (brainstorming, plan review), which is exactly the case
`plugin eval` cannot reach.

    claude plugin install superpowers@claude-plugins-official
    claude plugin disable superpowers@claude-plugins-official

(Installed so an arm can enable it; disabled so it stays out of every other session. Optimizer
enables it in the test arm only.) Then `/core:learn optimizer`, `/optimizer:setup`,
`/optimizer:init`, which interviews you for the rest, `/optimizer:plan`, `/optimizer:fire`,
work both arms on a task from your real work, and `/optimizer:analyze`. Whatever the report says
is what gets shown.

### 4. The launch post

- **Complement, not rival.** Say what `plugin eval` does well, then the gap. "Better than
  Anthropic's" from a solo developer draws the wrong thread.
- **Show the real output** from step 3.
- **State the cost up front:** two sessions of tokens plus your time per run, and the always-on
  token figures above.
- **Offer a cheap way in:** `/core:learn` takes minutes; Prospector works without Optimizer.
- **Two links only:** the repo and the form.
- **Channels:** `r/ClaudeCode` first. `r/ClaudeAI` a few days later with a different angle, not a
  crosspost. Show HN is legitimate for the repo itself now that a stranger can install and run it.
  Read each subreddit's rules by hand first.
- Be in the thread for the first hours; the form catches everything after.

Draft for `r/ClaudeCode`: `launch/reddit-post-claudecode.txt` (title on line 1). Written before the
first real run, so it shows no output yet; add the report screenshot when there is one. Do not
paste the same text into a second subreddit: Reddit's Responsible Builder Policy names "posting
identical or substantially similar content across subreddits" as spam.

**Posting is manual, by decision (checked 2026-09-22).** Reddit ended self-service API access on
2025-11-12; every new OAuth app needs approval under the Responsible Builder Policy, and
r/redditdev threads through 2026 report refusals even for one-account posting tools. The same
policy requires bots and AI agents to carry an app label and says "App accounts should solely be
used to perform app functions (no mixed use accounts)", which rules out an agent posting from the
operator's own account. Every Reddit MCP server that can post needs those API credentials.
Browser automation of the logged-in account is possible but puts the launch account at risk for
a two-paste job. Hacker News' official API has no submit endpoint. What is worth automating is
reading the thread afterwards, not writing to it.

### 5. List it

- Submit via `clau.de/plugin-directory-submission` (official Anthropic form).
- Check `claude-plugins-community`'s eligibility criteria and submit if eligible.
- Create a listing on `claudemarketplaces.com`.

### 6. Later: the findings post

Once there is a real run, its finding is a post of its own: lead with the plugin people already
use and what happened with a human in the loop, with the tool mentioned last. The upvote data
above says this is the format that travels. A negative or mixed finding is fine content; do not
massage it toward a better story.

### 7. Track real numbers only

GitHub stars, install signals if visible, directory submission approval/rejection, post
upvotes/comments, inbound DMs or issues. Log them below as they happen, dated.

## Definition of done

- Steps 1-5 executed (step 6, the findings post, when a real run gives it something to say).
- The Log section below has a dated entry for everything actually submitted or posted, and
  what came back.
- After roughly 3-4 weeks: one honest paragraph, written from the Log, usable as a CV bullet
  and as interview material regardless of outcome. A modest real outcome (a few hundred views,
  a handful of stars) is a legitimate, non-embarrassing result, don't inflate the writeup to
  make it sound bigger than the Log supports.

## Log

<!-- append dated entries here as steps complete, e.g.:
- 2026-08-27: submitted to clau.de/plugin-directory-submission, pending review.
- 2026-08-29: posted A/B findings on plugin X to r/ClaudeCode, 12 upvotes, 3 comments.
-->

- 2026-09-22 15:01 UTC: posted `launch/reddit-post-claudecode.txt` to r/ClaudeCode, flair "Built
  with Claude" (post `1wnbx12`). Removed by a moderator within the minute, before AutoModerator's
  standard welcome comment appeared, so almost certainly an AutoModerator rule rather than a human.
  Posted from u/ActiveTaste8720; the arctic-shift archive holds no other post or comment from that
  account, so it looked brand new to the sub. Context from the same archive (200 posts,
  2026-09-20 20:20 to 2026-09-22 15:01 UTC): 10 of 33 "Built with Claude" posts were removed,
  the highest rate of any flair. The sidebar's rule 5 sends simple project sharing to the weekly
  showcase thread and requires a standalone post to explain how Claude Code was used and what you
  learned; the draft did neither. Next: read the removal reason in the inbox, ask the mods, and
  do not repost the same text.
