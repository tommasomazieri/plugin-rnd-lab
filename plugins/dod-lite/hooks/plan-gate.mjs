#!/usr/bin/env node
// PreToolUse hook (matcher "ExitPlanMode").
// Soft nudge only, never blocks: if the planning skill hasn't been invoked
// this session, allow ExitPlanMode to proceed but attach additionalContext
// reminding Claude it exists. No permissionDecision is set, so this hook
// has no say over whether the tool call goes through — that's left to the
// user's normal ExitPlanMode approval.

import { isRecursionGuardActive, readStdinJSON, readSession, sessionFilePath, runFailOpen, printJSON } from './lib.mjs';

async function main() {
  if (isRecursionGuardActive()) return;

  const input = await readStdinJSON();
  const { session_id: sessionId, cwd } = input;
  if (!sessionId || !cwd) return;

  const session = await readSession(cwd, sessionId);
  // No session file is a dod-lite bug (SessionStart should have scaffolded
  // it) or dod-lite isn't installed for this project's SessionStart yet —
  // either way, fail open rather than warn about an unrelated plan.
  if (!session) return;
  if (session.planning_invoked) return;

  printJSON({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext:
        'dod-lite: the `dod-lite:planning` skill (Skill tool, skill id `dod-lite:planning`) has not ' +
        'been invoked this session. It interviews about the plan and decides whether it needs ' +
        'Definition-of-Done checks — it may legitimately decide none are needed. This is a reminder, ' +
        `not a requirement: this ExitPlanMode call is not blocked. State file: ${sessionFilePath(cwd, sessionId)}.`,
    },
  });
}

runFailOpen(main);
