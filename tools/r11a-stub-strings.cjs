#!/usr/bin/env node
/**
 * R11A read-only: dump UTF-16LE and ASCII strings from the 790 KB root Zalo.exe stub,
 * filtered to launcher-relevant keywords. Proves/disproves the "Squirrel launcher" label.
 *
 * Usage: node tools/r11a-stub-strings.cjs <path-to-stub.exe>
 */
'use strict';

const fs = require('fs');

const KEYWORDS = [
  'Zalo',
  'squirrel',
  'Squirrel',
  'Update.exe',
  'processStart',
  'Programs',
  'AppData',
  'CreateProcess',
  'CommandLine',
  'ShellExecute',
  'version',
  '--',
];

function utf16leStrings(buf, minLen) {
  const out = [];
  let start = -1;
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const lo = buf[i];
    const hi = buf[i + 1];
    const printable = hi === 0 && lo >= 0x20 && lo < 0x7f;
    if (printable) {
      if (start < 0) start = i;
    } else {
      if (start >= 0) {
        const s = buf.toString('latin1', start, i);
        // decode as UTF-16LE by taking every other byte as ASCII
        if (s.length >= minLen) out.push(s);
        start = -1;
      }
    }
  }
  return out;
}

function asciiStrings(buf, minLen) {
  const s = buf.toString('latin1');
  return (s.match(new RegExp('[\\x20-\\x7e]{' + minLen + ',}', 'g')) || []);
}

function main() {
  const p = process.argv[2];
  if (!p) {
    console.error('usage: node tools/r11a-stub-strings.cjs <stub.exe>');
    process.exit(2);
  }
  const buf = fs.readFileSync(p);
  console.log(`PATH=${p}`);
  console.log(`BYTES=${buf.length}`);

  const u16 = utf16leStrings(buf, 4);
  console.log(`UTF16LE_STRINGS=${u16.length}`);
  for (const kw of KEYWORDS) {
    const hits = [...new Set(u16.filter((s) => s.includes(kw)))];
    console.log(`  UTF16 ${JSON.stringify(kw).padEnd(18)} count=${hits.length} ` +
      (hits.length ? hits.slice(0, 12).map((h) => JSON.stringify(h)).join(' | ') : '-'));
  }

  const a8 = asciiStrings(buf, 4);
  console.log(`ASCII_STRINGS=${a8.length}`);
  for (const kw of KEYWORDS) {
    const hits = [...new Set(a8.filter((s) => s.includes(kw)))];
    console.log(`  ASCII ${JSON.stringify(kw).padEnd(18)} count=${hits.length} ` +
      (hits.length ? hits.slice(0, 12).map((h) => JSON.stringify(h)).join(' | ') : '-'));
  }
}

main();
