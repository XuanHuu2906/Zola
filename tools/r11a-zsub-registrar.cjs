#!/usr/bin/env node
/**
 * R11A read-only: dump the `Ke(...)` registrar body and the surrounding
 * bridge-wiring module in aa2b4a7eeda68a9f5e59.js so `$zsub.$zuri` attachment
 * is citable precisely.
 *
 * Usage: node tools/r11a-zsub-registrar.cjs <extracted-asar-root> [start] [len]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
const startArg = process.argv[3];
const lenArg = process.argv[4];
if (!root) {
  console.error('usage: node tools/r11a-zsub-registrar.cjs <root> [start] [len]');
  process.exit(2);
}

const rel = 'pc-dist/lazy/default-login-startup-main-startup-shared-worker-znotification.aa2b4a7eeda68a9f5e59.js';
const t = fs.readFileSync(path.join(root, rel), 'utf8');
console.log(`## ${rel} (${t.length} chars)`);

const anchor = 'Ke("$zuri"';
const at = t.indexOf(anchor);
console.log(`anchor ${JSON.stringify(anchor)} @${at}`);

const from = startArg ? Number(startArg) : Math.max(0, at - 9000);
const len = lenArg ? Number(lenArg) : 14000;
console.log(`window [${from}, ${from + len})`);

// Print with a preview cut so the log stays readable but complete in parts.
const seg = t.slice(from, from + len);
const CHUNK = 1400;
for (let i = 0; i < seg.length; i += CHUNK) {
  console.log(`\n--- @${from + i} ---`);
  console.log(seg.slice(i, i + CHUNK));
}
