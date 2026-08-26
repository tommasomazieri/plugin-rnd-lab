// resolve-baseline -> launch-pair, end to end, against real repos and real workspaces.
// The backward-compatibility test here is the most important one in the suite: every
// existing experiment must keep working with no config change.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  SCRIPTS,
  makeRepo,
  makePluginRepo,
  makeEnvPair,
  makeRun,
  cleanupAll,
  write,
  commitAll,
  tag,
  node,
  nodeExpectFail,
  readJson,
} from './helpers.mjs';
import { launchScriptExt } from '../skills/fire/scripts/terminal.mjs';

const LAUNCH_EXT = launchScriptExt();
const IS_WINDOWS = process.platform === 'win32';

test.after(cleanupAll);

const MODEL = 'claude-sonnet-5';

function baseEnv(extra) {
  return { schema: 1, experiment: 'test-exp', model: MODEL, mode: 'interactive', ...extra };
}

test('schema 1: env.json with only pluginUnderTestRepo still resolves and fires', () => {
  const repo = makePluginRepo('demo');
  const { configRoot, testenvRoot } = makeEnvPair(baseEnv({ pluginUnderTestRepo: repo }));
  const runDir = makeRun(testenvRoot);

  node(SCRIPTS.resolveBaseline, [configRoot, testenvRoot, runDir]);
  const baseline = readJson(path.join(runDir, 'baseline.json'));
  assert.equal(baseline.schema, 2);
  const controlPins = Object.values(baseline.arms.control.pins);
  assert.equal(controlPins.length, 1, 'the single legacy repo became exactly one artifact');
  assert.equal(controlPins[0].deliver, 'plugin-dir');

  node(SCRIPTS.launchPair, [configRoot, testenvRoot, '--dry-run']);
  const parity = readJson(path.join(runDir, '.launch', 'parity-report.json'));
  assert.ok(parity.pins.control.length === 1 && parity.pins.test.length === 1);
  assert.equal(parity.pins_symmetric, true, 'both arms unpinned means both are at HEAD');
});

test('schema 1: --vanilla gives control no artifacts at all', () => {
  const repo = makePluginRepo('demo');
  const { configRoot, testenvRoot } = makeEnvPair(baseEnv({ pluginUnderTestRepo: repo }));
  const runDir = makeRun(testenvRoot);

  node(SCRIPTS.resolveBaseline, [configRoot, testenvRoot, runDir, '--vanilla']);
  const baseline = readJson(path.join(runDir, 'baseline.json'));
  assert.deepEqual(baseline.arms.control.pins, {}, 'vanilla = nothing pinned, not "pinned to nothing in particular"');
  assert.equal(Object.keys(baseline.arms.test.pins).length, 1);
});

test('schema 1: --ref pins control to a tag and its plugin dirs reach the launch config', () => {
  const repo = makePluginRepo('demo');
  tag(repo, 'v0.2.0');
  write(repo, 'plugins/demo/README.md', 'newer\n');
  commitAll(repo, 'newer');

  const { configRoot, testenvRoot } = makeEnvPair(baseEnv({ pluginUnderTestRepo: repo }));
  const runDir = makeRun(testenvRoot);
  node(SCRIPTS.resolveBaseline, [configRoot, testenvRoot, runDir, '--ref', 'v0.2.0']);

  const baseline = readJson(path.join(runDir, 'baseline.json'));
  const pin = Object.values(baseline.arms.control.pins)[0];
  assert.equal(pin.requested_ref, 'v0.2.0');
  assert.equal(pin.resolved.kind, 'ref');
  assert.equal(fs.readFileSync(path.join(pin.resolved.path, 'plugins/demo/README.md'), 'utf8'), 'v1\n');

  node(SCRIPTS.launchPair, [configRoot, testenvRoot, '--dry-run']);
  const parity = readJson(path.join(runDir, '.launch', 'parity-report.json'));
  const controlDirs = parity.differs.control.pluginDirs.map((d) => d.replace(/\\/g, '/'));
  assert.ok(
    controlDirs.some((d) => d.includes('baselines') && d.endsWith('/plugins/demo')),
    `control should load the pinned checkout's plugin root, got: ${controlDirs.join(', ')}`,
  );
  assert.equal(parity.pins_symmetric, false, 'control on a tag, test on HEAD, is asymmetric by design');
});

