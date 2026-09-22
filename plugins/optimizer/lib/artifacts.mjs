/**
 * artifacts.mjs — the generic "versioned thing an experiment pins per arm" layer.
 *
 * optimizer used to hard-code one ontology: there is ONE plugin under test and it is
 * delivered as `--plugin-dir`. That made two things impossible: an experiment whose
 * subject spans more than one repo, and a run that can be replayed, since the "new" side
 * of every A/B pointed at a live mutable path in the dev repo with nothing recording what
 * state it was in.
 *
 * An artifact is now just: a git repo, a ref, and a delivery mode. A Claude Code plugin is
 * one delivery mode among several — nothing here knows or cares what the subject is.
 *
 *   env.json      declares WHAT exists (stable for the experiment's life)
 *   baseline.json declares WHICH REF each arm pins each artifact to (per run)
 *
 * Every artifact resolves to an IMMUTABLE snapshot at resolve time, always — an explicit
 * ref becomes a cached worktree, a clean tree becomes its HEAD sha, and a dirty tree is
 * copied out and content-hashed. Arms never read the live repo, so an edit made while a
 * run is in flight cannot change what that run measured.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const DELIVER_MODES = ['plugin-dir', 'workspace', 'env', 'none'];

/** Directories never worth walking. .gitignore does the real filtering; this is a fast path. */
const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', '.dod']);

export function git(repo, args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

export function sanitizeRef(ref) {
  return String(ref).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 100);
}

/**
 * `deliver` is a single string so env.json stays readable:
 *   "plugin-dir"            -> becomes a --plugin-dir flag
 *   "workspace:<subpath>"   -> copied into <workspace>/<subpath>
 *   "env:<VARNAME>"         -> absolute path exported as <VARNAME>
 *   "none"                  -> recorded in the manifest, delivered nowhere
 */
export function parseDeliver(deliver) {
  const raw = String(deliver || 'plugin-dir').trim();
  if (raw === 'plugin-dir') return { mode: 'plugin-dir' };
  if (raw === 'none') return { mode: 'none' };
  if (raw.startsWith('workspace:')) {
    const subpath = raw.slice('workspace:'.length).trim().replace(/^[\\/]+/, '');
    if (!subpath) throw new Error(`deliver "${raw}" needs a subpath, e.g. "workspace:vendor/lib"`);
    if (path.isAbsolute(subpath) || subpath.split(/[\\/]/).includes('..')) {
      throw new Error(`deliver "${raw}" must stay inside the workspace`);
    }
    return { mode: 'workspace', subpath };
  }
  if (raw.startsWith('env:')) {
    const varName = raw.slice('env:'.length).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(varName)) throw new Error(`deliver "${raw}" needs a valid env var name`);
    return { mode: 'env', varName };
  }
  throw new Error(`unknown deliver mode "${raw}" — expected one of: ${DELIVER_MODES.join(', ')} (workspace/env take a suffix)`);
}

/**
 * env.json schema 2 declares `artifacts`. Schema 1 declared a single
 * `pluginUnderTestRepo` delivered as a plugin dir — synthesized here into the same shape,
 * so every existing experiment keeps working with no config change and nothing downstream
 * has to know two formats exist.
 */
export function normalizeArtifacts(env) {
  const out = {};
  if (env && env.artifacts && typeof env.artifacts === 'object' && Object.keys(env.artifacts).length > 0) {
    for (const [id, spec] of Object.entries(env.artifacts)) {
      if (!spec || !spec.repo) throw new Error(`env.json: artifact "${id}" has no "repo"`);
      out[id] = {
        id,
        repo: path.resolve(spec.repo),
        deliver: spec.deliver || 'plugin-dir',
        delivery: parseDeliver(spec.deliver),
        prepare: spec.prepare || null,
        prepareTimeoutSec: Number.isFinite(spec.prepareTimeoutSec) ? spec.prepareTimeoutSec : 900,
      };
    }
    return out;
  }
  if (env && env.pluginUnderTestRepo) {
    const repo = path.resolve(env.pluginUnderTestRepo);
    const id = path.basename(repo);
    out[id] = {
      id,
      repo,
      deliver: 'plugin-dir',
      delivery: { mode: 'plugin-dir' },
      prepare: null,
      prepareTimeoutSec: 900,
      legacy: true,
    };
  }
  return out;
}

