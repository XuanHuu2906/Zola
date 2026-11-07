#!/usr/bin/env node
/**
 * R11A read-only: which renderer bundles actually SUBSCRIBE to the URI channels,
 * as opposed to merely calling the queue-drain bridge methods.
 *
 * Usage: node tools/r11a-uri-subscriber-check.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FILES = [
  'pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js',
  'pc-dist/search-worker.f32c58b63b6f4273a8a4.js',
  'pc-dist/sync-v2-sub-worker.f32c58b63b6f4273a8a4.js',
  'pc-dist/shared-worker.f32c58b63b6f4273a8a4.js',
  'pc-dist/lazy/default-login-startup-main-startup.ec73261654e4ce9540ac.js',
  'pc-dist/lazy/default-login-main-startup-shared-worker-znotification.aafd08147de6e983b76f.js',
  'pc-dist/lazy/default-login-startup-main-startup-shared-worker-znotification.aa2b4a7eeda68a9f5e59.js',
];

const KEYS = [
  '$zuri.onRequestOpenConv(',
  '$zuri.onNewRequest(',
  '$zuri.checkOpenConvReq(',
  '$zuri.checkArgvLink(',
  'Z_URI_OPEN_CONV',
  'Z_URI_REQUEST',
  'CHECK_ON_START_UP',
  'CHECK_ARG_LINK',
];

function main() {
  const root = process.argv[2];
  if (!root) {
    console.error('usage: node tools/r11a-uri-subscriber-check.cjs <extracted-asar-root>');
    process.exit(2);
  }
  console.log(JSON.stringify({ root, note: 'lexical counts, not call sites' }, null, 2));
  for (const rel of FILES) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) {
      console.log(`## ${rel} MISSING`);
      continue;
    }
    const text = fs.readFileSync(abs, 'utf8');
    const row = {};
    for (const k of KEYS) row[k] = text.split(k).length - 1;
    console.log(`## ${rel}  (${text.length} chars)`);
    console.log('   ' + JSON.stringify(row));
  }
}

main();
