const fs = require('fs');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const s = fs.readFileSync(ROOT + '/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js', 'utf8');
const out = [];
const log = (...a) => out.push(a.join(' '));

// locate 'se=' definition feeding _constructUrlParams(se)
const idxs = [];
let i = -1;
while ((i = s.indexOf('_constructUrlParams(se)', i + 1)) !== -1) idxs.push(i);
log('_constructUrlParams(se) sites: ' + JSON.stringify(idxs));

// find the variable declaration  se={...}  (webpack module scope)
const re = /\bse=\{/g;
let m;
while ((m = re.exec(s))) {
  log('');
  log('### se={ @' + m.index);
  log(s.slice(m.index, m.index + 900).replace(/\s+/g, ' '));
}
log('');
log('=== zpw_ver literal sites ===');
let j = -1, n = 0;
while ((j = s.indexOf('zpw_ver', j + 1)) !== -1 && n < 6) {
  log('');
  log('@' + j + '  ' + s.slice(Math.max(0, j - 200), j + 260).replace(/\s+/g, ' '));
  n++;
}
fs.writeFileSync(__dirname + '/_r6_se.txt', out.join('\n') + '\n');
console.log(out.join('\n').slice(0, 8000));
