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
const parts = (s) => s.split(',').map(x => x.trim());
const has = (re) => (r) => parts(r.sel).some(p => re.test(p));

// ---- exact .card family census ----
const CARD = /^\.card(\.[A-Za-z0-9_-]+)*$/;
const cardRules = R.filter(r => parts(r.sel).some(p => CARD.test(p)));
const cardVars = {};
for (const r of cardRules) for (const m of r.body.matchAll(/var\((--[A-Za-z0-9_-]+)\)/g)) cardVars[m[1]] = (cardVars[m[1]] || 0) + 1;
const textRules = R.filter(r => parts(r.sel).some(p => /\.card--text/.test(p)));
log(`.card family: rules=${cardRules.length}  .card--text rules=${textRules.length}`);
log('.card vars: ' + Object.entries(cardVars).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}(${v})`).join(' '));

// declared properties directly on a `.card` part
const propCount = {};
for (const r of cardRules) {
  const ps = parts(r.sel); if (!ps.some(p => CARD.test(p))) continue;
  for (const d of r.body.split(';')) {
    const k = d.split(':')[0].trim();
    if (k && !/^-(webkit|moz|ms|o)-/.test(k)) propCount[k] = (propCount[k] || 0) + 1;
  }
}
log('.card props: ' + Object.entries(propCount).sort((a, b) => b[1] - a[1]).slice(0, 22).map(([k, v]) => `${k}(${v})`).join(' '));

// ---- per-surface blocker census ----
const SURF = {
  titlebar: /\.titlebar|#titleBar/,
  nav_sidebar: /#sidebarNav|#main-tab|\.nav-button_|\.nav-content/,
  conv_list: /\.conv-item|\.conv-message|#contact-search/,
  chat_header: /\.threadChat/,
  message_row: /(^|[\s,>])\.chat-message(?![A-Za-z0-9_-])/,
  bubble_card: /^\.card(\.[A-Za-z0-9_-]+)*$/,
  date_divider: /\.chat-date|\.block-date/,
  composer: /\.chat-input-container|\.chat-box-input|\.chat-box-input__tools/,
  zmenu: /\.zmenu-item|\.zmenu-body|\.zmenu-separator/,
  modal: /\.zl-modal/,
  settings: /\.setting-menu__item|\.setting-section-content__item|(^|[\s,>])\.setting(?![A-Za-z0-9_-])/,
};
const PROPS = ['backdrop-filter', 'will-change', 'contain', 'transform', 'filter', 'isolation', 'overflow', 'z-index', 'position'];
log('\n## per-surface glass blockers (rules containing each declaration)');
log('surface'.padEnd(14) + ['rules', 'backdrop', 'willChange', 'contain', 'transform', 'filter', 'isolation', 'zIndex'].map(s => s.padStart(11)).join(''));
for (const [name, re] of Object.entries(SURF)) {
  const hit = R.filter(r => parts(r.sel).some(p => re.test(p)));
  const c = {};
  for (const p of PROPS) c[p] = hit.filter(r => new RegExp('(^|[;{])\\s*' + p + '\\s*:').test(r.body)).length;
  log(name.padEnd(14) + String(hit.length).padStart(5)
    + String(c['backdrop-filter']).padStart(11) + String(c['will-change']).padStart(11)
    + String(c['contain']).padStart(11) + String(c['transform']).padStart(11)
    + String(c['filter']).padStart(11) + String(c['isolation']).padStart(11)
    + String(c['z-index']).padStart(11));
}

log('\n## where backdrop-filter actually appears (selector + declaration)');
for (const r of R) if (/backdrop-filter\s*:/.test(r.body)) log(`   @${r.at} ${r.sel.slice(0, 150)} => ${(r.body.match(/backdrop-filter[^;]*/) || [''])[0]}`);

log('\n## contain:* declarations on the message scroll chain');
for (const r of R) if (/contain\s*:/.test(r.body) && /message-view|chat-message|conv-item|card/.test(r.sel)) log(`   @${r.at} ${r.sel.slice(0, 120)} => ${(r.body.match(/contain[^;]*/) || [''])[0]}`);

log('\n## transform: translate3d / transform-gpu usage');
for (const m of css.matchAll(/\.transform-gpu[^}]*}/g)) log('   ' + m[0].slice(0, 200));

fs.writeFileSync('D:/Zalo/reports/_r3_blockers.txt', out.join('\n'));
console.log('done ' + out.length);
