#!/usr/bin/env node
/**
 * R11A read-only: identify the webContents variable that each startup-queue
 * drain sends to, and where it was assigned a BrowserWindow.
 *
 * Usage: node tools/r11a-drain-target.cjs <extracted-asar-root> [which]
 *   which = main | compact | both (default both)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
const which = (process.argv[3] || 'both').toLowerCase();
if (!root) {
  console.error('usage: node tools/r11a-drain-target.cjs <root> [main|compact|both]');
  process.exit(2);
}

const TARGETS = [
  { rel: 'main-dist/main.js', anchor: 'checkStartupOpenConvReq:function(){', tag: 'main' },
  { rel: 'main-dist/compact-app.js', anchor: 'checkStartupOpenConvReq:function(){', tag: 'compact' },
];

function snippet(t, from, len) {
  return t.slice(from, from + len);
}

for (const T of TARGETS) {
  if (which !== 'both' && which !== T.tag) continue;
  const t = fs.readFileSync(path.join(root, T.rel), 'utf8');
  console.log(`\n===== ${T.rel} (${t.length} chars) =====`);

  const at = t.indexOf(T.anchor);
  console.log(`drain @${at}`);
  const body = snippet(t, at, 220);
  console.log('DRAIN :: ' + JSON.stringify(body));

  // the webContents receiver variable name: <X>.webContents.send("z-uri-open-conv"
  const m = /(\b[A-Za-z_$][\w$]*)\.webContents\.send\("z-uri-open-conv"/.exec(body);
  if (!m) {
    console.log('  !! could not extract receiver');
    continue;
  }
  const v = m[1];
  console.log(`RECEIVER = ${v}`);

  // Every assignment to that variable before the drain, nearest last.
  const pre = t.slice(0, at);
  const re = new RegExp(`(?:^|[^.\\w$])${v.replace(/\$/g, '\\$')}\\s*=\\s*`, 'g');
  let mm;
  const sites = [];
  while ((mm = re.exec(pre)) !== null) sites.push(mm.index + mm[0].length);
  console.log(`assignments of ${v} before drain = ${sites.length}; last 3 -> ${JSON.stringify(sites.slice(-3))}`);
  for (const s of sites.slice(-3)) {
    console.log(`   @${s - (mm ? 0 : 0)} :: ` + JSON.stringify(t.slice(Math.max(0, s - 220), s + 320)));
  }

  // also find where a BrowserWindow is constructed and assigned to v
  const re2 = new RegExp(`(?:^|[^.\\w$])${v.replace(/\$/g, '\\$')}\\s*=\\s*new\\s+[\\w$.]+`, 'g');
  let m3;
  while ((m3 = re2.exec(t)) !== null) {
    console.log(`   NEWWINDOW @${m3.index} :: ` + JSON.stringify(t.slice(Math.max(0, m3.index - 300), m3.index + 420)));
  }

  // what is loaded into that window
  const re3 = new RegExp(`(?:^|[^.\\w$])${v.replace(/\$/g, '\\$')}\\s*=`, 'g');
  let m4;
  const all = [];
  while ((m4 = re3.exec(t)) !== null) all.push(m4.index);
  console.log(`   all ${v}= at ${JSON.stringify(all.slice(-8))}`);
}