export function assertGitRepo(repo) {
  if (!fs.existsSync(repo)) throw new Error(`repo does not exist: ${repo}`);
  try {
    git(repo, ['rev-parse', '--git-dir']);
  } catch (e) {
    throw new Error(`"${repo}" is not a git repo (${e.message.trim()})`);
  }
}

export function headSha(repo) {
  return git(repo, ['rev-parse', 'HEAD']).trim();
}

export function isDirty(repo) {
  return git(repo, ['status', '--porcelain']).trim().length > 0;
}

/**
 * Exactly the files git considers part of the working tree: tracked, plus untracked that
 * .gitignore does not exclude. Using git rather than a hand-rolled ignore list means the
 * snapshot contains what a fresh clone plus your edits would contain — no build output,
 * no node_modules, no guessing.
 */
export function workingTreeFiles(repo) {
  return git(repo, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter(Boolean)
    .filter((rel) => !rel.split('/').some((seg) => SKIP_DIRS.has(seg)))
    .sort();
}

/** Content identity of a working tree: same bytes in the same paths -> same hash. */
export function hashWorkingTree(repo) {
  const h = crypto.createHash('sha256');
  for (const rel of workingTreeFiles(repo)) {
    const abs = path.join(repo, rel);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      h.update(`${rel}\0<deleted>\0`); // tracked but removed: still part of the identity
      continue;
    }
    if (!stat.isFile()) continue;
    h.update(`${rel}\0`);
    h.update(fs.readFileSync(abs));
    h.update('\0');
  }
  return h.digest('hex').slice(0, 16);
}

function copyWorkingTree(repo, dest) {
  for (const rel of workingTreeFiles(repo)) {
    const src = path.join(repo, rel);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
    const target = path.join(dest, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(src, target);
  }
}

/**
 * One spelling per directory, so a path we built and a path git printed can be compared.
 *
 * They are routinely different strings for the same folder. On Windows git prints the long,
 * correctly-cased form (`C:/Users/runneradmin/...`) while a path assembled from TEMP or typed by
 * the operator may carry an 8.3 short name (`C:\Users\RUNNER~1\...`) or other casing; on macOS
 * one side may go through the /var -> /private/var symlink. Compared raw, the resolver took its
 * own worktree for a stranger's folder and refused the second arm pinning the same ref — every
 * run that held an artifact fixed across arms. Found by the first Windows CI run.
 */
function canonicalPath(p) {
  let out;
  try { out = fs.realpathSync.native(p); } catch { out = path.resolve(p); }
  return process.platform === 'win32' ? out.toLowerCase() : out;
}

function listWorktrees(repo) {
  const out = git(repo, ['worktree', 'list', '--porcelain']);
  const paths = [];
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) paths.push(canonicalPath(line.slice('worktree '.length).trim()));
  }
  return paths;
}

function ensureWorktree(repo, ref, worktreePath) {
  // `ref` lands in git's argv after the path, where a leading dash is read as an option, not
  // a revision. No real ref can start with one — git refuses such branch and tag names, and a
  // sha never does — so refusing it here costs nothing and closes the option-injection path.
  if (String(ref).startsWith('-')) {
    throw new Error(`ref "${ref}" starts with "-" — git would read it as an option, not a revision`);
  }
  if (listWorktrees(repo).includes(canonicalPath(worktreePath))) return { cached: true };
  if (fs.existsSync(worktreePath)) {
    if (fs.readdirSync(worktreePath).length > 0) {
      throw new Error(
        `${worktreePath} exists, is not a registered worktree of ${repo}, and is not empty — ` +
          `refusing to touch it. Remove it (or \`git worktree prune\` in ${repo}) if it's stale.`,
      );
    }
    fs.rmdirSync(worktreePath);
  }
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
  try {
    git(repo, ['worktree', 'add', '--detach', worktreePath, ref]);
  } catch (e) {
    throw new Error(`git worktree add failed for ref "${ref}" — does that tag/commit exist in ${repo}? (${e.message.trim()})`);
  }
  return { cached: false };
}

