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
  readHypotheses, addHypothesis, resolveHypothesis, rankHypotheses, packageVerdict,
  readNeeds, addNeed, coverNeed, deferNeed, withdrawNeed, reopenNeed, rankNeeds, blockingNeeds,
  addEvidence, addFraming, addDecision, cutPackage, packageDir,
  STAGES, STATUSES, OUTCOMES, NEED_KINDS, NEED_IMPORTANCE,
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

/**
 * Finds the Optimizer's analysed runs, if any have been fired since the handoff.
 *
 * Reading `.ab-bench/state.json` is the mirror image of what `/prospector:handoff` already does
 * when it writes `mandate.md` into that same directory: a filesystem contract in the shared
 * working dir. There is still no code dependency in either direction, and there cannot be — a
 * plugin cannot reach another plugin's install directory.
 *
 * The runs themselves live in the Optimizer's testenv, whose location prospector has no way to
 * guess (`experiments_root` is the Optimizer's userConfig). `state.json.testenv_root` is the only
 * bridge, which is why this returns nothing rather than searching when the file is absent.
 */
async function optimizerRuns(root) {
  const stateFile = path.join(root, '.ab-bench', 'state.json');
  let abState;
  try {
    abState = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  } catch {
    return { testenv_root: null, analyzed_runs: [] };
  }
  const base = abState.testenv_root;
  if (!base || !fsSync.existsSync(base)) return { testenv_root: base ?? null, analyzed_runs: [] };

  // Scan every mandate/env, not just the current one — a re-entry wants everything the Optimizer
  // has ever learned about this plugin, and `state.json`'s pointer only ever moves forward.
  const analyzed = [];
  const dirs = async (p) => (await fs.readdir(p, { withFileTypes: true }).catch(() => []))
    .filter((d) => d.isDirectory()).map((d) => d.name);
  for (const m of await dirs(base)) {
    if (!/^mandate-\d+$/.test(m)) continue;
    for (const e of await dirs(path.join(base, m))) {
      if (!/^env-\d+$/.test(e)) continue;
      const runsDir = path.join(base, m, e, 'runs');
      for (const r of await dirs(runsDir)) {
        if (!/^run-\d+$/.test(r)) continue;
        const report = path.join(runsDir, r, 'analysis', 'report.md');
        if (fsSync.existsSync(report)) {
          analyzed.push({
            run: r,
            mandate: m,
            env: e,
            report,
            fix_list: path.join(runsDir, r, 'analysis', 'fix-list.md'),
          });
        }
      }
    }
  }
  analyzed.sort((a, b) => a.run.localeCompare(b.run));
  return {
    testenv_root: base,
    lab: path.join(base, abState.current_mandate ?? 'mandate-1', abState.current_env ?? 'env-1', 'lab'),
    ledger: path.join(base, abState.current_mandate ?? 'mandate-1', abState.current_env ?? 'env-1', 'ledger.md'),
    analyzed_runs: analyzed,
  };
}

async function cmdDetect(dir) {
  const root = findRoot(dir);
  if (!root) return out({ status: 'fresh' });
  const state = await readState(root);
  const doc = await readHypotheses(root);
  const needsDoc = await readNeeds(root);
  const pkgDir = paths(root).packages;
  const packages = (await fs.readdir(pkgDir).catch(() => [])).filter((d) => /^v\d+$/.test(d));
  const opt = await optimizerRuns(root);
  const blocking = blockingNeeds(needsDoc);

  // `post-optimizer` means a full cycle has closed: something was built, handed off, and measured.
  // That is a different engagement from `existing` — the problem is no longer unknown, so
  // /prospector:reenter ranks by value rather than by expected learning, and the blueprint is
  // revised rather than authored. Both conditions are required: a handoff with no analysed run
  // has produced no new evidence to re-enter ON.
  const postOptimizer = opt.analyzed_runs.length > 0 && fsSync.existsSync(paths(root).blueprint);

  out({
    status: postOptimizer ? 'post-optimizer' : 'existing',
    root,
    ...paths(root),
    state,
    open_hypotheses: doc.hypotheses.filter((h) => h.status !== 'resolved').length,
    resolved_hypotheses: doc.hypotheses.filter((h) => h.status === 'resolved').length,
    evidence_count: (await fs.readdir(paths(root).evidence).catch(() => [])).filter((x) => x.endsWith('.md')).length,
    packages: packages.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))),
    // Surfaced on every skill's first call, because the package that never came back is the
    // one thing that silently invalidates whatever the next stage is about to conclude.
    current_package_reviewed: (await packageVerdict(root, state.package_version ?? 0)).closed,
    handoff_written: fsSync.existsSync(path.join(root, '.ab-bench')),
    blueprint_written: fsSync.existsSync(paths(root).blueprint),
    // The breadth gate's state, reported BEFORE a cut is attempted, for the same reason
    // current_package_reviewed is: an agent that discovers it at `package` time has already
    // written the MVP against the wrong scope.
    needs_total: needsDoc.needs.length,
    needs_open: needsDoc.needs.filter((n) => n.status === 'open').length,
    needs_deferred: needsDoc.needs.filter((n) => n.status === 'deferred').length,
    needs_blocking_a_cut: blocking.map((n) => n.id),
    optimizer: opt,
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

