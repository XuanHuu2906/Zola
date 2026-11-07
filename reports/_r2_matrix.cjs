// R2 final: required category grouping + token->component + retint reachability.
const fs = require('fs');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const css = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.css', 'latin1');
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const OUT = 'D:/Zalo/reports/_r2_matrix.txt';
const log = [];
const say = (...a) => { const l = a.map(String).join(' '); log.push(l); console.log(l); };

// ---- rules
const rules = [];
let i = 0;
while (i < css.length) {
  const o = css.indexOf('{', i); if (o < 0) break;
  const c = css.indexOf('}', o); if (c < 0) break;
  const sel = css.slice(i, o).trim();
  if (!sel.startsWith('@')) rules.push({ sel, body: css.slice(o + 1, c) });
  i = c + 1; while (i < css.length && /[\s;]/.test(css[i])) i++;
}
const varsAt = (off) => { const b = css.indexOf('{', off), c = css.indexOf('}', b); const m = new Map(); for (const x of css.slice(b + 1, c).matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;]+)/g)) m.set(x[1], x[2].trim()); return m; };
const L = varsAt(43288), D = varsAt(13665);
const SCALE = /^--(N|DN|NG|NA|B|STB|SKB|R|OR|Y|G|TL|P|PK|WA|BA|BLA|GR|PU)\d+$/;
const GRAD = /^--(V|H|D)_Gradient_/;

// ---- TOKEN_MAP alias/step from JS (parsed earlier into _r2_resolved.json rows)
let rows = [];
try { rows = require('./_r2_resolved.json').rows; } catch (e) { say('rows unavailable: ' + e.message); }
const byName = new Map(rows.map((r) => [r.token_name || r.token, r]));

// ---- consumers
const consumers = new Map();
for (const r of rules) {
  if (/^:root/.test(r.sel)) continue;
  for (const m of r.body.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) {
    if (!consumers.has(m[1])) consumers.set(m[1], new Set());
    consumers.get(m[1]).add(r.sel);
  }
}

// ---- REQUIRED grouping
const REQUIRED = [
  ['Background', (t) => /^--(layer-background(?!-navbar|-leftmenu)|surface-background|surface-alt|bg-|item-wa|title-bar|title-ptv|input-white|input-grey|tip-bg|curtain|skeleton|background-)/.test(t)],
  ['Surface', (t) => /^--(layer-background-navbar-sublevel|layer-background-CSC|layer-background-ptv|layer-background-inverse|layer-background-pinned|layer-background-gradient|layer-accent|bg-message-info)/.test(t)],
  ['Text', (t) => /^--(text-|link$|success$|timestamp$|tab-txt|debugger-settings-text|self-bubble-chat-shadow)/.test(t)],
  ['Border', (t) => /^--(border|divider)/.test(t)],
  ['Navigation', (t) => /^--(layer-background-navbar|layer-background-leftmenu|icon-navbar|nav-width)/.test(t)],
  ['Conversation', (t) => /^--(grey-dot|red-dot|reaction|jump-to-message|emoji-status|conv-)/.test(t)],
  ['Message', (t) => /^--(media-message|floating-menu|partial-quote|toast|text-search-highlight$|blue-quote|white-quote|text-quote)/.test(t)],
  ['Icon', (t) => /^--icon-/.test(t)],
  ['Shadow', (t) => /^--shadow/.test(t)],
  ['Control / button', (t) => /^--button-/.test(t)],
  ['Accent', (t) => /^--accent-/.test(t)],
  ['Layout / other', (t) => /^--(space-|medium$|f\d|nav-width)/.test(t)],
];

const sem = [...new Set([...L.keys(), ...D.keys()])].filter((k) => !SCALE.test(k) && !GRAD.test(k));
say(`semantic token union = ${sem.length} (light ${L.size}, dark ${D.size} incl. scales)`);
const assigned = new Set();
const cat = {};
for (const [name, re] of REQUIRED) {
  const list = sem.filter((t) => !assigned.has(t) && re(t));
  list.forEach((t) => assigned.add(t));
  cat[name] = list;
}
const leftover = sem.filter((t) => !assigned.has(t));
say(`unassigned semantic = ${leftover.length}: ${leftover.join(' ')}`);
say('');

// ---- reachability classification
const MAIN = new Set(['N', 'NG', 'DN', 'B', 'R']);
function aliasOf(t) {
  const r = byName.get(t);
  if (r) return r.alias;
  const m = /^--(N|DN|NG|NA|B|STB|SKB|R|OR|Y|G|TL|P|PK|WA|BA|BLA|GR|PU)\d+$/.exec(t);
  return m ? m[1] : null;
}
function reach(t) {
  // 1. public class swap always works (light<->dark block)
  if (!L.has(t) && !D.has(t)) return 'no-def';
  // 2. Magic reachable?
  const a = aliasOf(t);
  if (/input-field-bg|border|divider/.test(t)) return 'excluded-by-filter';
  if (a && MAIN.has(a)) return 'magic';
  if (a) return 'alias-not-in-magic:' + a;
  return 'literal';
}
const reachCount = {};
for (const t of sem) { const r = reach(t); reachCount[r.split(':')[0]] = (reachCount[r.split(':')[0]] || 0) + 1; }

