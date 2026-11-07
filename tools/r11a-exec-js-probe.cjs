#!/usr/bin/env node
/**
 * R11A read-only: count code-execution / style-injection primitives across every .js
 * in an extracted asar. String counting only (no regex escaping through the shell).
 *
 * Usage: node tools/r11a-exec-js-probe.cjs <extracted-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const KEYS = [
  'executeJavaScript',
  'executeJavaScriptInIsolatedWorld',
  'insertCSS',
  'removeInsertedCSS',
  'injectCSS',
  'webContents.executeJavaScript',
];

const BAR = String.fromCharCode(92);

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (entry.name.endsWith('.js')) out.push(abs);
  }
  return out;
}

function main() {
  const root = process.argv[2];
  if (!root) {
    console.error('usage: node tools/r11a-exec-js-probe.cjs <extracted-root>');
    process.exit(2);
  }
  const files = walk(root, []);
  console.log(`JS_FILES=${files.length}`);
  for (const key of KEYS) {
    let total = 0;
    const hits = [];
    for (const abs of files) {
      const text = fs.readFileSync(abs, 'utf8');
      const count = text.split(key).length - 1;
      if (!count) continue;
      total += count;
      hits.push(`${path.relative(root, abs).split(BAR).join('/')}(${count})`);
    }
    console.log(
      `${key.padEnd(34)}total=${String(total).padEnd(5)}files=${hits.length ? hits.join(', ') : '-'}`
    );
  }
}

main();
