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
function fam(label, re, cap = 10) {
  const hit = R.filter((r) => re.test(r.sel));
  log(`\n## ${label} rules=${hit.length}`);
  for (const r of hit.slice(0, cap)) { log(`   @${r.at} ${r.sel.slice(0, 200)}`); log(`        ${r.body.slice(0, 260)}`); }
}
fam('.conv ', /(^|[,.\s>])\.conv(?![A-Za-z0-9_-])/, 6);
fam('.tab-main', /\.tab-main(?![A-Za-z0-9_-])/, 6);
fam('.listView', /\.listView(?![A-Za-z0-9_-])/, 6);
fam('.conv-list-empty-wrapper', /\.conv-list-empty-wrapper/, 4);
fam('.conv-item-padding', /\.conv-item-padding/, 4);
fam('.conv-item-title', /\.conv-item-title/, 4);
fam('.conv-item-st', /\.conv-item-st/, 4);
fam('.conv-avatar', /\.conv-avatar/, 4);

log('\n=== ids declared in conv-list module Zb+t (12278571..12866400) ===');
{
  const seen = new Set();
  const seg = js.slice(12278571, 12866400);
  for (const m of seg.matchAll(/id:\s*"([A-Za-z][A-Za-z0-9_-]{2,40})"/g)) seen.add(m[1]);
  for (const m of seg.matchAll(/dataId:\s*"([A-Za-z][A-Za-z0-9_-]{2,40})"/g)) seen.add('dataId:' + m[1]);
  log('  ' + [...seen].join('  '));
}

log('\n=== scroll/list container components near conv-item render ===');
for (const s of ['id:"convListWrap"', 'List.AutoSizer', 'AutoSizer', 'onRowsRendered', 'rowRenderer', 'react-virtualized', 'VariableSizeList']) {
  const occ = []; let p = 0;
  while ((p = js.indexOf(s, p)) >= 0) { occ.push(p); p += s.length; }
  log(`  ${JSON.stringify(s)} occ=${occ.length}`);
  for (const o of occ.slice(0, 2)) log(`    @${o}: ` + JSON.stringify(js.slice(o - 300, o + 400)));
}

log('\n=== section headers / label anchors (conv label) ===');
for (const s of ['"conv-label-title"', '"sb-label"', '"conv-list-label"']) {
  const occ = []; let p = 0;
  while ((p = js.indexOf(s, p)) >= 0) { occ.push(p); p += s.length; }
  log(`  ${s} occ=${occ.length}`);
  for (const o of occ.slice(0, 1)) log(`    @${o}: ` + JSON.stringify(js.slice(o - 260, o + 320)));
}

fs.writeFileSync('D:/Zalo/reports/_r3_convlist.txt', out.join('\n'));
console.log('done ' + out.length);
