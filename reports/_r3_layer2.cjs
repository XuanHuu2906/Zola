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

log('=== confirm the preview-ts call site is the live message list ===');
for (const at of [653837, 655787, 655000]) {
  log(`\n--- @${at} ---`);
  log(js.slice(at - 500, at + 400).replace(/\n/g, ' '));
}

log('\n\n=== does the module at 653837 render #messageView / message-view__scroll__inner ? ===');
for (const needle of ['messageViewScroll', 'message-view__scroll__inner', 'contentContainerClassName', 'transform-gpu', '#messageView']) {
  const occ = []; let p = 0;
  while ((p = js.indexOf(needle, p)) >= 0) { occ.push(p); p += needle.length; }
  log(`  ${needle}: occ=${occ.length} at ${occ.slice(0, 12).join(',')}`);
}

log('\n=== .chat-date / .island / .block-date rules ===');
for (const r of R) {
  const ps = r.sel.split(',').map(s => s.trim());
  const hit = ps.filter(p => /(^|[\s>])\.(chat-date|block-date|island)(\.[A-Za-z0-9_-]+|:[\w-]+)*$/.test(p));
  if (!hit.length) continue;
  log(`  @${r.at} ${hit[0]}  (parts=${ps.length})`);
  log(`      ${r.body.slice(0, 260)}`);
}

log('\n=== everything that declares .chat-date (any position) ===');
let n = 0;
for (const r of R) {
  if (!/\.chat-date/.test(r.sel)) continue;
  log(`  @${r.at} ${r.sel.slice(0, 150)}`);
  log(`      ${r.body.slice(0, 200)}`);
  if (++n >= 25) break;
}

fs.writeFileSync('D:/Zalo/reports/_r3_layer2.txt', out.join('\n'));
console.log('done ' + out.length);
