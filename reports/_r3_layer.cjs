const fs = require('fs');
const dir = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(dir + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
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
const parts = (s) => s.split(',').map(x => x.trim());

// Show only rules where the pattern appears as a SHORT (<=3 compound) selector part, i.e. the base rule.
function base(label, re, cap) {
  log(`\n### ${label}`);
  let n = 0;
  for (const r of R) {
    const hit = parts(r.sel).filter(p => re.test(p) && p.split(/[\s>+~]/).length <= 3);
    if (!hit.length) continue;
    log(`  @${r.at} ${hit[0]}   (parts=${parts(r.sel).length})`);
    log(`      ${r.body.slice(0, 320)}`);
    if (++n >= cap) break;
  }
  if (!n) log('  (none with <=3 compound parts)');
}
base('.zl-modal base', /^\.zl-modal(\.[A-Za-z0-9_-]+)*(::?[a-z-]+)?$/, 8);
base('.zl-modal__dialog base', /^\.zl-modal__dialog(\.[A-Za-z0-9_-]+)*$/, 6);
base('.zmenu-item base', /^\.zmenu-item(\.[A-Za-z0-9_-]+)*$/, 5);
base('.zmenu-separator base', /^\.zmenu-separator(\.[A-Za-z0-9_-]+)*$/, 3);
base('.setting-menu base', /^\.setting-menu(\.[A-Za-z0-9_-]+)*$/, 5);
base('.conv-item-padding base', /^\.conv-item-padding(\.[A-Za-z0-9_-]+)*$/, 3);
base('.chat-box-input exact', /^\.chat-box-input(\.[A-Za-z0-9_-]+)*$/, 6);
base('.message-view exact', /^\.message-view(\.[A-Za-z0-9_-]+)*$/, 8);

log('\n=== "block-date" in JS (is the date divider rendered in the live list?) ===');
{
  const occ = []; let p = 0;
  while ((p = js.indexOf('block-date', p)) >= 0) { occ.push(p); p += 10; }
  log(`  occ=${occ.length}`);
  for (const o of occ.slice(0, 3)) log(`    @${o}: ` + JSON.stringify(js.slice(Math.max(0, o - 200), o + 200)));
}

log('\n=== "\"preview-ts" in JS (unconditional class?) ===');
{
  const occ = []; let p = 0;
  while ((p = js.indexOf('preview-ts', p)) >= 0) { occ.push(p); p += 10; }
  log(`  occ=${occ.length}`);
  for (const o of occ.slice(0, 4)) log(`    @${o}: ` + JSON.stringify(js.slice(Math.max(0, o - 120), o + 140)));
}

log('\n=== .preview-ts rules that change the chat column ===');
for (const r of R) {
  if (!/\.preview-ts/.test(r.sel)) continue;
  if (!/block-date|chat-date|message-view|chat-message|card/.test(r.sel)) continue;
  log(`  @${r.at} ${r.sel.slice(0, 170)}`);
  log(`      ${r.body.slice(0, 220)}`);
}

fs.writeFileSync('D:/Zalo/reports/_r3_layer.txt', out.join('\n'));
console.log('done ' + out.length);
