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

## The plan

### 1. Sharpen the hook

Rewrite the opening of `README.md`. It currently leads with marketplace mechanics (two
instruments, a table). Lead with the pain instead, one sentence, before any of that:
"Does your Claude Code plugin actually help, or does it just feel that way?" Keep everything
else in the README as is, it's accurate and thorough, it just doesn't front-load the hook.

### 2. List it

- Submit via `clau.de/plugin-directory-submission` (official Anthropic form).
- Check `claude-plugins-community`'s eligibility criteria and submit if eligible.
- Create a listing on `claudemarketplaces.com`.

### 3. Prove it, don't announce it

This is the actual distribution lever, not steps 1-2. Run Optimizer as a real A/B test
against one or two other public, well-known Claude Code plugins (or against Prospector
itself, dogfooding counts and is honest). Write up the resulting evidence-backed report as a
public post: "I ran a controlled A/B test on plugin X, here's the evidence on whether it
actually helps." Lead with the finding, whatever it turns out to be, not with the tool that
produced it. A negative or mixed finding is fine content, do not massage the result toward a
better story.

### 4. Distribute the findings post

Post the step-3 writeup (not a launch announcement) to Show HN, `r/ClaudeCode`, and
X/dev-Twitter.

### 5. Track real numbers only

GitHub stars, install signals if visible, directory submission approval/rejection, post
upvotes/comments, inbound DMs or issues. Log them below as they happen, dated.

## Definition of done

- Steps 1-4 executed.
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
