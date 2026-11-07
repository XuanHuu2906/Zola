#!/usr/bin/env node
/**
 * R11A read-only: find EVERY definition of the $zsub global across the whole
 * extracted app, and every $zuri definition/use, so the compact renderer's
 * unguarded $zsub reads can be attributed to a real definer or declared
 * unreachable.
 *
 * Usage: node tools/r11a-zsub-defs-tree.cjs <extracted-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-zsub-defs-tree.cjs <root>');
  process.exit(2);
}

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (/\.(js|html)$/i.test(e.name)) files.push(f);
  }
})(root);

const DEF_PATTERNS = [
  [/globalThis\.\$zsub\s*=\s*\{\s*\}/g, 'globalThis.$zsub={}'],
  [/window\.\$zsub\s*=\s*\{\s*\}/g, 'window.$zsub={}'],
  [/self\.\$zsub\s*=\s*\{\s*\}/g, 'self.$zsub={}'],
  [/(?:var|let|const)\s+\$zsub\s*=/g, 'var/let/const $zsub='],
  [/\$zsub\s*=\s*\{\s*\}/g, '$zsub={} (any)'],
];

const ZURI_DEF = [
  [/contextBridge\.exposeInMainWorld\(\s*["']\$zuri["']/g, 'expose $zuri'],
  [/window\.\$zuri\s*=/g, 'window.$zuri='],
];

console.log(`scanned files = ${files.length}\n`);
console.log('=== $zsub definitions ===');
let anySub = false;
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  for (const [re, label] of DEF_PATTERNS) {
    const hits = t.match(re);
    if (!hits) continue;
    anySub = true;
    const rel = path.relative(root, f);
    for (const h of new Set(hits)) console.log(`  ${rel.padEnd(78)} ${label.padEnd(22)} x${hits.length}  ${JSON.stringify(h)}`);
  }
}
if (!anySub) console.log('  NONE');

console.log('\n=== $zuri definitions ===');
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  for (const [re, label] of ZURI_DEF) {
    const hits = t.match(re);
    if (!hits) continue;
    console.log(`  ${path.relative(root, f).padEnd(78)} ${label.padEnd(22)} x${hits.length}`);
  }
}

console.log('\n=== per-file $zsub / $zuri literal counts ===');
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  const sub = t.split('$zsub').length - 1;
  const uri = t.split('$zuri').length - 1;
  if (!sub && !uri) continue;
  console.log(`  ${path.relative(root, f).padEnd(78)} $zsub=${String(sub).padEnd(5)} $zuri=${uri}`);
}
