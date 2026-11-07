#!/usr/bin/env node
/**
 * R11A read-only: decide reachability, not presence.
 *   A. Are the compact bundle's $zsub reads at module top level (throw at load)
 *      or inside functions (throw only when called)? Use brace depth at offset.
 *   B. Is the main-App loader Zt( actually called in compact-app.js?
 *   C. Why does preload-render.js name compact-app-pc?
 *
 * Usage: node tools/r11a-compact-reach.cjs <root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-compact-reach.cjs <root>');
  process.exit(2);
}

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

// Brace depth at an offset, ignoring strings/template/regex crudely but
// deterministically. Good enough to separate "top of module" from "in a method".
function braceDepth(t, at) {
  let d = 0;
  let q = null;
  for (let i = 0; i < at; i++) {
    const c = t[i];
    if (q) {
      if (c === '\\') { i++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '{') d++;
    else if (c === '}') d--;
  }
  return d;
}

console.log('=== A. brace depth of each $zsub read in the compact bundle ===');
{
  const t = read('pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js');
  const depths = [];
  let i = -1;
  while ((i = t.indexOf('$zsub', i + 1)) !== -1) {
    const next = t[i + 5];
    if (next !== '.' && next !== '[' && next !== ')') continue;
    depths.push({ at: i, d: braceDepth(t, i) });
  }
  const hist = new Map();
  for (const x of depths) hist.set(x.d, (hist.get(x.d) || 0) + 1);
  console.log(`   reads = ${depths.length}`);
  for (const [d, n] of [...hist.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`   depth ${String(d).padStart(3)} : ${n}`);
  }
  const shallow = depths.filter((x) => x.d <= 51).slice(0, 6);
  console.log('\n   shallowest reads (top-level module scope sits at a constant depth;');
  console.log('   anything EQUAL to that constant is module-level and throws at load):');
  for (const s of shallow) {
    console.log(`\n   @${s.at} depth=${s.d} :: ${JSON.stringify(t.slice(Math.max(0, s.at - 160), s.at + 160))}`);
  }
  // The bundle wraps each webpack module in a function; find the module wrapper depth
  // by measuring a known top-level statement.
  const probe = t.indexOf('const __ZaBUNDLENAME__');
  console.log(`\n   __ZaBUNDLENAME__ probe @${probe === -1 ? 'n/a' : probe}`);
}

console.log('\n\n=== B. Zt (load index.html) call sites in compact-app.js ===');
{
  const t = read('main-dist/compact-app.js');
  // locate the definition over the webContents.getURL signature
  const m = /function ([A-Za-z_$][\w$]*)\(e,t=""\)\{let n=e\.webContents\.getURL\(\)/.exec(t);
  console.log('   fn =', m ? m[1] : 'not found');
  if (m) {
    const fn = m[1];
    const re = new RegExp(`(?:^|[^.\\w$])${fn}\\(`, 'g');
    let hit;
    let c = 0;
    while ((hit = re.exec(t)) !== null && c < 14) {
      c++;
      const ctx = t.slice(Math.max(0, hit.index - 200), hit.index + 120);
      const lodash = /for\(var [a-z]|length|var [a-z],/.test(ctx) && !/webContents/.test(ctx);
      console.log(`\n   @${hit.index} lodashish=${lodash} :: ${JSON.stringify(ctx)}`);
    }
  }
  console.log('\n   index.html sites:');
  let j = -1; let k = 0;
  while ((j = t.indexOf('"index.html"', j + 1)) !== -1 && k < 6) {
    k++;
    console.log(`   @${j} :: ${JSON.stringify(t.slice(Math.max(0, j - 300), j + 200))}`);
  }
}

console.log('\n\n=== C. preload-render.js compact-app-pc site ===');
{
  const t = read('main-dist/preload-render.js');
  const i = t.indexOf('compact-app-pc');
  console.log(JSON.stringify(t.slice(Math.max(0, i - 300), i + 300)));
}
