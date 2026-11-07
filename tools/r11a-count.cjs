#!/usr/bin/env node
/**
 * R11A read-only: count occurrences and list offsets for CLI-supplied literals
 * in one file. Avoids shell interpolation of identifiers containing `$`.
 *
 * Usage: node tools/r11a-count.cjs <abs-file> <literal> [literal...]
 */
'use strict';

const fs = require('fs');

const [file, ...needles] = process.argv.slice(2);
if (!file || !needles.length) {
  console.error('usage: node tools/r11a-count.cjs <file> <literal> [literal...]');
  process.exit(2);
}

const t = fs.readFileSync(file, 'utf8');
console.log(`## ${file} (${t.length})`);
for (const n of needles) {
  const offs = [];
  let i = -1;
  while ((i = t.indexOf(n, i + 1)) !== -1) offs.push(i);
  console.log(`   ${String(offs.length).padStart(3)}  ${JSON.stringify(n)}  ${offs.slice(0, 8).map((x) => '@' + x).join(' ')}`);
}
