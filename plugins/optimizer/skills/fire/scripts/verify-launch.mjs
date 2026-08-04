#!/usr/bin/env node
/**
 * verify-launch.mjs — post-fire gate: is this run actually measurable?
 *
 * Usage: node verify-launch.mjs <runDir>
 *
 * Both arms must be linked AND have an armed turn counter before the run is handed to
 * the human. A run whose arms are not counting stop signals cannot be compared at the
 * end — that failure used to surface only at analyze time, as a footer claiming one arm
 * lasted 1 turn and the other 135.
 *
 * Exit 0 = both arms ready. Exit 2 = not ready yet / broken (message says which).
 * Exit 1 = usage error.
 */

import fs from 'node:fs';
import path from 'node:path';
import { readCounter } from './turn-counter.mjs';

const ARMS = ['control', 'test'];

function main() {
  const runDir = process.argv[2] ? path.resolve(process.argv[2]) : null;
  if (!runDir) {
    console.error('usage: node verify-launch.mjs <runDir>');
    process.exit(1);
  }
  const manifestPath = path.join(runDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`[optimizer] no manifest.json in ${runDir} — run not fired`);
    process.exit(2);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const problems = [];
  const report = {};

  for (const arm of ARMS) {
    const armData = manifest.arms?.[arm] || {};
    const sessions = (armData.sessions || []).filter((s) => s.source === 'startup' || s.source === 'clear');
    const last = sessions[sessions.length - 1] || null;
    const counter = last ? readCounter(runDir, last.session_id) : null;
    const transcriptOk = !!(last?.transcript_path && fs.existsSync(last.transcript_path));

    report[arm] = {
      status: armData.status || 'missing',
      session_id: last?.session_id || null,
      transcript: transcriptOk,
      counter_armed: !!counter,
      turns: counter?.turns ?? null,
      stops_total: counter?.stops_total ?? null,
    };

    if (armData.status !== 'linked' || !last) problems.push(`${arm}: not linked yet (no SessionStart hook entry in manifest)`);
    else if (!counter) problems.push(`${arm}: turn counter NOT armed for session ${last.session_id} — .launch/turns/${last.session_id}.json missing`);
    else if (!transcriptOk) problems.push(`${arm}: transcript_path missing on disk (${last.transcript_path})`);
  }

  for (const arm of ARMS) {
    const r = report[arm];
    console.log(
      `${arm.padEnd(8)} status=${String(r.status).padEnd(8)} counter=${r.counter_armed ? 'armed' : 'MISSING'}` +
        ` turns=${r.turns ?? '-'} stops=${r.stops_total ?? '-'} transcript=${r.transcript ? 'ok' : 'MISSING'}` +
        ` session=${r.session_id || '-'}`
    );
  }

  if (problems.length > 0) {
    console.log('\nNOT READY:');
    for (const p of problems) console.log(`  ! ${p}`);
    console.log(`\nIf an arm stays unlinked or uncounted, read ${path.join(runDir, '.launch', 'hooks.log')}.`);
    process.exit(2);
  }
  console.log('\n[optimizer] both arms linked and counting — run is measurable.');
}

main();
