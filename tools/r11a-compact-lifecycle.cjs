#!/usr/bin/env node
/**
 * R11A read-only: in the compact process, (1) where is `Zt` (load main App)
 * called, (2) what does `process.argv[1]&&...` do, (3) any single-instance
 * forwarding at all.
 *
 * Usage: node tools/r11a-compact-lifecycle.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-compact-lifecycle.cjs <root>');
  process.exit(2);
}

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

for (const rel of ['main-dist/main.js', 'main-dist/compact-app.js']) {
  const t = read(rel);
  console.log(`\n===== ${rel} (${t.length} chars) =====`);

  // process.argv[1]&&...
  let i = t.indexOf('process.argv[1]&&');
  if (i >= 0) {
    console.log(`\nARGV_GATE @${i} :: ` + JSON.stringify(t.slice(Math.max(0, i - 700), i + 500)));
  }

  // single-instance related
  for (const k of ['singleinstance', 'second-instance', 'requestSingleInstanceLock', 'wakeupForInstance', 'argv']) {
    console.log(`   ${JSON.stringify(k)} = ${t.split(k).length - 1}`);
  }

  // Hn-equivalent: function that handles argv
  const hv = rel.endsWith('main.js') ? 'function Hn(e)' : null;
  if (hv) {
    let j = -1;
    while ((j = t.indexOf(hv, j + 1)) !== -1) {
      console.log(`\nHn @${j} :: ` + JSON.stringify(t.slice(j, j + 900)));
    }
  }
}
