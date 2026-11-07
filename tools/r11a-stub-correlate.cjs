#!/usr/bin/env node
/**
 * R11A read-only: correlate the stub's %APPDATA%\ZaloData\log.log with the app's
 * startup.log to establish (or refute) stub -> versioned-binary launch forwarding.
 *
 * log.log     : "[ts][native] info: found app directory <ver>"   (stub, versioned dir enumeration)
 * startup.log : "M/D/YYYY, h:mm:ss AM"                           (second-instance.js: lock held)
 *               "M/D/YYYY, h:mm:ss AM start up"                  (main.js: fresh main process)
 *
 * Prints only timestamps, version strings, and counts. No message content is read.
 *
 * Usage: node tools/r11a-stub-correlate.cjs <ZaloData-dir>
 */
'use strict';

const fs = require('fs');
const path = require('path');

function stubTimes(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.includes('found app directory'));
  const out = [];
  for (const l of lines) {
    const m = l.match(/^\[(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\]/);
    if (!m) continue;
    out.push({
      t: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]),
      version: l.split('directory ')[1],
    });
  }
  return out;
}

function startupTimes(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  const out = [];
  for (const l of lines) {
    const m = l.match(/^(\d+)\/(\d+)\/(\d+), (\d+):(\d+):(\d+) (AM|PM)/);
    if (!m) continue;
    const h = (+m[4] % 12) + (m[7] === 'PM' ? 12 : 0);
    out.push({
      t: Date.UTC(+m[3], +m[1] - 1, +m[2], h, +m[5], +m[6]),
      bare: !l.includes('start up'),
    });
  }
  return out;
}

function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: node tools/r11a-stub-correlate.cjs <ZaloData-dir>');
    process.exit(2);
  }
  const S = stubTimes(path.join(dir, 'log.log'));
  const U = startupTimes(path.join(dir, 'startup.log'));
  const bare = U.filter((u) => u.bare);
  const mainLine = U.filter((u) => !u.bare);

  console.log(`STUB_LAUNCH_RECORDS=${S.length}`);
  console.log(`STUB_DISTINCT_VERSIONS=${JSON.stringify([...new Set(S.map((s) => s.version))])}`);
  console.log(`STARTUP_RECORDS=${U.length} (second-instance/bare=${bare.length}, main/fresh=${mainLine.length})`);

  for (const tol of [1000, 3000, 10000]) {
    let pBare = 0;
    let pMain = 0;
    for (const u of U) {
      if (S.some((s) => Math.abs(s.t - u.t) <= tol)) {
        if (u.bare) pBare++;
        else pMain++;
      }
    }
    console.log(`TOLERANCE=${tol}ms paired_bare=${pBare}/${bare.length} paired_main=${pMain}/${mainLine.length}`);
  }

  const ex = [];
  for (const u of bare) {
    const near = S.filter((s) => Math.abs(s.t - u.t) <= 3000);
    if (!near.length) continue;
    ex.push(`${new Date(u.t).toISOString()} second-instance stub_dirs_seen=${JSON.stringify([...new Set(near.map((s) => s.version))])}`);
    if (ex.length >= 8) break;
  }
  console.log('EXAMPLES_OF_BARE_PAIRED_WITH_STUB:');
  ex.forEach((x) => console.log(`  ${x}`));

  const unpairedBare = bare.filter((u) => !S.some((s) => Math.abs(s.t - u.t) <= 10000));
  console.log(`UNPAIRED_BARE_AT_10s=${unpairedBare.length}`);
}

main();
