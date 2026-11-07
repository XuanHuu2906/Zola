const fs = require('fs');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const css = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.css', 'latin1');
const out = [];
const log = (...a) => out.push(a.map(String).join(' '));
function R_() {
  const res = []; let i = 0;
  while (i < css.length) {
    const o = css.indexOf('{', i); if (o < 0) break;
    const c = css.indexOf('}', o); if (c < 0) break;
    const sel = css.slice(i, o).trim();
    if (sel && !sel.startsWith('@')) res.push({ at: i, sel, body: css.slice(o + 1, c) });
    i = c + 1; while (i < css.length && /[\s;]/.test(css[i])) i++;
  }
  return res;
}
const R = R_();
function allOcc(s) { const o = []; let p = 0; while ((p = js.indexOf(s, p)) >= 0) { o.push(p); p += s.length; } return o; }
function around(off, b, f) { return js.slice(Math.max(0, off - b), off + f); }
function fam(label, re, cap = 8) {
  const hit = R.filter((r) => re.test(r.sel));
  log(`\n## ${label} rules=${hit.length}`);
  for (const r of hit.slice(0, cap)) { log(`   @${r.at} ${r.sel.slice(0, 190)}`); log(`        ${r.body.slice(0, 240)}`); }
}

fam('.nav-content', /\.nav-content(?![A-Za-z0-9_-])/);
fam('.conv-list-panel', /\.conv-list-panel/);
fam('.nav__content', /\.nav__content(?![A-Za-z0-9_-])/);
fam('.main__left', /\.main__left(?![A-Za-z0-9_-])/);
fam('.main__center', /\.main__center(?![A-Za-z0-9_-])/);
fam('.main__right', /\.main__right(?![A-Za-z0-9_-])/);
fam('#sidebarNav', /#sidebarNav/, 6);
fam('.conv-list-compact', /\.conv-list-compact/, 4);
fam('.sidebarNav', /\.sidebarNav/, 4);

log('\n=== who renders <nav id="sidebarNav"> (B) ===');
for (const o of allOcc('id:"sidebarNav"').slice(0, 2)) { log(`@${o}`); log(around(o, 400, 500)); }
const bDef = js.indexOf('function B(e){return r.a.createElement("nav"');
log('\nB def @' + bDef);

log('\n=== find callers of sidebar B / wrapper with main__left ===');
for (const s of ['main__left', 'id:"app-page"', 'className:"main ', '"main flx']) {
  const occ = allOcc(s);
  log(`\n## ${JSON.stringify(s)} occ=${occ.length}`);
  for (const o of occ.slice(0, 2)) { log(`@${o}`); log(around(o, 500, 700)); }
}

log('\n=== conversation list scroll container ids ===');
for (const s of ['listViewScroll', 'convListScroll', 'id:"listView', 'id:"conv', 'dataId:"div_TabMsg_Thrd']) {
  const occ = allOcc(s);
  log(`  ${JSON.stringify(s)} occ=${occ.length}`);
  for (const o of occ.slice(0, 1)) log(`    @${o}: ` + JSON.stringify(around(o, 240, 320)));
}

fs.writeFileSync('D:/Zalo/reports/_r3_sidebar.txt', out.join('\n'));
console.log('done ' + out.length);
