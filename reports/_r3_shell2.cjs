const fs = require('fs');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const out = [];
const log = (...a) => out.push(a.map(String).join(' '));
function around(off, back, fwd) { return js.slice(Math.max(0, off - back), off + fwd); }
function allOcc(s) { const out2 = []; let p = 0; while ((p = js.indexOf(s, p)) >= 0) { out2.push(p); p += s.length; } return out2; }
try {
  log('=== 3. main-tab renders ===');
  for (const s of ['"main-tab', ' main-tab ', 'main-tab"']) {
    const occ = allOcc(s);
    log(`## ${JSON.stringify(s)} occ=${occ.length}`);
    for (const o of occ.slice(0, 2)) { log(`@${o}`); log(around(o, 400, 800)); }
  }
  log('\n=== 4. left sidebar container ===');
  for (const s of ['id:"main-tab"', 'left-sidebar', 'leftSidebar', '"leftmenu"', 'sidebar-container', 'div_Main_Tab']) {
    const occ = allOcc(s);
    log(`## ${JSON.stringify(s)} occ=${occ.length}`);
    for (const o of occ.slice(0, 2)) { log(`@${o}`); log(around(o, 500, 900)); }
  }
  log('\n=== 5. message list wrapper parent (#messageView chain) ===');
  for (const o of allOcc('id:"messageView"')) { log(`@${o}`); log(around(o, 200, 2600)); }
  log('\n=== 6. composer root ===');
  for (const o of allOcc('id:"chat-input-container"').concat(allOcc('"chat-input-container"')).slice(0, 2)) { log(`@${o}`); log(around(o, 900, 1500)); }
  log('\n=== 7. settings root ===');
  for (const o of allOcc('id:"setting"').slice(0, 2)) { log(`@${o}`); log(around(o, 700, 1200)); }
  log('\n=== 8. zmenu body ===');
  for (const o of allOcc('"zmenu-body"').slice(0, 1)) { log(`@${o}`); log(around(o, 900, 700)); }
  log('\n=== 9. zl-modal root ===');
  for (const o of allOcc('"zl-modal"').slice(0, 1)) { log(`@${o}`); log(around(o, 600, 900)); }
} catch (e) { log('ERROR: ' + e.message + '\n' + e.stack); }
fs.writeFileSync('D:/Zalo/reports/_r3_shell2.txt', out.join('\n'));
console.log('done, lines=' + out.length);
