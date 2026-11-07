// R3: the real chat shell = #chatView / #chatViewContainer / #messageView / #messageViewScroll.
const fs = require('fs');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const css = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.css', 'latin1');
const LOG = 'D:/Zalo/reports/_r3_chatshell.txt';
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
function show(off, back = 700, fwd = 900) { return JSON.stringify(js.slice(Math.max(0, off - back), off + fwd)); }

// ---- 1. chat shell ids in JS
log('=== chat shell id render sites ===');
for (const id of ['chatView', 'chatViewContainer', 'messageView', 'messageViewContainer', 'messageViewScroll']) {
  const occ = allOcc('id:"' + id + '"');
  log(`\n## #${id}  occ=${occ.length}`);
  for (const o of occ.slice(0, 2)) {
    log(`  @${o}`);
    log('  ' + show(o, 900, 1100));
  }
}

// ---- 2. css rules keyed on those ids
log('\n=== CSS rules on chat shell ids ===');
for (const id of ['chatView', 'chatViewContainer', 'messageView', 'messageViewContainer', 'messageViewScroll']) {
  const hit = R.filter((r) => r.sel.includes('#' + id));
  log(`\n## #${id} rules=${hit.length}`);
  for (const r of hit.slice(0, 8)) {
    log(`  @${r.at} ${r.sel.slice(0, 160)}`);
    log(`       ${r.body.slice(0, 220)}`);
  }
}

// ---- 3. the header of chatView: what classes are siblings of messageView
log('\n=== sibling structure inside chatViewContainer ===');
{
  const at = js.indexOf('id:"chatViewContainer"');
  if (at >= 0) log('  ' + JSON.stringify(js.slice(at, at + 3000)));
}

// ---- 4. class families inside chat shell region (text scan of 12KB after chatView)
log('\n=== class literals inside chat shell region ===');
{
  const at = js.indexOf('id:"chatView"');
  if (at >= 0) {
    const region = js.slice(at - 4000, at + 14000);
    const classes = new Map();
    for (const m of region.matchAll(/className:(?:"([^"]+)"|Object\([a-z]\.a\)\("([^"]+)")/g)) {
      const raw = (m[1] || m[2] || '').trim();
      for (const c of raw.split(/\s+/)) if (c && !/[(){}`$]/.test(c)) classes.set(c, (classes.get(c) || 0) + 1);
    }
    for (const [k, v] of [...classes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60)) log(`  ${k.padEnd(46)} ${v}`);
  }
}

// ---- 5. message-view rules (real message pane has 3 rules) + banner
log('\n=== .message-view / .message-view__* css ===');
{
  const hit = R.filter((r) => /\.message-view/.test(r.sel));
  log(`  rules=${hit.length}`);
  for (const r of hit) {
    log(`  @${r.at} ${r.sel.slice(0, 170)}`);
    log(`       ${r.body.slice(0, 260)}`);
  }
}

// ---- 6. title/header inside chat: chat-info / conv-name families
log('\n=== candidate live-chat-header class families by JS usage count ===');
for (const c of ['chat-info__header', 'chat-info-general', 'chat-info', 'conv-name', 'conv-title', 'chat-title', 'header-title', 'threadChat__title', 'title-chat', 'chatName', 'convAvatar']) {
  const cssN = R.filter((r) => r.sel.includes('.' + c)).length;
  const jsN = allOcc(c).length;
  log(`  ${c.padEnd(24)} cssRules=${String(cssN).padStart(4)}  jsOcc=${String(jsN).padStart(4)}`);
  const at = js.indexOf('"' + c) >= 0 ? js.indexOf('"' + c) : js.indexOf(' ' + c + ' ');
  if (at >= 0 && jsN > 0) log(`     first@${at}: ` + JSON.stringify(js.slice(at - 200, at + 260)));
}

log('\nwrote _r3_chatshell.txt');
