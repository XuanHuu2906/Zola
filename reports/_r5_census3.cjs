const fs = require('fs');
const path = require('path');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const out = [];
const log = (...a) => out.push(a.join(' '));
const txt = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const findAll = (s, n, max = 10) => { const h = []; let i = 0; while ((i = s.indexOf(n, i)) !== -1) { h.push(i); i += n.length; if (h.length >= max) break; } return h; };

const main = txt('main-dist/main.js');
log('=== onHeadersReceived sites ===');
for (const off of findAll(main, 'onHeadersReceived', 6)) log('  @' + off + ' :: ' + JSON.stringify(main.slice(off - 700, off + 500)));
log('');

log('=== style.css site ===');
for (const off of findAll(main, 'style.css', 3)) log('  @' + off + ' :: ' + JSON.stringify(main.slice(off - 300, off + 200)));
log('');

log('=== loadFile sites (filtered to non-vendor) ===');
for (const off of findAll(main, 'loadFile', 40)) {
  const snip = main.slice(off - 160, off + 160);
  if (/node_modules|\.json|\.png|\.svg|\.woff|\.ttf/i.test(snip)) continue;
  log('  @' + off + ' :: ' + JSON.stringify(snip));
}
log('');

log('=== webRequest handler kinds ===');
for (const off of findAll(main, 'webRequest', 10)) log('  @' + off + ' :: ' + JSON.stringify(main.slice(off - 120, off + 160)));
log('');

// Check preload for any DOM/CSS mutation beyond the bridge
const pre = txt('main-dist/preload-render.js');
log('=== preload DOM/CSS mutation vocabulary ===');
for (const v of ['document.createElement', 'style', 'appendChild', 'insertRule', 'adoptedStyleSheets', 'link', 'stylesheet']) {
  let n = 0, i = 0; while ((i = pre.indexOf(v, i)) !== -1) { n++; i += v.length; }
  log('  ' + v + ' = ' + n);
}
log('');

// index.html: what is the inline boot script doing (background only)
const idx = txt('pc-dist/index.html');
log('=== index.html inline script/style digest ===');
const styles = findAll(idx, '<style', 5);
const scripts = findAll(idx, '<script', 10);
log('  style tags:', styles.length, 'script tags:', scripts.length);
for (const off of styles) log('  STYLE @' + off + ' :: ' + JSON.stringify(idx.slice(off, off + 260)));
log('');

fs.writeFileSync(path.join(__dirname, '_r5_census3.txt'), out.join('\n') + '\n');
console.log(out.join('\n'));
