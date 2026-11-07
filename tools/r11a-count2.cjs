#!/usr/bin/env node
/**
 * R11A read-only: same as r11a-count but the needles are a JSON array in argv[2],
 * so literals containing double quotes survive the shell.
 *
 * Usage: node tools/r11a-count2.cjs <abs-file> '<json-array-of-literals>'
 */
'use strict';

const fs = require('fs');

const file = process.argv[2];
let needles;
try { needles = JSON.parse(process.argv[3]); } catch (e) {
  console.error('argv[3] must be a JSON array of strings');
  process.exit(2);
}

const t = fs.readFileSync(file, 'utf8');
console.log(`## ${file} (${t.length})`);
for (const n of needles) {
  const offs = [];
  let i = -1;
  while ((i = t.indexOf(n, i + 1)) !== -1) offs.push(i);
  console.log(`   ${String(offs.length).padStart(3)}  ${JSON.stringify(n)}  ${offs.slice(0, 10).map((x) => '@' + x).join(' ')}`);
}
