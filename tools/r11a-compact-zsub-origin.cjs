#!/usr/bin/env node
/**
 * R11A read-only: if compact-app-pc.js reads $zsub but never defines it, where
 * does it come from? Look for every write-shape into $zsub and for the
 * URI descriptor table inside the compact bundle.
 *
 * Usage: node tools/r11a-compact-zsub-origin.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-compact-zsub-origin.cjs <root>');
  process.exit(2);
}

const rel = 'pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js';
const t = fs.readFileSync(path.join(root, rel), 'utf8');
console.log(`## ${rel} (${t.length} chars)`);

const K = [
  'globalThis.$zsub', 'self.$zsub', 'window.$zsub', 'this.$zsub',
  '["$zsub"]', "'$zsub'", '"$zsub"', '$zsub=',
  'z-uri-open-conv', 'z-uri-request', 'check-startup-open-conv-request', 'check-arg-link',
  'Z_URI_REQUEST', 'Z_URI_OPEN_CONV', 'CHECK_ON_START_UP', 'CHECK_ARG_LINK',
  '"$zuri"', '$zuri', '"$zapp"', '$zapp', '"$zwindow"',
  'verifySub', 'subBootstrap', '$zsubBootstrap',
];
for (const k of K) console.log(`   ${JSON.stringify(k).padEnd(38)} = ${t.split(k).length - 1}`);

console.log('\n--- every distinct $zsub.<member> in compact ---');
const mem = new Map();
let m;
const re = /\$zsub\.(\$?[A-Za-z_$][\w$]*)/g;
while ((m = re.exec(t)) !== null) mem.set(m[1], (mem.get(m[1]) || 0) + 1);
for (const [k, v] of [...mem.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(22)} ${v}`);

console.log('\n--- first 3 raw $zsub contexts ---');
let i = -1, c = 0;
while ((i = t.indexOf('$zsub', i + 1)) !== -1 && c < 3) {
  c++;
  console.log(`\n@${i} :: ` + JSON.stringify(t.slice(Math.max(0, i - 260), i + 200)));
}

console.log('\n--- does the compact bundle define the bridge factory (ipcRenderer-style)? ---');
for (const k of ['ipcRenderer', 'contextBridge', 'require("electron")', 'SUBSCRIBE_V2', 'RAW_SEND', 'STOP_PROVIDE']) {
  console.log(`   ${JSON.stringify(k)} = ${t.split(k).length - 1}`);
}
