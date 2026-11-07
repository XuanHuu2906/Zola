#!/usr/bin/env node
/**
 * R11A read-only: in compact-app.js, is the index.html "main App" path actually
 * reached, and is the compact window a replacement or an addition?
 *
 * Usage: node tools/r11a-compact-windows.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-compact-windows.cjs <root>');
  process.exit(2);
}

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

for (const rel of ['main-dist/main.js', 'main-dist/compact-app.js']) {
  const t = read(rel);
  console.log(`\n===== ${rel} (${t.length} chars) =====`);

  for (const k of [
    'CompactAppWindowLoader', 'isDriveBlockedAndStartCompactApp',
    'launchCompactApp', 'LAUNCH_COMPACT_APP',
    'lwnRequireV2',
  ]) {
    console.log(`   ${JSON.stringify(k).padEnd(40)} = ${t.split(k).length - 1}`);
  }

  // Is Zt called (load main App)?
  const ztName = /function (Zt|Rt|Bt)\(e,t=""\)\{let n=e\.webContents\.getURL\(\)/.exec(t);
  if (ztName) {
    const fn = ztName[1];
    const calls = [];
    let i = -1;
    const re = new RegExp(`(?:^|[^.\\w$])${fn}\\(`, 'g');
    while ((i = re.exec(t)) !== null && calls.length < 12) calls.push(i.index);
    console.log(`   loadMainApp fn = ${fn}; call sites = ${JSON.stringify(calls)}`);
    for (const c of calls.slice(0, 6)) {
      console.log(`      @${c} :: ` + JSON.stringify(t.slice(Math.max(0, c - 260), c + 140)));
    }
  } else {
    console.log('   !! loadMainApp shape not found');
  }
}
