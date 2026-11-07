#!/usr/bin/env node
/**
 * R11A read-only: verify the compact renderer's mount mechanism. React 18
 * createRoot vs legacy ReactDOM.render vs a first-party App base class.
 *
 * Usage: node tools/r11a-compact-mount.cjs <root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-compact-mount.cjs <root>');
  process.exit(2);
}

const REL = 'pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js';
const t = fs.readFileSync(path.join(root, REL), 'utf8');

const NEEDLES = [
  'createRoot',
  'ReactDOM.render',
  'ReactDOM',
  'getElementById("app")',
  'getElementById("root")',
  'super("compact-app"',
  'compact-app-container',
  'Zalo Compact Application',
  'Task is starting...',
];

console.log(`## ${REL} (${t.length})`);
for (const n of NEEDLES) {
  const offs = [];
  let i = -1;
  while ((i = t.indexOf(n, i + 1)) !== -1) offs.push(i);
  console.log(`   ${String(offs.length).padStart(3)}  ${JSON.stringify(n)}  ${offs.slice(0, 10).map((x) => '@' + x).join(' ')}`);
}

console.log('\n=== context around the App subclass that mounts `wt` ===');
const at = t.indexOf('"compact-app",e,t,{component:wt');
const at2 = t.indexOf('component:wt');
const pos = at !== -1 ? at : at2;
console.log(`   pos = ${pos}`);
if (pos !== -1) console.log(JSON.stringify(t.slice(Math.max(0, pos - 900), pos + 700)));
