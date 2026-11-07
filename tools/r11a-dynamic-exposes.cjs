#!/usr/bin/env node
/**
 * R11A read-only: the preloads expose more than their literal
 * exposeInMainWorld("...") calls — they also call a generic helper
 *   POOw.a = function(name, table){ const api = descriptorFactory(table);
 *                                    window[name] = api;
 *                                    contextBridge.exposeInMainWorld(name, api) }
 * with LITERAL names. Enumerate every such registration so the real bridge
 * surface of each preload is exact.
 *
 * Usage: node tools/r11a-dynamic-exposes.cjs <root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-dynamic-exposes.cjs <root>');
  process.exit(2);
}

const PRELOADS = [
  'main-dist/preload-render.js',
  'main-dist/compact-app-preload.js',
  'main-dist/preload-noti.js',
  'main-dist/preload-shared-worker.js',
  'main-dist/preload-sqlite.js',
];

// Every literal "$..." string that appears as the first argument of a call.
const CALL_LITERAL = /Object\(\s*[A-Za-z_$][\w$]*\.a\s*\)\s*\(\s*"\$([^"]+)"\s*,/g;
const CALL_LITERAL2 = /\(\s*"\$([^"\\]+)"\s*,\s*\{/g;

for (const rel of PRELOADS) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) { console.log(`## ${rel} :: MISSING`); continue; }
  const t = fs.readFileSync(p, 'utf8');
  console.log(`\n## ${rel} (${t.length} chars)`);

  const names = new Map();
  let m;
  CALL_LITERAL.lastIndex = 0;
  while ((m = CALL_LITERAL.exec(t)) !== null) names.set('$' + m[1], (names.get('$' + m[1]) || 0) + 1);
  CALL_LITERAL2.lastIndex = 0;
  while ((m = CALL_LITERAL2.exec(t)) !== null) names.set('$' + m[1], (names.get('$' + m[1]) || 0) + 1);

  console.log(`   dynamic literal registrations = ${names.size}`);
  for (const [k, v] of [...names.entries()].sort()) console.log(`      ${k.padEnd(34)} x${v}`);

  // registerEntryPoint implementations: what name does each pass?
  const re = /registerEntryPoint\s*\(\s*\)\s*\{[\s\S]{0,400}?\}\s*destroy/g;
  const hits = t.match(re) || [];
  console.log(`   registerEntryPoint bodies = ${hits.length}`);
  for (const h of hits.slice(0, 20)) {
    const nm = /\(\s*"\$([^"]+)"/.exec(h);
    console.log(`      -> ${nm ? '$' + nm[1] : '(non-literal)'}`);
  }

  // any place a "$" name is produced by concatenation
  console.log('   concat exposures =', (t.match(/"\$"\s*\+/g) || []).length);
}
