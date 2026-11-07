#!/usr/bin/env node
/**
 * R11A read-only: resolve how the compact renderer's 140 `$zsub.*` reads are
 * satisfied. Three questions:
 *   1. Is every `$zsub` in the compact renderer a pure read (followed by `.`)?
 *   2. Does the compact preload build names by concatenation ("$z"+...)?
 *   3. Who calls the generic expose helper module POOw in the compact preload?
 *
 * Usage: node tools/r11a-zsub-dynamic.cjs <root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-zsub-dynamic.cjs <root>');
  process.exit(2);
}

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

// ---- 1. compact renderer: $zsub occurrences that are NOT reads ----
{
  const rel = 'pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js';
  const t = read(rel);
  console.log(`\n===== ${rel} (${t.length} chars) =====`);
  let i = -1;
  let reads = 0;
  const nonReads = [];
  while ((i = t.indexOf('$zsub', i + 1)) !== -1) {
    const next = t[i + 5];
    if (next === '.' || next === '[') reads++;
    else nonReads.push({ at: i, next: JSON.stringify(next), ctx: t.slice(Math.max(0, i - 80), i + 80) });
  }
  console.log(`   total $zsub = ${reads + nonReads.length}; pure reads = ${reads}; non-reads = ${nonReads.length}`);
  for (const n of nonReads.slice(0, 10)) {
    console.log(`\n   NONREAD @${n.at} next=${n.next}\n   :: ${JSON.stringify(n.ctx)}`);
  }

  console.log('\n   --- guard shapes ---');
  for (const p of ['typeof $zsub', 'window.$zsub', '$zsub&&', '$zsub&&', '$zsub?', '$zsub||', 'if($zsub', 'if ($zsub'])
    console.log(`      ${JSON.stringify(p).padEnd(20)} = ${t.split(p).length - 1}`);
}

// ---- 2/3. compact preload: dynamic name construction + POOw consumers ----
{
  const rel = 'main-dist/compact-app-preload.js';
  const t = read(rel);
  console.log(`\n===== ${rel} (${t.length} chars) =====`);
  console.log('   --- dynamic name building ---');
  for (const p of ['"$z"+', "'$z'+", '`$z', '"$z"', '"$zs"', '"$zsu"', '"sb"', "'sub'", '"sub"', 'sub', 'zsub'])
    console.log(`      ${JSON.stringify(p).padEnd(14)} = ${t.split(p).length - 1}`);

  console.log('\n   --- POOw consumers (n("POOw")) ---');
  let i = -1; let c = 0;
  while ((i = t.indexOf('"POOw"', i + 1)) !== -1 && c < 8) {
    c++;
    console.log(`\n   @${i} :: ${JSON.stringify(t.slice(Math.max(0, i - 260), i + 180))}`);
  }
  if (c === 0) console.log('      none');

  console.log('\n   --- DmP7 (descriptor factory) surface ---');
  i = t.indexOf('DmP7:function');
  console.log(i < 0 ? '      DmP7 not defined here' : JSON.stringify(t.slice(i, i + 900)));
}

// ---- 4. the two windows in compact-app.js: which HTML each loads ----
{
  const rel = 'main-dist/compact-app.js';
  const t = read(rel);
  console.log(`\n===== ${rel} =====`);
  for (const p of ['compact-app.html', '"index.html"', "'index.html'", 'getHtml('])
    console.log(`   ${JSON.stringify(p).padEnd(20)} = ${t.split(p).length - 1}`);
  let i = -1; let c = 0;
  while ((i = t.indexOf('compact-app.html', i + 1)) !== -1 && c < 4) {
    c++;
    console.log(`\n   @${i} :: ${JSON.stringify(t.slice(Math.max(0, i - 320), i + 200))}`);
  }
}
