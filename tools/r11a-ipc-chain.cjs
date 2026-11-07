#!/usr/bin/env node
/**
 * R11A read-only: find which ipcMain primitive roots the "check-arg-link" handler chain,
 * and print the ipc-event registration helper usage in main.js.
 *
 * Usage: node tools/r11a-ipc-chain.cjs <main.js>
 */
'use strict';

const fs = require('fs');

const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/r11a-ipc-chain.cjs <main.js>');
  process.exit(2);
}
const t = fs.readFileSync(file, 'utf8');

const KEY = 'check-arg-link';
let i = -1;
while ((i = t.indexOf(KEY, i + 1)) !== -1) {
  const back = t.slice(Math.max(0, i - 3000), i);
  const on = back.lastIndexOf('ipcMain.on(');
  const hd = back.lastIndexOf('ipcMain.handle(');
  const best = Math.max(on, hd);
  console.log(`@${i}  nearest_ipcMain_on_rel=${on}  nearest_ipcMain_handle_rel=${hd}`);
  if (best >= 0) {
    console.log('  ' + JSON.stringify(back.slice(Math.max(0, best - 160), best + 140)));
  }
}

for (const k of ['ipcMain.on(', 'ipcMain.handle(', 'ipcDecorator', 'from "K/Cq"']) {
  let n = 0;
  let j = -1;
  while ((j = t.indexOf(k, j + 1)) !== -1) n++;
  console.log(`${k} -> ${n}`);
}
