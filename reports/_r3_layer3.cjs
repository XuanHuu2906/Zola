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

function base(label, re, cap, maxBody) {
  maxBody = maxBody || 320;
  log(`\n### ${label}`);
  let n = 0;
  for (const r of R) {
    const ps = r.sel.split(',').map(s => s.trim());
    const hit = ps.filter(p => re.test(p) && p.split(/[\s>+~]/).length <= 3);
    if (!hit.length) continue;
    log(`  @${r.at} ${hit[0]}   (parts=${ps.length})`);
    log(`      ${r.body.slice(0, maxBody)}`);
    if (++n >= cap) break;
  }
  if (!n) log('  (none)');
}

base('.threadChat base', /^\.threadChat(\.[A-Za-z0-9_-]+)*(::?[a-z-]+)?$/, 10);
base('#header exact', /^#header(\.[A-Za-z0-9_-]+)*$/, 4);
base('.chat-input-container base', /^\.chat-input-container(\.[A-Za-z0-9_-]+)*$/, 6);
base('.chat-input-wrapper base', /^\.chat-input-wrapper(\.[A-Za-z0-9_-]+)*$/, 5);
base('.chat-input-content base', /^\.chat-input-content(\.[A-Za-z0-9_-]+)*$/, 4);
base('.chat-box-input__content base', /^\.chat-box-input__content(\.[A-Za-z0-9_-]+)*$/, 5);
base('.zmenu-body base', /^\.zmenu-body(\.[A-Za-z0-9_-]+)*$/, 6);
base('.popover-v3 base', /^\.popover-v3(\.[A-Za-z0-9_-]+)*$/, 5);
base('.conv-item base', /^\.conv-item(\.[A-Za-z0-9_-]+)*(::?[a-z-]+)?$/, 8);
base('.conv base', /^\.conv(\.[A-Za-z0-9_-]+)*(::?[a-z-]+)?$/, 8);
base('.conv-message base', /^\.conv-message(\.[A-Za-z0-9_-]+)*$/, 6);
base('.setting-menu__item base', /^\.setting-menu__item(\.[A-Za-z0-9_-]+)*(::?[a-z-]+)?$/, 6);
base('.setting-content base', /^\.setting-content(\.[A-Za-z0-9_-]+)*$/, 4);
base('.nav__tabs base', /^\.nav__tabs(\.[A-Za-z0-9_-]+)*$/, 5);
base('.nav-button base', /^\.nav-button[\w-]*$/, 5);
base('#main-tab exact', /^#main-tab(\.[A-Za-z0-9_-]+)*$/, 4);

log('\n\n=== selectors that mention #header (any position) ===');
let n = 0;
for (const r of R) if (/#header/.test(r.sel)) { log(`  @${r.at} ${r.sel.slice(0, 140)} => ${r.body.slice(0, 140)}`); if (++n >= 15) break; }
if (!n) log('  (none)');

fs.writeFileSync('D:/Zalo/reports/_r3_layer3.txt', out.join('\n'));
console.log('done ' + out.length);
