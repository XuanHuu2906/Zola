#!/usr/bin/env node
/**
 * R11A read-only: print the definition + context of checkStartupOpenConvReq in each main-side bundle,
 * so the drain target window can be identified without guessing.
 *
 * Usage: node tools/r11a-drain-defs.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FILES = ['main-dist/main.js', 'main-dist/compact-app.js'];
const KEY = 'checkStartupOpenConvReq';

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-drain-defs.cjs <extracted-asar-root>');
  process.exit(2);
}

for (const rel of FILES) {
  const abs = path.join(root, rel);
  const text = fs.readFileSync(abs, 'utf8');
  let i = -1;
  console.log(`## ${rel}`);
  while ((i = text.indexOf(KEY, i + 1)) !== -1) {
    console.log(`  @${i} :: ${JSON.stringify(text.slice(i, i + 190))}`);
  }
  console.log('');
}
