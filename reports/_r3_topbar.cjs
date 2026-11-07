// R3: confirm .top-bar = live chat header; find the real message-list pane.
const fs = require('fs');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const css = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.css', 'latin1');
const LOG = 'D:/Zalo/reports/_r3_topbar.txt';
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
function allOcc(s) { const out = []; let p = 0; while ((p = js.indexOf(s, p)) >= 0) { out.push(p); p += s.length; } return out; }
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

// ---- 1. all top-bar occurrences in JS + their module + context
log('=== .top-bar JS occurrences ===');
{
  const occ = allOcc('top-bar');
  log(`  total occ=${occ.length}`);
  const mods = new Map();
  for (const o of occ) {
    const m = moduleFor(o);
    const k = m ? m.key : 'NONE';
    mods.set(k, (mods.get(k) || 0) + 1);
  }
  for (const [k, v] of mods) log(`    module ${k} -> ${v} occ`);
  for (const o of occ.slice(0, 8)) {
    const m = moduleFor(o);
    log(`\n  @${o} module=${m ? m.key + '@' + m.at + ' len=' + (m.end - m.at) : 'NONE'}`);
    log('    ' + JSON.stringify(js.slice(o - 320, o + 320)));
  }
}

// ---- 2. top-bar CSS rules
log('\n=== .top-bar CSS rules (all) ===');
{
  const hit = R.filter((r) => /\.top-bar(?![A-Za-z0-9_-])/.test(r.sel));
  const vars = new Map();
  for (const r of hit) {
    for (const m of r.body.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) vars.set(m[1], (vars.get(m[1]) || 0) + 1);
    const bg = /background(?:-color)?\s*:\s*([^;}]+)/.exec(r.body);
    log(`  @${r.at} ${r.sel.slice(0, 130)}`);
    if (bg) log(`       bg: ${bg[1].trim()}`);
  }
  log('  vars: ' + [...vars.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}(${v})`).join(' '));
}

// ---- 3. real message list pane: candidates by class + big rule counts
log('\n=== message pane candidates: css rule counts ===');
const CAND = ['chatList', 'chat-list', 'messageList', 'message-list', 'msg-list', 'list-message', 'conversation-message',
  'chat-box', 'chatBox', 'chat-content-v2', 'chat-content-message', 'msgview', 'msg-view', 'message-view',
  'chat-message-list', 'chatMessageList', 'virtual-list', 'virtualList', 'scroll-view', 'conversation-content'];
for (const c of CAND) {
  const re = new RegExp('\\.' + c.replace(/[-]/g, '\\-') + '(?![A-Za-z0-9_-])');
  const n = R.filter((r) => re.test(r.sel)).length;
  const jn = allOcc('"' + c).length + allOcc(' ' + c + ' ').length;
  log(`  .${c.padEnd(26)} cssRules=${String(n).padStart(4)}  jsForms=${jn}`);
}

// ---- 4. what wraps the chat-message rows: search for className composition near chat-message-v2 render
log('\n=== wrapper context: chat-message-v2 render parent (2.6KB before) ===');
{
  const at = js.indexOf('"chat-message chat-message-v2"');
  log('  at=' + at);
  log('  ' + JSON.stringify(js.slice(at - 2600, at - 1800)));
}

// ---- 5. ids used as pane anchors
log('\n=== id anchors (id:"...") near chat surfaces ===');
{
  const ids = new Map();
  for (const m of js.matchAll(/id:"([a-zA-Z][A-Za-z0-9_-]{2,40})"/g)) ids.set(m[1], (ids.get(m[1]) || 0) + 1);
  const interesting = [...ids.entries()].filter(([k]) => /chat|msg|message|conv|list|title|input|nav|sidebar|setting|menu|modal/i.test(k));
  for (const [k, v] of interesting.sort((a, b) => b[1] - a[1]).slice(0, 40)) {
    const m = moduleFor(js.indexOf('id:"' + k + '"'));
    log(`  id="${k}"`.padEnd(28) + ` occ=${String(v).padStart(3)} module=${m ? m.key : '?'}`);
  }
}

log('\nwrote _r3_topbar.txt');
