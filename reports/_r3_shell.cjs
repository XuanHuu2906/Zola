// R3 shell: full El header body, nav-button render, message list wrapper, composer root, settings root.
const fs = require('fs');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const LOG = 'D:/Zalo/reports/_r3_shell.txt';
fs.writeFileSync(LOG, '');
const log = (...a) => { const l = a.map(String).join(' '); console.log(l); fs.appendFileSync(LOG, l + '\n'); };

function around(off, back, fwd) { return js.slice(Math.max(0, off - back), off + fwd); }
function allOcc(s) { const out = []; let p = 0; while ((p = js.indexOf(s, p)) >= 0) { out.push(p); p += s.length; } return out; }

log('=== 1. El header full body (11018306 +3600) ===');
log(js.slice(11018306, 11018306 + 3600));

log('\n=== 2. nav-button_add_friend render context ===');
for (const o of allOcc('nav-button_add_friend').slice(0, 2)) log(`\n@${o}\n` + around(o, 700, 700));

log('\n=== 3. main-tab render (sidebar tab bar) ===');
for (const o of allOcc('"main-tab').concat(allOcc(' main-tab ')).slice(0, 3)) log(`\n@${o}\n` + around(o, 500, 900));

log('\n=== 4. conv-list container render (#conversationList / conv-item parent) ===');
for (const s of ['"conv-list"', 'id:"convList"', 'conversation-list__container', 'id:"contact-search"']) {
  const occ = allOcc(s);
  log(`\n## ${s} occ=${occ.length}`);
  for (const o of occ.slice(0, 2)) log(`@${o}\n` + around(o, 600, 900));
}

log('\n=== 5. message list wrapper (.message-view / #messageView) parent chain ===');
for (const o of allOcc('id:"messageView"')) log(`\n@${o}\n` + around(o, 1200, 1200));

log('\n=== 6. composer root chain (#chat-input-container) ===');
for (const o of allOcc('id:"chat-input-container"').concat(allOcc('"chat-input-container"')).slice(0, 2)) log(`\n@${o}\n` + around(o, 900, 1400));

log('\n=== 7. settings root (#setting) ===');
for (const o of allOcc('id:"setting"').slice(0, 2)) log(`\n@${o}\n` + around(o, 700, 1200));

log('\n=== 8. zmenu root container ===');
for (const o of allOcc('"zmenu-body"').slice(0, 1)) log(`\n@${o}\n` + around(o, 900, 700));

log('\n=== 9. zl-modal root ===');
for (const o of allOcc('"zl-modal"').slice(0, 1)) log(`\n@${o}\n` + around(o, 600, 900));

log('\nwrote _r3_shell.txt');