test('a legacy schema-1 baseline.json on disk is still understood by launch-pair', () => {
  const repo = makePluginRepo('demo');
  const { configRoot, testenvRoot } = makeEnvPair(baseEnv({ pluginUnderTestRepo: repo }));
  const runDir = makeRun(testenvRoot);
  fs.writeFileSync(
    path.join(runDir, 'baseline.json'),
    JSON.stringify({
      schema: 1,
      run: 'run-001',
      control_baseline: {
        type: 'previous-version',
        ref: 'v0.1.0',
        repoPath: repo,
        worktreePath: path.join(testenvRoot, 'baselines', 'v0.1.0'),
        pluginDirs: [path.join(testenvRoot, 'baselines', 'v0.1.0', 'plugins', 'demo')],
      },
    }, null, 2),
  );

  node(SCRIPTS.launchPair, [configRoot, testenvRoot, '--dry-run']);
  const parity = readJson(path.join(runDir, '.launch', 'parity-report.json'));
  assert.equal(parity.pins.control.length, 1);
  assert.equal(parity.pins.control[0].requested_ref, 'v0.1.0');
  assert.ok(
    parity.differs.control.pluginDirs.some((d) => d.includes('v0.1.0')),
    'the old format\'s pluginDirs still layer onto control',
  );
});

test('schema 2: two artifacts, independently pinned, delivered two different ways', () => {
  const pluginRepo = makePluginRepo('demo');
  tag(pluginRepo, 'v1');
  write(pluginRepo, 'plugins/demo/README.md', 'plugin v2\n');
  commitAll(pluginRepo, 'plugin v2');

  const libRepo = makeRepo({ 'include/lib.h': 'v1\n', 'CMakeLists.txt': 'project(lib)\n' });
  tag(libRepo, 'v1');
  write(libRepo, 'include/lib.h', 'v2\n');
  commitAll(libRepo, 'lib v2');

  const { configRoot, testenvRoot } = makeEnvPair(
    baseEnv({
      artifacts: {
        plugin: { repo: pluginRepo, deliver: 'plugin-dir' },
        lib: { repo: libRepo, deliver: 'workspace:vendor/lib' },
      },
    }),
  );
  const runDir = makeRun(testenvRoot);

  // control on the previous release of BOTH; test on current working tree of both.
  node(SCRIPTS.resolveBaseline, [configRoot, testenvRoot, runDir, '--control', 'plugin=v1,lib=v1']);
  const baseline = readJson(path.join(runDir, 'baseline.json'));
  assert.equal(baseline.arms.control.pins.plugin.requested_ref, 'v1');
  assert.equal(baseline.arms.control.pins.lib.requested_ref, 'v1');
  assert.equal(baseline.arms.test.pins.plugin.requested_ref, null);
  assert.equal(baseline.arms.test.pins.lib.requested_ref, null);
  assert.notEqual(
    baseline.arms.control.pins.lib.resolved.path,
    baseline.arms.test.pins.lib.resolved.path,
    'old and new library must be two distinct cache entries',
  );

  node(SCRIPTS.launchPair, [configRoot, testenvRoot, '--no-spawn']);

  // plugin-dir delivery: a flag, nothing copied.
  const parity = readJson(path.join(runDir, '.launch', 'parity-report.json'));
  assert.ok(parity.differs.control.pluginDirs.some((d) => d.includes('baselines')));

  // workspace delivery: really copied, and each arm got ITS OWN version.
  assert.equal(fs.readFileSync(path.join(runDir, 'control', 'vendor', 'lib', 'include', 'lib.h'), 'utf8'), 'v1\n');
  assert.equal(fs.readFileSync(path.join(runDir, 'test', 'vendor', 'lib', 'include', 'lib.h'), 'utf8'), 'v2\n');
  assert.ok(!fs.existsSync(path.join(runDir, 'control', 'vendor', 'lib', '.ab-bench-snapshot.json')), 'bookkeeping is stripped');

  // seed still lands, and the manifest records full resolved identity.
  assert.ok(fs.existsSync(path.join(runDir, 'control', 'seed.txt')));
  const manifest = readJson(path.join(runDir, 'manifest.json'));
  assert.equal(manifest.arms.control.artifacts.length, 2);
  assert.equal(manifest.arms.test.artifacts.length, 2);
  for (const a of manifest.arms.control.artifacts) assert.ok(a.resolved.path, 'every artifact records where it came from');
});

