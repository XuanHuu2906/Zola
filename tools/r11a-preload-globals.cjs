#!/usr/bin/env node
/**
 * R11A read-only: enumerate every contextBridge.exposeInMainWorld call in one
 * preload file, including calls whose name argument is a variable (the generic
 * helper form), so a literal-only count does not undercount.
 *
 * Usage: node tools/r11a-preload-globals.cjs <root> <relative-preload-path>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const [root, rel] = process.argv.slice(2);
if (!root || !rel) {
  console.error('usage: node tools/r11a-preload-globals.cjs <root> <rel>');
  process.exit(2);
}

const t = fs.readFileSync(path.join(root, rel), 'utf8');
const out = [];
for (const m of t.matchAll(/exposeInMainWorld\(([^)]{0,120}?)\)/g)) {
  out.push(m[1]);
}
console.log(`## ${rel} (${t.length})`);
console.log(`exposeInMainWorld total = ${out.length}`);
for (const a of out) console.log('   ' + JSON.stringify(a));
