#!/usr/bin/env node
/**
 * R11A read-only: toggleCompact — is compact mode a user-facing window mode, or
 * only the inaccessible-drive fallback?
 *
 * Usage: node tools/r11a-toggle-compact.cjs <root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-toggle-compact.cjs <root>');
  process.exit(2);
}

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

for (const rel of ['main-dist/main.js', 'main-dist/compact-app.js']) {
  const t = read(rel);
  console.log(`\n===== ${rel} =====`);
  for (const key of ['toggleCompact', 'isDriveBlockedAndStartCompactApp']) {
    let i = -1; let c = 0;
    while ((i = t.indexOf(key, i + 1)) !== -1 && c < 4) {
      c++;
      console.log(`\n@${i} ${key} :: ` + JSON.stringify(t.slice(Math.max(0, i - 520), i + 400)));
    }
  }
}
