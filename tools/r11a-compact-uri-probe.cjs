#!/usr/bin/env node
/**
 * R11A read-only: what does the compact renderer actually do with the URI bridge?
 *
 * Usage: node tools/r11a-compact-uri-probe.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-compact-uri-probe.cjs <extracted-asar-root>');
  process.exit(2);
}

const FILES = {
  'pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js': 'renderer (compact)',
  'pc-dist/render.f32c58b63b6f4273a8a4.js': 'renderer (main)',
  'main-dist/preload-render.js': 'preload (shared by both)',
};

const KEYS = [
  'window.$zuri',
  'exposeInMainWorld("$zuri"',
  '$zuri.checkOpenConvReq(',
  '$zuri.checkArgvLink(',
  '$zuri.onRequestOpenConv(',
  '$zuri.onNewRequest(',
  'z-uri-open-conv',
  'z-uri-request',
];

for (const rel of Object.keys(FILES)) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    console.log(`## ${rel} MISSING`);
    continue;
  }
  const t = fs.readFileSync(abs, 'utf8');
  const row = {};
  for (const k of KEYS) row[k] = t.split(k).length - 1;
  console.log(`## ${rel} (${FILES[rel]}) ${t.length} chars`);
  console.log('   ' + JSON.stringify(row));
}
