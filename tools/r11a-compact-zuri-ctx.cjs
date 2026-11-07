#!/usr/bin/env node
/**
 * R11A read-only: exact context of the two `$zuri` references in the compact
 * renderer, and whether the enclosing code is reachable in the compact window.
 *
 * Usage: node tools/r11a-compact-zuri-ctx.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-compact-zuri-ctx.cjs <root>');
  process.exit(2);
}

const RELS = [
  'pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js',
  'pc-dist/lazy/default-login-main-startup-shared-worker-znotification.aafd08147de6e983b76f.js',
];

for (const rel of RELS) {
  const t = fs.readFileSync(path.join(root, rel), 'utf8');
  console.log(`\n===== ${rel} (${t.length} chars) =====`);
  let i = -1;
  let c = 0;
  while ((i = t.indexOf('$zuri', i + 1)) !== -1) {
    c++;
    console.log(`\nZURI#${c} @${i}`);
    console.log(JSON.stringify(t.slice(Math.max(0, i - 900), i + 700)));
  }
}
