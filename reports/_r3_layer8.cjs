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

const WANT = ['#sidebarNav', '.nav-content', '.titlebar', '.setting ', '.setting.flx', '.setting-menu',
  '.setting-content', '.chat-box-input__tools', '.chat-box-input__right', '.chat-box-input__left',
  '.chat-input-wrapper', '.chat-input-content', '.chat-input-scrollable', '.zmenu', '.zmenu-content',
  '.zl-modal__dialog__header', '.zl-modal__dialog-body', '.zl-modal__footer', '.zl-dlg', '.zl-fl-dlg'];

for (const w of WANT) {
  log(`\n### ${w}`);
  let n = 0;
  for (const r of R) {
    const ps = r.sel.split(',').map(s => s.trim());
    const hit = ps.filter(p => p === w.trim() || p.startsWith(w.trim() + '.') || p.startsWith(w.trim() + ':'));
    if (!hit.length) continue;
    log(`  @${r.at} ${hit[0]}  (parts=${ps.length})`);
    log(`      ${r.body.slice(0, 300)}`);
    if (++n >= 4) break;
  }
  if (!n) log('  (none)');
}

fs.writeFileSync('D:/Zalo/reports/_r3_layer8.txt', out.join('\n'));
console.log('done ' + out.length);
