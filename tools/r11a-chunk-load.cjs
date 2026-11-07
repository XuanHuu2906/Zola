#!/usr/bin/env node
/**
 * R11A read-only: is the $zsub wiring chunk (aa2b4a7e) loaded by the main
 * window? Look for its chunk id in the webpack runtime map and in any
 * dynamic import site.
 *
 * Usage: node tools/r11a-chunk-load.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-chunk-load.cjs <root>');
  process.exit(2);
}

const CHUNK = 'aa2b4a7eeda68a9f5e59';

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.js$/i.test(e.name)) out.push(p);
  }
}
const files = [];
walk(root, files);

console.log(`scanning ${files.length} js files for chunk id ${CHUNK}`);
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  if (!t.includes(CHUNK)) continue;
  const rel = path.relative(root, f);
  console.log(`\n## ${rel} :: x${t.split(CHUNK).length - 1}`);
  let i = -1;
  let c = 0;
  while ((i = t.indexOf(CHUNK, i + 1)) !== -1 && c < 3) {
    c++;
    console.log(`   @${i} :: ` + JSON.stringify(t.slice(Math.max(0, i - 300), i + 200)));
  }
}

// also: webpack chunk-id map entries like {123:"aa2b4a7eeda68a9f5e59"}
console.log('\n--- chunk id map lookups ---');
for (const f of files) {
  const rel = path.relative(root, f);
  if (!/render|compact-app|index/.test(rel)) continue;
  const t = fs.readFileSync(f, 'utf8');
  const re = new RegExp(`(\\d{1,4})\\s*:\\s*"${CHUNK}"`, 'g');
  let m;
  while ((m = re.exec(t)) !== null) console.log(`   ${rel} :: chunkId=${m[1]} @${m.index}`);
}
