#!/usr/bin/env node
/**
 * R11A read-only: show the code that selects the main-window page
 * (index.html vs compact-app.html) in each main bundle.
 *
 * Usage: node tools/r11a-page-select.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-page-select.cjs <root>');
  process.exit(2);
}

const MAP = [
  ['main-dist/main.js', 'index.html'],
  ['main-dist/compact-app.js', 'compact-app.html'],
];

for (const [rel, needle] of MAP) {
  const t = fs.readFileSync(path.join(root, rel), 'utf8');
  console.log(`\n===== ${rel} :: ${needle} (${t.length} chars) =====`);
  let i = -1;
  let c = 0;
  while ((i = t.indexOf(`"${needle}"`, i + 1)) !== -1 && c < 8) {
    c++;
    console.log(`\nHIT#${c} @${i} :: ` + JSON.stringify(t.slice(Math.max(0, i - 420), i + 260)));
  }
  console.log(`\noccurrences = ${t.split(needle).length - 1}`);
}
