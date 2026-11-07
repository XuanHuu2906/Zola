#!/usr/bin/env node
/**
 * R11A read-only: occurrence counts + every offset for the identifiers the
 * report edits will cite, so each citation is unambiguous (some names, e.g.
 * `Hn`, are reused by several webpack modules in the same bundle).
 *
 * Usage: node tools/r11a-counts.cjs <root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-counts.cjs <root>');
  process.exit(2);
}

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const TARGETS = {
  'main-dist/main.js': [
    'function Hn(e){',
    'checkStartupOpenConvReq',
    '.on("check-arg-link"',
    '.on("second-instance"',
    'process.argv[1]&&Hn',
    '["actually load main App","d98nxB"]',
    'isDriveBlockedAndStartCompactApp',
    'launchCompactApp(',
  ],
  'main-dist/compact-app.js': [
    'function Hn(e){',
    'checkStartupOpenConvReq',
    'compact-app-preload.js',
    'fromPartition("compact-app")',
    'Object(f.getHtml)("compact-app.html")',
    'process.argv[1]&&Hn',
    '["actually load main App","d98nxB"]',
    'launchCompactApp(',
    '".on(\'second-instance\'"',
  ],
};

for (const [rel, needles] of Object.entries(TARGETS)) {
  let t;
  try { t = read(rel); } catch (e) { console.log(`## ${rel} :: ${e.code}`); continue; }
  console.log(`\n## ${rel} (${t.length})`);
  for (const n of needles) {
    const offs = [];
    let i = -1;
    while ((i = t.indexOf(n, i + 1)) !== -1) offs.push(i);
    console.log(`   ${String(offs.length).padStart(3)}  ${JSON.stringify(n)}  ${offs.length ? offs.map((x) => '@' + x).join(' ') : ''}`);
  }
}
