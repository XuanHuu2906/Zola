#!/usr/bin/env node
/**
 * R11A read-only: in compact-app.js, identify what window the URI drain sends to.
 * Prints the assignment context for the window variable used at the drain site.
 *
 * Usage: node tools/r11a-compact-drain-window.cjs <extracted-asar-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-compact-drain-window.cjs <extracted-asar-root>');
  process.exit(2);
}
const text = fs.readFileSync(path.join(root, 'main-dist/compact-app.js'), 'utf8');

const drain = text.indexOf('checkStartupOpenConvReq:function');
console.log(`drain_site=${drain}`);
console.log('DRAIN :: ' + JSON.stringify(text.slice(drain, drain + 200)));

for (const pat of ['let Ae,', 'Ae=', ' var Ae', 'Ae=']) {
  let i = -1;
  let n = 0;
  while ((i = text.indexOf(pat, i + 1)) !== -1 && n < 6) {
    const ctx = text.slice(Math.max(0, i - 120), i + 160);
    if (ctx.includes('createWindow') || ctx.includes('new ') || ctx.includes('BrowserWindow') || ctx.includes('=let')) {
      console.log(`ASSIGN(${pat}) @${i} :: ${JSON.stringify(ctx)}`);
      n++;
    }
  }
}
