#!/usr/bin/env node
/**
 * R11A read-only: dump context around every occurrence of a literal key in given files.
 *
 * Usage: node tools/r11a-context.cjs <root> <key> <pad> <file1> [file2 ...]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const BAR = String.fromCharCode(92);

function main() {
  const root = process.argv[2];
  const key = process.argv[3];
  const pad = Number(process.argv[4] || 220);
  const files = process.argv.slice(5);
  if (!root || !key || !files.length) {
    console.error('usage: node tools/r11a-context.cjs <root> <key> <pad> <file...>');
    process.exit(2);
  }
  for (const rel of files) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) {
      console.log(`## ${rel} MISSING`);
      continue;
    }
    const text = fs.readFileSync(abs, 'utf8');
    const total = text.split(key).length - 1;
    console.log(`## ${rel} ${JSON.stringify(key)} total=${total}`);
    let idx = -1;
    let n = 0;
    while ((idx = text.indexOf(key, idx + 1)) !== -1 && n < 12) {
      const a = Math.max(0, idx - pad);
      const b = Math.min(text.length, idx + key.length + pad);
      const before = text.slice(Math.max(0, idx - 120), idx);
      console.log(`  @${idx} BEFORE=${JSON.stringify(before)}`);
      console.log(`    ${text.slice(a, b).replace(new RegExp('\\s+', 'g'), ' ')}`);
      n++;
    }
    console.log('');
  }
}

main();
