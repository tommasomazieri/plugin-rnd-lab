/**
 * dod-lite-dir.mjs — where the DoD audit engine lives, from wherever optimizer was loaded.
 *
 * dod-lite is a separate plugin, permanently (see docs/dod-contract.md), so optimizer has to
 * find it on disk rather than import it from its own tree. There are exactly two layouts:
 *
 *   in place   <plugins>/optimizer/              a clone, or a marketplace added from a local
 *              <plugins>/dod-lite/               directory: Claude Code loads plugins where they
 *                                                sit, so dod-lite is optimizer's plain sibling.
 *
 *   cached     <cache>/<marketplace>/optimizer/<version>/    a marketplace added from GitHub or
 *              <cache>/<marketplace>/dod-lite/<version>/     any git URL: every plugin is copied
 *                                                            into its own *versioned* folder.
 *
 * Only the first layout used to be looked for. It is the one the author runs, so every test
 * and every real run passed — while every stranger installing from GitHub got a `fire` that
 * refused to launch and a `plan` probe that crashed on import. Found 2026-09-22 by installing
 * from the public repo into an isolated CLAUDE_CONFIG_DIR, the only way to see the cached layout.
 *
 * Several versions can sit side by side in the cache after an update, so the highest is taken:
 * both plugins ship from the same marketplace commit, and the newest dod-lite is the one that
 * commit put there.
 */

import fs from 'node:fs';
import path from 'node:path';

const ENGINE = path.join('hooks', 'dod-check.mjs');

const hasEngine = (dir) => fs.existsSync(path.join(dir, ENGINE));

/** Numeric-aware compare, so 0.10.0 sorts above 0.9.0 and a sha-named folder still sorts. */
function byVersionDesc(a, b) {
  return b.localeCompare(a, 'en', { numeric: true });
}

/**
 * `pluginRoot` is optimizer's own root: the directory holding its `.claude-plugin/`.
 * Returns the dod-lite directory to hand an arm via --plugin-dir, or null if neither layout has one.
 */
export function resolveDodLiteDir(pluginRoot) {
  const inPlace = path.resolve(pluginRoot, '..', 'dod-lite');
  if (hasEngine(inPlace)) return inPlace;

  const cachedParent = path.resolve(pluginRoot, '..', '..', 'dod-lite');
  let versions = [];
  try {
    versions = fs.readdirSync(cachedParent, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((name) => hasEngine(path.join(cachedParent, name)))
      .sort(byVersionDesc);
  } catch { /* no cached dod-lite at all */ }
  return versions.length ? path.join(cachedParent, versions[0]) : null;
}

/** Every place resolveDodLiteDir looked, for an error message that says where to check. */
export function dodLiteSearchPaths(pluginRoot) {
  return [
    path.resolve(pluginRoot, '..', 'dod-lite'),
    path.join(path.resolve(pluginRoot, '..', '..', 'dod-lite'), '<version>'),
  ];
}
