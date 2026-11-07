#!/usr/bin/env node
/**
 * R11A read-only: find the enclosing webpack module for an offset and list its
 * `x = n("...")` bindings, so `i.a` at the URI registrar call site can be resolved.
 *
 * Usage: node tools/r11a-module-scope.cjs <main.js> <offset>
 */
'use strict';

const fs = require('fs');

const [file, offStr] = process.argv.slice(2);
const off = Number(offStr);
if (!file || !Number.isFinite(off)) {
  console.error('usage: node tools/r11a-module-scope.cjs <main.js> <offset>');
  process.exit(2);
}
const t = fs.readFileSync(file, 'utf8');

// Webpack bundles use <id>:function(e,t,n){ boundaries.
const re = /\n?\s*"([^"]+)":function\(e,t,n\)\{/g;
let start = -1;
let id = null;
let m;
while ((m = re.exec(t)) !== null) {
  if (m.index > off) break;
  start = m.index;
  id = m[1];
}
console.log(`enclosing_module="${id}" start=${start} offset_in_module=${off - start}`);
const head = t.slice(start, Math.min(t.length, start + 700));
console.log('HEAD :: ' + JSON.stringify(head));

const scope = t.slice(start, off);
const binds = [];
const bre = /\b([A-Za-z_$][\w$]*)\s*=\s*n\("([^"]+)"\)/g;
let b;
while ((b = bre.exec(scope)) !== null) binds.push(`${b[1]}=n("${b[2]}")`);
console.log('BINDINGS :: ' + JSON.stringify(binds));
