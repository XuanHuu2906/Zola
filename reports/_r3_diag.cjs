// R3 diagnostics: (a) why namedEnclosing returns null, (b) bubble selector reality,
// (c) per-surface token census keyed on the v9 real selector families.
const fs = require('fs');
const acorn = require('acorn');

const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const css = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.css', 'latin1');
const LOG = 'D:/Zalo/reports/_r3_diag.txt';
fs.writeFileSync(LOG, '');
const log = (...a) => { const l = a.map(String).join(' '); console.log(l); fs.appendFileSync(LOG, l + '\n'); };

// ---------- (a) label census ----------
const MODS = [
  ['y1FZ', 19641108, 9042], ['AXH7', 3807709, 6499], ['JFrT', 6508381, 90243],
  ['+ISi', 85954, 576375], ['Zb+t', 12278564, 587835], ['/GXy', 965564, 159468],
  ['GQ8g', 5553773, 11891], ['MEZx', 7331013, 11890], ['O7EA', 7989310, 137420],
  ['8ky5', 3367770, 4360], ['eIjl', 14308176, 901], ['/ymA', 1255215, 56717],
  ['VLvn', 10707732, 430389], ['Dtbk', 4584814, 40781], ['pg6P', 17403058, 12498],
];
function parseModule(at) {
  const fnAt = js.indexOf('function', at);
  if (fnAt < 0 || fnAt > at + 200) return { node: null, why: 'no function near ' + at };
  let node;
  try { node = acorn.parseExpressionAt(js, fnAt, { ecmaVersion: 2022 }); }
  catch (e) { return { node: null, why: 'parse error: ' + e.message }; }
  const body = node.type === 'SequenceExpression' ? node.expressions[0] : node;
  return { node: body, why: null, fnAt };
}
function labelOf(n) {
  if ((n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') && n.id) return n.id.name;
  if (n.type === 'ClassDeclaration' && n.id) return n.id.name;
  if (n.type === 'ClassExpression' && n.id) return n.id.name;
  if (n.type === 'VariableDeclarator' && n.id && n.id.type === 'Identifier' && n.init &&
      /Function|Class/.test(n.init.type)) return n.id.name;
  if (n.type === 'ObjectProperty' && n.key && n.key.type === 'Identifier' &&
      n.value && /Function|Class/.test(n.value.type)) return n.key.name;
  if (n.type === 'ObjectProperty' && n.key && n.key.type === 'Literal' && typeof n.key.value === 'string' &&
      n.value && /Function|Class/.test(n.value.type)) return n.key.value;
  return null;
}
log('=== (a) labelled-node census per module ===');
const census = {};
for (const [key, at, len] of MODS) {
  const { node, why, fnAt } = parseModule(at);
  if (!node) { log(`  ${key.padEnd(6)} PARSE-FAIL ${why}`); census[key] = { fail: why }; continue; }
  let total = 0, labelled = 0;
  const labels = [];
  (function walk(n) {
    if (!n || typeof n.type !== 'string') return;
    total++;
    const lab = labelOf(n);
    if (lab) { labelled++; if (labels.length < 40) labels.push(`${lab}(${n.end - n.start})`); }
    for (const k in n) {
      if (k === 'type' || k === 'loc') continue;
      const v = n[k];
      if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') walk(c); }
      else if (v && typeof v.type === 'string') walk(v);
    }
  })(node);
  log(`  ${key.padEnd(6)} body=${node.type.padEnd(18)} span=${fnAt}..${node.end} nodes=${String(total).padStart(6)} labelled=${String(labelled).padStart(4)}  ${labels.slice(0, 8).join(' ')}`);
  census[key] = { body: node.type, nodes: total, labelled, labels };
}
fs.writeFileSync('D:/Zalo/reports/_r3_diag_census.json', JSON.stringify(census, null, 1), 'utf8');

// ---------- (b) bubble / wrapper selector reality ----------
log('\n=== (b) selector-position reality for bubble + wrapper ===');
const TARGETS = ['content-message-container', 'message-box-message-wrapper', 'chat-message-v2', 'msg-item'];
function selectorOccurrences(cls) {
  let leftmost = 0, anywhere = 0, rules = 0;
  const sels = css.split('}');
  for (const s of sels) {
    const open = s.lastIndexOf('{');
    if (open < 0) continue;
    const head = s.slice(0, open);
    let inRule = false;
    for (const part of head.split(',')) {
      const p = part.trim().replace(/^[^.#A-Za-z]*/, '');
      const m = /^[.#]?([A-Za-z0-9_-]+)/.exec(p);
      const has = new RegExp('\\.' + cls.replace(/[-]/g, '\\-') + '(?![A-Za-z0-9_-])').test(part);
      if (has) { anywhere++; if (m && m[1] === cls) leftmost++; inRule = true; }
    }
    if (inRule) rules++;
  }
  return { leftmost, anywhere, rules };
}
for (const t of TARGETS) {
  const o = selectorOccurrences(t);
  log(`  .${t.padEnd(28)} rules=${String(o.rules).padStart(3)} selector-parts=${String(o.anywhere).padStart(4)} leftmost=${String(o.leftmost).padStart(3)}`);
}

// ---------- (c) per-surface token census on real families ----------
const rules = [];
{
  let i = 0;
  while (i < css.length) {
    const o = css.indexOf('{', i); if (o < 0) break;
    const c = css.indexOf('}', o); if (c < 0) break;
    const sel = css.slice(i, o).trim();
    if (sel && !sel.startsWith('@')) rules.push({ sel, body: css.slice(o + 1, c) });
    i = c + 1; while (i < css.length && /[\s;]/.test(css[i])) i++;
  }
}
const SURF = [
  ['titlebar', /\.titlebar|\.titlebar-menu-btn|\.titlebar-os/],
  ['nav (buttons)', /\.nav-button_|\.nav-content|\.nav-loading/],
  ['conversation list', /\.conv-item|\.conv-message|#contact-search|\.conv-list-empty-wrapper|\.conv-item-padding/],
  ['chat header', /\.threadChat__/],
  ['message row', /\.chat-message(?![A-Za-z0-9_-])|\.chat-message-v2|\.chat-content|\.message-box-message-wrapper/],
  ['bubble', /\.content-message-container/],
  ['date divider', /\.chat-date(?![A-Za-z0-9_-])/],
  ['composer', /\.chat-input-container|\.chat-box-input|\.chat-input-wrapper/],
  ['context menu', /#zmenu|\.zmenu-/],
  ['modal', /\.zl-modal/],
  ['settings', /\.setting-section|\.setting-menu|\.setting(?![A-Za-z0-9_-])/],
];
log('\n=== (c) per-surface rule + token census (real selector families) ===');
const surfTokens = {};
for (const [name, re] of SURF) {
  const hit = rules.filter((r) => re.test(r.sel));
  const vars = new Map();
  let bf = 0, semi = 0, opaque = 0, shadow = 0, radius = 0;
  for (const r of hit) {
    for (const m of r.body.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) vars.set(m[1], (vars.get(m[1]) || 0) + 1);
    if (/backdrop-filter/.test(r.body)) bf++;
    if (/box-shadow/.test(r.body)) shadow++;
    if (/border-radius/.test(r.body)) radius++;
    const bg = /background(?:-color)?\s*:\s*([^;}]+)/.exec(r.body);
    if (bg) { if (/rgba\(|hsla\(/.test(bg[1])) semi++; else opaque++; }
  }
  const top = [...vars.entries()].sort((a, b) => b[1] - a[1]);
  surfTokens[name] = { rules: hit.length, vars: top, bf, semi, opaque, shadow, radius };
  log(`\n## ${name}  rules=${hit.length} distinctVars=${top.length} backdrop=${bf} shadow=${shadow} radius=${radius} semiBg=${semi} opaqueBg=${opaque}`);
  log('   ' + top.slice(0, 14).map(([k, v]) => `${k}(${v})`).join(' '));
}
fs.writeFileSync('D:/Zalo/reports/_r3_diag_surfaces.json', JSON.stringify(surfTokens, null, 1), 'utf8');
log('\nwrote _r3_diag.txt / .json');
