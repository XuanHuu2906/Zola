#!/usr/bin/env node
/**
 * R11A read-only: locate every `$zuri.checkOpenConvReq` / `$zuri.checkArgvLink`
 * occurrence and report the file plus exact offset, so the reports cannot cite
 * an offset belonging to a different chunk.
 *
 * Usage: node tools/r11a-find-zuri-callsites.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-find-zuri-callsites.cjs <root>');
  process.exit(2);
}

const NEEDLES = ['$zuri.checkOpenConvReq', '$zuri.checkArgvLink'];

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = walk(root, []).sort();
console.log(`scanned ${files.length} .js file(s) under ${root}`);

for (const needle of NEEDLES) {
  console.log(`\n===== ${needle} =====`);
  let total = 0;
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    const offs = [];
    let i = s.indexOf(needle);
    while (i !== -1) { offs.push(i); i = s.indexOf(needle, i + 1); }
    if (!offs.length) continue;
    total += offs.length;
    console.log(`\n${path.relative(root, f).replace(/\\/g, '/')}   len=${s.length}`);
    for (const o of offs) {
      console.log(`   @${o}  ${JSON.stringify(s.slice(Math.max(0, o - 40), o + needle.length + 60))}`);
    }
  }
  console.log(`\ntotal ${needle} = ${total}`);
}
