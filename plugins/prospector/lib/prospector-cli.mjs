#!/usr/bin/env node
// The CLI every Prospector skill drives. Keeping the state transitions in one testable place
// means a skill never hand-edits JSON, and the record cannot drift into a shape nothing reads.

import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  findRoot, paths, scaffold, readState, writeState, setStage,
  readHypotheses, addHypothesis, resolveHypothesis, rankHypotheses,
  addEvidence, addFraming, addDecision, cutPackage, packageDir,
  STAGES, STATUSES, OUTCOMES,
} from './prospector.mjs';
import { writeHandoff } from './handoff.mjs';

const out = (o) => console.log(JSON.stringify(o, null, 2));
const die = (m) => { console.error(`[prospector] ERROR: ${m}`); process.exit(1); };

function flags(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { f[key] = true; continue; }
    f[key] = next;
    i++;
  }
  return f;
}

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8', shell: false });

function requireRoot(dir) {
  const root = findRoot(dir);
  if (!root) {
    die(
      `no .prospector/ found at or above ${path.resolve(dir)}.\n` +
        '  Prospector works in place, inside the directory the future plugin will live in.\n' +
        '  Create an empty dir, launch Claude Code inside it, and run /prospector:start.',
    );
  }
  return root;
}

// ---------------------------------------------------------------- commands

async function cmdInit(dir, f) {
  const root = path.resolve(dir);
  await fs.mkdir(root, { recursive: true });

  // Git is not optional. `.prospector/` is tracked — that is what gives the engagement a real
  // version history — and the Optimizer's artifact pinning is built on git, so a non-repo dir
  // could never be handed off.
  const isRepo = git(root, ['rev-parse', '--is-inside-work-tree']).status === 0;
  if (!isRepo) git(root, ['init']);

  const existed = fsSync.existsSync(paths(root).state);
  await scaffold(root, { issue: typeof f.issue === 'string' ? f.issue : null });
  out({
    status: existed ? 'existing' : 'created',
    root,
    git: isRepo ? 'already a repo' : 'git init run',
    ...paths(root),
    state: await readState(root),
  });
}

async function cmdDetect(dir) {
  const root = findRoot(dir);
  if (!root) return out({ status: 'fresh' });
  const state = await readState(root);
  const doc = await readHypotheses(root);
  const pkgDir = paths(root).packages;
  const packages = (await fs.readdir(pkgDir).catch(() => [])).filter((d) => /^v\d+$/.test(d));
  out({
    status: 'existing',
    root,
    ...paths(root),
    state,
    open_hypotheses: doc.hypotheses.filter((h) => h.status !== 'resolved').length,
    resolved_hypotheses: doc.hypotheses.filter((h) => h.status === 'resolved').length,
    evidence_count: (await fs.readdir(paths(root).evidence).catch(() => [])).filter((x) => x.endsWith('.md')).length,
    packages: packages.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))),
    handoff_written: fsSync.existsSync(path.join(root, '.ab-bench')),
  });
}

async function cmdStage(dir, f) {
  const root = requireRoot(dir);
  out(await setStage(root, f.to));
}

async function cmdHypothesis(dir, sub, f) {
  const root = requireRoot(dir);
  if (sub === 'add') {
    out(await addHypothesis(root, {
      statement: f.statement, assumption: f.assumption, why: f.why, expected: f.expected,
      validation: f.validation, success: f.success, failure: f.failure,
      confidence: f.confidence === undefined ? undefined : Number(f.confidence),
    }));
  } else if (sub === 'resolve') {
    out(await resolveHypothesis(root, f.id, f.outcome, f.note));
  } else if (sub === 'rank') {
    out(rankHypotheses(await readHypotheses(root)));
  } else if (sub === 'list') {
    out((await readHypotheses(root)).hypotheses);
  } else {
    die(`unknown hypothesis subcommand "${sub}" (add|resolve|rank|list)`);
  }
}

async function cmdEvidence(dir, f) {
  const root = requireRoot(dir);
  out(await addEvidence(root, {
    text: f.text,
    status: f.status,
    source: f.source,
    hypotheses: typeof f.hypotheses === 'string' ? f.hypotheses.split(',').map((s) => s.trim()).filter(Boolean) : [],
  }));
}

async function cmdFraming(dir, f) {
  const root = requireRoot(dir);
  out(await addFraming(root, {
    statement: f.statement, killed_by: f['killed-by'], target: f.target, need: f.need, outcome: f.outcome,
  }));
}

async function cmdDecision(dir, f) {
  const root = requireRoot(dir);
  await addDecision(root, { text: f.text, why: f.why });
  out({ ok: true });
}

async function cmdPackage(dir, f) {
  const root = requireRoot(dir);
  const res = await cutPackage(root, {
    changed: f.changed, why: f.why, evidence: f.evidence,
    unresolved: f.unresolved, confidence: f.confidence,
  });
  out({
    ...res,
    write_package_md_to: path.join(res.dir, 'package.md'),
    note:
      `Package v${res.version} pairs with MVP plugin v${res.version} — bump the MVP's ` +
      'plugin.json version to match, then /plugin update to put it back in the user\'s hands.',
  });
}

async function cmdHandoff(dir, f) {
  const root = requireRoot(dir);
  if (!f.payload) die('--payload <file.json> is required');
  let payload;
  try {
    payload = JSON.parse(await fs.readFile(path.resolve(f.payload), 'utf8'));
  } catch (e) {
    die(`could not read handoff payload: ${e.message}`);
  }
  const state = await readState(root);
  if (!state.package_version) {
    die('nothing to hand off — no design package has been cut yet. Run /prospector:build first.');
  }
  payload.package_version = `v${state.package_version}`;
  try {
    const res = await writeHandoff(root, payload, { force: Boolean(f.force) });
    out({ ...res, next: 'Run /optimizer:init here. understand will confirm and ask only for task complexity.' });
  } catch (e) {
    die(e.message);
  }
}

// ---------------------------------------------------------------- entry

const HELP = `prospector-cli <command> <dir> [flags]

  init       --issue "<stated issue>"      git init + scaffold .prospector/
  detect                                    resolve state from cwd (walks up)
  stage      --to <${STAGES.join('|')}>
  hypothesis add|resolve|rank|list
             add:     --statement --assumption --why --expected --validation
                      --success --failure --confidence
             resolve: --id H-001 --outcome <${OUTCOMES.join('|')}> --note
  evidence   --text --status <${STATUSES.join('|')}> --source --hypotheses H-001,H-002
  framing    --statement --target --need --outcome --killed-by
  decision   --text --why
  package    --changed --why --evidence --unresolved --confidence
  handoff    --payload <file.json> [--force]
`;

async function main() {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd || cmd === '--help' || cmd === '-h') { console.log(HELP); return; }

  const positional = rest.filter((a) => !a.startsWith('--'));
  const f = flags(rest);
  const isHypothesis = cmd === 'hypothesis';
  const dir = (isHypothesis ? positional[1] : positional[0]) ?? process.cwd();

  switch (cmd) {
    case 'init': return cmdInit(dir, f);
    case 'detect': return cmdDetect(dir);
    case 'stage': return cmdStage(dir, f);
    case 'hypothesis': return cmdHypothesis(dir, positional[0], f);
    case 'evidence': return cmdEvidence(dir, f);
    case 'framing': return cmdFraming(dir, f);
    case 'decision': return cmdDecision(dir, f);
    case 'package': return cmdPackage(dir, f);
    case 'handoff': return cmdHandoff(dir, f);
    default: die(`unknown command "${cmd}"\n\n${HELP}`);
  }
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main().catch((e) => die(e.stack || e.message));

export { main };
