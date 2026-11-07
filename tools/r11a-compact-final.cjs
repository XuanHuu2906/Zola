#!/usr/bin/env node
/**
 * R11A read-only: close the last gaps.
 *   A. why main.js names compact-app-pc (twice)
 *   B. the three "$zwindow" sites in compact-app-preload.js
 *   C. is compact mode feature-flagged / actually launched?
 *   D. does compact-app.html carry any other script or inline shim?
 *
 * Usage: node tools/r11a-compact-final.cjs <root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-compact-final.cjs <root>');
  process.exit(2);
}

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

// A
console.log('=== A. main.js compact-app-pc sites ===');
{
  const t = read('main-dist/main.js');
  let i = -1; let c = 0;
  while ((i = t.indexOf('compact-app-pc', i + 1)) !== -1 && c < 5) {
    c++;
    console.log(`\n@${i} :: ${JSON.stringify(t.slice(Math.max(0, i - 420), i + 260))}`);
  }
}

// B
console.log('\n\n=== B. compact-app-preload $zwindow sites ===');
{
  const t = read('main-dist/compact-app-preload.js');
  let i = -1; let c = 0;
  while ((i = t.indexOf('$zwindow', i + 1)) !== -1 && c < 6) {
    c++;
    console.log(`\n@${i} :: ${JSON.stringify(t.slice(Math.max(0, i - 300), i + 300))}`);
  }
  console.log('\n--- other exposed-ish globals referenced in the preload ---');
  for (const k of ['window.$app=', 'window.$zconfig=', 'window.$zlogger=', 'window.$znode=',
                   'window.$zelectron=', 'window.$zfileRes=', 'window.$zFileManager=',
                   'window.$zupdater', '$zupdater', '$zscreencap', '$zcall', '$zlogin', '$zdb'])
    console.log(`   ${JSON.stringify(k).padEnd(26)} = ${t.split(k).length - 1}`);
}

// C
console.log('\n\n=== C. compact-mode gating and launch ===');
for (const rel of ['main-dist/main.js', 'main-dist/compact-app.js', 'main-dist/second-instance.js']) {
  const t = read(rel);
  console.log(`\n-- ${rel}`);
  for (const k of ['LAUNCH_COMPACT_APP_ARG', 'isCompactApp', 'launchCompactApp',
                   'compactApp', 'COMPACT_APP_VERSION_ARG', 'compact-app'])
    console.log(`   ${JSON.stringify(k).padEnd(28)} = ${t.split(k).length - 1}`);
}
{
  const t = read('main-dist/main.js');
  let i = -1; let c = 0;
  while ((i = t.indexOf('LAUNCH_COMPACT_APP_ARG', i + 1)) !== -1 && c < 5) {
    c++;
    console.log(`\nmain.js @${i} :: ${JSON.stringify(t.slice(Math.max(0, i - 360), i + 300))}`);
  }
}

// D
console.log('\n\n=== D. compact-app.html ===');
console.log(read('pc-dist/compact-app.html'));
