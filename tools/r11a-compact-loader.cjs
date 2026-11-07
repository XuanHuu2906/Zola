#!/usr/bin/env node
/**
 * R11A read-only: how does the compact window relate to the main window in
 * compact-app.js? Dump launchCompactApp + CompactAppWindowLoader usage.
 *
 * Usage: node tools/r11a-compact-loader.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-compact-loader.cjs <root>');
  process.exit(2);
}

const rel = 'main-dist/compact-app.js';
const t = fs.readFileSync(path.join(root, rel), 'utf8');
console.log(`## ${rel} (${t.length} chars)`);

let i = -1;
let c = 0;
while ((i = t.indexOf('launchCompactApp', i + 1)) !== -1 && c < 8) {
  c++;
  console.log(`\nlaunchCompactApp#${c} @${i}\n` + JSON.stringify(t.slice(Math.max(0, i - 700), i + 700)));
}

console.log('\n\n=== CompactAppWindowLoader refs ===');
i = -1;
c = 0;
while ((i = t.indexOf('CompactAppWindowLoader', i + 1)) !== -1 && c < 12) {
  c++;
  console.log(`\nLOADER#${c} @${i} :: ` + JSON.stringify(t.slice(Math.max(0, i - 260), i + 300)));
}
