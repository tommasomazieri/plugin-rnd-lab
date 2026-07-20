#!/usr/bin/env node
// SessionStart hook (matcher "*").
// Scaffolds .dod/ for this project and the session json for this session
// (create-if-absent, never overwrites — matters on --resume). On a
// source=resume fire that lands on a session id with no file yet, tries to
// migrate forward the most recently active session's DoD state first — works
// around a known Claude Code bug where resume sometimes hands SessionStart a
// new session_id instead of the resumed session's durable one (see lib.mjs
// findResumeDonor for the anthropics/claude-code issue numbers). Always
// injects a standing reminder to design DoD checks via plan mode; this is the
// whole answer to "sessions should start in plan mode" since no hook can
// force the startup permission mode.

import {
  isRecursionGuardActive,
  readStdinJSON,
  ensureDodScaffold,
  createSessionIfAbsent,
  findResumeDonor,
  migrateSession,
  touchSessionTitle,
  pathExists,
  sessionFilePath,
  runFailOpen,
  printJSON,
} from './lib.mjs';

async function main() {
  if (isRecursionGuardActive()) return;

  const input = await readStdinJSON();
  const { session_id: sessionId, cwd, source, session_title: title } = input;
  if (!sessionId || !cwd) return;

  await ensureDodScaffold(cwd);

  let resumedFrom = null;
  if (source === 'resume' && !(await pathExists(sessionFilePath(cwd, sessionId)))) {
    const donor = await findResumeDonor(cwd, sessionId, title);
    if (donor) {
      await migrateSession(cwd, donor, sessionId, title);
      resumedFrom = donor.id;
    }
  }

  await createSessionIfAbsent(cwd, sessionId, title);
  if (title) await touchSessionTitle(cwd, sessionId, title);

  const sessFile = sessionFilePath(cwd, sessionId);

  printJSON({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: resumedFrom
        ? 'dod-lite: this resume landed on a new session id distinct from the one you resumed ' +
          `(${resumedFrom}) — a known Claude Code resume/fork quirk. Its DoD state (checks, ` +
          `history, goal) was migrated forward automatically; the old file is now marked ` +
          `superseded_by and frozen. This session's DoD state file is at ${sessFile}.`
        : 'This project uses dod-lite for Definition-of-Done tracking. Before starting ' +
          'implementation, consider entering plan mode and invoking the `dod-lite:planning` ' +
          'skill to interview about this session\'s goal and design its DoD checks ' +
          `(script/AI-graded/human-judged). This session's DoD state file is at ${sessFile} ` +
          '(the planning skill reads/writes it directly). If you skip plan mode entirely, ' +
          'dod-lite stays inactive for this session — nothing is enforced.',
    },
  });
}

runFailOpen(main);
