// R3: locate the *live* chat header + message pane container (threadChat is group-preview).
const fs = require('fs');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const css = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.css', 'latin1');
const LOG = 'D:/Zalo/reports/_r3_header.txt';
fs.writeFileSync(LOG, '');
const log = (...a) => { const l = a.map(String).join(' '); console.log(l); fs.appendFileSync(LOG, l + '\n'); };

const ivs = JSON.parse(fs.readFileSync('D:/Zalo/reports/_r3_modules7_intervals.json', 'utf8'))
  .map(([k, at, end]) => ({ key: k, at, end })).sort((a, b) => a.at - b.at);
function moduleFor(off) {
  let lo = 0, hi = ivs.length - 1, best = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (ivs[mid].at <= off) { best = mid; lo = mid + 1; } else hi = mid - 1; }
  let pick = null;
  for (let k = best; k >= 0 && best - k <= 600; k--) { const v = ivs[k]; if (off > v.at && off < v.end && (!pick || v.at > pick.at)) pick = v; }
  return pick;
}

// ---- 1. header-ish class families actually present in CSS
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
const FAM = [
  'chat-header', 'header-chat', 'conv-header', 'chat-top', 'topbar', 'top-bar',
  'header-title', 'header-info', 'chat-title', 'conv-title', 'chatNav',
  'chat-content', 'message-box', 'message-list', 'chat-list', 'chat-container', 'chat-pane', 'chatArea', 'chat-area',
];
log('=== CSS families (rules, selector-parts) ===');
for (const f of FAM) {
  const re = new RegExp('\\.' + f.replace(/[-]/g, '\\-') + '(?![A-Za-z0-9_-])');
  const hit = R.filter((r) => re.test(r.sel));
  const vars = new Set();
  for (const r of hit) for (const m of r.body.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) vars.add(m[1]);
  log(`  .${f.padEnd(20)} rules=${String(hit.length).padStart(4)} vars=${String(vars.size).padStart(3)}  ${[...vars].slice(0, 8).join(' ')}`);
}

// ---- 2. class-prefix census for anything containing 'header' or 'top'
log('\n=== top class prefixes containing header/top/thread (by css rule count) ===');
{
  const pre = new Map();
  for (const r of R) {
    for (const part of r.sel.split(',')) {
      for (const m of part.matchAll(/\.([A-Za-z0-9_-]+)/g)) {
        const c = m[1];
        if (/header|threadChat|^top|chatNav|convNav/i.test(c)) pre.set(c, (pre.get(c) || 0) + 1);
      }
    }
  }
  for (const [k, v] of [...pre.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) log(`  .${k.padEnd(46)} ${v}`);
}

// ---- 3. JS: which module emits the header.
log('\n=== JS literal -> module for header candidates ===');
const CAND = ['header-title', 'conv-header', 'chat-header', 'header-info', 'chatNav', 'chat-content', 'message-box-message-wrapper', 'message-list', 'chat-container'];
for (const cls of CAND) {
  const forms = [`"${cls}"`, `className:"${cls}`, ` ${cls} `, `"${cls} `, ` ${cls}"`];
  let hit = -1, used = null;
  for (const f of forms) { hit = js.indexOf(f); if (hit >= 0) { used = f; break; } }
  if (hit < 0) { log(`  ${cls.padEnd(30)} NOT FOUND`); continue; }
  const mod = moduleFor(hit);
  let total = 0, p = 0;
  while ((p = js.indexOf(cls, p)) >= 0) { total++; p += cls.length; }
  log(`  ${cls.padEnd(30)} occ=${String(total).padStart(4)} first@${hit} ${JSON.stringify(used)} module=${mod ? mod.key + '@' + mod.at + ' len=' + (mod.end - mod.at) : 'NONE'}`);
  log('     ' + JSON.stringify(js.slice(hit - 300, hit + 300)));
}

// ---- 4. chat pane shell: where is chat-message rendered (parent chain)
log('\n=== parent shell of message list ===');
for (const anchor of ['message-list', 'chat-content', 'wrap-message']) {
  const p = js.indexOf(anchor);
  if (p >= 0) log(`  [${anchor}] ` + JSON.stringify(js.slice(p - 420, p + 200)));
}

log('\nwrote _r3_header.txt');
