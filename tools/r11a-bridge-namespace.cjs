#!/usr/bin/env node
/**
 * R11A read-only: verify how renderers reach the URI bridge ($zuri vs $zsub.$zuri),
 * and whether the compact renderer can open a conversation by any URI-adjacent path.
 *
 * Usage: node tools/r11a-bridge-namespace.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-bridge-namespace.cjs <extracted-asar-root>');
  process.exit(2);
}

const RENDERERS = {
  'pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js': 'compact renderer',
  'pc-dist/lazy/default-login-startup-main-startup.ec73261654e4ce9540ac.js': 'main-window startup listener chunk',
  'pc-dist/lazy/default-login-main-startup-shared-worker-znotification.aafd08147de6e983b76f.js': 'main-window startup drain chunk',
};

for (const rel of Object.keys(RENDERERS)) {
  const t = fs.readFileSync(path.join(root, rel), 'utf8');
  console.log(`## ${rel} (${RENDERERS[rel]})`);
  for (const k of ['$zsub.$zuri.', 'window.$zuri', '$zuri.', '$zsub.']) {
    console.log(`   ${k} = ${t.split(k).length - 1}`);
  }
  const methods = new Set();
  const re = /\$zsub\.\$zuri\.([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(t)) !== null) methods.add(m[1]);
  console.log('   VIA_ZSUB = ' + JSON.stringify([...methods].sort()));
  const methods2 = new Set();
  const re2 = /(?:^|[^.\w$])\$zuri\.([A-Za-z_$][\w$]*)\s*\(/g;
  while ((m = re2.exec(t)) !== null) methods2.add(m[1]);
  console.log('   VIA_BARE = ' + JSON.stringify([...methods2].sort()));
  console.log('');
}

// preload exposure
{
  const t = fs.readFileSync(path.join(root, 'main-dist/preload-render.js'), 'utf8');
  console.log('## main-dist/preload-render.js');
  for (const k of ['"$zsub"', '"$zuri"', 'exposeInMainWorld("$zsub"', 'exposeInMainWorld("$zuri"']) {
    console.log(`   ${k} = ${t.split(k).length - 1}`);
  }
  const i = t.indexOf('window.$zsub=');
  console.log('   window.$zsub= @ ' + i + ' :: ' + JSON.stringify(t.slice(Math.max(0, i - 120), i + 200)));
}
