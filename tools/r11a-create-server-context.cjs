#!/usr/bin/env node
/**
 * R11A: dump context around every `createServer` occurrence in main-side bundles.
 * Read-only. Output tells OBSERVED server creation apart from polyfill/boilerplate.
 *
 * Usage: node tools/r11a-create-server-context.cjs <extracted-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FILES = [
  'main-dist/main.js',
  'main-dist/compact-app.js',
  'main-dist/preload-render.js',
  'pc-dist/shared-worker.f32c58b63b6f4273a8a4.js',
  'pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js',
  'pc-dist/search-worker.f32c58b63b6f4273a8a4.js',
  'pc-dist/sync-v2-sub-worker.f32c58b63b6f4273a8a4.js',
  'pc-dist/lazy/default-login-main-startup-shared-worker-znotification.aafd08147de6e983b76f.js',
];

const PAD = 220;

function main() {
  const root = process.argv[2];
  if (!root) {
    console.error('usage: node tools/r11a-create-server-context.cjs <extracted-root>');
    process.exit(2);
  }
  const key = 'createServer';
  for (const rel of FILES) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) {
      console.log(`## ${rel} MISSING`);
      continue;
    }
    const text = fs.readFileSync(abs, 'utf8');
    let idx = -1;
    let n = 0;
    const total = text.split(key).length - 1;
    console.log(`## ${rel} createServer total=${total}`);
    while ((idx = text.indexOf(key, idx + 1)) !== -1 && n < 12) {
      const a = Math.max(0, idx - PAD);
      const b = Math.min(text.length, idx + key.length + PAD);
      const head = text.slice(Math.max(0, idx - 90), idx);
      console.log(`  @${idx} BEFORE=${JSON.stringify(head.slice(-90))}`);
      console.log(`    ${text.slice(a, b).replace(/\s+/g, ' ')}`);
      n++;
    }
    console.log('');
  }
}

main();
