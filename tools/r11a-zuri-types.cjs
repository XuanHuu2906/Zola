#!/usr/bin/env node
/**
 * R11A read-only: exact type coverage of the $zuri bridge surface.
 * The descriptor enum has SUBSCRIBE/UNSUBSCRIBE/SUBSCRIBE_V2/REQUEST/
 * RAW_SEND/NOTIFY/PROVIDE/STOP_PROVIDE. The renderer-built $zsub namespace is
 * created by a registrar that switches on type; this prints which descriptor
 * types the wiring chunk implements and every $zuri member renderers call.
 *
 * Usage: node tools/r11a-zuri-types.cjs <root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-zuri-types.cjs <root>');
  process.exit(2);
}

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const WIRING = 'pc-dist/lazy/default-login-startup-main-startup-shared-worker-znotification.aa2b4a7eeda68a9f5e59.js';
const TABLE_OWNER = 'main-dist/preload-render.js';

console.log('=== A. globalThis.$zsub and registrar sites in the wiring chunk ===');
{
  const t = read(WIRING);
  for (const needle of ['globalThis.$zsub', 'Ke("$zuri"', 'Ke("$zsub"']) {
    const n = t.split(needle).length - 1;
    console.log(`   ${JSON.stringify(needle).padEnd(20)} = ${n}`);
    if (n) {
      let i = -1;
      let c = 0;
      while ((i = t.indexOf(needle, i + 1)) !== -1 && c < 3) {
        c++;
        console.log(`      @${i} :: ${JSON.stringify(t.slice(Math.max(0, i - 150), i + 250))}`);
      }
    }
  }
}

console.log('\n=== B. descriptor types present in the wiring chunk ===');
{
  const t = read(WIRING);
  for (const k of ['SUBSCRIBE_V2', 'SUBSCRIBE', 'UNSUBSCRIBE', 'REQUEST', 'RAW_SEND', 'NOTIFY', 'PROVIDE', 'STOP_PROVIDE']) {
    console.log(`   ${k.padEnd(14)} = ${t.split(k).length - 1}`);
  }
}

console.log('\n=== C. $zuri table in preload-render.js ===');
{
  const t = read(TABLE_OWNER);
  const i = t.indexOf('e.Z_URI_REQUEST="z-uri-request"');
  console.log(`   channel enum @${i === -1 ? 'NOT FOUND' : i}`);
  if (i !== -1) console.log('   :: ' + JSON.stringify(t.slice(Math.max(0, i - 120), i + 900)));
  console.log(`   onCheckStartupOpenConvRequest @${t.indexOf('onCheckStartupOpenConvRequest')}`);
}

console.log('\n=== D. every $zuri member call across pc-dist + pc-dist/lazy ===');
{
  const dirs = [path.join(root, 'pc-dist'), path.join(root, 'pc-dist', 'lazy')];
  const files = [];
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) if (f.endsWith('.js')) files.push(path.join(d, f));
  }
  const members = new Map();
  const re = /\$zuri\.([A-Za-z_$][\w$]*)/g;
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf8');
    let m;
    while ((m = re.exec(t)) !== null) {
      if (!members.has(m[1])) members.set(m[1], []);
      members.get(m[1]).push(`${path.basename(f)}@${m.index}`);
    }
  }
  console.log(`   files scanned = ${files.length}`);
  for (const [k, v] of [...members.entries()].sort()) {
    console.log(`   $zuri.${k.padEnd(32)} x${v.length}  ${v.slice(0, 3).join(' ')}${v.length > 3 ? ' …' : ''}`);
  }
}
