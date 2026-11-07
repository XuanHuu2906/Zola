#!/usr/bin/env node
/**
 * R11A read-only: extract every `@<digits>` offset citation from the R11A
 * reports and print the actual bytes at that offset in each candidate bundle.
 * A human can then see whether the cited offset still lands on the code the
 * sentence claims. Also flags offsets that exceed every bundle length.
 *
 * Each hit is prefixed `*` when the byte before the offset is a JS token
 * boundary (or offset 0) and ` ` otherwise — a cited offset should have exactly
 * one `*` hit, in the bundle the sentence names. Everything else is a fragment
 * that merely happens to be long enough.
 *
 * Usage: node tools/r11a-audit-report-offsets.cjs <root> <report.md> [...]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const [root, ...reports] = process.argv.slice(2);
if (!root || !reports.length) {
  console.error('usage: node tools/r11a-audit-report-offsets.cjs <root> <report.md> [...]');
  process.exit(2);
}

const BUNDLES = {
  main: 'main-dist/main.js',
  compact: 'main-dist/compact-app.js',
  'compact-pc': 'pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js',
  preload: 'main-dist/preload-render.js',
  'compact-preload': 'main-dist/compact-app-preload.js',
  wiring: 'pc-dist/lazy/default-login-startup-main-startup-shared-worker-znotification.aa2b4a7eeda68a9f5e59.js',
  'lazy-ec7326': 'pc-dist/lazy/default-login-startup-main-startup.ec73261654e4ce9540ac.js',
  render: 'pc-dist/render.f32c58b63b6f4273a8a4.js',
};

const cache = new Map();
function get(k) {
  if (!cache.has(k)) {
    try { cache.set(k, fs.readFileSync(path.join(root, BUNDLES[k]), 'utf8')); }
    catch { cache.set(k, null); }
  }
  return cache.get(k);
}

const BOUNDARY = new Set(['{', '}', '(', ')', '[', ']', ';', ',', '\n', '=', ':']);
function atBoundary(s, off) {
  return off === 0 || BOUNDARY.has(s[off - 1]);
}

for (const rel of reports) {
  const md = fs.readFileSync(rel, 'utf8');
  const seen = new Map();
  const re = /@(\d{3,9})/g;
  let m;
  while ((m = re.exec(md)) !== null) {
    const off = Number(m[1]);
    const line = md.slice(0, m.index).split('\n').length;
    if (!seen.has(off)) seen.set(off, []);
    seen.get(off).push(line);
  }
  console.log(`\n########## ${rel} — ${seen.size} distinct offset(s) ##########`);
  for (const [off, lines] of [...seen.entries()].sort((a, b) => a[0] - b[0])) {
    const hits = [];
    for (const k of Object.keys(BUNDLES)) {
      const s = get(k);
      if (s && off < s.length) {
        const frag = s.slice(off, off + 64).replace(/\s+/g, ' ');
        hits.push(`${atBoundary(s, off) ? '*' : ' '} ${k}: ${JSON.stringify(frag)}`);
      }
    }
    console.log(`\n@${off}  (lines ${lines.join(',')})`);
    for (const h of hits) console.log(`   ${h}`);
    if (!hits.length) console.log('   !! exceeds every bundle length');
  }
}
