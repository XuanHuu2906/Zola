#!/usr/bin/env node
/**
 * R11A read-only: the compact WINDOW uses preload `compact-app-preload.js`
 * on partition "compact-app". Inspect that file's bridge surface.
 *
 * Usage: node tools/r11a-compact-preload.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-compact-preload.cjs <root>');
  process.exit(2);
}

const rel = 'main-dist/compact-app-preload.js';
const p = path.join(root, rel);
console.log(`exists(${rel}) = ${fs.existsSync(p)}`);
if (!fs.existsSync(p)) {
  const d = path.join(root, 'main-dist');
  console.log('main-dist entries:', fs.readdirSync(d).filter((x) => /preload/i.test(x)).join(', '));
  process.exit(0);
}

const t = fs.readFileSync(p, 'utf8');
console.log(`chars = ${t.length}`);

const K = [
  'exposeInMainWorld', '$zuri', '$zsub', '$zapp', '$zwindow', '$zscreencap', '$zdownload',
  '$zcall', '$zlogin', '$zupdater', '$zdb', '$zMsgChannel', '$zFeatures',
  'ipcRenderer', 'contextBridge', 'z-uri-open-conv', 'z-uri-request',
  'check-startup-open-conv-request', 'check-arg-link',
  'Z_URI_REQUEST', 'Z_URI_OPEN_CONV', 'CHECK_ON_START_UP', 'CHECK_ARG_LINK',
  'SUBSCRIBE', 'UNSUBSCRIBE', 'RAW_SEND', 'REQUEST',
];
for (const k of K) console.log(`   ${JSON.stringify(k).padEnd(36)} = ${t.split(k).length - 1}`);

const i = t.indexOf('exposeInMainWorld');
if (i >= 0) console.log('\nEXPOSE_CTX :: ' + JSON.stringify(t.slice(Math.max(0, i - 900), i + 900)));
