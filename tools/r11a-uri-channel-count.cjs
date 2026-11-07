#!/usr/bin/env node
/**
 * R11A read-only: count URI-channel tokens per renderer bundle.
 * Lexical counts, not call sites.
 *
 * Usage: node tools/r11a-uri-channel-count.cjs <extracted-asar-root>
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
  'z-uri-open-conv',
  'z-uri-request',
  'onRequestOpenConv',
  'onNewRequest',
  'checkOpenConvReq(',
  'checkArgvLink(',
  'conversation/?',
  'autoOpenConversationByPhone',
  'doActionWithUri',
];

function main() {
  const root = process.argv[2];
  if (!root) {
    console.error('usage: node tools/r11a-uri-channel-count.cjs <extracted-asar-root>');
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
