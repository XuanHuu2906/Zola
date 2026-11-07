// R3 final: react version, portal targets, state-class CSS, #titleBar, conv list shell.
const fs = require('fs');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const css = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.css', 'latin1');
const LOG = 'D:/Zalo/reports/_r3_final.txt';
fs.writeFileSync(LOG, '');
const log = (...a) => { const l = a.map(String).join(' '); console.log(l); fs.appendFileSync(LOG, l + '\n'); };

log('=== react runtime version ===');
for (const re of [/"18\.\d+\.\d+"/g, /"17\.\d+\.\d+"/g, /"16\.\d+\.\d+"/g, /"19\.\d+\.\d+"/g]) {
  const hits = [...js.matchAll(re)].map((m) => m[0]);
  if (hits.length) log(`  ${re} -> ${[...new Set(hits)].join(' ')}  (${hits.length} hits)`);
}
{
  const at = js.indexOf('react-dom');
  log('  react-dom ctx: ' + JSON.stringify(js.slice(at - 400, at + 260)));
}
// react mojibake fingerprint: __SECRET_INTERNALS / react.element
for (const s of ['react.element', '__SECRET_INTERNALS', 'react.memo', 'react.forward_ref', 'hooks']) {
  const n = js.split(s).length - 1;
  log(`  ${JSON.stringify(s).padEnd(22)} ${n}`);
}

log('\n=== portal targets (zl-modal) ===');
{
  const at = js.indexOf('createPortal');
  let p = at;
  let n = 0;
  while (p >= 0 && n < 4) {
    log(`  @${p}: ` + JSON.stringify(js.slice(p - 500, p + 260)));
    p = js.indexOf('createPortal', p + 1); n++;
  }
  log('  createPortal occurrences = ' + (js.split('createPortal').length - 1));
}

log('\n=== titleBar / shell anchors ===');
for (const s of ['titleBar', 'id:"titleBar"', 'convList', 'div_Main_Tab_zCloud']) {
  const hits = []; let p = 0;
  while ((p = js.indexOf(s, p)) >= 0) { hits.push(p); p += s.length; }
  log(`  ${JSON.stringify(s).padEnd(24)} occ=${hits.length}`);
  for (const h of hits.slice(0, 3)) log(`     @${h}: ` + JSON.stringify(js.slice(h - 180, h + 220)));
}

log('\n=== state-class CSS for conversation row + message row ===');
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
log('  total rules = ' + R.length);
const STATE = [
  ['conv-item.selected', /\.conv-item[^,{]*\.selected/],
  ['conv-item.pinned', /\.conv-item[^,{]*\.pinned/],
  ['conv-item:hover', /\.conv-item:hover/],
  ['chat-message.me', /\.chat-message[^,{]*\.me\b/],
  ['chat-message.failed', /\.chat-message[^,{]*\.failed/],
  ['chat-message-reaction', /\.chat-message[^,{]*\.-reaction/],
  ['chat-box-input--to-focus', /\.chat-box-input--to-focus/],
  ['zmenu-item:hover', /\.zmenu-item:hover/],
  ['zmenu-item.selected', /\.zmenu-item[^,{]*\.(?:selected|active)/],
  ['setting-item:hover', /\.setting-(?:section-content__item|menu__item):hover/],
  ['nav active', /\.nav-button_[^,{]*\.(?:active|selected)/],
  ['sidebar active', /\.sidebar[^,{]*\.(?:active|selected)/],
  ['titlebar is-maximized', /\.titlebar[^,{]*\.is-maximized/],
  ['modal mask', /\.zl-modal[^,{]*mask|mask[^,{]*\.zl-modal/],
];
for (const [name, re] of STATE) {
  const hit = R.filter((r) => re.test(r.sel));
  log(`\n## ${name}  rules=${hit.length}`);
  for (const r of hit.slice(0, 4)) {
    const bg = /background(?:-color)?\s*:\s*([^;}]+)/.exec(r.body);
    const vars = [...r.body.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)].map((m) => m[1]);
    log(`   @${r.at} ${r.sel.slice(0, 120)}`);
    if (bg) log(`        bg: ${bg[1].trim()}`);
    if (vars.length) log(`        vars: ${[...new Set(vars)].join(' ')}`);
  }
}

log('\n=== --BA20 / --WA100 definitions (used by chat header + bubbles) ===');
for (const v of ['--BA20', '--BA30', '--WA100', '--text-information', '--layer-background', '--layer-background-subtle', '--border-focused', '--background-activeness']) {
  const re = new RegExp('\\' + v + '\\s*:\\s*([^;]+)', 'g');
  const defs = [...css.matchAll(re)].map((m) => `${m[1].trim()}`);
  log(`  ${v.padEnd(26)} defs=${defs.length}  ${[...new Set(defs)].slice(0, 4).join(' | ')}`);
}

log('\n=== does chat-message row use transform/will-change/overflow (glass blockers) ===');
{
  const hit = R.filter((r) => /\.chat-message(?![A-Za-z0-9_-])/.test(r.sel));
  const flag = { transform: 0, willChange: 0, overflow: 0, contain: 0, zIndex: 0, position: 0, filter: 0, isolation: 0 };
  for (const r of hit) {
    if (/transform\s*:/.test(r.body)) flag.transform++;
    if (/will-change/.test(r.body)) flag.willChange++;
    if (/overflow/.test(r.body)) flag.overflow++;
    if (/contain\s*:/.test(r.body)) flag.contain++;
    if (/z-index/.test(r.body)) flag.zIndex++;
    if (/position\s*:/.test(r.body)) flag.position++;
    if (/filter\s*:/.test(r.body)) flag.filter++;
    if (/isolation/.test(r.body)) flag.isolation++;
  }
  log(`  .chat-message rules=${hit.length}  ` + Object.entries(flag).map(([k, v]) => `${k}:${v}`).join(' '));
  const tf = hit.filter((r) => /transform\s*:/.test(r.body)).slice(0, 6);
  for (const r of tf) {
    const t = /transform\s*:\s*([^;}]+)/.exec(r.body);
    log(`   @${r.at} ${r.sel.slice(0, 90)}  transform: ${t && t[1]}`);
  }
}

log('\nwrote _r3_final.txt');
