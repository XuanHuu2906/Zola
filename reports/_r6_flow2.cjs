const fs = require('fs');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const R = ROOT + '/pc-dist/compact-app-c.f32c58b63b6f4273a8a4.js';
const R2 = ROOT + '/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js';
const s = fs.readFileSync(R2, 'utf8');
const out = [];
const log = (...a) => out.push(a.join(' '));

function ctx(needle, before = 300, after = 500, max = 2) {
  let i = -1, n = 0;
  while ((i = s.indexOf(needle, i + 1)) !== -1 && n < max) {
    log('');
    log(`### ${needle} @${i}`);
    log(s.slice(Math.max(0, i - before), i + after).replace(/\s+/g, ' '));
    n++;
  }
  if (n === 0) { log(''); log(`### ${needle} -> NOT FOUND`); }
}

log('=== AUTHEN PAYLOAD SHAPE (field names only) ===');
ctx('AUTHEN', 200, 900, 3);

log('');
log('=== buildParams (send) ===');
ctx('static buildParams', 100, 900, 1);

log('');
log('=== _postSendMsg ===');
ctx('_postSendMsg(', 100, 900, 1);

log('');
log('=== Notification.requestPermission context ===');
ctx('Notification.requestPermission', 300, 300, 3);

log('');
log('=== WS message envelope receive ===');
ctx('INNER_PAYLOAD', 300, 700, 2);

fs.writeFileSync(__dirname + '/_r6_flow2.txt', out.join('\n') + '\n');
console.log(out.join('\n').slice(0, 14000));
