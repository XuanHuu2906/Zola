#!/usr/bin/env node
/**
 * R11A read-only: two closing questions.
 *   A. the non-literal registerEntryPoint in compact-app-preload.js
 *   B. who calls launchCompactApp — is compact mode reachable in this build?
 *   C. is the compact surface gated by a remote/config flag?
 *
 * Usage: node tools/r11a-compact-gate.cjs <root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-compact-gate.cjs <root>');
  process.exit(2);
}

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

console.log('=== A. registerEntryPoint bodies in compact-app-preload ===');
{
  const t = read('main-dist/compact-app-preload.js');
  const re = /registerEntryPoint\s*\(\s*\)\s*\{/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const body = t.slice(m.index, m.index + 520);
    const nm = /\(\s*"\$([^"]+)"/.exec(body);
    if (nm && nm[1] === 'inaccessibleDrive') continue;
    if (nm && nm[1] === 'migration') continue;
    console.log(`\n@${m.index} NON-LITERAL :: ${JSON.stringify(body)}`);
  }
}

console.log('\n\n=== B. launchCompactApp call sites ===');
for (const rel of ['main-dist/main.js', 'main-dist/compact-app.js']) {
  const t = read(rel);
  console.log(`\n-- ${rel}`);
  let i = -1; let c = 0;
  while ((i = t.indexOf('launchCompactApp', i + 1)) !== -1 && c < 8) {
    c++;
    console.log(`\n   @${i} :: ${JSON.stringify(t.slice(Math.max(0, i - 420), i + 220))}`);
  }
}

console.log('\n\n=== C. compact feature gating ===');
for (const rel of ['main-dist/main.js', 'main-dist/compact-app.js']) {
  const t = read(rel);
  console.log(`\n-- ${rel}`);
  for (const k of [
    'isCompactAppEnabled', 'compactAppEnabled', 'enableCompact', 'COMPACT_APP',
    'compact_app', 'compactAppConfig', 'COMPACT_MODE', 'isCompactMode',
    'switchToCompact', 'toggleCompact', 'compactAppMode',
  ]) {
    const n = t.split(k).length - 1;
    if (n) console.log(`   ${JSON.stringify(k).padEnd(26)} = ${n}`);
  }
}
