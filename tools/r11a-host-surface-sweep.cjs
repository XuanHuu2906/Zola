#!/usr/bin/env node
/**
 * R11A read-only sweep: is there any local server / bridge surface at all?
 * Counts lexical occurrences (NOT call sites) across every .js in an extracted asar.
 *
 * Usage: node tools/r11a-host-surface-sweep.cjs <extracted-root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const KEYS = [
  'createServer',
  'http.createServer',
  'https.createServer',
  'express(',
  'app.listen(',
  'server.listen(',
  'WebSocketServer',
  'socket.io',
  'net.connect',
  'net.createConnection',
  'PipeZCallRecv',
  'PipeZCallSend',
  '\\\\\\\\.\\\\pipe\\\\',
  'serve-static',
  'connect(',
  'listen(',
  'ws.Server',
];

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
    console.error('usage: node tools/r11a-host-surface-sweep.cjs <extracted-root>');
    process.exit(2);
  }
  const files = walk(root, []);
  const rows = [];
  for (const key of KEYS) {
    let total = 0;
    const hits = [];
    for (const abs of files) {
      const text = fs.readFileSync(abs, 'utf8');
      const count = text.split(key).length - 1;
      if (!count) continue;
      total += count;
      hits.push({ file: path.relative(root, abs).replace(/\\/g, '/'), count });
    }
    rows.push({ key, total, hits: hits.slice(0, 8), file_count: hits.length });
  }
  console.log(
    JSON.stringify(
      { root, js_files: files.length, note: 'lexical counts, not call sites', rows },
      null,
      2
    )
  );
}

main();
