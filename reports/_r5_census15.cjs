const fs = require('fs'), path = require('path');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const out = []; const log = (...a) => out.push(a.join(' '));
const findAll = (s, n, max = 40) => { const h = []; let i = 0; while ((i = s.indexOf(n, i)) !== -1) { h.push(i); i += n.length; if (h.length >= max) break; } return h; };
const ctx = (s, o, b = 300, f = 400) => JSON.stringify(s.slice(Math.max(0, o - b), o + f));

const pcd = path.join(ROOT, 'pc-dist');
const big = 'compact-app-pc.f32c58b63b6f4273a8a4.js';
const s = fs.readFileSync(path.join(pcd, big), 'utf8');

// --- 1. Which bundle does the main window (index.html) actually load? ---
log('=== index.html script srcs ===');
{
  const h = fs.readFileSync(path.join(pcd, 'index.html'), 'utf8');
  const srcs = [...h.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => m[1]);
  for (const x of srcs) log('  ' + x);
  log('  inline webpack chunk hints:');
  for (const m of h.matchAll(/window\.__(SRC|CHUNK)[A-Z_]*\s*=\s*'([^']+)'/g)) log('    ' + m[1] + ' = ' + m[2]);
}
log('');

// --- 2. The theme module's export map, so we can find the scrubber's public name ---
log('=== theme module export map (n.d(t,"x",()=>y)) ===');
{
  const anchor = s.indexOf('document.getElementById("app-custom-theme")');
  let start = s.lastIndexOf(',', s.lastIndexOf('function(e,t,n)', anchor));
  // walk back to the module key
  const modKey = /([A-Za-z0-9_+\/$-]{3,12}):function\(e,t,n\)\{"use strict"[^]*?$/.exec(s.slice(Math.max(0, anchor - 60000), anchor));
  log('  module key guess: ' + (modKey ? modKey[1] : 'unknown'));
  // export decls within +/- 40k of anchor that reference a 1-2 char alias
  const win = s.slice(Math.max(0, anchor - 12000), anchor + 8000);
  const decls = [...win.matchAll(/n\.d\(t,"([^"]+)",\(function\(\)\{return (\w+)\}\)\)/g)].map(m => m[1] + '->' + m[2]);
  log('  exports: ' + JSON.stringify(decls));
}
log('');

// --- 3. Is the scrubber (the fn that removes zadark nodes) exported and called? ---
log('=== scrubber invocation check ===');
{
  // Rebuild selector strings to find all references
  const linkSel = ['l','i','n','k','[','h','r','e','f','^','=','"','z','a','d','a','r','k','"',']'].join('');
  log('  re-assembled link selector: ' + linkSel);
  log('  occurrences of assembled selector literal: ' + findAll(s, JSON.stringify(linkSel).slice(1,-1), 20).length);
  // Find the function boundaries and see what follows the closing brace
  const g = s.indexOf('document.getElementsByTagName("body")');
  log('  scrubber body start @' + g);
  log('  after scrubber: ' + JSON.stringify(s.slice(g + 400, g + 1200)));
}
log('');

// --- 4. Does the CUSTOM theme apply path run on boot (useEffect) or only when settings opened? ---
log('=== CUSTOM theme hot path: which module renders the App and applies theme on mount ===');
for (const pat of ['za_theme_custom', 'THEME_SETTING_OPT', 'isMaskSidebar']) {
  const offs = findAll(s, pat, 6);
  log('  ' + pat + ' sites: ' + offs.length);
}
log('');

// --- 5. token-only? enumerate every property name the generator emits ---
log('=== properties emitted by the CUSTOM generator ===');
{
  const win = s.slice(14345000, 14348500);
  const props = new Set();
  for (const m of win.matchAll(/--[a-zA-Z][a-zA-Z0-9-]*/g)) props.add(m[0]);
  for (const m of win.matchAll(/[a-zA-Z-]+:\\s?\\$\\{/g)) props.add('(dyn)' + m[0]);
  log('  tokens: ' + [...props].sort().join(' '));
}
log('');

// --- 6. same sink scope in other bundles: is the selector :root .custom only? ---
log('=== sink scope occurrences ===');
for (const b of [big, 'sync-v2-sub-worker.f32c58b63b6f4273a8a4.js', 'search-worker.f32c58b63b6f4273a8a4.js']) {
  const t = fs.readFileSync(path.join(pcd, b), 'utf8');
  log('  [' + b + '] ":root .custom" = ' + findAll(t, ':root .custom', 99).length + ' ; "app-custom-theme" = ' + findAll(t, 'app-custom-theme', 99).length);
}
log('');

fs.writeFileSync(path.join(__dirname, '_r5_census15.txt'), out.join('\n') + '\n');
console.log(out.join('\n'));
