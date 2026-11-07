#!/usr/bin/env node
/**
 * R11A read-only: locate the `X` descriptor table bound to `$zuri` by
 * `Ke("$zuri",$zuri,X)` in aa2b4a7eeda68a9f5e59.js.
 *
 * Usage: node tools/r11a-zuri-desc.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-zuri-desc.cjs <root>');
  process.exit(2);
}

const rel = 'pc-dist/lazy/default-login-startup-main-startup-shared-worker-znotification.aa2b4a7eeda68a9f5e59.js';
const t = fs.readFileSync(path.join(root, rel), 'utf8');
console.log(`## ${rel} (${t.length} chars)`);

const zone = t.slice(0, t.indexOf('Ke("$zuri"'));

// declarations of X: X=..., const X={...}, let X={...}
const re = /(?:^|[^.\w$])(?:const |let |var )?X\s*=\s*/g;
let m;
const hits = [];
while ((m = re.exec(zone)) !== null) hits.push(m.index);
console.log('X= declaration candidates -> ' + JSON.stringify(hits.slice(-10)));

// find the Z_URI enum definition (z-uri-open-conv)
for (const k of ['z-uri-open-conv', 'z-uri-request', 'check-startup-open-conv-request', 'check-arg-link']) {
  let i = -1;
  const all = [];
  while ((i = t.indexOf(k, i + 1)) !== -1 && all.length < 6) all.push(i);
  console.log(`\n${JSON.stringify(k)} -> ${JSON.stringify(all)}`);
  for (const a of all) {
    console.log('   ctx :: ' + JSON.stringify(t.slice(Math.max(0, a - 380), a + 380)));
  }
}
