#!/usr/bin/env node
/**
 * R11A read-only: dump the second-instance registration in main.js, and the
 * argv handler Hn in both bundles, so the URI-entry difference is exact.
 *
 * Usage: node tools/r11a-second-instance.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-second-instance.cjs <root>');
  process.exit(2);
}

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

// main.js second-instance
{
  const t = read('main-dist/main.js');
  let i = t.indexOf('on("second-instance"');
  console.log('===== main-dist/main.js second-instance =====');
  console.log(`@${i}\n` + JSON.stringify(t.slice(Math.max(0, i - 900), i + 1200)));
}

// Hn real implementation in both (the one logging "instance arguments")
for (const rel of ['main-dist/main.js', 'main-dist/compact-app.js']) {
  const t = read(rel);
  const anchor = 'instance arguments';
  const i = t.indexOf(anchor);
  console.log(`\n===== ${rel} Hn @${i} =====`);
  if (i < 0) continue;
  // walk back to the enclosing function start
  const s = t.lastIndexOf('function ', i);
  console.log(JSON.stringify(t.slice(s, s + 2200)));
}
