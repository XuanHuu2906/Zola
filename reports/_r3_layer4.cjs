const fs = require('fs');
const dir = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const css = fs.readFileSync(dir + 'compact-app-pc.f32c58b63b6f4273a8a4.css', 'latin1');
const out = [];
const log = (...a) => out.push(a.map(String).join(' '));
const R = [];
(function () {
  let i = 0;
  while (i < css.length) {
    const o = css.indexOf('{', i); if (o < 0) break;
    const c = css.indexOf('}', o); if (c < 0) break;
    const sel = css.slice(i, o).trim();
    if (sel && !sel.startsWith('@')) R.push({ at: i, sel, body: css.slice(o + 1, c) });
    i = c + 1; while (i < css.length && /[\s;]/.test(css[i])) i++;
  }
})();

function base(label, re, cap) {
  log(`\n### ${label}`);
  let n = 0;
  for (const r of R) {
    const ps = r.sel.split(',').map(s => s.trim());
    const hit = ps.filter(p => re.test(p) && p.split(/[\s>+~]/).length <= 4);
    if (!hit.length) continue;
    log(`  @${r.at} ${hit[0]}   (parts=${ps.length})`);
    log(`      ${r.body.slice(0, 300)}`);
    if (++n >= cap) break;
  }
  if (!n) log('  (none)');
}

base('.threadChat__*', /^\.threadChat__[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/, 14);
base('.threadChat plain', /^\.threadChat$/, 6);
base('utility .flx family', /^\.flx(-1|-cell|-al-c|-col|-sp-btw)?$/, 10);
base('.rel / .ovf-hidden', /^\.(rel|ovf-hidden)$/, 4);
base('.conv-back-btn', /^\.conv-back-btn$/, 3);

log('\n\n=== all .threadChat__ rules (any depth), truncated ===');
let n = 0;
for (const r of R) {
  if (!/\.threadChat__/.test(r.sel)) continue;
  log(`  @${r.at} ${r.sel.slice(0, 150)}`);
  log(`      ${r.body.slice(0, 200)}`);
  if (++n >= 30) break;
}

log('\n\n=== background/backdrop declarations on any .threadChat* rule ===');
for (const r of R) {
  if (!/\.threadChat/.test(r.sel)) continue;
  const m = r.body.match(/(background[a-z-]*|backdrop-filter|box-shadow)\s*:[^;]*/g);
  if (!m) continue;
  log(`  @${r.at} ${r.sel.slice(0, 130)} => ${m.join(' | ').slice(0, 240)}`);
}

fs.writeFileSync('D:/Zalo/reports/_r3_layer4.txt', out.join('\n'));
console.log('done ' + out.length);
