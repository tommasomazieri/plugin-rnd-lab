// Artifact declaration, pinning, and snapshotting.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  normalizeArtifacts,
  parseDeliver,
  resolveArtifact,
  hashWorkingTree,
  workingTreeFiles,
  isDirty,
  headSha,
  findPluginDirs,
} from '../lib/artifacts.mjs';
import { makeRepo, makePluginRepo, tmpDir, cleanupAll, write, commitAll, tag, git } from './helpers.mjs';

test.after(cleanupAll);

test('parseDeliver: every mode, and the traversal guards', () => {
  assert.deepEqual(parseDeliver('plugin-dir'), { mode: 'plugin-dir' });
  assert.deepEqual(parseDeliver(undefined), { mode: 'plugin-dir' }, 'default is the schema-1 behaviour');
  assert.deepEqual(parseDeliver('none'), { mode: 'none' });
  assert.deepEqual(parseDeliver('workspace:vendor/lib'), { mode: 'workspace', subpath: 'vendor/lib' });
  assert.deepEqual(parseDeliver('env:LIB_ROOT'), { mode: 'env', varName: 'LIB_ROOT' });

  assert.throws(() => parseDeliver('workspace:'), /needs a subpath/);
  assert.throws(() => parseDeliver('workspace:../escape'), /inside the workspace/);
  assert.throws(() => parseDeliver('env:not a var'), /valid env var name/);
  assert.throws(() => parseDeliver('carrier-pigeon'), /unknown deliver mode/);
});

test('normalizeArtifacts: schema 1 env.json is synthesized into one plugin-dir artifact', () => {
  const repo = path.resolve('/tmp/some-plugin-repo');
  const artifacts = normalizeArtifacts({ pluginUnderTestRepo: repo });
  const ids = Object.keys(artifacts);
  assert.equal(ids.length, 1, 'exactly one artifact, so existing experiments are unchanged');
  assert.equal(artifacts[ids[0]].deliver, 'plugin-dir');
  assert.equal(artifacts[ids[0]].legacy, true);
  assert.equal(artifacts[ids[0]].prepare, null);
});

test('normalizeArtifacts: schema 2 wins and carries prepare settings', () => {
  const artifacts = normalizeArtifacts({
    pluginUnderTestRepo: '/tmp/ignored',
    artifacts: {
      p: { repo: '/tmp/p', deliver: 'plugin-dir' },
      lib: { repo: '/tmp/lib', deliver: 'workspace:vendor/lib', prepare: 'cmake --build .', prepareTimeoutSec: 60 },
    },
  });
  assert.deepEqual(Object.keys(artifacts).sort(), ['lib', 'p']);
  assert.equal(artifacts.lib.prepare, 'cmake --build .');
  assert.equal(artifacts.lib.prepareTimeoutSec, 60);
  assert.equal(artifacts.p.prepareTimeoutSec, 900, 'default timeout');
  assert.ok(!artifacts.p.legacy, 'pluginUnderTestRepo is ignored once artifacts exist');
});

test('normalizeArtifacts: an artifact with no repo is rejected by name', () => {
  assert.throws(() => normalizeArtifacts({ artifacts: { broken: { deliver: 'plugin-dir' } } }), /"broken" has no "repo"/);
});

test('workingTreeFiles: respects .gitignore and includes untracked-but-not-ignored', () => {
  const repo = makeRepo({ 'a.txt': 'a\n', '.gitignore': 'ignored/\n*.log\n' });
  write(repo, 'ignored/junk.bin', 'x');
  write(repo, 'noisy.log', 'x');
  write(repo, 'b.txt', 'b\n');
  const files = workingTreeFiles(repo);
  assert.ok(files.includes('a.txt'));
  assert.ok(files.includes('b.txt'), 'untracked but not ignored belongs in the snapshot');
  assert.ok(!files.some((f) => f.includes('ignored/')), 'gitignored dirs stay out');
  assert.ok(!files.includes('noisy.log'), 'gitignored patterns stay out');
});

