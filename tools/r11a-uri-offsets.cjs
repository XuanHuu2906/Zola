#!/usr/bin/env node
/**
 * R11A read-only: exact offsets for the main-side URI symbols, so report citations
 * point at the definition rather than a nearby token.
 *
 * Usage: node tools/r11a-uri-offsets.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-uri-offsets.cjs <extracted-asar-root>');
  process.exit(2);
}

const TARGETS = {
  'main-dist/main.js': [
    'function Hn(e)',
    'checkStartupOpenConvReq:function',
    'process.argv[1]&&Hn(process.argv)',
    'on("second-instance"',
    'on("check-arg-link"',
    'checkOpenConvReq:function',
  ],
  'main-dist/preload-render.js': [
    'checkOpenConvReq:{apiKey',
    'checkArgvLink:{apiKey',
    'case i.a.REQUEST:',
    'case i.a.RAW_SEND:',
  ],
  'pc-dist/lazy/default-login-main-startup-shared-worker-znotification.aafd08147de6e983b76f.js': [
    '$zuri.checkOpenConvReq(',
    '$zuri.checkArgvLink(',
  ],
};

for (const rel of Object.keys(TARGETS)) {
  const abs = path.join(root, rel);
  const text = fs.readFileSync(abs, 'utf8');
  console.log(`## ${rel}`);
  for (const key of TARGETS[rel]) {
    let i = -1;
    const hits = [];
    while ((i = text.indexOf(key, i + 1)) !== -1) hits.push(i);
    console.log(`  ${JSON.stringify(key)} -> ${JSON.stringify(hits)}`);
  }
  console.log('');
}
