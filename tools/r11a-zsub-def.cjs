#!/usr/bin/env node
/**
 * R11A read-only: where does the renderer-side `$zsub` namespace come from?
 * preload-render.js exposes only "$zuri" via contextBridge; renderers read
 * `$zsub.$zuri.*`. Find the assignment and which bridges it aggregates.
 *
 * Usage: node tools/r11a-zsub-def.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-zsub-def.cjs <extracted-asar-root>');
  process.exit(2);
}

const FILES = [
  'pc-dist/render.f32c58b63b6f4273a8a4.js',
  'pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js',
  'pc-dist/lazy/default-login-startup-main-startup.ec73261654e4ce9540ac.js',
  'pc-dist/lazy/default-login-main-startup-shared-worker-znotification.aafd08147de6e983b76f.js',
  'pc-dist/lazy/default-login-render-shared-worker.09de2d8e0cc06d14906d.js',
  'pc-dist/lazy/default-login-render.dc51d7e4150dfd0aae85.js',
  'pc-dist/lazy/vendors-login-render-shared-worker.eadda6f305bf492b3efc.js',
];

const PATS = [
  /\$zsub\s*=\s*/g,
  /window\.\$zsub/g,
  /[\w$.]*\$zsub\s*=\s*\{/g,
  /\$zsub\s*=/g,
];

for (const rel of FILES) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) {
    console.log(`## ${rel} :: MISSING`);
    continue;
  }
  const t = fs.readFileSync(p, 'utf8');
  console.log(`## ${rel} (${t.length} chars)`);
  for (const re of PATS) {
    re.lastIndex = 0;
    const hits = [];
    let m;
    while ((m = re.exec(t)) !== null) {
      hits.push(m.index);
      if (hits.length >= 6) break;
    }
    console.log(`   ${re.source} -> ${JSON.stringify(hits)}`);
  }
  // dump context around the first plausible assignment
  const ai = t.indexOf('$zsub=');
  if (ai >= 0) {
    console.log('   ASSIGN_CTX :: ' + JSON.stringify(t.slice(Math.max(0, ai - 200), ai + 320)));
  }
  console.log('');
}
