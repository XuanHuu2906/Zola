#!/usr/bin/env node
/**
 * R11A read-only: show the full preload filename at each window-construction site.
 *
 * Usage: node tools/r11a-preload-names.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-preload-names.cjs <extracted-asar-root>');
  process.exit(2);
}

for (const rel of ['main-dist/main.js', 'main-dist/compact-app.js']) {
  const t = fs.readFileSync(path.join(root, rel), 'utf8');
  console.log(`## ${rel}`);
  const re = /preload:\s*[a-z]\.(?:join|resolve)\(__dirname\s*,\s*"([^"]+)"\)/g;
  let m;
  const seen = new Set();
  while ((m = re.exec(t)) !== null) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    console.log(`   @${m.index} preload=${m[1]}`);
  }
  console.log('');
}
