// R3: bubble family CSS + conversation list container discovery.
const fs = require('fs');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const css = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.css', 'latin1');
const out = [];
const log = (...a) => out.push(a.map(String).join(' '));
function rules() {
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
const R = rules();
function fam(label, re, cap = 14, bodyCap = 320) {
  const hit = R.filter((r) => re.test(r.sel));
  const vars = new Map();
  for (const r of hit) for (const m of r.body.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) vars.set(m[1], (vars.get(m[1]) || 0) + 1);
  log(`\n## ${label} rules=${hit.length}`);
  log('   vars: ' + ([...vars.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}(${v})`).join(' ') || '—'));
  for (const r of hit.slice(0, cap)) {
    log(`   @${r.at} ${r.sel.slice(0, 220)}`);
    log(`        ${r.body.slice(0, bodyCap)}`);
  }
  return hit;
}

fam('.content-message-container', /\.content-message-container(?![A-Za-z0-9_-])/, 23, 200);
fam('.bubble-message', /\.bubble-message(?![A-Za-z0-9_-])/, 30, 260);
fam('.text-container', /\.text-container(?![A-Za-z0-9_-])/, 10, 220);
fam('.rtf-container', /\.rtf-container(?![A-Za-z0-9_-])/, 8, 220);
fam('.chat-message-v2', /\.chat-message-v2(?![A-Za-z0-9_-])/, 8, 300);
fam('.message-view__banner', /\.message-view__banner(?![A-Za-z0-9_-])/, 6, 300);
fam('.chat-box-input', /\.chat-box-input(?![A-Za-z0-9_-])/, 12, 260);

log('\n=== data-component attribute JS sites ===');
{
  let p = 0, n = 0;
  while ((p = js.indexOf('"data-component"', p)) >= 0 && n < 12) {
    log(`  @${p}: ` + JSON.stringify(js.slice(p - 260, p + 200)));
    p += 16; n++;
  }
  log('  total = ' + (js.split('"data-component"').length - 1));
}

log('\n=== conversation list container discovery ===');
for (const s of ['conv-item conv-rel', '"conv-list', 'conv-list ', 'id:"conv-list"', 'conv-list__', 'list-conversation', 'ConversationList', '"conv-item-wrapper"']) {
  const occ = []; let p = 0;
  while ((p = js.indexOf(s, p)) >= 0) { occ.push(p); p += s.length; }
  log(`\n## ${JSON.stringify(s)} occ=${occ.length}`);
  for (const o of occ.slice(0, 2)) log(`  @${o}: ` + JSON.stringify(js.slice(o - 300, o + 400)));
}

fs.writeFileSync('D:/Zalo/reports/_r3_bubble.txt', out.join('\n'));
console.log('done ' + out.length);
