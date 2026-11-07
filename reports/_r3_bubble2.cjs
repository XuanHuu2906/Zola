const fs = require('fs');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
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

function fam(label, re, cap) {
  const hit = R.filter((r) => re.test(r.sel));
  log(`\n## ${label}  rules=${hit.length}`);
  for (const r of hit.slice(0, cap)) { log(`   @${r.at} ${r.sel.slice(0, 260)}`); log(`        ${r.body.slice(0, 460)}`); }
}
// the visible bubble = .card (short selector parts only, to avoid descendant blobs)
fam('.card (exact single)', /^\.card(\.[A-Za-z0-9_-]+)*$/, 12);
fam('.card.me / .card.you', /^\.card\.[a-z]/, 10);
fam('.msg-footer', /\.msg-footer/, 6);
fam('.bubble-message-time-status', /\.bubble-message-time-status/, 4);
fam('.message-reaction-container', /\.message-reaction-container/, 4);
fam('.message-view__blur', /\.message-view__blur/, 6);
fam('.message-info', /(^|[\s,>])\.message-info(?![A-Za-z0-9_-])/, 4);
fam('.card--text', /\.card--text/, 6);
fam('.chat-message-v2 .card', /\.chat-message-v2[^,]*\.card/, 8);

log('\n=== .card token usage (all rules whose selector is .card-ish) ===');
const vars = {};
for (const r of R) {
  if (/^\.card(\.[A-Za-z0-9_-]+)*$/.test(r.sel)) for (const m of r.body.matchAll(/var\((--[A-Za-z0-9_-]+)\)/g)) vars[m[1]] = (vars[m[1]] || 0) + 1;
}
log('  ' + Object.entries(vars).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}(${v})`).join(' '));

log('\n=== js className emitting the bubble "card" wrapper ===');
for (const s of ['"card ', '"card"', '"card--text', 'card--text']) {
  const occ = []; let p = 0;
  while ((p = js.indexOf(s, p)) >= 0) { occ.push(p); p += s.length; }
  log(`  ${JSON.stringify(s)} occ=${occ.length}`);
  for (const o of occ.slice(0, 3)) log(`    @${o}: ` + JSON.stringify(js.slice(Math.max(0, o - 320), o + 320)));
}

log('\n=== is there a .card class in the message bundle (+ISi 85954..662330)? ===');
{
  const seg = js.slice(85954, 662330);
  const cnt = {};
  for (const s of ['"card', 'card ', 'msg-footer', 'bubble-message-time-status', 'message-reaction-container', 'chat-message-v2']) {
    let c = 0, p = 0; while ((p = seg.indexOf(s, p)) >= 0) { c++; p += s.length; }
    cnt[s] = c;
  }
  log('  ' + Object.entries(cnt).map(([k, v]) => `${JSON.stringify(k)}=${v}`).join(' '));
}

fs.writeFileSync('D:/Zalo/reports/_r3_bubble2.txt', out.join('\n'));
console.log('done ' + out.length);
