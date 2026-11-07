#!/usr/bin/env node
/**
 * R11A read-only: dump every printable ASCII string from a binary, optionally filtered.
 *
 * Usage: node tools/r11a-stub-dump.cjs <path> [minLen] [regex]
 */
'use strict';

const fs = require('fs');

function main() {
  const p = process.argv[2];
  if (!p) {
    console.error('usage: node tools/r11a-stub-dump.cjs <path> [minLen] [pattern]');
    process.exit(2);
  }
  const minLen = Number(process.argv[3] || 4);
  const pattern = process.argv[4] ? new RegExp(process.argv[4]) : null;
  const buf = fs.readFileSync(p);
  const all = buf.toString('latin1').match(new RegExp('[\\x20-\\x7e]{' + minLen + ',}', 'g')) || [];
  const hits = pattern ? all.filter((s) => pattern.test(s)) : all;
  console.log(`PATH=${p}`);
  console.log(`BYTES=${buf.length}`);
  console.log(`STRINGS=${all.length} MATCHES=${hits.length}`);
  hits.forEach((s, i) => console.log(`${i}\t${JSON.stringify(s)}`));
}

main();