test('schema 2: holding one artifact fixed while varying the other', () => {
  const pluginRepo = makePluginRepo('demo');
  tag(pluginRepo, 'v1');
  const libRepo = makeRepo({ 'include/lib.h': 'v1\n' });
  tag(libRepo, 'v1');

  const { configRoot, testenvRoot } = makeEnvPair(
    baseEnv({
      artifacts: {
        plugin: { repo: pluginRepo, deliver: 'plugin-dir' },
        lib: { repo: libRepo, deliver: 'workspace:vendor/lib' },
      },
    }),
  );
  const runDir = makeRun(testenvRoot);

  // The isolating run: both arms on lib@v1, only the plugin differs.
  node(SCRIPTS.resolveBaseline, [configRoot, testenvRoot, runDir, '--control', 'plugin=v1,lib=v1', '--test', 'lib=v1']);
  const baseline = readJson(path.join(runDir, 'baseline.json'));
  assert.equal(
    baseline.arms.control.pins.lib.resolved.path,
    baseline.arms.test.pins.lib.resolved.path,
    'a held-fixed artifact resolves to the SAME snapshot on both arms — that is what makes it a control',
  );
  assert.equal(baseline.arms.test.pins.plugin.requested_ref, null, 'the varied artifact is at the working tree');
});

test('schema 2: env: delivery exports a path into the arm launcher', () => {
  const libRepo = makeRepo({ 'include/lib.h': 'v1\n' });
  const { configRoot, testenvRoot } = makeEnvPair(
    baseEnv({ artifacts: { lib: { repo: libRepo, deliver: 'env:LIB_ROOT' } } }),
  );
  const runDir = makeRun(testenvRoot);
  node(SCRIPTS.resolveBaseline, [configRoot, testenvRoot, runDir]);
  node(SCRIPTS.launchPair, [configRoot, testenvRoot, '--no-spawn']);

  const script = fs.readFileSync(path.join(runDir, '.launch', `control.launch${LAUNCH_EXT}`), 'utf8');
  assert.match(script, IS_WINDOWS ? /^\$env:LIB_ROOT = '.+'$/m : /^export LIB_ROOT='.+'$/m);
  const manifest = readJson(path.join(runDir, 'manifest.json'));
  assert.ok(manifest.arms.control.env_vars.LIB_ROOT);
  assert.ok(!fs.existsSync(path.join(runDir, 'control', 'vendor')), 'env delivery copies nothing');
});