test('hashWorkingTree: stable for identical content, changes on any edit', () => {
  const repo = makeRepo({ 'a.txt': 'a\n' });
  const h1 = hashWorkingTree(repo);
  assert.equal(hashWorkingTree(repo), h1, 'same bytes -> same hash');
  write(repo, 'a.txt', 'a changed\n');
  const h2 = hashWorkingTree(repo);
  assert.notEqual(h2, h1, 'content change must change identity');
  write(repo, 'a.txt', 'a\n');
  assert.equal(hashWorkingTree(repo), h1, 'reverting restores the identity, so the cache hits again');
});

test('resolveArtifact: an explicit ref becomes a cached worktree', () => {
  const repo = makePluginRepo('demo');
  tag(repo, 'v1.0');
  write(repo, 'plugins/demo/README.md', 'v2\n');
  commitAll(repo, 'move on');

  const testenvRoot = tmpDir('optimizer-te-');
  const artifact = { id: 'demo', repo, deliver: 'plugin-dir', delivery: { mode: 'plugin-dir' } };

  const first = resolveArtifact(artifact, 'v1.0', testenvRoot);
  assert.equal(first.resolved.kind, 'ref');
  assert.equal(first.resolved.dirty, false);
  assert.equal(first.requested_ref, 'v1.0');
  assert.equal(fs.readFileSync(path.join(first.resolved.path, 'plugins/demo/README.md'), 'utf8'), 'v1\n');
  assert.deepEqual(
    first.resolved.pluginDirs.map((d) => path.basename(d)),
    ['demo'],
    'plugin dirs are discovered inside the pinned checkout, not the live repo',
  );

  const second = resolveArtifact(artifact, 'v1.0', testenvRoot);
  assert.equal(second.resolved.cached, true, 'a second run pinning the same ref reuses the worktree');
  assert.equal(second.resolved.path, first.resolved.path);
});

test('resolveArtifact: a clean tree with no ref pins to HEAD, not to the live repo', () => {
  const repo = makePluginRepo('demo');
  const sha = headSha(repo);
  const testenvRoot = tmpDir('optimizer-te-');
  const artifact = { id: 'demo', repo, deliver: 'plugin-dir', delivery: { mode: 'plugin-dir' } };

  const pin = resolveArtifact(artifact, null, testenvRoot);
  assert.equal(pin.resolved.kind, 'head');
  assert.equal(pin.resolved.sha, sha);
  assert.equal(pin.resolved.dirty, false);
  assert.notEqual(path.resolve(pin.resolved.path), path.resolve(repo), 'an arm must never be handed the live repo');
});

test('resolveArtifact: a dirty tree is snapshotted, content-hashed, and cached', () => {
  const repo = makePluginRepo('demo');
  write(repo, 'plugins/demo/README.md', 'uncommitted work in progress\n');
  assert.equal(isDirty(repo), true);

  const testenvRoot = tmpDir('optimizer-te-');
  const artifact = { id: 'demo', repo, deliver: 'plugin-dir', delivery: { mode: 'plugin-dir' } };

  const pin = resolveArtifact(artifact, null, testenvRoot);
  assert.equal(pin.resolved.kind, 'worktree-snapshot');
  assert.equal(pin.resolved.dirty, true);
  assert.ok(pin.resolved.hash, 'the snapshot has a content identity');
  assert.equal(
    fs.readFileSync(path.join(pin.resolved.path, 'plugins/demo/README.md'), 'utf8'),
    'uncommitted work in progress\n',
    'the uncommitted edit is what got captured',
  );

  // The whole point: editing the live repo afterwards cannot change what this run measured.
  write(repo, 'plugins/demo/README.md', 'edited AFTER the run was pinned\n');
  assert.equal(
    fs.readFileSync(path.join(pin.resolved.path, 'plugins/demo/README.md'), 'utf8'),
    'uncommitted work in progress\n',
    'a mid-run edit must not reach back into a fired run',
  );

  const again = resolveArtifact(artifact, null, testenvRoot);
  assert.notEqual(again.resolved.hash, pin.resolved.hash, 'the new tree state is a new identity');
});

