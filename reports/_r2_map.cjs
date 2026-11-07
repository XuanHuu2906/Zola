// R2: token inventory + token -> component mapping from the shipped stylesheet.
const fs = require('fs');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const css = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.css', 'latin1');
const OUT = 'D:/Zalo/reports/_r2_map.txt';
const log = [];
const say = (...a) => { const l = a.map(String).join(' '); log.push(l); console.log(l); };

// ---- flat rule scanner (shipped CSS is nesting-free; @media treated transparently)
const rules = [];
let i = 0;
while (i < css.length) {
  const open = css.indexOf('{', i);
  if (open < 0) break;
  const sel = css.slice(i, open).trim();
  const close = css.indexOf('}', open);
  if (close < 0) break;
  if (!sel.startsWith('@') || sel.startsWith('@media')) rules.push({ sel, body: css.slice(open + 1, close) });
  i = close + 1;
  while (i < css.length && /[\s;]/.test(css[i])) i++;
}
say(`rules parsed=${rules.length}`);

const pick = (sel) => rules.find((r) => r.sel === sel);
const LIGHT = pick(':root,:root .light');
const DARK = pick(':root .dark');
if (!LIGHT || !DARK) { console.log('BLOCK NOT FOUND', !!LIGHT, !!DARK); process.exit(1); }

function vars(body) {
  const m = new Map();
  for (const x of body.matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;]+)/g)) m.set(x[1], x[2].trim());
  return m;
}
const LV = vars(LIGHT.body), DV = vars(DARK.body);
say(`light selector=${JSON.stringify(LIGHT.sel)} vars=${LV.size}`);
say(`dark  selector=${JSON.stringify(DARK.sel)} vars=${DV.size}`);

const SCALE = /^--(N|DN|NG|NA|B|STB|SKB|R|OR|Y|G|TL|P|PK|WA|BA|BLA|GR|PU)\d+$/;
const GRAD = /^--(V|H|D)_Gradient_/;
const semL = [...LV.keys()].filter((k) => !SCALE.test(k) && !GRAD.test(k));
const semD = [...DV.keys()].filter((k) => !SCALE.test(k) && !GRAD.test(k));
say(`scale tokens light=${LV.size - semL.length} dark=${DV.size - semD.length}`);
say(`semantic tokens light=${semL.length} dark=${semD.length}`);

const CATS = [
  ['navigation', /^--(layer-background-navbar|layer-background-leftmenu|text-navbar)/],
  ['background/surface', /^--(layer-background|background|surface-background|title-bar|title-ptv|tab-txt|bg-|bg-|item-wa|tip-bg|input-|progress|vtt-)/],
  ['text', /^--(text-|timestamp$|link$|white-quote|blue-quote|success$|self-bubble)/],
  ['border/divider', /^--(border|divider)/],
  ['conversation', /^--(conv-|jump-to-message|reaction|emoji-status|grey-dot|red-dot|bg-divide)/],
  ['message', /^--(media-message|partial-quote|floating-menu|toast|text-search-highlight$)/],
  ['icon', /^--icon-/],
  ['shadow', /^--shadow/],
  ['control/button', /^--button-/],
  ['accent', /^--accent-/],
];
const catOf = (t) => (CATS.find(([, re]) => re.test(t)) || ['other'])[0];
const groups = {};
for (const t of semL) (groups[catOf(t)] ||= []).push(t);
say('\n=== semantic token groups (light) ===');
for (const [g, a] of Object.entries(groups).sort((a, b) => b[1].length - a[1].length)) {
  say(`\n## ${g}  n=${a.length}`);
  say('  ' + a.join(' '));
}

say('\n=== light vs dark equivalence (semantic) ===');
let same = 0, diff = 0, noDark = 0;
const unchanged = [];
for (const t of semL) {
  if (!DV.has(t)) { noDark++; continue; }
  if (LV.get(t) === DV.get(t)) { same++; unchanged.push(`${t}=${LV.get(t)}`); } else diff++;
}
say(`identical=${same} differing=${diff} light-only=${noDark}`);
say('unchanged: ' + unchanged.join(' '));

