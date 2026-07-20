#!/usr/bin/env node
// UserPromptSubmit hook (matcher "*").
// Soft nudge only: while in plan mode and the planning skill hasn't run yet
// this session, remind Claude to invoke it. Uses additionalContext, not
// decision:block — UserPromptSubmit's block reason does not route back to
// Claude, it just ends the turn with a warning banner to the user.

import { isRecursionGuardActive, readStdinJSON, readSession, sessionFilePath, runFailOpen, printJSON } from './lib.mjs';

async function main() {
  if (isRecursionGuardActive()) return;

  const input = await readStdinJSON();
  const { session_id: sessionId, cwd, permission_mode: permissionMode } = input;
  if (!sessionId || !cwd) return;
  if (permissionMode !== 'plan') return;

  const session = await readSession(cwd, sessionId);
  if (!session || session.planning_invoked) return;

  printJSON({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext:
        'Reminder: you are in plan mode and have not yet invoked the `dod-lite:planning` ' +
        'skill this session. Invoke it (Skill tool, skill id `dod-lite:planning`) before ' +
        'presenting an implementation plan — it interviews about the plan and designs this ' +
        `session's Definition-of-Done checks. Its state file is ${sessionFilePath(cwd, sessionId)}. ` +
        'This is a reminder only — nothing blocks you from skipping it if this session doesn\'t need it.',
    },
  });
}

runFailOpen(main);
