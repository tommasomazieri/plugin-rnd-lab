# Where to launch plugin-rnd-lab

Measured 2026-09-23 from the arctic-shift Reddit archive, the Discord invite API and the GitHub
API. Removal rates are the share of recent posts removed, sampled in two separate windows per
subreddit so a mod-queue snapshot cannot explain them.

## Do today, no gate

**1. Anthropic's Discord** — `discord.gg/anthropic`, server "Claude", 128,174 members, 20,878
online when measured. No reputation gate. Join, find the showcase or projects channel, read its
pinned rules, post `discord-claude-server.txt`.

**2. The r/ClaudeCode weekly showcase thread** — a comment in the stickied AutoModerator thread,
not a post. 33 comments in its first day and a half; of the 24 people whose comments survived, 5
had under 30 days of Reddit history and one had a single day. The filter that removed the launch
post does not apply to comments there, and people do share plugins in it. Post
`reddit-showcase-comment.txt`.

**3. awesome-claude-code** — 54,445 stars, submission by issue form, GitHub account only, no
reputation needed. Resource issues were closed on 21 and 22 September, so the queue moves despite
1,108 open. The repo qualifies (older than 14 days, actively developed). Values to paste:
`awesome-claude-code-submission.txt`.

## Reddit posting: about three weeks away

The thresholds are not published: not in the sidebar, not in the removal message, not findable on
the web. So it was measured instead. Of the 30 people whose **posts** survived in r/ClaudeCode
over two days:

- the youngest account had **20 days** of archived history and **31 comments** in the last 90 days;
- only 1 of the 30 was under 30 days old;
- nobody younger than 20 days got a post through.

**Getting there: comment, don't post.** Three or four real answers a day in r/ClaudeCode and
r/ClaudeAI, plus the showcase comment, which doubles as the launch. A useful answer earns
single-digit to low-double-digit karma, so two weeks of that clears any normal automod threshold
at about the same time the account passes 20 to 30 days. The karma number itself is an estimate;
only the age data is measured.

## The numbers

| where | posts removed | new accounts surviving |
|---|---|---|
| r/LLMDevs | 15-29% | 2 of 25, youngest 13 days |
| r/LocalLLaMA | 17-18% | not sampled |
| r/ClaudeCode | 20-29% | posts: no. Comments in the weekly thread: yes, youngest 1 day |
| r/AI_Agents | 36-38% | 2 of 25, youngest 3 days |
| r/SideProject | 55-73% | 4 of 25, youngest 0 days |
| r/ChatGPTCoding | 65-83% | — |
| r/vibecoding | 73-84% | — |
| r/opensource | 93-97%, mostly moderator | — |
| r/ClaudeAI | 97-98%, automod-filtered | none under 90 days |

Most removals in r/LLMDevs and r/SideProject come from Reddit's own site-wide spam filter rather
than the mods, and that filter is harder on new accounts posting links. Expect to lose one.

## What to skip

- **r/ClaudeAI, r/opensource, r/vibecoding, r/ChatGPTCoding.** Between two thirds and 98% of
  everything posted is removed, in every window sampled.
- **r/LLMDevs** unless the angle is the method rather than the tool. Best odds of any sub
  (15-29%), wrong audience for a Claude Code plugin. Draft kept at `reddit-llmdevs-post.txt`.
- **dev.to and Hashnode**, except for search traffic: 100 articles tagged `#claude` in 30 days,
  median 0 reactions and 0 comments. `#claudecode` the same.
- **"Show and tell" GitHub Discussions** on davila7/claude-code-templates (31k stars) and
  wshobson/agents (40k stars): recent posts sit at 1 upvote and 0 comments.
- **Show HN** (closed to new accounts since June), **Lobsters** (invite only),
  **community.anthropic.com** (does not exist).
- **Paid placement.** claudemarketplaces.com sells one slot at $1,499/month, sold out, and its own
  FAQ says narrow tools underperform there. EthicalAds needs $1,000 minimum. Reddit Ads would work
  from $5/day and skips the karma problem, but it buys views of a repo nobody has vouched for yet.

## The texts

| file | goes where |
|---|---|
| `discord-claude-server.txt` | the Claude Discord showcase channel |
| `reddit-showcase-comment.txt` | r/ClaudeCode weekly showcase thread, as a comment |
| `awesome-claude-code-submission.txt` | the awesome-claude-code issue form, field by field |
| `reddit-llmdevs-post.txt` | r/LLMDevs, method-first, only if that angle is wanted |
| `reddit-post-claudecode.txt` | r/ClaudeCode, once the account clears the gate; rewrite to rule 5 first |

Results go in `LAUNCH_PLAN.md`'s log, dated, real numbers only.
