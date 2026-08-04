// Handoff to the Optimizer.
//
// `/optimizer:understand` interviews seven categories to produce mandate.md. A finished
// Prospector engagement has already established SIX of them over the whole engagement, so
// re-interviewing would ask the user everything they just spent an engagement answering.
//
//   1 Domain / environment        <- user & stakeholder model
//   2 Capability gap              <- problem statement + current alternatives and failure modes
//   3 Target user & workflow      <- user & stakeholder model
//   4 Definition of a good outcome<- needs & desired outcomes + measurable success criteria
//   5 Non-goals                   <- constraints & non-goals
//   6 Appropriate task complexity <- NOTHING. Optimizer-specific: it is about A/B signal
//                                     strength, not about the problem. Left for understand.
//   7 Known weak spots            <- ranked hypotheses + unresolved risks
//
// MECHANISM. There is no supported way for one plugin to read another's install directory —
// `dependencies` buys co-installation, not code access, and `CLAUDE_PLUGIN_ROOT` is always the
// invoking plugin's own root. So this writes plain files into its OWN cwd at the path the
// Optimizer already looks in. It is a filesystem contract in a shared working dir, needing zero
// cross-plugin access.
//
// It deliberately writes NEITHER state.json NOR env.json: those need `experiments_root`, which
// is the Optimizer's userConfig and none of Prospector's business. `/optimizer:init`'s
// `create-fresh` only mkdirs and writes state.json — it never touches mandate.md — so nothing
// here is clobbered when the user runs it afterwards.

import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import path from 'node:path';

export const AB_BENCH_DIR = '.ab-bench';

/** mandate-1 on a fresh dir; otherwise whatever the Optimizer already considers current. */
export function resolveMandateId(root) {
  try {
    const state = JSON.parse(fsSync.readFileSync(path.join(root, AB_BENCH_DIR, 'state.json'), 'utf8'));
    if (state.current_mandate) return state.current_mandate;
  } catch { /* no experiment here yet — the normal case at first handoff */ }
  return 'mandate-1';
}

const section = (title, body) => `## ${title}\n\n${(body ?? '').trim() || '_(not established)_'}\n\n`;

export function renderMandate(payload, { pluginName, mandateId }) {
  return (
    `# ${pluginName} — plugin mandate (${mandateId})\n` +
    `Plugin under test: ${pluginName} | Last updated: ${new Date().toISOString().slice(0, 10)}\n` +
    `\n> Authored by Prospector from design package ${payload.package_version}. Six of the seven\n` +
    `> categories are carried over from the engagement's evidence rather than re-interviewed.\n` +
    `> "Appropriate task complexity" is deliberately left open — it is about A/B signal strength,\n` +
    `> not about the problem, so nothing in the engagement answers it.\n\n` +
    section('Domain / environment', payload.domain) +
    section('Capability gap', payload.capability_gap) +
    section('Target user & workflow', payload.target_user) +
    section('Definition of a good outcome', payload.good_outcome) +
    section('Non-goals (explicitly out of scope)', payload.non_goals) +
    '## Appropriate task complexity\n\n' +
    '_NOT ESTABLISHED — `/optimizer:understand` must ask for this._ Too trivial and neither arm\n' +
    'shows a difference; too complex and failures come from confounds unrelated to the plugin.\n' +
    'Nothing in a discovery engagement answers it, so it is not guessed here.\n\n' +
    section('Known weak spots to stress-test', payload.weak_spots)
  );
}

export function renderRubric(payload, { pluginName }) {
  const dims = payload.rubric ?? [];
  const total = dims.reduce((a, d) => a + Number(d.weight || 0), 0);
  if (dims.length === 0) return null;
  if (Math.abs(total - 1) > 0.001) {
    throw new Error(`rubric weights must sum to 1, got ${total.toFixed(3)}`);
  }
  return (
    `# ${pluginName} — quality rubric (rubric_version: v1)\n\n` +
    `> Derived by Prospector from the design package's ranked desired outcomes and known weak\n` +
    `> spots. Bumping rubric_version later forks the quality trajectory — scores either side of\n` +
    `> a bump are on different scales and must never be plotted as one curve.\n\n` +
    dims
      .map(
        (d) =>
          `## ${d.dimension}   weight: ${d.weight}\n` +
          `evidence_sources: ${d.evidence_sources ?? '(unspecified)'}\n\n` +
          (d.anchors ?? []).map((a) => `- ${a}`).join('\n') +
          '\n',
      )
      .join('\n')
  );
}

/**
 * Writes mandate.md (+ quality-rubric.md when a rubric was supplied) into `.ab-bench/<id>/`.
 * Refuses to overwrite an existing mandate: if the Optimizer already has one, that is a live
 * experiment's north star and silently replacing it would retroactively change what every past
 * run was measured against.
 */
export async function writeHandoff(root, payload, { force = false } = {}) {
  const pluginName = path.basename(path.resolve(root));
  const mandateId = resolveMandateId(root);
  const dir = path.join(root, AB_BENCH_DIR, mandateId);
  const mandateFile = path.join(dir, 'mandate.md');
  const rubricFile = path.join(dir, 'quality-rubric.md');

  if (!force && fsSync.existsSync(mandateFile)) {
    throw new Error(
      `${path.join(AB_BENCH_DIR, mandateId, 'mandate.md')} already exists.\n` +
        '  That is a live experiment\'s north star — every past run was planned and analysed\n' +
        '  against it. Re-run with --force only if you mean to replace it, or run\n' +
        '  /optimizer:init and pick "new mandate" if the purpose genuinely changed.',
    );
  }

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(mandateFile, renderMandate(payload, { pluginName, mandateId }), 'utf8');

  const rubric = renderRubric(payload, { pluginName });
  if (rubric) await fs.writeFile(rubricFile, rubric, 'utf8');

  return { mandateId, mandateFile, rubricFile: rubric ? rubricFile : null, pluginName };
}
