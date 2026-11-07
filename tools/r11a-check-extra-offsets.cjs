#!/usr/bin/env node
/**
 * R11A read-only: spot-check the offsets the reports cite but the citation
 * verifier does not assert. Prints a window around each so the reviewer can
 * judge whether the cited bundle and the quoted shape agree.
 *
 * Usage: node tools/r11a-check-extra-offsets.cjs <root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-check-extra-offsets.cjs <root>');
  process.exit(2);
}

const F = {
  main: 'main-dist/main.js',
  compact: 'main-dist/compact-app.js',
  compactPc: 'pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js',
  preload: 'main-dist/preload-render.js',
  compactPreload: 'main-dist/compact-app-preload.js',
  wiring: 'pc-dist/lazy/default-login-startup-main-startup-shared-worker-znotification.aa2b4a7eeda68a9f5e59.js',
  ec7326: 'pc-dist/lazy/default-login-startup-main-startup.ec73261654e4ce9540ac.js',
};

const cache = new Map();
function t(k) {
  if (!cache.has(k)) cache.set(k, fs.readFileSync(path.join(root, F[k]), 'utf8'));
  return cache.get(k);
}

const CASES = [
  // [bundle, offset, what the report claims is there]
  ['ec7326', 18350, 'start of the quoted listener block (n=…, s=…, autoOpen…)'],
  ['ec7326', 18934, 'subscription call $zsub.$zuri.onRequestOpenConv(s)'],
  ['compactPreload', 72851, '$inaccessibleDrive via POOw.a(name, table)'],
  ['compactPreload', 1164302, '$migration via POOw.a(name, table)'],
  ['main', 311443, 'module "3Zc2" / logger "call-v2"'],
  ['compact', 941546, 'launchCompactApp definition'],
  ['compact', 2020730, 'launchCompactApp wrapper'],
  ['main', 1077098, 'Kiki Assistant webPreferences'],
  ['main', 3110359, 'Kiki Assistant webPreferences'],
  ['main', 1194719, 'Shared Worker webPreferences'],
  ['main', 2218293, 'module ZQzv'],
  ['main', 2696852, 'main window webPreferences (devTools true)'],
  ['main', 2711202, 'Fe===be ? send : queue branch'],
  ['main', 2726412, 'Notification window webPreferences'],
  ['main', 4154303, 'SQLite window webPreferences'],
  ['compactPc', 13086649, 'reported as wiring aa2b4a7e — check bundle'],
  ['compactPc', 13088998, 'reported as wiring aa2b4a7e — check bundle'],
];

for (const [k, off, claim] of CASES) {
  const s = t(k);
  const len = s ? s.length : 0;
  console.log(`\n=== ${k} @${off} (len ${len}) — claim: ${claim}`);
  if (!s || off >= len) { console.log('   !! out of range'); continue; }
  console.log('   before: ' + JSON.stringify(s.slice(Math.max(0, off - 48), off)));
  console.log('   at    : ' + JSON.stringify(s.slice(off, off + 110)));
}

console.log('\n=== same offsets, other bundles (only when they differ) ===');
for (const [k, off] of CASES) {
  const line = [];
  for (const k2 of Object.keys(F)) {
    if (k2 === k) continue;
    const s2 = t(k2);
    if (s2 && off < s2.length) line.push(`${k2}=${JSON.stringify(s2.slice(off, off + 20))}`);
  }
  console.log(`\n@${off} (cited as ${k}): ${line.join(' | ') || '(no other bundle long enough)'}`);
}
