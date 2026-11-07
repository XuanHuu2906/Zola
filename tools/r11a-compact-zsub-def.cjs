#!/usr/bin/env node
/**
 * R11A read-only: the compact renderer calls $zsub.$zXXX 140 times, but the
 * compact preload exposes no such global and `globalThis.$zsub` is absent from
 * the renderer bundle. Find where $zsub is actually created, and whether the
 * bundle even reaches those call sites.
 *
 * Usage: node tools/r11a-compact-zsub-def.cjs <root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-compact-zsub-def.cjs <root>');
  process.exit(2);
}

const rel = 'pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js';
const t = fs.readFileSync(path.join(root, rel), 'utf8');
console.log(`## ${rel} (${t.length} chars)`);

console.log('\n--- definition-shaped patterns ---');
const DEFS = [
  '$zsub={', '$zsub ={', '$zsub={}', 'var $zsub', 'let $zsub', 'const $zsub',
  'window.$zsub', 'globalThis.$zsub', 'self.$zsub', 'global.$zsub',
  '["$zsub"]', "['$zsub']", '$zsub:', '"$zsub"', "'$zsub'",
];
for (const p of DEFS) console.log(`   ${JSON.stringify(p).padEnd(22)} = ${t.split(p).length - 1}`);

console.log('\n--- first 6 $zsub contexts ---');
let i = -1;
let c = 0;
while ((i = t.indexOf('$zsub', i + 1)) !== -1 && c < 6) {
  c++;
  console.log(`\n#${c} @${i} :: ` + JSON.stringify(t.slice(Math.max(0, i - 120), i + 120)));
}

console.log('\n--- webpack runtime / chunk loader ---');
for (const p of [
  'webpackJsonp', '__webpack_require__', 'this.webpackChunk', 'webpackChunk',
  '.e(', 'push([[', '__ZaBUNDLENAME__', 'window.__ZaBUNDLENAME__',
]) console.log(`   ${JSON.stringify(p).padEnd(26)} = ${t.split(p).length - 1}`);

console.log('\n--- is $zuri declared locally? ---');
for (const p of ['$zuri=', '$zuri =', 'window.$zuri', 'var $zuri', 'const $zuri', 'let $zuri'])
  console.log(`   ${JSON.stringify(p).padEnd(20)} = ${t.split(p).length - 1}`);

console.log('\n--- chunk-id demand table (first 10 .e() sites) ---');
i = -1; c = 0;
while ((i = t.indexOf('.e(', i + 1)) !== -1 && c < 10) {
  c++;
  console.log(`@${i} :: ` + JSON.stringify(t.slice(Math.max(0, i - 90), i + 60)));
}
