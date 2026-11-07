const fs = require('fs');
const dir = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(dir + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const out = [];
const log = (...a) => out.push(a.map(String).join(' '));

function scan(label, needle, cap, before, after) {
  before = before || 180; after = after || 220;
  const occ = []; let p = 0;
  while ((p = js.indexOf(needle, p)) >= 0) { occ.push(p); p += needle.length; }
  log(`\n=== ${label}  occ=${occ.length} ===`);
  for (const o of occ.slice(0, cap)) {
    log(`  @${o}: ` + JSON.stringify(js.slice(Math.max(0, o - before), o + after)));
  }
}

scan('messageView background/wallpaper inline', 'messageView', 8);
scan('message-view wallpaper', 'message-view__wallpaper', 4);
scan('wallpaper', 'allpaper', 8, 120, 160);
scan('message-view__blur usage', 'message-view__blur', 6);
scan('backgroundImage on chat area', 'coverImage', 5, 120, 160);

log('\n=== "isUsingNewThreadBuilder" ===');
{
  const occ = []; let p = 0;
  while ((p = js.indexOf('isUsingNewThreadBuilder', p)) >= 0) { occ.push(p); p += 24; }
  log('  occ=' + occ.length + ' at ' + occ.slice(0, 10).join(','));
  const d = js.indexOf('isUsingNewThreadBuilder(');
  if (d >= 0) log('  def-ish @' + d + ': ' + JSON.stringify(js.slice(d - 200, d + 260)));
}

fs.writeFileSync('D:/Zalo/reports/_r3_layer6.txt', out.join('\n'));
console.log('done ' + out.length);
