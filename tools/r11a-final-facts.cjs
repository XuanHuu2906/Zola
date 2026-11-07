#!/usr/bin/env node
/**
 * R11A read-only: settle (a) which page the compact process loads into its
 * main window, (b) whether preload-render.js mentions zsub at all,
 * (c) whether any `$zsub` occurrence in the compact bundle is a write.
 *
 * Usage: node tools/r11a-final-facts.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-final-facts.cjs <root>');
  process.exit(2);
}

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

console.log('=== (a) compact-app.js page targets ===');
{
  const t = read('main-dist/compact-app.js');
  for (const k of ['"index.html"', '"compact-app.html"', 'getHtml(']) {
    console.log(`   ${JSON.stringify(k)} = ${t.split(k).length - 1}`);
  }
  let i = -1;
  let c = 0;
  while ((i = t.indexOf('getHtml(', i + 1)) !== -1 && c < 6) {
    c++;
    console.log(`   getHtml#${c} @${i} :: ` + JSON.stringify(t.slice(Math.max(0, i - 160), i + 160)));
  }
}

console.log('\n=== (b) preload-render.js zsub mentions ===');
{
  const t = read('main-dist/preload-render.js');
  for (const k of ['zsub', 'ZSUB', '$zsub']) console.log(`   ${JSON.stringify(k)} = ${t.split(k).length - 1}`);
}

console.log('\n=== (c) compact bundle: what follows each $zsub ===');
{
  const rel = 'pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js';
  const t = read(rel);
  const tally = new Map();
  let i = -1;
  let n = 0;
  while ((i = t.indexOf('$zsub', i + 1)) !== -1) {
    n++;
    const after = t.slice(i + 5, i + 7);
    tally.set(after, (tally.get(after) || 0) + 1);
  }
  console.log(`   total = ${n}`);
  for (const [k, v] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   after '$zsub' -> ${JSON.stringify(k)} x${v}`);
  }
}

console.log('\n=== (d) compact process: index.html references ===');
{
  const t = read('main-dist/compact-app.js');
  let i = -1;
  let c = 0;
  while ((i = t.indexOf('index.html', i + 1)) !== -1 && c < 4) {
    c++;
    console.log(`\n  index.html#${c} @${i} :: ` + JSON.stringify(t.slice(Math.max(0, i - 300), i + 200)));
  }
}