async function cmdNeeds(dir, sub, f) {
  const root = requireRoot(dir);
  const ids = (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
  try {
    if (sub === 'add') {
      out(await addNeed(root, {
        statement: f.statement,
        verbatim: f.verbatim,
        evidence: ids(f.evidence),
        kind: f.kind,
        importance: f.importance,
        confidence: f.confidence === undefined ? undefined : Number(f.confidence),
      }));
    } else if (sub === 'cover') {
      out(await coverNeed(root, f.id, typeof f.version === 'string' ? f.version : undefined));
    } else if (sub === 'defer') {
      out(await deferNeed(root, f.id, typeof f.reason === 'string' ? f.reason : null));
    } else if (sub === 'withdraw') {
      out(await withdrawNeed(root, f.id, typeof f.reason === 'string' ? f.reason : null));
    } else if (sub === 'reopen') {
      out(await reopenNeed(root, f.id));
    } else if (sub === 'rank') {
      out(rankNeeds(await readNeeds(root)));
    } else if (sub === 'list') {
      const doc = await readNeeds(root);
      out({ needs: doc.needs, blocking_a_cut: blockingNeeds(doc).map((n) => n.id) });
    } else {
      die(`unknown needs subcommand "${sub}" (add|list|rank|cover|defer|withdraw|reopen)`);
    }
  } catch (e) {
    die(e.message);
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
  let res;
  try {
    res = await cutPackage(root, {
      changed: f.changed, why: f.why, evidence: f.evidence,
      unresolved: f.unresolved, confidence: f.confidence,
      unreviewed_reason: f['unreviewed-reason'],
    });
  } catch (e) {
    die(e.message);
  }
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
  needs      add|list|rank|cover|defer|withdraw|reopen
             add:     --statement --verbatim --evidence E-001,E-004
                      --kind <${NEED_KINDS.join('|')}> --importance <${NEED_IMPORTANCE.join('|')}>
                      --confidence      (stated/observed REQUIRE --evidence)
             cover:   --id N-001 [--version v2]
             defer:   --id N-001 --reason "<why not this version>"   refuses without it
             rank:    by VALUE (importance x provenance x confidence) — NOT the
                      inverted-confidence learning ranking "hypothesis rank" uses
  evidence   --text --status <${STATUSES.join('|')}> --source --hypotheses H-001,H-002
  framing    --statement --target --need --outcome --killed-by
  decision   --text --why
  package    --changed --why --evidence --unresolved --confidence
             [--unreviewed-reason "<why vN-1 was never reviewed>"]  refuses without it
             also refuses while any core stated need is neither covered nor deferred
  handoff    --payload <file.json> [--force]
`;

async function main() {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd || cmd === '--help' || cmd === '-h') { console.log(HELP); return; }

  const positional = rest.filter((a) => !a.startsWith('--'));
  const f = flags(rest);
  // `hypothesis` and `needs` take a subcommand before the dir, every other command takes the dir
  // first. Keep this list in sync with the switch below or the dir silently becomes the subcommand.
  const hasSubcommand = cmd === 'hypothesis' || cmd === 'needs';
  const dir = (hasSubcommand ? positional[1] : positional[0]) ?? process.cwd();

  switch (cmd) {
    case 'init': return cmdInit(dir, f);
    case 'detect': return cmdDetect(dir);
    case 'stage': return cmdStage(dir, f);
    case 'hypothesis': return cmdHypothesis(dir, positional[0], f);
    case 'needs': return cmdNeeds(dir, positional[0], f);
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
