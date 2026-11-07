#!/usr/bin/env node
/**
 * R11A read-only: <script src> for EVERY .html under pc-dist, so the html→script
 * table in the report covers all entry points, not just the two main ones.
 *
 * Usage: node tools/r11a-all-html.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-all-html.cjs <root>');
  process.exit(2);
}

const pc = path.join(root, 'pc-dist');
const files = fs.readdirSync(pc).filter((f) => f.endsWith('.html')).sort();

for (const f of files) {
  const t = fs.readFileSync(path.join(pc, f), 'utf8');
  const srcs = [...t.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
  console.log(`${f}`);
  if (!srcs.length) console.log('   (no <script src>)');
  for (const s of srcs) console.log(`   ${s}`);
}
