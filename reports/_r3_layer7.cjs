const fs = require('fs');
const dir = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(dir + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const out = [];
const log = (...a) => out.push(a.map(String).join(' '));

log('=== wallpaper components around @11093857 ===');
log(js.slice(11093000, 11095200));
log('\n\n=== look backwards for Rd = / Td = / Od = definitions ===');
for (const needle of ['var Rd', 'Rd=', 'Td=', 'Od=', 'function Rd', 'function Td']) {
  let p = -1; const hits = [];
  while ((p = js.indexOf(needle, p + 1)) >= 0) hits.push(p);
  log(`  ${needle}: ${hits.slice(0, 8).join(',')}`);
}

fs.writeFileSync('D:/Zalo/reports/_r3_layer7.txt', out.join('\n'));
console.log('done ' + out.length);
