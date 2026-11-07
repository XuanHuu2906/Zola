#!/usr/bin/env node
/**
 * R11A read-only: resolve which module provides the descriptor-driven IPC registrar
 * used at the `Object(i.a)(Ie,Le)` site in main.js.
 *
 * Usage: node tools/r11a-registrar-id.cjs <main.js>
 */
'use strict';

const fs = require('fs');

const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/r11a-registrar-id.cjs <main.js>');
  process.exit(2);
}
const t = fs.readFileSync(file, 'utf8');

const site = t.indexOf('Object(i.a)(Ie,Le)');
console.log(`registrar_call_site=${site}`);

// Walk backwards for the nearest `i = n("...")` binding.
const before = t.slice(Math.max(0, site - 200000), site);
const re = /\bi\s*=\s*n\("([^"]+)"\)/g;
let last = null;
let m;
while ((m = re.exec(before)) !== null) last = { id: m[1], at: before.length - 200000 + m.index };
console.log('nearest_i_binding=' + JSON.stringify(last));
if (last) {
  const def = t.indexOf(`"${last.id}":function`);
  console.log(`module_def_offset=${def}`);
  if (def >= 0) console.log('module_head :: ' + JSON.stringify(t.slice(def, def + 420)));
}
