#!/usr/bin/env node
/**
 * R11A read-only: offset list for CLI-supplied literals, plus a raw dump around
 * a chosen offset. Keeps `$`-bearing identifiers away from shell interpolation.
 *
 * Usage: node tools/r11a-find.cjs <abs-file> <pgRep> [--ctx <offset> <pad>]
 */
'use strict';

const fs = require('fs');

const argv = process.argv.slice(2);
const file = argv.shift();
if (!file || !argv.length) {
  console.error('usage: node tools/r11a-find.cjs <file> <literal> [literal...] [--ctx <off> <pad>]');
  process.exit(2);
}

const ctxAt = argv.indexOf('--ctx');
let ctxOff = -1;
let ctxPad = 300;
if (ctxAt !== -1) {
  ctxOff = Number(argv[ctxAt + 1]);
  if (argv[ctxAt + 2] !== undefined) ctxPad = Number(argv[ctxAt + 2]);
  argv.length = ctxAt;
}

const t = fs.readFileSync(file, 'utf8');
console.log(`## ${file} (${t.length})`);
for (const n of argv) {
  const offs = [];
  let i = -1;
  while ((i = t.indexOf(n, i + 1)) !== -1) offs.push(i);
  console.log(`   ${String(offs.length).padStart(3)}  ${JSON.stringify(n)}  ${offs.map((x) => '@' + x).join(' ')}`);
}

if (ctxOff >= 0) {
  console.log(`\n--- ctx @${ctxOff} ±${ctxPad} ---`);
  console.log(JSON.stringify(t.slice(Math.max(0, ctxOff - ctxPad), ctxOff + ctxPad)));
}