test('resolveArtifact: an unchanged dirty tree hits the cache instead of re-copying', () => {
  const repo = makeRepo({ 'a.txt': 'a\n' });
  write(repo, 'b.txt', 'uncommitted\n');
  const testenvRoot = tmpDir('optimizer-te-');
  const artifact = { id: 'x', repo, deliver: 'none', delivery: { mode: 'none' } };

  const first = resolveArtifact(artifact, null, testenvRoot);
  assert.equal(first.resolved.cached, false, 'first resolve does the copy');
  const second = resolveArtifact(artifact, null, testenvRoot);
  assert.equal(second.resolved.cached, true, 'second resolve with no edits copies nothing');
  assert.equal(second.resolved.path, first.resolved.path);
});

test('resolveArtifact: two artifacts sharing a tag name do not collide on disk', () => {
  const repoA = makeRepo({ 'a.txt': 'A\n' });
  const repoB = makeRepo({ 'b.txt': 'B\n' });
  tag(repoA, 'v1.0');
  tag(repoB, 'v1.0');
  const testenvRoot = tmpDir('optimizer-te-');

  const a = resolveArtifact({ id: 'alpha', repo: repoA, deliver: 'none', delivery: { mode: 'none' } }, 'v1.0', testenvRoot);
  const b = resolveArtifact({ id: 'beta', repo: repoB, deliver: 'none', delivery: { mode: 'none' } }, 'v1.0', testenvRoot);

  assert.notEqual(a.resolved.path, b.resolved.path, 'cache keys are namespaced per artifact id');
  assert.ok(fs.existsSync(path.join(a.resolved.path, 'a.txt')));
  assert.ok(fs.existsSync(path.join(b.resolved.path, 'b.txt')));
});

test('resolveArtifact: a bad ref and a non-repo both fail loudly', () => {
  const repo = makeRepo();
  const testenvRoot = tmpDir('optimizer-te-');
  const artifact = { id: 'x', repo, deliver: 'none', delivery: { mode: 'none' } };
  assert.throws(() => resolveArtifact(artifact, 'no-such-tag', testenvRoot), /does that tag\/commit exist/);

  const notARepo = tmpDir('optimizer-notrepo-');
  assert.throws(
    () => resolveArtifact({ id: 'y', repo: notARepo, deliver: 'none', delivery: { mode: 'none' } }, null, testenvRoot),
    /not a git repo/,
  );
});

test('findPluginDirs: returns plugin ROOTS, not the .claude-plugin manifest folder', () => {
  // --plugin-dir wants the root (skills/, agents/, hooks/ live there). Handing it
  // .claude-plugin/ makes the plugin silently fail to load, which is invisible in an
  // A/B: the arm just behaves like it has no plugin.
  const root = tmpDir('optimizer-mono-');
  write(root, 'plugins/one/.claude-plugin/plugin.json', '{}');
  write(root, 'plugins/one/skills/s/SKILL.md', '# s');
  write(root, 'plugins/two/.claude-plugin/plugin.json', '{}');
  write(root, 'legacy/plugin.json', '{}');
  write(root, 'node_modules/pkg/.claude-plugin/plugin.json', '{}');
  const found = findPluginDirs(root).map((d) => path.relative(root, d).replace(/\\/g, '/'));
  assert.deepEqual(found, ['legacy', 'plugins/one', 'plugins/two']);
});

test('git worktrees created by the resolver are registered against the source repo', () => {
  const repo = makeRepo({ 'a.txt': 'a\n' });
  tag(repo, 'v1.0');
  const testenvRoot = tmpDir('optimizer-te-');
  const pin = resolveArtifact({ id: 'x', repo, deliver: 'none', delivery: { mode: 'none' } }, 'v1.0', testenvRoot);
  // git reports worktree paths with forward slashes even on Windows.
  const norm = (p) => p.replace(/\\/g, '/').toLowerCase();
  const listed = norm(git(repo, ['worktree', 'list', '--porcelain']));
  assert.ok(listed.includes(norm(pin.resolved.path)), 'the checkout is a real registered worktree, not a stray copy');
});
