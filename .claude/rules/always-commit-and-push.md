# Rule: Always Commit and Push When Work Is Done

**MANDATORY. NO EXCEPTIONS. DO NOT ASK.**

When you finish a piece of work in this repo, commit it and push it. Do not ask permission.
Do not end a response with "nothing committed" or "say the word and I'll commit." Just do it.

## Required

1. Stage the work, write a real commit message, commit.
2. Push.
3. Report the commit hash as part of normal completion. One line.

If on the default branch (`master`) and the change is substantial, branch first — but still
commit and push without asking.

## Forbidden

- "Nothing has been committed." / "Nothing committed."
- "Let me know if you'd like me to commit."
- "Should I commit this?"
- Ending a completed task with the work only on disk.

## Why

**Git IS the undo button.** That is the entire point of version control. If the user dislikes
the work, `git revert` / `git reset` costs them one command. Asking permission first costs them
a round trip, every single time, forever — and it protects against nothing, because the commit
was never the irreversible step.

Stated by the user 2026-08-02, after being asked one time too many: *"VERSIONING IS THE WHOLE
POINT — IF I DON'T LIKE WHAT YOU DID WE CAN GO BACK FROM GIT. STOP ASKING ME. COMMIT. ALWAYS,
AND PUSH."*

This rule **overrides** the default "commit or push only when the user asks." That default
exists for repos where the user has not opted in. This one has.

## The genuinely irreversible things still need confirmation

This rule covers commit and push to this repo. It does not extend to: `push --force`, history
rewrites on shared branches, deleting branches or tags, publishing releases, or anything that
leaves git and reaches an outside audience.
