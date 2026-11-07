#!/usr/bin/env node
/**
 * R11A read-only: resolve the compact-window contradiction.
 *
 * compact-app-pc.js reads the global $zsub 140 times. $zsub has exactly two
 * definers in the app: preload-sqlite.js (isolated world of the sqlite window)
 * and chunk aa2b4a7e (main window). The compact window's preload
 * (compact-app-preload.js) exposes neither. Either (a) something else attaches
 * a definer to the compact window, (b) compact-app.html is loaded in a window
 * whose preload is preload-render.js, or (c) those call sites are unreachable.
 *
 * Usage: node tools/r11a-compact-contradiction.cjs <root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-compact-contradiction.cjs <root>');
  process.exit(2);
}

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

// ---- A. every site across main-dist that can attach a session-wide preload ----
console.log('=== A. session-level preload attachment across main-dist ===');
for (const rel of ['main-dist/main.js', 'main-dist/compact-app.js', 'main-dist/second-instance.js', 'main-dist/0.js', 'main-dist/9.js', 'main-dist/10.js']) {
  let t;
  try { t = read(rel); } catch { continue; }
  const row = ['setPreloads', 'getPreloads', 'registerPreloadScript', 'compact-app.html']
    .map((k) => `${k}=${t.split(k).length - 1}`);
  console.log(`  ${rel.padEnd(36)} ${row.join('  ')}`);
}

// ---- B. every script the compact window could load ----
console.log('\n=== B. where compact-app.html / compact-app-pc are named ===');
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (/\.(js|html)$/i.test(e.name)) files.push(f);
  }
})(root);
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  for (const k of ['compact-app.html', 'compact-app-pc']) {
    const n = t.split(k).length - 1;
    if (n) console.log(`  ${path.relative(root, f).padEnd(70)} ${k} = ${n}`);
  }
}

// ---- C. getHtml implementation ----
console.log('\n=== C. getHtml ===');
{
  const t = read('main-dist/compact-app.js');
  let i = -1; let c = 0;
  while ((i = t.indexOf('getHtml', i + 1)) !== -1 && c < 6) {
    c++;
    console.log(`\n  @${i} :: ${JSON.stringify(t.slice(Math.max(0, i - 300), i + 320))}`);
  }
}

// ---- D. the POOw generic-expose helper: who calls it, with what name ----
console.log('\n=== D. POOw consumers in compact-app-preload ===');
{
  const t = read('main-dist/compact-app-preload.js');
  let i = -1; let c = 0;
  while ((i = t.indexOf('"POOw"', i + 1)) !== -1 && c < 6) {
    c++;
    console.log(`\n  @${i} :: ${JSON.stringify(t.slice(Math.max(0, i - 100), i + 900))}`);
  }
}

// ---- E. is CompactAppWindowLoader.load() actually invoked? ----
console.log('\n=== E. CompactAppWindowLoader invocation in compact-app.js ===');
{
  const t = read('main-dist/compact-app.js');
  for (const k of ['CompactAppWindowLoader', '.load()', 'compactAppWindowLoader']) {
    console.log(`  ${JSON.stringify(k).padEnd(28)} = ${t.split(k).length - 1}`);
  }
  let i = -1; let c = 0;
  while ((i = t.indexOf('CompactAppWindowLoader', i + 1)) !== -1 && c < 10) {
    c++;
    console.log(`\n  @${i} :: ${JSON.stringify(t.slice(Math.max(0, i - 300), i + 300))}`);
  }
}
