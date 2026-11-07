const fs = require('fs'), path = require('path');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const out = []; const log = (...a) => out.push(a.join(' '));
const findAll = (s, n, max = 40) => { const h = []; let i = 0; while ((i = s.indexOf(n, i)) !== -1) { h.push(i); i += n.length; if (h.length >= max) break; } return h; };
const ctx = (s, o, back = 500, fwd = 700) => JSON.stringify(s.slice(Math.max(0, o - back), o + fwd));

const f = 'compact-app-pc.f32c58b63b6f4273a8a4.js';
const s = fs.readFileSync(path.join(ROOT, 'pc-dist', f), 'utf8');

log('=== where is the anti-ZaDark scrubber invoked? (search its module export alias) ===');
// The scrubber is `f` inside a module; find callers by the adjacent export map.
{
  const o = s.indexOf('document.getElementById("app-custom-theme")');
  const modStart = s.lastIndexOf('function(e,t,n){"use strict"', o);
  log('  module start guess @' + modStart);
  log('  exports seen after module: ' + JSON.stringify(s.slice(o + 1500, o + 2600)));
}
log('');

log('=== za_theme_custom read/write sites ===');
for (const o of findAll(s, 'za_theme_custom', 12)) log('  @' + o + ' :: ' + ctx(s, o, 350, 450));
log('');

log('=== updateThemeSetting definition ===');
for (const o of findAll(s, 'updateThemeSetting', 8)) log('  @' + o + ' :: ' + ctx(s, o, 400, 600));
log('');

log('=== is any setting field interpolated RAW into CSS? look for "${R. or "${e. near contentCss ===');
for (const o of findAll(s, 'contentCss', 8)) {
  const seg = s.slice(o, o + 1200);
  const raw = [...seg.matchAll(/\$\{([^}]{0,40})\}/g)].map(m => m[1]);
  if (raw.length) log('  @' + o + ' interpolation: ' + JSON.stringify(raw));
}
log('');

log('=== tinycolor coercion of the four color fields ===');
for (const o of findAll(s, 'isGradient', 6)) {
  const seg = s.slice(Math.max(0, o - 700), o + 500);
  if (/contentCss|toRgb|isDark/.test(seg)) log('  @' + o + ' :: ' + JSON.stringify(seg));
}
log('');

log('=== mask-sidebar / custom body classes are REQUIRED for the sink to apply? ===');
for (const k of ['mask-sidebar', '"custom"', 'ot.e.CUSTOM', 'classList.add']) log('  ' + k + ' = ' + findAll(s, k, 99999).length);
log('');

log('=== does the scrubber run on load / interval? callers of the module ===');
{
  // find exports of the module containing the scrubber
  const idx = s.indexOf('document.getElementById("app-custom-theme")');
  const tail = s.slice(idx, idx + 4000);
  const m = tail.match(/(\w+):function\(e,t,n\)\{/g);
  log('  next modules: ' + JSON.stringify(m ? m.slice(0, 4) : null));
}
log('');

log('=== same sink present in the OTHER large renderer bundles? ===');
for (const other of ['sync-v2-sub-worker.f32c58b63b6f4273a8a4.js', 'search-worker.f32c58b63b6f4273a8a4.js', 'zd-worker.f32c58b63b6f4273a8a4.js']) {
  const t = fs.readFileSync(path.join(ROOT, 'pc-dist', other), 'utf8');
  log('  [' + other + '] app-custom-theme=' + findAll(t, 'app-custom-theme', 99).length + ' zadark-guard=' + findAll(t, '"z","a","d","a","r","k"', 99).length);
}
log('');

fs.writeFileSync(path.join(__dirname, '_r5_census14.txt'), out.join('\n') + '\n');
console.log(out.join('\n'));
