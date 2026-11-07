const fs = require('fs');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const R = ROOT + '/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js';
const s = fs.readFileSync(R, 'utf8');
const out = [];
const log = (...a) => out.push(a.join(' '));

function ctx(needle, before = 300, after = 500, max = 3) {
  let i = -1, n = 0;
  while ((i = s.indexOf(needle, i + 1)) !== -1 && n < max) {
    log('');
    log(`### ${needle} @${i}`);
    log(s.slice(Math.max(0, i - before), i + after).replace(/\s+/g, ' '));
    n++;
  }
  if (n === 0) { log(''); log(`### ${needle} -> NOT FOUND`); }
}

log('=== SEND PIPELINE ===');
ctx('"sms"', 200, 400, 2);

log('');
log('=== SEND HTTP TABLE ENTRY (message/sms) ===');
ctx('/api/message/sms', 400, 300, 2);

log('');
log('=== RECEIVE / WS DISPATCH ===');
ctx('PUSH_MSG_1_1', 250, 700, 2);
ctx('PUSH_MSG_GROUP', 250, 700, 1);

log('');
log('=== PING / KEEPALIVE STRUCTURE ===');
ctx('KEEP_CONNECTION', 300, 400, 1);

log('');
log('=== SYNC MESSAGE ===');
ctx('SYNC_MESSAGE', 200, 600, 2);

log('');
log('=== NOTIFICATION (web Notification) ===');
for (const k of ['new Notification(', 'Notification.requestPermission', 'showNotification']) {
  log('');
  log(`${k}: ${(s.split(k).length - 1)}`);
}

log('');
log('=== CONTACTS / FRIEND WRITE PATHS ===');
for (const a of ['/api/friend/sendreq', '/api/friend/accept', '/api/social/friend/getfriends']) {
  const j = s.indexOf(a);
  log(a + ' @' + j);
}

fs.writeFileSync(__dirname + '/_r6_flow.txt', out.join('\n') + '\n');
console.log(out.join('\n').slice(0, 12000));
