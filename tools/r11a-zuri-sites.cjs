#!/usr/bin/env node
/**
 * R11A read-only: bind each `$zuri.checkOpenConvReq()` / `$zuri.checkArgvLink()`
 * call site to the function that contains it, and to the html entrypoint that
 * loads that bundle. Distinguishes "code shipped in this bundle" from "code
 * that runs in this window".
 *
 * Usage: node tools/r11a-zuri-sites.cjs <root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-zuri-sites.cjs <root>');
  process.exit(2);
}

const pc = path.join(root, 'pc-dist');

// A. which html loads which js
console.log('=== A. html -> script map (pc-dist) ===');
const loaders = new Map();
for (const f of fs.readdirSync(pc)) {
  if (!f.endsWith('.html')) continue;
  const t = fs.readFileSync(path.join(pc, f), 'utf8');
  for (const m of t.matchAll(/<script[^>]*src="([^"]+)"/g)) {
    if (!loaders.has(m[1])) loaders.set(m[1], []);
    loaders.get(m[1]).push(f);
  }
}
for (const [js, htmls] of [...loaders.entries()].sort()) {
  if (/compact-app-pc|search-worker|sync-v2-sub-worker|render\./.test(js)) {
    console.log(`   ${js.padEnd(52)} <- ${htmls.join(', ')}`);
  }
}

// B. exact context of the $zuri call sites in every file that has them
console.log('\n=== B. $zuri.check* call sites ===');
const FILES = [];
for (const d of [pc, path.join(pc, 'lazy')]) {
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) if (f.endsWith('.js')) FILES.push(path.join(d, f));
}
for (const abs of FILES) {
  const t = fs.readFileSync(abs, 'utf8');
  for (const member of ['$zuri.checkOpenConvReq', '$zuri.checkArgvLink']) {
    let i = -1;
    let c = 0;
    while ((i = t.indexOf(member, i + 1)) !== -1) {
      c++;
      console.log(`\n   [${path.basename(abs)}] ${member} @${i}`);
      console.log('   :: ' + JSON.stringify(t.slice(Math.max(0, i - 300), i + 200)));
    }
  }
}

// C. does compact-app-pc.js reference any html/entry bootstrap of its own?
console.log('\n=== C. compact-app-pc.js worker/bootstrap references ===');
{
  const t = fs.readFileSync(path.join(pc, 'compact-app-pc.f32c58b63b6f4273a8a4.js'), 'utf8');
  for (const k of ['shared-worker.html', 'znotification.html', 'new SharedWorker', 'SharedWorker(',
                   'search-worker', 'sync-v2-sub-worker', '__ZaBUNDLENAME__', 'compact-app-pc']) {
    console.log(`   ${JSON.stringify(k).padEnd(24)} = ${t.split(k).length - 1}`);
  }
}