/**
 * Every plugin ROOT under `root`. Covers monorepos shipping several plugins.
 *
 * `--plugin-dir` wants the plugin root — the folder holding `skills/`, `agents/`, `hooks/`
 * — not the folder holding plugin.json. Those differ under the current layout, where the
 * manifest lives at `<root>/.claude-plugin/plugin.json`; returning the manifest's own
 * folder handed Claude Code `.claude-plugin/` and the plugin silently failed to load.
 * Both layouts are accepted: manifest in `.claude-plugin/`, or legacy manifest at the root.
 */
export function findPluginDirs(root) {
  const found = [];
  (function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const hasNested = entries.some((e) => e.isDirectory() && e.name === '.claude-plugin')
      && fs.existsSync(path.join(dir, '.claude-plugin', 'plugin.json'));
    if (hasNested || entries.some((e) => e.isFile() && e.name === 'plugin.json')) {
      found.push(dir);
      return; // a plugin's own folder is not searched for nested plugins
    }
    for (const e of entries) {
      if (e.isDirectory() && !SKIP_DIRS.has(e.name) && e.name !== '.claude-plugin') {
        walk(path.join(dir, e.name));
      }
    }
  })(root);
  return found.sort();
}

/**
 * Resolve one artifact for one arm to an immutable, cached location.
 *
 * `requestedRef` null/undefined means "whatever is in the working tree now" — which is
 * still pinned, just to a snapshot of that tree rather than to a named ref. There is
 * deliberately no path through this function that leaves an arm pointing at a live repo.
 *
 * Cache keys are namespaced per artifact id, because two artifacts can legitimately carry
 * the same tag ("v1.0") and must not collide on disk.
 */
export function resolveArtifact(artifact, requestedRef, testenvRoot) {
  assertGitRepo(artifact.repo);
  const cacheRoot = path.join(testenvRoot, 'baselines', sanitizeRef(artifact.id));

  let resolved;
  if (requestedRef) {
    const p = path.join(cacheRoot, sanitizeRef(requestedRef));
    const { cached } = ensureWorktree(artifact.repo, requestedRef, p);
    let sha = null;
    try { sha = headSha(p); } catch { /* detached worktree without HEAD is still usable */ }
    resolved = { kind: 'ref', sha, hash: null, dirty: false, path: p, cached };
  } else if (!isDirty(artifact.repo)) {
    const sha = headSha(artifact.repo);
    const p = path.join(cacheRoot, sanitizeRef(sha));
    const { cached } = ensureWorktree(artifact.repo, sha, p);
    resolved = { kind: 'head', sha, hash: null, dirty: false, path: p, cached };
  } else {
    const hash = hashWorkingTree(artifact.repo);
    const p = path.join(cacheRoot, `_wt-${hash}`);
    const cached = fs.existsSync(path.join(p, '.ab-bench-snapshot.json'));
    if (!cached) {
      fs.rmSync(p, { recursive: true, force: true });
      fs.mkdirSync(p, { recursive: true });
      copyWorkingTree(artifact.repo, p);
      fs.writeFileSync(
        path.join(p, '.ab-bench-snapshot.json'),
        JSON.stringify({ repo: artifact.repo, head_sha: headSha(artifact.repo), hash, taken_at: new Date().toISOString() }, null, 2),
      );
    }
    resolved = { kind: 'worktree-snapshot', sha: headSha(artifact.repo), hash, dirty: true, path: p, cached };
  }

  resolved.pluginDirs = artifact.delivery.mode === 'plugin-dir' ? findPluginDirs(resolved.path) : [];
  return { id: artifact.id, repo: artifact.repo, deliver: artifact.deliver, requested_ref: requestedRef || null, resolved };
}

/** Human-readable one-liner for parity reports and console output. */
export function describeResolved(pin) {
  const r = pin.resolved;
  if (r.kind === 'ref') return `${pin.id}@${pin.requested_ref} (${(r.sha || '').slice(0, 8)})`;
  if (r.kind === 'head') return `${pin.id}@HEAD ${(r.sha || '').slice(0, 8)}`;
  return `${pin.id}@working-tree ${r.hash} (dirty, snapshot of ${(r.sha || '').slice(0, 8)})`;
}
