const fs = require('fs'), path = require('path');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const out = []; const log = (...a) => out.push(a.join(' '));
const findAll = (s, n, max = 40) => { const h = []; let i = 0; while ((i = s.indexOf(n, i)) !== -1) { h.push(i); i += n.length; if (h.length >= max) break; } return h; };

const pcd = path.join(ROOT, 'pc-dist');
const js = fs.readdirSync(pcd).filter(f => f.endsWith('.js'))
  .map(f => [f, fs.statSync(path.join(pcd, f)).size]).sort((a, b) => b[1] - a[1]);

log('=== pc-dist top-level .js by size (top 15) ===');
for (const [f, s] of js.slice(0, 15)) log('  ' + f + ' ' + s);
log('');

// The renderer's CUSTOM theme sink: does it write CSS TEXT into a <style> / insertRule / textContent?
const keys = ['za_theme', 'insertRule', 'textContent', 'adoptedStyleSheets', 'cssRules', 'innerHTML', 'setProperty', 'createElement("style")', "createElement('style')", 'appendChild'];
for (const [f, sz] of js.slice(0, 12)) {
  const s = fs.readFileSync(path.join(pcd, f), 'utf8');
  const row = keys.map(k => k + '=' + findAll(s, k, 99999).length).join(' ');
  if (/za_theme|insertRule|adoptedStyleSheets/.test(row) && !/=\s*0(\s|$)/.test(row)) log('  [' + f + '] ' + row);
}
log('');

// Locate za_theme reads in the renderer and show the CUSTOM branch
log('=== za_theme sites in pc-dist js (top 6 files, first 3 each) ===');
let shown = 0;
for (const [f] of js) {
  if (shown >= 12) break;
  const s = fs.readFileSync(path.join(pcd, f), 'utf8');
  const offs = findAll(s, 'za_theme', 3);
  for (const o of offs) {
    log('  [' + f + '] @' + o + ' :: ' + JSON.stringify(s.slice(Math.max(0, o - 400), o + 500)));
    shown++;
  }
}
log('');

// Is there ANY place CSS text from storage/remote is applied to a stylesheet?
log('=== "styleSheet" / "cssText" / "insertRule" in the largest renderer bundle ===');
if (js.length) {
  const biggest = js[0][0];
  const s = fs.readFileSync(path.join(pcd, biggest), 'utf8');
  for (const k of ['styleSheet', 'cssText', 'insertRule', 'adoptedStyleSheets', 'custom']) {
    log('  [' + biggest + '] ' + k + ' = ' + findAll(s, k, 99999).length);
  }
  for (const o of findAll(s, 'cssText', 5)) log('    cssText @' + o + ' :: ' + JSON.stringify(s.slice(Math.max(0, o - 300), o + 300)));
}
log('');

fs.writeFileSync(path.join(__dirname, '_r5_census11.txt'), out.join('\n') + '\n');
console.log(out.join('\n'));
