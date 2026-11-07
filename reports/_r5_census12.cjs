const fs = require('fs'), path = require('path');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const out = []; const log = (...a) => out.push(a.join(' '));
const findAll = (s, n, max = 40) => { const h = []; let i = 0; while ((i = s.indexOf(n, i)) !== -1) { h.push(i); i += n.length; if (h.length >= max) break; } return h; };

const f = 'compact-app-pc.f32c58b63b6f4273a8a4.js';
const s = fs.readFileSync(path.join(ROOT, 'pc-dist', f), 'utf8');
log('=== bundle = ' + f + ' (' + s.length + ' B) ===');
log('');

// Where are CSS variables applied? look for style.setProperty with a -- token
log('=== setProperty sites whose argument looks like a CSS variable ===');
let n = 0;
for (const o of findAll(s, 'setProperty', 400)) {
  const snip = s.slice(Math.max(0, o - 200), o + 220);
  if (/--[a-zA-Z]/.test(snip)) { log('  @' + o + ' :: ' + JSON.stringify(snip)); if (++n >= 8) break; }
}
log('  total setProperty = ' + findAll(s, 'setProperty', 99999).length);
log('');

// The CUSTOM theme branch: find CORE_TOKEN_COLORS usage and what consumes it
log('=== CORE_TOKEN_COLORS consumers ===');
for (const o of findAll(s, 'CORE_TOKEN_COLORS', 20)) log('  @' + o + ' :: ' + JSON.stringify(s.slice(Math.max(0, o - 300), o + 400)));
log('');

// does anything build a <style> element from theme data?
log('=== createElement("style") sites ===');
for (const o of findAll(s, 'createElement("style")', 20)) log('  @' + o + ' :: ' + JSON.stringify(s.slice(Math.max(0, o - 350), o + 350)));
log('');

log('=== insertRule sites (all) ===');
for (const o of findAll(s, 'insertRule', 20)) log('  @' + o + ' :: ' + JSON.stringify(s.slice(Math.max(0, o - 350), o + 300)));
log('');

// Where is za_theme written, and what does the custom palette contain?
log('=== "custom" theme apply path (search theme_setting===3 / theme===custom) ===');
for (const pat of ['theme_setting===3', '===3', '"custom"', "'custom'"]) {
  const offs = findAll(s, pat, 12);
  if (!offs.length) continue;
  for (const o of offs) {
    const snip = s.slice(Math.max(0, o - 350), o + 450);
    if (/theme/i.test(snip) && /color|palette|variable|style/i.test(snip)) { log('  [' + pat + '] @' + o + ' :: ' + JSON.stringify(snip)); }
  }
}
log('');

fs.writeFileSync(path.join(__dirname, '_r5_census12.txt'), out.join('\n') + '\n');
console.log(out.join('\n'));
