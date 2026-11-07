#!/usr/bin/env node
/**
 * R11A read-only: print the complete `X` ($zuri) descriptor table verbatim.
 *
 * Usage: node tools/r11a-x-table.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-x-table.cjs <root>');
  process.exit(2);
}

const rel = 'pc-dist/lazy/default-login-startup-main-startup-shared-worker-znotification.aa2b4a7eeda68a9f5e59.js';
const t = fs.readFileSync(path.join(root, rel), 'utf8');

const start = t.indexOf('let x=function(e){return e.Z_URI_REQUEST');
const end = t.indexOf('};', t.indexOf('checkArgvLink', start));
const seg = t.slice(start, end + 2);
console.log(`## ${rel}`);
console.log(`range [${start}, ${end + 2})  len=${seg.length}`);
console.log('\n' + seg + '\n');

// enumerate apiKey/type pairs
const re = /(\w+):\{apiKey:(x\.[A-Z_]+),type:S\.([A-Z_0-9]+)\}/g;
let m;
const rows = [];
while ((m = re.exec(seg)) !== null) rows.push({ method: m[1], key: m[2], type: m[3] });
console.log('PARsed rows = ' + rows.length);
for (const r of rows) console.log(`   ${r.method.padEnd(34)} ${r.key.padEnd(22)} ${r.type}`);
