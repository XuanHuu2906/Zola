const fs = require('fs');
const p = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js';
const s = fs.readFileSync(p, 'latin1');
const out = [];
const log = (...a) => { const l = a.map(String).join(' '); out.push(l); console.log(l); };

function moduleSlice(start) {
  let depth = 0, j = s.indexOf('{', s.indexOf('function(', start));
  for (; j < s.length; j++) {
    const c = s[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
  }
  return s.slice(start, j);
}

for (const [name, off] of [['CYG6', 4245911], ['RFxn', 8774196]]) {
  const mod = moduleSlice(off);
  log(`\n########## ${name} @${off} len=${mod.length}`);
  for (const needle of ['$alias_name', '$dark_alias_name', 'BLA', 'alias_name:', 'map-merge', '$org_color', '$color_map', 'locals']) {
    const idx = mod.indexOf(needle);
    log(`  ${needle}: ${idx >= 0 ? '@+' + idx : 'absent'}`);
  }
  const ai = mod.indexOf('$alias_name:');
  if (ai >= 0) log('\n--- $alias_name block ---\n' + mod.slice(ai, ai + 3000));
  const bi = mod.indexOf('BLA');
  if (bi >= 0) log('\n--- BLA context ---\n' + mod.slice(Math.max(0, bi - 800), bi + 800));
  const li = mod.indexOf('locals');
  log('\n--- locals tail ---\n' + mod.slice(Math.max(0, li - 600), li + 300));
}

// chunk map: webpack jsonp filename function
const um = s.indexOf('__webpack_require__.u=');
log(`\n### __webpack_require__.u @${um}`);
if (um > 0) log(s.slice(um, um + 1200));
const um2 = s.indexOf('.u=function');
if (um2 > 0) log('\n### .u=function @' + um2 + '\n' + s.slice(um2, um2 + 1200));

fs.writeFileSync('D:/Zalo/reports/_r1_scss.txt', out.join('\n'), 'utf8');
