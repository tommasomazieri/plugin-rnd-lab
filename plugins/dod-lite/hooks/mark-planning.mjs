#!/usr/bin/env node
// PostToolUse hook (matcher "Skill").
// Fires as soon as the planning skill is *invoked*, not when the interview
// finishes — that's what the ExitPlanMode gate actually needs to know.
//
// The Skill tool's input parameter is named `skill` (confirmed against the
// tool's own schema: {skill: string, args?: string}). Match on that primarily;
// fall back to a substring scan of the whole tool_input in case a future
// Claude Code version renames the field.

import { isRecursionGuardActive, readStdinJSON, readSession, writeSession, runFailOpen } from './lib.mjs';

const SKILL_ID = 'dod-lite:planning';

function invokedPlanningSkill(toolInput) {
  if (!toolInput) return false;
  if (toolInput.skill === SKILL_ID) return true;
  // Fallback: skills-dir/unscoped install, or a renamed field.
  const serialized = JSON.stringify(toolInput);
  return serialized.includes(SKILL_ID) || /["']planning["']/.test(serialized);
}

async function main() {
  if (isRecursionGuardActive()) return;

  const input = await readStdinJSON();
  const { session_id: sessionId, cwd, tool_name: toolName, tool_input: toolInput } = input;
  if (!sessionId || !cwd) return;
  if (toolName !== 'Skill') return;
  if (!invokedPlanningSkill(toolInput)) return;

  const session = await readSession(cwd, sessionId);
  if (!session || session.planning_invoked) return;

  session.planning_invoked = true;
  await writeSession(cwd, sessionId, session);
}

runFailOpen(main);
