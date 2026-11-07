#!/usr/bin/env node
/**
 * R11A read-only: dump the setPreloads/getPreloads call sites in compact-app.js,
 * plus the full compact-app-preload tail (the n("EmOc"),n("ezdo")... module
 * requires after the 8 exposes) — those require-ids decide which bridge
 * modules actually run in the compact preload.
 *
 * Usage: node tools/r11a-setpreloads.cjs <root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-setpreloads.cjs <root>');
  process.exit(2);
}

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

{
  const rel = 'main-dist/compact-app.js';
  const t = read(rel);
  console.log(`\n===== ${rel} :: setPreloads / getPreloads =====`);
  for (const key of ['setPreloads', 'getPreloads']) {
    let i = -1; let c = 0;
    while ((i = t.indexOf(key, i + 1)) !== -1 && c < 4) {
      c++;
      console.log(`\n@${i} ${key} :: ` + JSON.stringify(t.slice(Math.max(0, i - 700), i + 400)));
    }
  }
}

{
  const rel = 'main-dist/compact-app-preload.js';
  const t = read(rel);
  console.log(`\n===== ${rel} :: tail after exposes =====`);
  const i = t.indexOf('exposeInMainWorld("$zconfig"');
  console.log(JSON.stringify(t.slice(Math.max(0, i), i + 1400)));

  console.log('\n--- bridge module ids referenced in the preload ---');
  const ids = new Map();
  const re = /n\("([A-Za-z0-9+/_\-]{4})"\)/g;
  let m;
  while ((m = re.exec(t)) !== null) ids.set(m[1], (ids.get(m[1]) || 0) + 1);
  console.log(`   distinct module ids = ${ids.size}`);

  for (const id of ['EmOc', 'ezdo', 'KdAX', 'mzek', 'aBYf', 'zm+Q', 'WSI5', 'v/rv', 'nAZb', 'c0KM', 'zheM', 'CXIs', 'cZjg']) {
    const j = t.indexOf(`"${id}":function`);
    console.log(`\n   [${id}] defined=${j >= 0} refs=${ids.get(id) || 0}`);
    if (j >= 0) console.log('     ' + JSON.stringify(t.slice(j, j + 420)));
  }
}
