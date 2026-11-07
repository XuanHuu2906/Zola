const fs = require('fs');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const R = ROOT + '/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js';
const s = fs.readFileSync(R, 'utf8');
const out = [];
const log = (...a) => out.push(a.join(' '));

function ctx(needle, before = 250, after = 600, max = 2) {
  let i = -1, n = 0;
  while ((i = s.indexOf(needle, i + 1)) !== -1 && n < max) {
    log('');
    log(`### ${needle} @${i}`);
    log(s.slice(Math.max(0, i - before), i + after).replace(/\s+/g, ' '));
    n++;
  }
  if (n === 0) { log(''); log(`### ${needle} -> NOT FOUND`); }
}

log('=== FILE UPLOAD PIPELINE ===');
ctx('chunkId', 300, 700, 2);

log('');
log('=== MEDIA UPLOAD URL (WS cmd 800) ===');
ctx('GET_MEDIA_UPLOAD_URL', 200, 500, 2);

log('');
log('=== SYNC / BACKUP MSG PIPELINE ===');
ctx('BACKUP_MSG', 200, 700, 2);

log('');
log('=== E2EE ENABLE GATE ===');
ctx('enable_e2ee', 300, 500, 2);

log('');
log('=== CALL: voicecall API usage in renderer ===');
ctx('/api/voicecall/requestcall', 400, 400, 1);
ctx('/api/voicecall/request', 400, 400, 1);

log('');
log('=== SCREENCAP / SCREENSHARE ===');
ctx('requestsharescreen', 300, 400, 1);

fs.writeFileSync(__dirname + '/_r6_flow3.txt', out.join('\n') + '\n');
console.log(out.join('\n').slice(0, 12000));
