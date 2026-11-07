#!/usr/bin/env node
/**
 * R11A read-only: map the `$zsub` namespace surface and find where `$zuri`
 * is attached. Resolves which preload/global defines each `$zsub.$zXxx`.
 *
 * Usage: node tools/r11a-zuri-surface.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-zuri-surface.cjs <extracted-asar-root>');
  process.exit(2);
}

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|html)$/i.test(e.name)) out.push(p);
  }
}
const files = [];
walk(root, files);

const SUB_MEMBERS = new Set();
const ZURI_CTX = [];

for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  const rel = path.relative(root, f);

  // $zsub.$zXxx members actually used/defined
  let m;
  const re = /\$zsub\s*\.\s*(\$z[A-Za-z0-9_]+)/g;
  while ((m = re.exec(t)) !== null) SUB_MEMBERS.add(m[1]);

  // definitions of $zuri inside the $zsub world
  const defs = [
    /\$zsub\s*\.\s*\$zuri\s*=/g,
    /\$zsub\[\s*"\$zuri"\s*\]\s*=/g,
    /\$zuri\s*:\s*\{/g,
  ];
  for (const d of defs) {
    d.lastIndex = 0;
    let mm;
    while ((mm = d.exec(t)) !== null) {
      ZURI_CTX.push({ rel, pat: d.source, at: mm.index, ctx: t.slice(Math.max(0, mm.index - 220), mm.index + 420) });
    }
  }

  // preload-side exposure of any $z bridge
  if (/preload/i.test(rel)) {
    const subs = ['$zuri', '$zsub', '$zapp', '$zwindow', '$zdownload', '$zMetric', '$zlogin', '$zscreencap', '$zperf'];
    const row = [];
    for (const s of subs) {
      const exp = t.split(`exposeInMainWorld("${s}"`).length - 1;
      const set = t.split(`window.${s}=`).length - 1;
      const gt = t.split(`globalThis.${s}`).length - 1;
      if (exp || set || gt) row.push(`${s}: expose=${exp} window=${set} globalThis=${gt}`);
    }
    if (row.length) console.log(`PRELOAD ${rel}\n   ` + row.join('\n   '));
  }
}

console.log('\n$zsub MEMBERS USED = ' + JSON.stringify([...SUB_MEMBERS].sort()));
console.log('\nLEDGER ($zsub.$zuri definition sites):');
if (!ZURI_CTX.length) console.log('   none');
for (const z of ZURI_CTX) {
  console.log(`\n   ${z.rel} :: ${z.pat} @${z.at}\n   ${JSON.stringify(z.ctx)}`);
}
