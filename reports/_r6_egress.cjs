const fs = require('fs');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const F = ROOT + '/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js';
const s = fs.readFileSync(F, 'utf8');
const out = [];
const log = (...a) => out.push(a.join(' '));
const c = p => (s.match(p) || []).length;

log('=== RENDERER NETWORK EGRESS PRIMITIVES ===');
for (const [name, re] of [
  ['new WebSocket', /new WebSocket/g],
  ['XMLHttpRequest', /XMLHttpRequest/g],
  ['fetch(', /\bfetch\(/g],
  ['window.fetch', /window\.fetch/g],
  ['navigator.onLine', /navigator\.onLine/g],
  ['EventSource', /EventSource/g],
  ['sendBeacon', /sendBeacon/g],
  ['RTCPeerConnection', /RTCPeerConnection/g],
  ['chrome.runtime', /chrome\.runtime/g],
]) log(name.padEnd(24) + c(re));

log('');
log('=== IPC-ONLY EGRESS (does renderer reach network at all?) ===');
const ws = s.indexOf('new WebSocket');
log('new WebSocket @' + ws);
log(s.slice(Math.max(0, ws - 500), ws + 400).replace(/\s+/g, ' '));

log('');
log('=== XHR SITES (first 12 contexts) ===');
let i = -1, n = 0;
while ((i = s.indexOf('XMLHttpRequest', i + 1)) !== -1 && n < 12) {
  log('');
  log('@' + i + ': ' + s.slice(Math.max(0, i - 130), i + 150).replace(/\s+/g, ' '));
  n++;
}

fs.writeFileSync(__dirname + '/_r6_egress.txt', out.join('\n') + '\n');
console.log(out.join('\n').slice(0, 9000));
