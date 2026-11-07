#!/usr/bin/env node
/**
 * R11A read-only: which preloads are attached to the compact window at runtime?
 * Electron can attach extra preloads to a whole session
 * (session.setPreloads / registerPreloadScript), not only per BrowserWindow.
 * preload-sqlite.js is the only main-dist file that defines globalThis.$zsub,
 * and the compact renderer reads $zsub unguarded 137 times.
 *
 * Usage: node tools/r11a-preload-attach.cjs <root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-preload-attach.cjs <root>');
  process.exit(2);
}

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

for (const rel of ['main-dist/main.js', 'main-dist/compact-app.js']) {
  const t = read(rel);
  console.log(`\n===== ${rel} (${t.length} chars) =====`);
  for (const p of [
    'setPreloads', 'registerPreloadScript', 'getPreloads',
    'preload-sqlite', 'preload-shared-worker', 'preload-noti',
    'compact-app-preload', 'preload-render.js',
    'fromPartition("compact-app")', 'fromPartition("persist:zalo")',
  ]) console.log(`   ${JSON.stringify(p).padEnd(34)} = ${t.split(p).length - 1}`);
}

// every preload path binding, with context
for (const rel of ['main-dist/main.js', 'main-dist/compact-app.js']) {
  const t = read(rel);
  console.log(`\n----- ${rel} :: preload path sites -----`);
  const re = /preload[-a-z]*\.js/g;
  let m;
  let c = 0;
  while ((m = re.exec(t)) !== null && c < 14) {
    c++;
    console.log(`@${m.index} ${JSON.stringify(m[0])} :: ` + JSON.stringify(t.slice(Math.max(0, m.index - 240), m.index + 120)));
  }
}

// does preload-sqlite define $zsub, and what does it expose?
{
  const rel = 'main-dist/preload-sqlite.js';
  const t = read(rel);
  console.log(`\n===== ${rel} (${t.length} chars) =====`);
  for (const p of ['globalThis.$zsub', '$zsub', 'exposeInMainWorld', 'contextBridge', 'window.$zsub'])
    console.log(`   ${JSON.stringify(p).padEnd(22)} = ${t.split(p).length - 1}`);
  const i = t.indexOf('globalThis.$zsub');
  if (i >= 0) console.log('\n   DEF :: ' + JSON.stringify(t.slice(Math.max(0, i - 700), i + 500)));
}
