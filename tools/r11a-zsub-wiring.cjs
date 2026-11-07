#!/usr/bin/env node
/**
 * R11A read-only: how is `$zsub.$zuri` populated? Dump every `$zuri` occurrence
 * with context inside the only two files that mention `globalThis.$zsub`.
 *
 * Usage: node tools/r11a-zsub-wiring.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-zsub-wiring.cjs <extracted-asar-root>');
  process.exit(2);
}

const FILES = [
  'main-dist/preload-sqlite.js',
  'pc-dist/lazy/default-login-startup-main-startup-shared-worker-znotification.aa2b4a7eeda68a9f5e59.js',
];

for (const rel of FILES) {
  const t = fs.readFileSync(path.join(root, rel), 'utf8');
  console.log(`\n===== ${rel} (${t.length} chars) =====`);

  // where is $zsub assigned its members
  const PATS = ['Object.assign($zsub', '$zsub.', 'globalThis.$zsub'];
  for (const pat of PATS) {
    const idxs = [];
    let i = -1;
    while ((i = t.indexOf(pat, i + 1)) !== -1 && idxs.length < 8) idxs.push(i);
    console.log(`PAT ${JSON.stringify(pat)} -> ${JSON.stringify(idxs)}`);
  }

  // every $zuri with context
  let i = -1;
  let c = 0;
  while ((i = t.indexOf('$zuri', i + 1)) !== -1) {
    c++;
    console.log(`\nZURI#${c} @${i} :: ` + JSON.stringify(t.slice(Math.max(0, i - 320), i + 360)));
    if (c >= 12) break;
  }
  console.log(`\n$zuri count in file = ${t.split('$zuri').length - 1}`);

  // the module export table that likely feeds $zsub
  const m = /\$zsub\s*=\s*\{[^}]{0,600}\}/.exec(t);
  if (m) console.log('\nZSUB_LITERAL :: ' + JSON.stringify(m[0]));
}
