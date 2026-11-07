#!/usr/bin/env node
/**
 * R11A read-only: prove the two $zuri surfaces are the same 6-method table.
 *  (a) preload-render.js: window.$zuri = Object(h.a)(F)
 *  (b) chunk aa2b4a7e:    Ke("$zuri",$zuri,X)  -> $zsub.$zuri
 * Also: how does the compact renderer obtain $zsub if it never loads chunk 3?
 *
 * Usage: node tools/r11a-two-surfaces.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-two-surfaces.cjs <root>');
  process.exit(2);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function table(t, name) {
  const re = new RegExp(`${name}=\\{[^}]*\\}[^}]*\\}`, 'g');
  return t.match(re);
}

// ---- (a) preload-render.js
{
  const rel = 'main-dist/preload-render.js';
  const t = read(rel);
  console.log(`\n===== ${rel} (${t.length} chars) =====`);
  const i = t.indexOf('window.$zuri=');
  console.log(`window.$zuri= @${i}`);
  console.log('CTX :: ' + JSON.stringify(t.slice(Math.max(0, i - 1400), i + 240)));

  // the F descriptor table
  const fi = t.indexOf('const F={onNewRequest');
  console.log(`const F @${fi}`);
  if (fi >= 0) console.log('F_TABLE :: ' + JSON.stringify(t.slice(fi, fi + 700)));
  const gi = t.indexOf('{onNewRequest:{apiKey:');
  console.log(`anon table @${gi}`);
  if (gi >= 0) console.log('ANON_TABLE :: ' + JSON.stringify(t.slice(gi, gi + 640)));
}

// ---- (b) compact renderer: how does $zsub appear
{
  const rel = 'pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js';
  const t = read(rel);
  console.log(`\n===== ${rel} (${t.length} chars) =====`);
  for (const k of ['globalThis.$zsub', '$zsub={}', 'Ke("$zuri"', 'Ke(', 'window.$zsub', '$zsub=', 'exposeInMainWorld']) {
    console.log(`   ${JSON.stringify(k)} = ${t.split(k).length - 1}`);
  }
  // any registrar-like function that writes into $zsub
  const re = /\$zsub\[[^\]]{0,40}\]\s*=|Object\.assign\(\$zsub|\$zsub\s*\.\s*\$z/;
  console.log('   registrar-ish regex present = ' + re.test(t));
}
