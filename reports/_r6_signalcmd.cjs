const fs = require('fs');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const F = ROOT + '/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js';
const s = fs.readFileSync(F, 'utf8');
const out = [];
const log = (...a) => out.push(a.join(' '));

const anchors = ['INIT_SESSION:', 'SUBMIT_PREKEYS:', 'DELIVER_SEEN_ONEONE:'];
for (const a of anchors) {
  log('##### ' + a);
  let idx = -1, n = 0;
  while ((idx = s.indexOf(a, idx + 1)) !== -1 && n < 3) {
    log('@' + idx);
    log(s.slice(Math.max(0, idx - 2600), idx + 2600));
    log('');
    n++;
  }
  if (!n) log('(none)');
  log('');
}
fs.writeFileSync(__dirname + '/_r6_signalcmd.txt', out.join('\n') + '\n');
console.log('wrote _r6_signalcmd.txt');
