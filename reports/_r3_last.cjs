// R3 last: chat header component, .message-view__blur / NG10, sidebar tabs, block-date.
const fs = require('fs');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const css = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.css', 'latin1');
const LOG = 'D:/Zalo/reports/_r3_last.txt';
fs.writeFileSync(LOG, '');
const log = (...a) => { const l = a.map(String).join(' '); console.log(l); fs.appendFileSync(LOG, l + '\n'); };
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
function allOcc(s) { const out = []; let p = 0; while ((p = js.indexOf(s, p)) >= 0) { out.push(p); p += s.length; } return out; }

// ---- 1. chat header component El inside VLvn (search from chatViewContainer region)
log('=== chat header component (El) ===');
{
  const regionStart = 11120000, regionEnd = 11140000;
  const region = js.slice(regionStart, regionEnd);
  for (const m of region.matchAll(/createElement\((El|Od|[A-Z][A-Za-z0-9_$]*),\{/g)) {
    log(`  @${regionStart + m.index} component ${m[1]}`);
  }
  // find "function El" or "El=" or "var El" within VLvn module span
  const vspan = [10707732, 11138122];
  for (const pat of ['function El(', 'El=e=>', 'El=(e)', 'var El=', 'class El ', 'let El=']) {
    let p = vspan[0];
    while ((p = js.indexOf(pat, p)) >= 0 && p < vspan[1]) {
      log(`  ${pat} @${p}`);
      log('    ' + JSON.stringify(js.slice(p, p + 1200)));
      p += pat.length;
    }
  }
}
// chat header likely uses class names; scan window after chatViewContainer for className literals
log('\n=== className literals 0..6000 chars BEFORE #chatView (header region) ===');
{
  const at = js.indexOf('id:"chatView"');
  const region = js.slice(at - 6000, at);
  const cls = new Map();
  for (const m of region.matchAll(/className:(?:"([^"]{2,80})"|Object\([a-z]\.a\)\("([^"]{2,80})")/g)) {
    const raw = (m[1] || m[2] || '').trim();
    for (const c of raw.split(/\s+/)) if (c && !/[(){}`$]/.test(c)) cls.set(c, (cls.get(c) || 0) + 1);
  }
  for (const [k, v] of [...cls.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) log(`  ${k.padEnd(44)} ${v}`);
}

// ---- 2. .message-view__blur + NG10 + layer tokens
log('\n=== .message-view__blur family + token defs ===');
for (const v of ['--NG10', '--layer-background-CSC', '--divider-bold', '--text-placeholder', '--layer-background-pinned', '--layer-background-selected', '--layer-background-hover', '--surface-background-subtle', '--curtain', '--curtain-bold', '--shadow-overlay']) {
  const re = new RegExp('\\' + v.replace(/-/g, '\\-') + '\\s*:\\s*([^;]+)', 'g');
  const defs = [...css.matchAll(re)].map((m) => m[1].trim());
  log(`  ${v.padEnd(30)} ${[...new Set(defs)].slice(0, 3).join(' | ')}`);
}
log('\n  .message-view__blur JS usage:');
for (const o of allOcc('message-view__blur')) log(`    @${o}: ` + JSON.stringify(js.slice(o - 240, o + 240)));

// ---- 3. block-date / chat-date live structure
log('\n=== .block-date + .chat-date ===');
{
  const hit = R.filter((r) => /\.block-date|\.chat-date(?![A-Za-z0-9_-])/.test(r.sel));
  log(`  rules=${hit.length}`);
  for (const r of hit) {
    log(`  @${r.at} ${r.sel.slice(0, 150)}`);
    log(`       ${r.body.slice(0, 200)}`);
  }
  for (const o of allOcc('block-date')) log(`  JS block-date @${o}: ` + JSON.stringify(js.slice(o - 220, o + 260)));
}

// ---- 4. sidebar tabs
log('\n=== sidebar tabs ===');
for (const s of ['SidebarTab:', 'STR_LEFT_SIDEBAR', 'left-sidebar', 'leftSidebar', 'leftmenu', 'left-menu', 'navBtn', 'navbar']) {
  const occ = allOcc(s);
  log(`  ${JSON.stringify(s).padEnd(24)} occ=${occ.length}`);
  for (const o of occ.slice(0, 3)) log(`     @${o}: ` + JSON.stringify(js.slice(o - 200, o + 420)));
}
{
  const m = /SidebarTab\s*[:=]\s*\{/.exec(js);
  if (m) log('\n  SidebarTab enum: ' + JSON.stringify(js.slice(m.index, m.index + 900)));
}

// ---- 5. nav / left menu css
log('\n=== nav-ish css families ===');
for (const c of ['nav-button', 'nav-content', 'navbar', 'navBtn', 'leftmenu', 'leftpanel', 'main-tab', 'main__left', 'main__center', 'main-tabs', 'menu-left']) {
  const hit = R.filter((r) => r.sel.includes('.' + c) || r.sel.includes('#' + c));
  const vars = new Set();
  for (const r of hit) for (const m of r.body.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) vars.add(m[1]);
  log(`  ${c.padEnd(16)} rules=${String(hit.length).padStart(4)} vars=${[...vars].slice(0, 10).join(' ')}`);
}

log('\nwrote _r3_last.txt');