// ---- emit
for (const [name] of REQUIRED) {
  const list = cat[name];
  say(`\n## ${name}  n=${list.length}`);
  for (const t of list.sort()) {
    const lv = L.get(t) ?? '—';
    const dv = D.get(t) ?? '—';
    const n = consumers.has(t) ? consumers.get(t).size : 0;
    say(`  ${t.padEnd(52)} L=${String(lv).padEnd(28)} D=${String(dv).padEnd(28)} used=${String(n).padStart(3)}  ${reach(t)}`);
  }
}

say('\n=== reachability summary (semantic) ===');
for (const [k, v] of Object.entries(reachCount).sort((a, b) => b[1] - a[1])) say(`  ${k.padEnd(28)} ${v}`);

// ---- token -> component (top selectors) map for the design spine
const SPINE = ['--text-primary', '--text-secondary', '--text-information', '--text-on-color', '--layer-background', '--layer-background-subtle', '--layer-background-hover', '--layer-background-selected', '--border', '--border-subtle', '--border-focused', '--divider', '--icon-primary', '--icon-secondary', '--background-activeness', '--WA100', '--surface-background-subtle', '--shadow-overlay', '--shadow-overflow', '--shadow-bubble'];
say('\n=== design spine: token -> component families ===');
for (const t of SPINE) {
  const sels = [...(consumers.get(t) || [])];
  const fam = new Map();
  for (const s of sels) {
    const k = s.startsWith('.conv-item') ? 'conv list row'
      : /chat-message|chat-content|msg-item/.test(s) ? 'message row'
      : /chat-box/.test(s) ? 'composer'
      : /titlebar/.test(s) ? 'titlebar'
      : /zmenu/.test(s) ? 'context menu'
      : /zl-modal|modal/.test(s) ? 'modal'
      : /leftmenu|navbar/.test(s) ? 'nav'
      : /setting/.test(s) ? 'settings'
      : /threadChat/.test(s) ? 'chat header'
      : /\.btn|button/.test(s) ? 'button'
      : /input/.test(s) ? 'input'
      : 'other';
    fam.set(k, (fam.get(k) || 0) + 1);
  }
  say(`  ${t.padEnd(32)} total=${String(sels.length).padStart(3)}  ` + [...fam.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}:${v}`).join(' '));
}

// ---- glass feasibility per surface
say('\n=== glass feasibility (per surface) ===');
const SURF = [
  ['conversation row', /^\.conv-item/],
  ['chat header', /\.threadChat__/],
  ['message row', /\.chat-content|\.chat-message/],
  ['bubble', /\.content-message-container/],
  ['composer', /\.chat-box-bar|\.chat-box-input/],
  ['titlebar', /\.titlebar/],
  ['context menu', /^#zmenu|\.zmenu-item/],
  ['modal', /\.zl-modal/],
  ['settings', /\.setting/],
  ['leftpanel', /\.leftpanel/],
  ['rightpanel', /\.rightpanel/],
];
for (const [name, re] of SURF) {
  const hit = rules.filter((r) => re.test(r.sel));
  let bf = 0, semiBg = 0, shadow = 0, radius = 0, blurF = 0, opaqueBg = 0;
  for (const r of hit) {
    if (/backdrop-filter/.test(r.body)) bf++;
    if (/filter\s*:[^;}]*blur\(/.test(r.body)) blurF++;
    if (/box-shadow/.test(r.body)) shadow++;
    if (/border-radius/.test(r.body)) radius++;
    const bg = /background(?:-color)?\s*:\s*([^;}]+)/.exec(r.body);
    if (bg) { if (/rgba\(|hsla\(/.test(bg[1])) semiBg++; else opaqueBg++; }
  }
  say(`  ${name.padEnd(18)} rules=${String(hit.length).padStart(3)} backdrop=${bf} blur=${blurF} shadow=${String(shadow).padStart(2)} radius=${String(radius).padStart(3)} semiBg=${String(semiBg).padStart(2)} opaqueBg=${opaqueBg}`);
}

// ---- does .custom exist as own theme scope?
say('\n=== .custom scope in shipped CSS ===');
say('  standalone .custom class selector occurrences: ' + ((css.match(/\.custom(?![A-Za-z0-9_-])/g) || []).length));
say('  .custom{ rule: ' + ((css.match(/\.custom\s*\{/g) || []).length));
say('  .custom.mask-sidebar rules: ' + ((css.match(/\.custom\.mask-sidebar/g) || []).length));
say('  JS body.classList.add/remove(…CUSTOM): ' + ((js.match(/classList\.(?:add|remove)\([^)]*CUSTOM/g) || []).length));

fs.writeFileSync(OUT, log.join('\n'), 'utf8');
say('\nwrote ' + OUT);
