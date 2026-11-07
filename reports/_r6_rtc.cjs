const fs = require('fs');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const F = ROOT + '/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js';
const s = fs.readFileSync(F, 'utf8');
const out = [];
const log = (...a) => out.push(a.join(' '));

log('=== RTCPeerConnection SITES ===');
let i = -1, n = 0;
while ((i = s.indexOf('RTCPeerConnection', i + 1)) !== -1 && n < 8) {
  log('');
  log('@' + i + ': ' + s.slice(Math.max(0, i - 420), i + 420).replace(/\s+/g, ' '));
  n++;
}

log('');
log('=== CALL NATIVE BRIDGE (call-send-to-native / call-init) IN RENDERER ===');
for (const a of ['call-send-to-native', 'call-init', 'call_active_native_app', 'call-server-request']) {
  const j = s.indexOf('"' + a + '"');
  log(a.padEnd(26) + (j === -1 ? 'NOT IN RENDERER' : '@' + j + ' ' + s.slice(Math.max(0, j - 200), j + 200).replace(/\s+/g, ' ')));
}

log('');
log('=== voicecall API CALL SITES ===');
for (const a of ['/api/voicecall/requestcall', '/api/voicecall/answer', '/api/voicecall/group/join']) {
  const j = s.indexOf(a);
  log(a + ' @' + j);
  if (j !== -1) log('   ' + s.slice(Math.max(0, j - 260), j + 260).replace(/\s+/g, ' '));
}

log('');
log('=== getMedia / getUserMedia / getDisplayMedia ===');
for (const a of ['getUserMedia', 'getDisplayMedia', 'mediaDevices']) {
  log(a.padEnd(18) + (s.match(new RegExp(a, 'g')) || []).length);
}

fs.writeFileSync(__dirname + '/_r6_rtc.txt', out.join('\n') + '\n');
console.log(out.join('\n').slice(0, 9000));
