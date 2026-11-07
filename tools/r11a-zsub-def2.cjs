#!/usr/bin/env node
/**
 * R11A read-only: search for any non-`$zsub` spelling that could create the
 * namespace in the compact renderer (property define, concat, webpack external,
 * preload-injected global). Print every hit with context.
 *
 * Usage: node tools/r11a-zsub-def2.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-zsub-def2.cjs <root>');
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

const PATS = [
  /defineProperty\([^)]{0,60}\$zs/,
  /\$zs"\+"ub/,
  /\$z"\+\"sub/,
  /"\$zs"\+/,
  /zsu[bB]"\s*\]/,
  /window\[[^\]]{0,20}zsub/,
  /globalThis\[[^\]]{0,20}zsub/,
  /self\[[^\]]{0,20}zsub/,
];

console.log('--- property-define / bracket-access shapes ---');
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  for (const re of PATS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(t)) !== null) {
      console.log(`${path.relative(root, f)} :: ${re.source} @${m.index}\n   ` + JSON.stringify(t.slice(Math.max(0, m.index - 200), m.index + 240)));
    }
  }
}

// In the compact bundle, is `zsub` referenced WITHOUT the dollar anywhere?
{
  const rel = 'pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js';
  const t = fs.readFileSync(path.join(root, rel), 'utf8');
  const bare = [];
  let m;
  const re = /(?<!\$)\bzsub\b/g;
  while ((m = re.exec(t)) !== null && bare.length < 8) bare.push(m.index);
  console.log(`\ncompact bare "zsub" (not $zsub) -> ${JSON.stringify(bare)}`);
  for (const b of bare) console.log('   ' + JSON.stringify(t.slice(Math.max(0, b - 180), b + 180)));
}
