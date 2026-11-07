// R3 diagnostic 10: find the real module boundary right after Zb+t@12278564..12305492.
const fs = require('fs');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const out = [];
const log = (...a) => { const l = a.map(String).join(' '); out.push(l); console.log(l); };

const END = 12305492;
log('--- 200 chars ending at END, then 200 after ---');
log('BEFORE: ' + JSON.stringify(js.slice(END - 200, END)));
log('AFTER : ' + JSON.stringify(js.slice(END, END + 400)));

// next `:function` of any kind after END, within 200k
const win = js.slice(END, END + 200_000);
const idx = win.indexOf(':function');
log(`\nnext ":function" after END = ${idx === -1 ? 'NONE within 200k' : END + idx}`);
if (idx !== -1) log('  context: ' + JSON.stringify(js.slice(END + idx - 120, END + idx + 120)));

// enumerate every `},` followed within 60 chars by `:function(` in the whole file,
// and report the key text exactly as it appears
const reAll = /\},([^]{0,60}?):function\(/g;
let m, count = 0, weird = [];
while ((m = reAll.exec(js))) {
  count++;
  const raw = m[1];
  if (!/^[A-Za-z0-9_$+\/]{1,30}$/.test(raw) && !/^"[A-Za-z0-9_$+\/]{1,30}"$/.test(raw)) weird.push([m.index, raw]);
}
log(`\ntotal },<key>:function( = ${count}   non-standard-key = ${weird.length}`);
for (const [i, k] of weird.slice(0, 40)) log(`  @${i} key=${JSON.stringify(k)}`);

// list any },<key>:function( between 12,305,492 and 12,600,000
log('\n--- all },<key>:function( between 12.30M and 12.70M ---');
reAll.lastIndex = 0;
while ((m = reAll.exec(js))) {
  if (m.index >= 12_300_000 && m.index <= 12_700_000) log(`  @${m.index} key=${JSON.stringify(m[1])}`);
}

// what is at 12,393,315 exactly, with 500 chars of context?
log('\n--- conv-item site @12393315 context ---');
log(JSON.stringify(js.slice(12_393_315 - 600, 12_393_315 + 600)));

fs.writeFileSync('D:/Zalo/reports/_r3_dbg10.txt', out.join('\n'), 'utf8');
