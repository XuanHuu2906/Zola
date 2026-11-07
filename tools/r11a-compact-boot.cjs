#!/usr/bin/env node
/**
 * R11A read-only: what does the compact renderer actually boot into?
 * Look for the react root mount, the InaccessibleDrive branch, and whether the
 * full chat shell (the component that reads $zsub) is rendered in this entry.
 *
 * Usage: node tools/r11a-compact-boot.cjs <root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-compact-boot.cjs <root>');
  process.exit(2);
}

const REL = 'pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js';
const t = fs.readFileSync(path.join(root, REL), 'utf8');
console.log(`## ${REL} (${t.length})`);

for (const [label, needle] of [
  ['InaccessibleDrive', 'InaccessibleDrive'],
  ['AccessibleDrive', 'AccessibleDrive'],
  ['Migration', 'Migration'],
  ['root render', 'createRoot'],
  ['legacy render', 'ReactDOM.render'],
  ['getElementById("app")', 'getElementById("app")'],
  ['$inaccessibleDrive', '$inaccessibleDrive'],
  ['$migration', '$migration'],
]) {
  const n = t.split(needle).length - 1;
  console.log(`\n### ${label} :: ${JSON.stringify(needle)} = ${n}`);
  let i = -1;
  let c = 0;
  while ((i = t.indexOf(needle, i + 1)) !== -1 && c < 3) {
    c++;
    console.log(`   @${i} :: ${JSON.stringify(t.slice(Math.max(0, i - 260), i + 300))}`);
  }
}
