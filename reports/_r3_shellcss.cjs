// R3: CSS for the newly confirmed shell anchors + conv-list container discovery.
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
log('total rules = ' + R.length);

function selRe(tok, kind) {
  const esc = tok.replace(/[-_]/g, '\\$&');
  if (kind === 'id') return new RegExp('#' + esc + '(?![A-Za-z0-9_-])');
  return new RegExp('\\.' + esc + '(?![A-Za-z0-9_-])');
}
function fam(label, tok, kind = 'class', cap = 12) {
  const re = selRe(tok, kind);
  const hit = R.filter((r) => re.test(r.sel));
  const vars = new Map(); let bf = 0, sh = 0, rad = 0, bg = 0;
  for (const r of hit) {
    for (const m of r.body.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) vars.set(m[1], (vars.get(m[1]) || 0) + 1);
    if (/backdrop-filter/.test(r.body)) bf++;
    if (/box-shadow/.test(r.body)) sh++;
    if (/border-radius/.test(r.body)) rad++;
    if (/background/.test(r.body)) bg++;
  }
  log(`\n## ${label}  rules=${hit.length} bg=${bg} shadow=${sh} radius=${rad} bf=${bf}`);
  log('   vars: ' + ([...vars.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}(${v})`).join(' ') || '—'));
  for (const r of hit.slice(0, cap)) {
    log(`   @${r.at} ${r.sel.slice(0, 200)}`);
    log(`        ${r.body.slice(0, 300)}`);
  }
}

fam('#sidebarNav', 'sidebarNav', 'id');
fam('#main-tab', 'main-tab', 'id');
fam('.nav__tabs', 'nav__tabs');
fam('.sidebar-icon', 'sidebar-icon');
fam('#setting', 'setting', 'id', 4);
fam('.setting', 'setting', 'class', 4);
fam('#chatInput', 'chatInput', 'id', 4);
fam('.chat-input-container', 'chat-input-container', 6);
fam('.chat-input-scrollable', 'chat-input-scrollable', 4);
fam('.chat-input-content', 'chat-input-content', 4);
fam('.chat-input-wrapper', 'chat-input-wrapper', 4);
fam('.chat-box-input__content', 'chat-box-input__content', 4);
fam('#header', 'header', 'id', 4);
fam('.threadChat', 'threadChat', 'class', 6);
fam('.conv-item', 'conv-item', 'class', 8);
fam('.conv-message', 'conv-message', 'class', 4);
fam('.data-list__label', 'data-list__label', 3);
fam('.contact-list__add', 'contact-list__add', 3);
fam('#contact-search', 'contact-search', 'id', 4);
fam('.conversation-list__container', 'conversation-list__container', 4);
fam('.conv-list', 'conv-list', 4);
fam('#convList', 'convList', 'id', 4);

// discover conv-item render parent: scan JS for id/class of list container near conv-item
log('\n=== conv-item parent discovery ===');
{
  const at = js.indexOf('"conv-item ');
  log('  conv-item first @' + at);
  log(js.slice(at - 2600, at + 300));
}

fs.writeFileSync('D:/Zalo/reports/_r3_shellcss.txt', out.join('\n'));
console.log('done ' + out.length);
