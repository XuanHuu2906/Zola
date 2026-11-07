#!/usr/bin/env node
/**
 * R11A probe: what does each BrowserWindow load, and what is the compact-app surface?
 * Read-only over an already-extracted app.asar copy.
 *
 * Usage: node tools/r11a-load-targets.cjs <extracted-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FILES = [
  'main-dist/main.js',
  'main-dist/compact-app.js',
  'main-dist/migration.js',
  'main-dist/utility-process-media.js',
];

const PATTERNS = [
  ['loadURL', /\.loadURL\s*\(/g],
  ['loadFile', /\.loadFile\s*\(/g],
  ['file-protocol', /file:\/\//g],
  ['app-html', /[A-Za-z0-9_\-./]*index\.html/g],
  ['compact-app-pc', /compact-app-pc/g],
  ['http-local', /http:\/\/localhost|http:\/\/127\.0\.0\.1/g],
  ['pc-dist-ref', /pc-dist\//g],
  ['executeJavaScript', /executeJavaScript\s*\(/g],
  ['loadURL-arg-shape', /loadURL\s*\(\s*[^)]{0,120}/g],
  ['loadFile-arg-shape', /loadFile\s*\([^)]{0,160}/g],
];

function excerpt(text, idx, len, pad) {
  const a = Math.max(0, idx - pad);
  const b = Math.min(text.length, idx + len + pad);
  return text.slice(a, b).replace(/\s+/g, ' ');
}

function main() {
  const root = process.argv[2];
  if (!root) {
    console.error('usage: node tools/r11a-load-targets.cjs <extracted-root>');
    process.exit(2);
  }
  const result = { root, generated_at: new Date().toISOString(), rows: [] };

  for (const file of FILES) {
    const abs = path.join(root, file);
    if (!fs.existsSync(abs)) continue;
    const text = fs.readFileSync(abs, 'utf8');
    for (const [name, re] of PATTERNS) {
      re.lastIndex = 0;
      const hits = [];
      let m;
      while ((m = re.exec(text)) && hits.length < 4) {
        hits.push({ at: m.index, text: excerpt(text, m.index, m[0].length, 110) });
      }
      if (!hits.length) continue;
      result.rows.push({
        file,
        symbol: name,
        occurrences: (text.match(new RegExp(re.source, re.flags.replace('g', ''))) || []).length,
        hits,
      });
    }
  }
  console.log(JSON.stringify(result, null, 2));
}

main();
