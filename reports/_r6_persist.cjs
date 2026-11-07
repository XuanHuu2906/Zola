const fs = require('fs');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const F = ROOT + '/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js';
const s = fs.readFileSync(F, 'utf8');
const out = [];
const log = (...a) => out.push(a.join(' '));

function count(pat, flags = 'g') {
  try { return (s.match(new RegExp(pat, flags)) || []).length; } catch (e) { return 'ERR ' + e.message; }
}

log('=== STORAGE PRIMITIVE CENSUS (renderer bundle) ===');
for (const p of ['indexedDB', 'IDBDatabase', 'openDatabase', 'localStorage', 'sessionStorage',
                 'caches\\.open', 'navigator\\.storage', 'SQLite', 'sqlite', 'wasm.*sqlite',
                 'FileSystem', 'showDirectoryPicker', 'postMessage\\(.*MessageChannel']) {
  log((p + '').padEnd(34) + count(p));
}

log('');
log('=== PRELOAD / IPC BRIDGE MARKERS ===');
for (const p of ['contextBridge', 'exposeInMainWorld', 'ipcRenderer', 'ipcMain',
                 'BrowserWindow', 'webContents\\.send', 'MessagePort', 'MessageChannel']) {
  log((p + '').padEnd(34) + count(p));
}

log('');
log('=== $z* CLASS NS SITES ===');
const nsRe = /window\.(\$[A-Za-z0-9_]+)\s*=/g;
const seen = new Set();
let m;
while ((m = nsRe.exec(s))) {
  if (!seen.has(m[1])) {
    seen.add(m[1]);
    log(`@${m.index}  ${m[1]}  ->  ${s.slice(m.index, m.index + 160).replace(/\s+/g, ' ')}`);
  }
}

log('');
log('=== DB NAMESPACE $zdb repr ===');
let i = s.indexOf('$zdb');
if (i >= 0) log(s.slice(Math.max(0, i - 400), i + 1200).replace(/\s+/g, ' '));

fs.writeFileSync(__dirname + '/_r6_persist.txt', out.join('\n') + '\n');
console.log(out.join('\n'));
