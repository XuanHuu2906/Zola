const fs = require('fs');
const path = require('path');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const out = [];
const log = (...a) => out.push(a.join(' '));
const pre = fs.readFileSync(path.join(ROOT, 'main-dist/preload-render.js'), 'utf8');
const findAll = (s, n, max = 20) => { const h = []; let i = 0; while ((i = s.indexOf(n, i)) !== -1) { h.push(i); i += n.length; if (h.length >= max) break; } return h; };

log('=== preload insertRule sites ===');
for (const off of findAll(pre, 'insertRule', 12)) log('  @' + off + ' :: ' + JSON.stringify(pre.slice(off - 260, off + 220)));
log('');

log('=== preload document.createElement sites ===');
for (const off of findAll(pre, 'document.createElement', 10)) log('  @' + off + ' :: ' + JSON.stringify(pre.slice(off - 160, off + 200)));
log('');

log('=== preload stylesheet literal sites ===');
for (const off of findAll(pre, 'stylesheet', 6)) log('  @' + off + ' :: ' + JSON.stringify(pre.slice(off - 260, off + 220)));
log('');

// where does .style get used - is it DOM style or React-like?
log('=== sample .style occurrences (first 12) ===');
for (const off of findAll(pre, '.style', 12)) log('  @' + off + ' :: ' + JSON.stringify(pre.slice(off - 120, off + 120)));
log('');

fs.writeFileSync(path.join(__dirname, '_r5_census4.txt'), out.join('\n') + '\n');
console.log(out.join('\n'));