test('the arm launcher preserves argv and keeps colour in the host dialect', () => {
  // Regression guard, in two directions. The launcher used to emit a .cmd batch run under
  // `cmd /k`, which put both arms in a legacy conhost console with no colour at all — in a
  // benchmark whose deliverable is visual and whose operator reads two windows side by side.
  // It was then PowerShell-only, which made the whole harness Windows-only. What every
  // dialect has to keep is the same short list: argv preserved element by element, cwd set,
  // session persistence forced, colour forced back on.
  const pluginRepo = makePluginRepo();
  const { configRoot, testenvRoot } = makeEnvPair(
    baseEnv({ artifacts: { demo: { repo: pluginRepo, deliver: 'plugin-dir' } } }),
  );
  const runDir = makeRun(testenvRoot);
  node(SCRIPTS.resolveBaseline, [configRoot, testenvRoot, runDir]);
  node(SCRIPTS.launchPair, [configRoot, testenvRoot, '--no-spawn']);

  for (const arm of ['control', 'test']) {
    const p = path.join(runDir, '.launch', `${arm}.launch${LAUNCH_EXT}`);
    assert.ok(fs.existsSync(p), `${arm} launcher should be a ${LAUNCH_EXT}`);
    assert.ok(!fs.existsSync(path.join(runDir, '.launch', `${arm}.launch.cmd`)),
      `${arm} must not fall back to a .cmd batch`);

    const script = fs.readFileSync(p, 'utf8');

    if (IS_WINDOWS) {
      // Arguments go through an array + splat, never an interpolated command line: paths
      // carry spaces and the opening prompt carries punctuation.
      assert.match(script, /^\$claudeArgs = @\(.+\)$/m);
      assert.match(script, /^& claude @claudeArgs$/m);
      assert.match(script, /^Set-Location -LiteralPath '.+'$/m);
      assert.match(script, /^\$env:CLAUDE_CODE_FORCE_SESSION_PERSISTENCE = "1"$/m);
      // UTF-8, or box-drawing in the arm's own TUI comes out as mojibake.
      assert.match(script, /OutputEncoding/);
      // No cmd-isms left behind.
      assert.ok(!/^set [A-Z_]+=/m.test(script), 'no cmd `set VAR=` lines');
      assert.ok(!/^@echo off$/m.test(script), 'no cmd batch header');
    } else {
      // `set --` + "$@" is sh's splat: one array element, one argv entry, whatever is in it.
      assert.match(script, /^#!\/bin\/sh$/m);
      assert.match(script, /^set -- .+$/m);
      assert.match(script, /^claude "\$@"$/m);
      assert.match(script, /^cd '.+' \|\| exit 1$/m);
      assert.match(script, /^export CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1$/m);
      // No PowerShell left behind.
      assert.ok(!/\$env:/.test(script), 'no PowerShell env syntax');
      assert.ok(!/Set-Location/.test(script), 'no PowerShell cmdlets');
    }

    // Both dialects: the parent session's NO_COLOR leaks all the way down to the arm's
    // own TUI, and scrubbing it is what keeps the two windows readable side by side.
    assert.match(script, /NO_COLOR/);
    assert.match(script, /FORCE_COLOR/);
  }
});

test('prepare: runs per arm, is logged, and its output stays out of the arm', () => {
  const libRepo = makeRepo({ 'src.txt': 'source\n' });
  const { configRoot, testenvRoot } = makeEnvPair(
    baseEnv({
      artifacts: {
        lib: {
          repo: libRepo,
          deliver: 'workspace:vendor/lib',
          prepare: `node -e "require('fs').writeFileSync('vendor/lib/BUILT.txt','built for '+process.env.AB_BENCH_ARM)"`,
        },
      },
    }),
  );
  const runDir = makeRun(testenvRoot);
  node(SCRIPTS.resolveBaseline, [configRoot, testenvRoot, runDir]);
  node(SCRIPTS.launchPair, [configRoot, testenvRoot, '--no-spawn']);

  for (const arm of ['control', 'test']) {
    assert.equal(
      fs.readFileSync(path.join(runDir, arm, 'vendor', 'lib', 'BUILT.txt'), 'utf8'),
      `built for ${arm}`,
      'prepare ran in the arm workspace, per arm',
    );
    const log = fs.readFileSync(path.join(runDir, '.launch', `prepare-${arm}-lib.log`), 'utf8');
    assert.match(log, /# exit: 0/);
    assert.match(log, /# prepare: lib/);
  }
  const parity = readJson(path.join(runDir, '.launch', 'parity-report.json'));
  assert.match(parity.pins.control[0].prepare_cost, /excluded from arm metrics/);
});

test('prepare: a failing build aborts the run and writes no manifest', () => {
  const libRepo = makeRepo({ 'src.txt': 'source\n' });
  const { configRoot, testenvRoot } = makeEnvPair(
    baseEnv({
      artifacts: {
        lib: { repo: libRepo, deliver: 'workspace:vendor/lib', prepare: 'node -e "process.exit(7)"' },
      },
    }),
  );
  const runDir = makeRun(testenvRoot);
  node(SCRIPTS.resolveBaseline, [configRoot, testenvRoot, runDir]);

  const r = nodeExpectFail(SCRIPTS.launchPair, [configRoot, testenvRoot, '--no-spawn']);
  assert.notEqual(r.status, 0, 'a broken pin must not produce a run');
  assert.match(r.stderr, /prepare failed for artifact "lib"/);
  assert.ok(!fs.existsSync(path.join(runDir, 'manifest.json')), 'no manifest means the run is still fireable after a fix');
  assert.ok(fs.existsSync(path.join(runDir, '.launch', 'prepare-control-lib.log')), 'the failure is still logged');
});

test('a dirty working tree is snapshotted and flagged, and the live repo is untouched', () => {
  const pluginRepo = makePluginRepo('demo');
  write(pluginRepo, 'plugins/demo/README.md', 'work in progress, uncommitted\n');

  const { configRoot, testenvRoot } = makeEnvPair(
    baseEnv({ artifacts: { plugin: { repo: pluginRepo, deliver: 'plugin-dir' } } }),
  );
  const runDir = makeRun(testenvRoot);
  const out = node(SCRIPTS.resolveBaseline, [configRoot, testenvRoot, runDir]);
  assert.match(out, /uncommitted changes/, 'the operator is told their run is pinned to a snapshot');

  const baseline = readJson(path.join(runDir, 'baseline.json'));
  const pin = baseline.arms.test.pins.plugin;
  assert.equal(pin.resolved.kind, 'worktree-snapshot');
  assert.equal(pin.resolved.dirty, true);

  node(SCRIPTS.launchPair, [configRoot, testenvRoot, '--dry-run']);
  const parity = readJson(path.join(runDir, '.launch', 'parity-report.json'));
  assert.ok(parity.pins_dirty.includes('test:plugin'), 'a snapshot is replayable but is not a named ref — say so');

  // Editing after the fact must not reach the pinned snapshot.
  write(pluginRepo, 'plugins/demo/README.md', 'changed later\n');
  assert.equal(
    fs.readFileSync(path.join(pin.resolved.path, 'plugins/demo/README.md'), 'utf8'),
    'work in progress, uncommitted\n',
  );
});

test('resolve-baseline rejects an artifact id env.json never declared', () => {
  const repo = makePluginRepo('demo');
  const { configRoot, testenvRoot } = makeEnvPair(
    baseEnv({ artifacts: { plugin: { repo, deliver: 'plugin-dir' } } }),
  );
  const runDir = makeRun(testenvRoot);
  const r = nodeExpectFail(SCRIPTS.resolveBaseline, [configRoot, testenvRoot, runDir, '--control', 'typo=v1']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unknown artifact "typo"/);
  assert.match(r.stderr, /env\.json declares: plugin/);
});

test('the DoD engine and its deny rule are still injected into both arms', () => {
  const repo = makePluginRepo('demo');
  const { configRoot, testenvRoot } = makeEnvPair(baseEnv({ pluginUnderTestRepo: repo }));
  const runDir = makeRun(testenvRoot);
  node(SCRIPTS.resolveBaseline, [configRoot, testenvRoot, runDir]);
  node(SCRIPTS.launchPair, [configRoot, testenvRoot, '--no-spawn']);

  const parity = readJson(path.join(runDir, '.launch', 'parity-report.json'));
  assert.match(parity.equal.dod_engine.replace(/\\/g, '/'), /plugins\/dod-lite$/);

  for (const arm of ['control', 'test']) {
    const settings = readJson(path.join(runDir, arm, '.claude', 'settings.json'));
    // `.dod/` is opaque in BOTH directions: the arm may not edit the checkers it is
    // graded against, and may not read the shared sessions/ folder that holds the
    // other arm's scorecard.
    assert.deepEqual(settings.permissions.deny, [
      'Edit(/.dod/**)', 'Write(/.dod/**)', 'MultiEdit(/.dod/**)',
      'Read(/.dod/**)',
    ]);
    assert.ok(fs.existsSync(path.join(runDir, arm, 'TASK.md')));
    assert.ok(fs.existsSync(path.join(runDir, arm, '.dod')), 'the shared .dod junction is linked');
  }
});
