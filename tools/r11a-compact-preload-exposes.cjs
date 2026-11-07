#!/usr/bin/env node
/**
 * R11A read-only: enumerate every exposeInMainWorld name in each preload, so
 * the compact window's actual bridge surface is exact.
 *
 * Usage: node tools/r11a-compact-preload-exposes.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-compact-preload-exposes.cjs <root>');
  process.exit(2);
}

const PRELOADS = [
  'main-dist/preload-render.js',
  'main-dist/compact-app-preload.js',
  'main-dist/preload-noti.js',
  'main-dist/preload-shared-worker.js',
  'main-dist/preload-sqlite.js',
];

for (const rel of PRELOADS) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) { console.log(`## ${rel} :: MISSING\n`); continue; }
  const t = fs.readFileSync(p, 'utf8');
  const names = new Map();
  let m;
  const re = /exposeInMainWorld\(\s*"([^"]+)"/g;
  while ((m = re.exec(t)) !== null) names.set(m[1], (names.get(m[1]) || 0) + 1);
  const re2 = /exposeInMainWorld\(\s*'([^']+)'/g;
  while ((m = re2.exec(t)) !== null) names.set(m[1], (names.get(m[1]) || 0) + 1);
  console.log(`## ${rel} (${t.length} chars)  exposed=${names.size}`);
  for (const [k, v] of [...names.entries()].sort()) console.log(`   ${k.padEnd(28)} x${v}`);
  console.log('');
}
