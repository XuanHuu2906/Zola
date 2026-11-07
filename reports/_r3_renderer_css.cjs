const fs = require('fs');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const css = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.css', 'latin1');
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

const FAM = [
  ['.titlebar', /(^|[\s,>])\.titlebar(?![A-Za-z0-9_-])/, 8],
  ['.titlebar__btns', /\.titlebar__btns/, 4],
  ['#titleBar', /#titleBar/, 4],
  ['.nav-button_add_friend', /\.nav-button_add_friend/, 4],
  ['#contact-search-input', /#contact-search-input/, 6],
  ['.conv-item-title__name', /\.conv-item-title__name/, 4],
  ['.conv-list-empty-wrapper', /\.conv-list-empty-wrapper/, 4],
  ['.threadChat__title', /\.threadChat__title/, 4],
  ['.threadChat__mutual-group', /\.threadChat__mutual-group/, 4],
  ['.threadChat__avatar', /\.threadChat__avatar/, 3],
  ['.chat-message ', /(^|[\s,>])\.chat-message(?![A-Za-z0-9_-])/, 14],
  ['.chat-message.me', /\.chat-message\.me/, 10],
  ['.chat-date', /\.chat-date/, 6],
  ['.block-date', /\.block-date/, 4],
  ['.chat-box-input ', /(^|[\s,>])\.chat-box-input(?![A-Za-z0-9_-])/, 8],
  ['.chat-box-input-container', /\.chat-box-input-container/, 4],
  ['.chat-box-input__tools__btn', /\.chat-box-input__tools__btn/, 3],
  ['.zmenu-item', /\.zmenu-item/, 8],
  ['.zmenu-body', /\.zmenu-body/, 5],
  ['.zl-modal ', /(^|[\s,>])\.zl-modal(?![A-Za-z0-9_-])/, 8],
  ['.zl-modal__dialog', /\.zl-modal__dialog/, 5],
  ['.zl-modal__dialog-body', /\.zl-modal__dialog-body/, 3],
  ['.setting-menu__item', /\.setting-menu__item/, 5],
  ['.setting-section-content__item', /\.setting-section-content__item(?![A-Za-z0-9_-])/, 5],
];

for (const [label, re, cap] of FAM) {
  const hit = R.filter((r) => re.test(r.sel));
  log(`\n## ${label}  rules=${hit.length}`);
  for (const r of hit.slice(0, cap)) {
    log(`   @${r.at} ${r.sel.slice(0, 240)}`);
    log(`        ${r.body.slice(0, 420)}`);
  }
}

// bubble background search: any rule that sets a bg on chat-message family
log('\n=== chat-message background declarations (verbatim) ===');
let n = 0;
for (const r of R) {
  if (/(^|[\s,>])\.chat-message(?![A-Za-z0-9_-])/.test(r.sel) && /background/.test(r.body)) {
    log(`   @${r.at} ${r.sel.slice(0, 200)}`);
    log(`        ${r.body.slice(0, 300)}`);
    if (++n >= 20) break;
  }
}
log(`   (chat-message rules containing background = ${n} shown)`);

log('\n=== backdrop-filter / filter across whole sheet ===');
for (const m of css.matchAll(/backdrop-filter[^;}]*/g)) log('   bd: ' + m[0].slice(0, 160));
let fl = 0;
for (const r of R) if (/[^-]filter:/.test(r.body) && /blur|saturate/.test(r.body)) { log(`   ${r.sel.slice(0,120)} => ${r.body.slice(0,160)}`); if (++fl > 12) break; }

fs.writeFileSync('D:/Zalo/reports/_r3_renderer_css.txt', out.join('\n'));
console.log('done ' + out.length);
