#!/usr/bin/env node
/**
 * R11A read-only: list <script src> per HTML entry point.
 *
 * Usage: node tools/r11a-html-scripts.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-html-scripts.cjs <extracted-asar-root>');
  process.exit(2);
}

for (const rel of ['pc-dist/index.html', 'pc-dist/compact-app.html']) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) {
    console.log(`${rel} MISSING`);
    continue;
  }
  const t = fs.readFileSync(p, 'utf8');
  const srcs = [];
  const re = /<script[^>]*\bsrc="([^"]+)"/g;
  let m;
  while ((m = re.exec(t)) !== null) srcs.push(m[1]);
  console.log(`${rel} -> ${JSON.stringify(srcs)}`);
}
