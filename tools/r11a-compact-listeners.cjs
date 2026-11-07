#!/usr/bin/env node
/**
 * R11A read-only: does the compact renderer register ANY $zuri listener?
 *
 * Usage: node tools/r11a-compact-listeners.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-compact-listeners.cjs <extracted-asar-root>');
  process.exit(2);
}

const FILES = [
  'pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js',
  'pc-dist/lazy/default-login-startup-main-startup.ec73261654e4ce9540ac.js',
];

const KEYS = [
  '$zuri.on',
  '.onRequestOpenConv',
  '.onNewRequest',
  '.removeListenRequestOpenConv',
  '.removeListenNewRequest',
  '$zuri.checkOpenConvReq',
  '$zuri.checkArgvLink',
];

for (const rel of FILES) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  console.log(`## ${rel}`);
  for (const k of KEYS) {
    const n = text.split(k).length - 1;
    console.log(`   ${k} = ${n}`);
  }
  // show every $zuri.<method> the bundle actually calls
  const used = new Set();
  const re = /\$zuri\.([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(text)) !== null) used.add(m[1]);
  console.log('   METHODS_USED = ' + JSON.stringify([...used].sort()));
  console.log('');
}
