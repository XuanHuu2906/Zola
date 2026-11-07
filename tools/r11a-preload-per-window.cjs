#!/usr/bin/env node
/**
 * R11A read-only: which preload does each main-side window specify?
 *
 * Usage: node tools/r11a-preload-per-window.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-preload-per-window.cjs <extracted-asar-root>');
  process.exit(2);
}

for (const rel of ['main-dist/main.js', 'main-dist/compact-app.js']) {
  const t = fs.readFileSync(path.join(root, rel), 'utf8');
  console.log(`## ${rel}`);
  const re = /preload:\s*[^,}]{0,160}/g;
  let m;
  const seen = new Set();
  while ((m = re.exec(t)) !== null) {
    const s = m[0].replace(/\s+/g, ' ');
    if (seen.has(s)) continue;
    seen.add(s);
    console.log(`   @${m.index} ${s}`);
  }
  console.log('');

  // which html does it load
  const re2 = /(compact-app\.html|index\.html)/g;
  let m2;
  const pages = new Set();
  while ((m2 = re2.exec(t)) !== null) pages.add(m2[1]);
  console.log('   PAGES_REFERENCED = ' + JSON.stringify([...pages]));
  console.log('');
}
