const fs = require('fs');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const css = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.css', 'latin1');
const LOG = 'D:/Zalo/reports/_r3_gap.txt';
fs.writeFileSync(LOG, '');
const log = (...a) => { const l = a.map(String).join(' '); fs.appendFileSync(LOG, l + '\n'); console.log(l); };

function rules() {
  const out = []; let i = 0;
  while (i < css.length) {
    const o = css.indexOf('{', i); if (o < 0) break;
    const c = css.indexOf('}', o); if (c < 0) break;
    const sel = css.slice(i, o).trim();
    if (sel && !sel.startsWith('@')) out.push({ at: i, sel, body: css.slice(o + 1, c) });
    i = c + 1; while (i < css.length && /[\s;]/.test(css[i])) i++;
  }
  return out;
}
const R = rules();
function fam(name, re) {
  const hit = R.filter((r) => re.test(r.sel));
  const vars = new Map();
  let bg = 0, shadow = 0, radius = 0;
  for (const r of hit) {
    for (const m of r.body.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) vars.set(m[1], (vars.get(m[1]) || 0) + 1);
    if (/background/.test(r.body)) bg++;
    if (/box-shadow/.test(r.body)) shadow++;
    if (/border-radius/.test(r.body)) radius++;
  }
  log(`\n## ${name}  rules=${hit.length} bg=${bg} shadow=${shadow} radius=${radius}`);
  log('   vars: ' + [...vars.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}(${v})`).join(' ') || '—');
  return hit;
}
fam('header-btn', /\.header-btn(?![A-Za-z0-9_-])/);
fam('header-title', /\.header-title(?![A-Za-z0-9_-])/);
fam('main-tab / #main-tab', /\.main-tab(?![A-Za-z0-9_-])|#main-tab/);
fam('nav-button_*', /\.nav-button_/);
fam('nav-content', /\.nav-content(?![A-Za-z0-9_-])/);
fam('conversation-list__*', /\.conversation-list__/);
fam('conv-item (full)', /\.conv-item(?![A-Za-z0-9_-])/);
fam('chat-box-input__content', /\.chat-box-input__content/);
fam('chat-input-container__*', /\.chat-input-container__/);
fam('zl-modal__footer', /\.zl-modal__footer/);
fam('setting-menu__item', /\.setting-menu__item(?![A-Za-z0-9_-])/);

// component El definition search inside VLvn span
log('\n=== El definition inside VLvn (10707732..11138122) ===');
for (const pat of ['function El', 'El=', 'El extends', 'const El', 'var El', 'let El']) {
  let p = 10707732;
  while ((p = js.indexOf(pat, p)) >= 0 && p < 11138122) {
    log(`  ${pat} @${p}`);
    log('    ' + JSON.stringify(js.slice(p, p + 500)));
    p += pat.length;
  }
}

// who calls createElement(El
log('\n=== El call sites ===');
{
  let p = 0, n = 0;
  while ((p = js.indexOf('createElement(El', p)) >= 0 && n < 10) { log(`  @${p}: ` + JSON.stringify(js.slice(p - 120, p + 320))); p += 5; n++; }
}
