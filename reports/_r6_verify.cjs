const fs = require('fs');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const R = ROOT + '/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js';
const P = ROOT + '/main-dist/preload-render.js';
const RE = /["'`](\/(?:api|cloudmedia|zalocloud|zalocloudqos|zfamily|zpw|spcontact)[A-Za-z0-9_\-\/\.{}:]*?)["'`]/g;

function census(file, label) {
  const s = fs.readFileSync(file, 'utf8');
  const set = new Set();
  let m;
  while ((m = RE.exec(s))) set.add(m[1]);
  console.log(`${label}: ${set.size} distinct endpoint literals`);
  return { s, set };
}

const a = census(R, 'renderer');
const b = census(P, 'preload');

// transport primitives in preload
const prims = ['new WebSocket', 'XMLHttpRequest', 'fetch(', 'ipcRenderer.invoke', 'ipcRenderer.send', 'ipcRenderer.sendSync', 'ipcRenderer.on', 'ipcMain.handle', 'ipcMain.on', 'contextBridge', 'exposeInMainWorld'];
console.log('\n-- preload transport primitives --');
for (const p of prims) console.log(p.padEnd(24), b.s.split(p).length - 1);

console.log('\n-- renderer transport primitives --');
for (const p of ['new WebSocket', 'XMLHttpRequest', 'fetch(', 'ipcRenderer', 'contextBridge', 'exposeInMainWorld']) {
  console.log(p.padEnd(24), a.s.split(p).length - 1);
}

// sample of preload /api hits if any
const hits = [];
const re2 = /\/(api|cloudmedia|zalocloud)[A-Za-z0-9_\-\/\.]*/g;
let m2;
while ((m2 = re2.exec(b.s)) && hits.length < 12) hits.push(m2[0] + ' @' + m2.index);
console.log('\n-- preload api-ish raw hits (context) --');
for (const h of hits) console.log('  ' + h);
