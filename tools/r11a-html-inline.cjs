#!/usr/bin/env node
/**
 * R11A read-only: dump the inline scripts of compact-app.html and index.html
 * verbatim, plus every <script> tag, to see how $zsub is bootstrapped.
 *
 * Usage: node tools/r11a-html-inline.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-html-inline.cjs <root>');
  process.exit(2);
}

for (const rel of ['pc-dist/compact-app.html', 'pc-dist/index.html']) {
  const t = fs.readFileSync(path.join(root, rel), 'utf8');
  console.log(`\n===== ${rel} (${t.length} chars) =====`);
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  let n = 0;
  while ((m = re.exec(t)) !== null) {
    n++;
    const attrs = m[1].trim();
    const body = m[2];
    console.log(`\n--- SCRIPT#${n} @${m.index} attrs=${JSON.stringify(attrs)} bodyLen=${body.length}`);
    if (body.trim()) {
      console.log(body.length > 4000 ? body.slice(0, 4000) + '\n…[truncated]' : body);
    }
  }
  console.log(`\ntotal <script> = ${n}`);
}