// ---- token -> consumer rules
const consumers = new Map();
for (const r of rules) {
  if (/^:root/.test(r.sel)) continue;
  for (const m of r.body.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) {
    if (!consumers.has(m[1])) consumers.set(m[1], []);
    consumers.get(m[1]).push(r.sel);
  }
}
say(`\ntokens consumed by >=1 non-:root rule: ${consumers.size}`);
const dead = semL.filter((t) => !consumers.has(t));
say(`semantic tokens never consumed: ${dead.length}`);
say('  ' + dead.join(' '));
const top = [...consumers.entries()].map(([t, s]) => [t, s.length]).sort((a, b) => b[1] - a[1]);
say('\n=== most-consumed tokens (top 40) ===');
for (const [t, n] of top.slice(0, 40)) say(`  ${String(n).padStart(4)}  ${t}`);

// ---- per surface
const SURF = [
  ['conversation row', /^\.conv-item|\.conv-item-title|\.conv-message|\.conv-item__avatar/],
  ['chat header', /\.threadChat__/],
  ['message row', /\.chat-content|\.chat-message/],
  ['bubble', /\.content-message-container/],
  ['date divider', /\.chat-date/],
  ['composer', /\.chat-box-bar|\.chat-box-input/],
  ['titlebar', /\.titlebar/],
  ['context menu', /^#zmenu|\.zmenu-item/],
  ['modal', /\.zl-modal/],
  ['settings', /\.setting|\.settings/],
  ['sidebar/nav', /^\.leftpanel|^\.rightpanel|\.navbar|\.leftmenu/],
];
say('\n=== per-surface token census ===');
for (const [name, re] of SURF) {
  const hit = rules.filter((r) => re.test(r.sel));
  const toks = new Map();
  let bf = 0, blur = 0, semis = 0, shadow = 0;
  for (const r of hit) {
    for (const m of r.body.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) toks.set(m[1], (toks.get(m[1]) || 0) + 1);
    if (/backdrop-filter/.test(r.body)) bf++;
    if (/filter\s*:[^;}]*blur\(/.test(r.body)) blur++;
    for (const c of r.body.match(/rgba?\([^)]*\)/g) || []) if (/rgba\(\s*[^,]+,\s*[^,]+,?\s*[^,]+,\s*(0?\.\d+|0)\s*\)/.test(c)) semis++;
    if (/box-shadow/.test(r.body)) shadow++;
  }
  const t = [...toks.entries()].sort((a, b) => b[1] - a[1]);
  say(`\n## ${name}  rules=${hit.length} uniqTokens=${t.length} backdrop=${bf} blur=${blur} semi=${semis} shadow=${shadow}`);
  say('  ' + t.slice(0, 20).map(([k, v]) => `${k}(${v})`).join(' '));
}

// ---- transparency profile
say('\n=== transparency profile per category (light values) ===');
for (const [g, arr] of Object.entries(groups)) {
  let rgba = 0, hex = 0, other = 0, transparent = 0, gradient = 0;
  for (const t of arr) {
    const v = LV.get(t) || '';
    if (v === 'transparent') transparent++;
    else if (/^rgba\(|^hsla\(/.test(v)) rgba++;
    else if (/^#/.test(v)) hex++;
    else if (/gradient/.test(v)) gradient++;
    else other++;
  }
  say(`  ${g.padEnd(20)} rgba/hsla=${String(rgba).padEnd(3)} hex=${String(hex).padEnd(3)} transparent=${String(transparent).padEnd(3)} gradient=${gradient} other=${other}`);
}

say('\n=== backdrop-filter rules (all) ===');
for (const r of rules) {
  const m = /backdrop-filter\s*:\s*([^;}]+)/.exec(r.body);
  if (m) say(`  ${r.sel}  ->  ${m[1]}`);
}
say('\n=== filter:blur rules (all) ===');
for (const r of rules) {
  const m = /(?:^|;|\s)filter\s*:\s*([^;}]+)/.exec(r.body);
  if (m && m[1].includes('blur(')) say(`  ${r.sel}  ->  ${m[1]}`);
}
say('\n=== shadow token definitions ===');
for (const t of semL) if (/^--shadow/.test(t)) say(`  ${t} = ${LV.get(t)}`);
say('\n=== gradient / alpha literal counts in shipped CSS ===');
for (const [n, re] of [['rgba(', /rgba\(/g], ['hsla(', /hsla\(/g], ['linear-gradient', /linear-gradient\(/g], ['radial-gradient', /radial-gradient\(/g], ['conic-gradient', /conic-gradient\(/g], ['box-shadow', /box-shadow\s*:/g], ['border-radius', /border-radius\s*:/g]]) {
  say(`  ${n.padEnd(18)} ${(css.match(re) || []).length}`);
}

fs.writeFileSync(OUT, log.join('\n'), 'utf8');
say('\nwrote ' + OUT);
