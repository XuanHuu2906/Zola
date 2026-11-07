const fs = require('fs');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const out = [];
const log = (...a) => { const l = a.map(String).join(' '); out.push(l); console.log(l); };

function moduleOf(off) {
  // find enclosing webpack module key: search backwards for `,Key:function(` or `{Key:function(`
  const re = /[{,]([A-Za-z0-9_$+\/]{3,20}):function\(/g;
  let best = null, m;
  const win = js.slice(Math.max(0, off - 400000), off);
  while ((m = re.exec(win))) best = { key: m[1], at: Math.max(0, off - 400000) + m.index };
  return best;
}

for (const needle of ['createElement("style")', 'head.appendChild', 'body.style.setProperty', 'createElement("link")']) {
  log(`\n######## ${needle}`);
  let i = -1;
  while ((i = js.indexOf(needle, i + 1)) >= 0) {
    const mod = moduleOf(i);
    log(`--- @${i} module=${mod ? mod.key + '@' + mod.at : '?'}`);
    log('    ' + js.slice(Math.max(0, i - 260), i + 200).replace(/\n/g, '\\n'));
  }
}

fs.writeFileSync('D:/Zalo/reports/_r2_inject.txt', out.join('\n'), 'utf8');
