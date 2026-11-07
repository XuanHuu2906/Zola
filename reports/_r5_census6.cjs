const fs = require('fs');
const path = require('path');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const out = [];
const log = (...a) => out.push(a.join(' '));
const findAll = (s, n, max = 20) => { const h = []; let i = 0; while ((i = s.indexOf(n, i)) !== -1) { h.push(i); i += n.length; if (h.length >= max) break; } return h; };
const main = fs.readFileSync(path.join(ROOT, 'main-dist/main.js'), 'utf8');
const compact = fs.readFileSync(path.join(ROOT, 'main-dist/compact-app.js'), 'utf8');

log('=== --inspect sites (main.js) ===');
for (const off of findAll(main, '--inspect', 6)) log('  @' + off + ' :: ' + JSON.stringify(main.slice(off - 300, off + 200)));
log('');

log('=== setOpacity sites (main.js) — first 6, filtered to window calls ===');
for (const off of findAll(main, 'setOpacity', 16)) {
  const snip = main.slice(off - 140, off + 100);
  if (/\.setOpacity\(/.test(snip)) log('  @' + off + ' :: ' + JSON.stringify(snip));
}
log('');

log('=== Electron version / update feed / provider ===');
for (const off of findAll(main, 'provider:', 4)) log('  @' + off + ' :: ' + JSON.stringify(main.slice(off - 320, off + 320)));
log('');

log('=== bootstrap.js (root) ===');
log(fs.readFileSync(path.join(ROOT, 'bootstrap.js'), 'utf8'));
log('');

log('=== package.json (root) ===');
log(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
log('');

log('=== compact-app.js: any window chrome besides backgroundColor? ===');
for (const v of ['setBackgroundMaterial', 'vibrancy', 'titleBarOverlay', 'nativeTheme', 'insertCSS', 'executeJavaScript']) {
  let n = 0, i = 0; while ((i = compact.indexOf(v, i)) !== -1) { n++; i += v.length; }
  log('  ' + v + ' = ' + n);
}
log('');

fs.writeFileSync(path.join(__dirname, '_r5_census6.txt'), out.join('\n') + '\n');
console.log(out.join('\n'));
