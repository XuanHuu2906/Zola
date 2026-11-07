#!/usr/bin/env node
/**
 * R11A read-only: is $zsub wiring chunk 3 (aa2b4a7e) pulled in by the compact
 * renderer, or only by the main window's login/render runtimes?
 *
 * Usage: node tools/r11a-chunk3-demand.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-chunk3-demand.cjs <root>');
  process.exit(2);
}

const RELS = [
  'pc-dist/render.f32c58b63b6f4273a8a4.js',
  'pc-dist/login.f32c58b63b6f4273a8a4.js',
  'pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js',
];

for (const rel of RELS) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) {
    console.log(`\n## ${rel} :: MISSING`);
    continue;
  }
  const t = fs.readFileSync(p, 'utf8');
  console.log(`\n## ${rel} (${t.length} chars)`);
  for (const k of ['aa2b4a7eeda68a9f5e59', 'default-login-startup-main-startup-shared-worker-znotification']) {
    console.log(`   ${k} = ${t.split(k).length - 1}`);
  }
  // webpack runtime shape: n.e(<id>) or .e(3)
  const ev = t.match(/\.e\(\s*3\s*\)/g);
  console.log(`   .e(3) = ${ev ? ev.length : 0}`);
  // chunk-id map for name lookup containing "startup-main-startup"
  const i = t.indexOf('startup-main-startup"');
  if (i >= 0) {
    console.log('   CHUNKMAP_CTX :: ' + JSON.stringify(t.slice(Math.max(0, i - 400), i + 700)));
  }
}
