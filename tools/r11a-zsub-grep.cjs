#!/usr/bin/env node
/**
 * R11A read-only: exhaustive `$zsub` occurrence report across every file under
 * the extracted asar root, with context, to find its definition/binding.
 *
 * Usage: node tools/r11a-zsub-grep.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-zsub-grep.cjs <extracted-asar-root>');
  process.exit(2);
}

const NEAR = [
  '$zsub:', '$zsub =', '$zsub=', '["$zsub"]', "['$zsub']", '$zsub]', '"$zsub"', "'$zsub'",
];

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|html|json)$/i.test(e.name)) out.push(p);
  }
}

const files = [];
walk(root, files);
console.log(`files=$((${files.length}))`);

let totalHits = 0;
for (const f of files) {
  const raw = fs.readFileSync(f);
  if (!raw.includes('$zsub')) continue;
  const t = raw.toString('utf8');
  const n = t.split('$zsub').length - 1;
  totalHits += n;
  console.log(`\n## ${path.relative(root, f)} :: $zsub x${n}`);
  for (const k of NEAR) {
    const i = t.indexOf(k);
    if (i >= 0) console.log(`   NEAR ${JSON.stringify(k)} @${i} :: ` + JSON.stringify(t.slice(Math.max(0, i - 160), i + 260)));
  }
  // first few raw occurrences with context
  let i = -1, c = 0;
  while ((i = t.indexOf('$zsub', i + 1)) !== -1 && c < 4) {
    c++;
    console.log(`   OCC${c} @${i} :: ` + JSON.stringify(t.slice(Math.max(0, i - 90), i + 110)));
  }
}
console.log(`\nTOTAL $zsub occurrences = ${totalHits}`);
