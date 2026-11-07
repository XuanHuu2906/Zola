const fs = require('fs');
const path = require('path');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const out = [];
const log = (...a) => out.push(a.join(' '));
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const count = (s, n) => { let c = 0, i = 0; while ((i = s.indexOf(n, i)) !== -1) { c++; i += n.length; } return c; };

const main = read('main-dist/main.js');
const pre = read('main-dist/preload-render.js');

log('=== native module inventory (native/) ===');
const natDir = path.join(ROOT, 'native');
const walk = (d, depth = 0) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (depth > 2) return;
    if (e.isDirectory()) { log('  '.repeat(depth) + 'DIR ' + e.name); walk(path.join(d, e.name), depth + 1); }
    else log('  '.repeat(depth) + e.name + ' ' + fs.statSync(path.join(d, e.name)).size);
  }
};
walk(natDir);
log('');

log('=== function-surface census (main.js counts) ===');
const surfaces = {
  'login/session': ['zpw_sek', 'ZaloLoginWidget', 'login.html', 'refreshToken', 'RefreshToken'],
  'messaging': ['zMsgChannel', 'MsgChannel', 'sendMessage', 'messageChannel'],
  'file-send': ['zFileManager', 'uploadFile', 'new-download-file', 'zcloud', 'ZCloud'],
  'calling': ['zcall', 'CallChannel', 'videoCall', 'webrtc', 'WebRTC'],
  'sync/db': ['zdb', 'sqlite', 'SQLite', 'ZDB', 'syncMessage', 'conversationList'],
  'updater': ['checkForUpdates', 'quitAndInstall', 'update-downloaded'],
};
for (const [group, keys] of Object.entries(surfaces)) {
  log('  [' + group + '] ' + keys.map(k => k + '=' + count(main, k)).join(' '));
}
log('');

log('=== preload bridge groups ===');
for (const [group, keys] of Object.entries(surfaces)) {
  log('  [' + group + '] ' + keys.map(k => k + '=' + count(pre, k)).join(' '));
}
log('');

// CSP monitor: confirm it never rewrites headers (only inspects frame-ancestors and forwards original)
const off = main.indexOf('setupCSPMonitor');
log('=== CSP monitor handler verbatim ===');
log(JSON.stringify(main.slice(off, off + 1180)));
log('');

// headerController.addNewHeader
log('=== headerController.addNewHeader (module yyar) ===');
for (const m of main.matchAll(/yyar/g)) {
  const i = m.index;
  const snip = main.slice(i, i + 1200);
  if (snip.includes('addNewHeader')) { log(JSON.stringify(snip)); break; }
}
log('');

fs.writeFileSync(path.join(__dirname, '_r5_census7.txt'), out.join('\n') + '\n');
console.log(out.join('\n'));
