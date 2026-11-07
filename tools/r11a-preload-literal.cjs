#!/usr/bin/env node
/**
 * R11A read-only: the compact preload has 9 exposeInMainWorld() calls but only
 * 8 quoted names. Dump all 9 call sites with context so the 9th (non-literal)
 * key is identifiable — this decides where the compact renderer's $zsub comes
 * from.
 *
 * Usage: node tools/r11a-preload-literal.cjs <root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-preload-literal.cjs <root>');
  process.exit(2);
}

for (const rel of ['main-dist/compact-app-preload.js', 'main-dist/preload-render.js']) {
  const t = fs.readFileSync(path.join(root, rel), 'utf8');
  console.log(`\n===== ${rel} (${t.length} chars) =====`);
  let i = -1;
  let c = 0;
  while ((i = t.indexOf('exposeInMainWorld', i + 1)) !== -1) {
    c++;
    console.log(`\n#${c} @${i} :: ` + JSON.stringify(t.slice(Math.max(0, i - 200), i + 220)));
  }
  console.log(`\ntotal = ${c}`);

  // Does the preload build a namespace object literal anywhere?
  console.log('\n--- namespace assembly patterns ---');
  for (const p of [
    '$zsub', '$zsub=', 'globalThis.$zsub', 'window.$zsub',
    'exposeInMainWorld(name', 'exposeInMainWorld(n,', 'exposeInMainWorld(e,',
    'exposeInMainWorld(t,', 'exposeInMainWorld(o,',
  ]) console.log(`   ${JSON.stringify(p).padEnd(26)} = ${t.split(p).length - 1}`);
}
