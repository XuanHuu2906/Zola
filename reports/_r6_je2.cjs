const fs = require('fs');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const s = fs.readFileSync(ROOT + '/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js', 'utf8');
const out = [];
const log = (...a) => out.push(a.join(' '));
// all assignments of Je
const re = /\bJe\s*=\s*/g;
let m, n = 0;
while ((m = re.exec(s)) && n < 8) {
  log('');
  log('### Je= @' + m.index);
  log(s.slice(Math.max(0, m.index - 300), m.index + 400).replace(/\s+/g, ' '));
  n++;
}
// zdmapi override
log('');
log('=== zdmapi ===');
let j = -1, k = 0;
while ((j = s.indexOf('zdmapi', j + 1)) !== -1 && k < 4) {
  log('');
  log('@' + j + '  ' + s.slice(Math.max(0, j - 350), j + 350).replace(/\s+/g, ' '));
  k++;
}
fs.writeFileSync(__dirname + '/_r6_je2.txt', out.join('\n') + '\n');
console.log(out.join('\n').slice(0, 7000));
