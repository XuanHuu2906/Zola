#!/usr/bin/env node
/**
 * R11A read-only: does the compact main process register any URI entry point
 * (second-instance, argv, open-url, protocol handler)? And which HTML pulls in
 * each startup chunk?
 *
 * Usage: node tools/r11a-compact-entry.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-compact-entry.cjs <root>');
  process.exit(2);
}

const KEYS = [
  'on("second-instance"',
  "on('second-instance'",
  'process.argv[1]&&',
  'requestSingleInstanceLock',
  'setAsDefaultProtocolClient',
  'open-url',
  'zalo://',
  'check-arg-link',
  'z-uri-open-conv',
  'z-uri-request',
  'check-startup-open-conv-request',
];

for (const rel of ['main-dist/main.js', 'main-dist/compact-app.js']) {
  const t = fs.readFileSync(path.join(root, rel), 'utf8');
  console.log(`\n===== ${rel} (${t.length} chars) =====`);
  for (const k of KEYS) console.log(`   ${JSON.stringify(k)} = ${t.split(k).length - 1}`);
}

console.log('\n===== HTML -> startup chunks =====');
for (const html of ['pc-dist/index.html', 'pc-dist/compact-app.html']) {
  const t = fs.readFileSync(path.join(root, html), 'utf8');
  const re = /src="([^"]+\.js)"/g;
  let m;
  const scripts = [];
  while ((m = re.exec(t)) !== null) scripts.push(m[1]);
  console.log(`\n## ${html}`);
  for (const s of scripts) {
    const base = path.basename(s);
    const startup = /startup-main-startup/.test(base);
    const znotif = /znotification/.test(base);
    console.log(`   ${startup ? 'STARTUP ' : '        '}${znotif ? 'ZNOTIF ' : '       '}${s}`);
  }
  // inline script tags too
  const inl = (t.match(/<script(?![^>]*\bsrc=)[^>]*>/g) || []).length;
  console.log(`   inline <script> count = ${inl}`);
}
