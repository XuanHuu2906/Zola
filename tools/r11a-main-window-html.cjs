#!/usr/bin/env node
/**
 * R11A read-only: what does each main process load into its MAIN window?
 * Resolve loadURL/loadFile targets near setMainWindow in both bundles.
 *
 * Usage: node tools/r11a-main-window-html.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-main-window-html.cjs <root>');
  process.exit(2);
}

const RELS = ['main-dist/main.js', 'main-dist/compact-app.js'];

for (const rel of RELS) {
  const t = fs.readFileSync(path.join(root, rel), 'utf8');
  console.log(`\n===== ${rel} (${t.length} chars) =====`);

  for (const pat of ['setMainWindow(', 'loadFile(', 'loadURL(']) {
    const idx = [];
    let i = -1;
    while ((i = t.indexOf(pat, i + 1)) !== -1 && idx.length < 40) idx.push(i);
    console.log(`PAT ${pat} -> ${idx.length} hits ${JSON.stringify(idx.slice(0, 14))}`);
  }

  // exact loadFile args
  const re = /\.loadFile\(\s*([^)]{0,160})\)/g;
  let m;
  const files = new Set();
  while ((m = re.exec(t)) !== null) files.add(m[1].trim());
  console.log('LOADFILE_ARGS = ' + JSON.stringify([...files]));

  // html literals anywhere
  const re2 = /"([^"]{0,80}\.html)"/g;
  let m2;
  const html = new Set();
  while ((m2 = re2.exec(t)) !== null) html.add(m2[1]);
  console.log('HTML_LITERALS = ' + JSON.stringify([...html].sort()));

  // context around each setMainWindow
  let i2 = -1;
  let c = 0;
  while ((i2 = t.indexOf('setMainWindow(', i2 + 1)) !== -1 && c < 6) {
    c++;
    console.log(`\n  setMainWindow#${c} @${i2} :: ` + JSON.stringify(t.slice(Math.max(0, i2 - 520), i2 + 120)));
  }
}
