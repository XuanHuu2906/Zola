// R3 step 3c (v9): attribute the *real* CSS selectors (not guessed names) to
// module + nearest named enclosing unit. v8 probed guessed literals and missed
// the surfaces that actually exist (.threadChat__, navBtn, titleBar, ...).
const fs = require('fs');
const acorn = require('acorn');

const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const css = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.css', 'latin1');
const LOG = 'D:/Zalo/reports/_r3_modules9.txt';
fs.writeFileSync(LOG, '');
const log = (...a) => { const l = a.map(String).join(' '); console.log(l); fs.appendFileSync(LOG, l + '\n'); };

const ivs = JSON.parse(fs.readFileSync('D:/Zalo/reports/_r3_modules7_intervals.json', 'utf8'))
  .map(([k, at, end]) => ({ key: k, at, end })).sort((a, b) => a.at - b.at);
log(`verified modules = ${ivs.length}`);

function moduleFor(off) {
  let lo = 0, hi = ivs.length - 1, best = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (ivs[mid].at <= off) { best = mid; lo = mid + 1; } else hi = mid - 1; }
  let pick = null;
  for (let k = best; k >= 0 && best - k <= 600; k--) { const v = ivs[k]; if (off > v.at && off < v.end && (!pick || v.at > pick.at)) pick = v; }
  return pick;
}

const cache = new Map();
function parsedModule(mod) {
  if (cache.has(mod.at)) return cache.get(mod.at);
  let out = null;
  try {
    const fnAt = js.indexOf('function', mod.at);
    if (fnAt >= 0 && fnAt < mod.at + 200) {
      const node = acorn.parseExpressionAt(js, fnAt, { ecmaVersion: 2022 });
      out = node.type === 'SequenceExpression' ? node.expressions[0] : node;
    }
  } catch (e) { out = null; }
  cache.set(mod.at, out);
  return out;
}

function namedEnclosing(mod, off) {
  const body = parsedModule(mod);
  if (!body || body.type !== 'FunctionExpression') return null;
  const stack = [];
  let best = null;
  (function walk(n, label) {
    if (!n || typeof n.type !== 'string' || n.start > off || n.end <= off) return;
    let lab = label;
    if ((n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') && n.id) lab = n.id.name;
    if (n.type === 'ClassDeclaration' && n.id) lab = n.id.name;
    if (n.type === 'VariableDeclarator' && n.id && n.id.type === 'Identifier' && n.init && /Function/.test(n.init.type)) lab = n.id.name;
    if (n.type === 'ObjectProperty' && n.key && n.key.type === 'Identifier' && n.value && /Function/.test(n.value.type)) lab = n.key.name;
    if (lab) {
      if (!best || (n.end - n.start) < (best.end - best.start)) best = { name: lab, start: n.start, end: n.end };
      stack.push(lab);
    }
    for (const k in n) {
      if (k === 'type' || k === 'loc') continue;
      const v = n[k];
      if (Array.isArray(v)) for (const c of v) if (c && typeof c.type === 'string') walk(c, lab);
      else if (v && typeof v.type === 'string') walk(v, lab);
    }
  })(body, null);
  return best;
}

// ---- 1. which container selectors really exist in CSS
const SURFACES = [
  ['titlebar', /^\.titlebar(?:__|\b)/],
  ['leftmenu / navbar', /^\.navBtn|^#nav[A-Za-z]*|^\.nav-|^\.navigatorWrapper/],
  ['conversation list', /^\.conv-(?:item|list|message|top-bar)|^#conversationListId|^#contact-search/],
  ['chat header', /^\.threadChat__/],
  ['message row', /^\.chat-content|^\.chat-message\b|^\.message-box-message-wrapper/],
  ['bubble', /^\.content-message-container/],
  ['date divider', /^\.chat-date/],
  ['composer', /^\.chat-box-(?:bar|input)|^\.chat-input-(?:container|wrapper)/],
  ['context menu', /^#zmenu|^\.zmenu-/],
  ['modal', /^\.zl-modal/],
  ['setting', /^\.setting(?:-|__|\b)|^\.setting-menu/],
  ['sidebar/leftpanel', /^\.leftpanel|^\.sidebar|^\.left-panel/],
];
function cssSelectors(re) {
  const out = new Map();
  const sels = css.split('}');
  for (const s of sels) {
    const open = s.lastIndexOf('{');
    if (open < 0) continue;
    const head = s.slice(0, open);
    for (const part of head.split(',')) {
      const cls = part.trim().replace(/^[^.#A-Za-z]*/, '');
      if (!/^[.#]/.test(cls)) continue;
      const m = /^[.#]([A-Za-z0-9_-]+)/.exec(cls);
      if (!m) continue;
      const whole = (cls.startsWith('#') ? '#' : '.') + m[1];
      if (re.test(whole)) out.set(whole, (out.get(whole) || 0) + 1);
    }
  }
  return [...out.entries()].sort((a, b) => b[1] - a[1]);
}

log('\n=== real CSS selectors per surface (top 6 by rule count) ===');
const surfaceSelectors = {};
for (const [name, re] of SURFACES) {
  const hits = cssSelectors(re);
  surfaceSelectors[name] = hits.slice(0, 6);
  log(`\n## ${name}  distinct=${hits.length}`);
  log('   ' + hits.slice(0, 6).map(([s, n]) => `${s}(${n})`).join(' '));
}

// ---- 2. locate each surviving selector class literal in JS and attribute it
log('\n=== CSS selector -> JS className literal -> module -> named unit ===');
const report = {};
for (const [name, hits] of Object.entries(surfaceSelectors)) {
  if (!hits.length) { log(`\n## ${name}: no CSS selectors`); continue; }
  const probes = hits.slice(0, 4);
  log(`\n## ${name}`);
  const rows = [];
  for (const [sel, cssCount] of probes) {
    const cls = sel.slice(1);
    const forms = [`"${cls}"`, `className:"${cls}"`, ` ${cls} `, `"${cls} `, ` ${cls}"`];
    let hit = -1, used = null;
    for (const f of forms) { hit = js.indexOf(f); if (hit >= 0) { used = f; break; } }
    if (hit < 0) { log(`   ${sel.padEnd(28)} css=${String(cssCount).padStart(3)}  JS literal NOT FOUND`); rows.push({ sel, cssCount, found: false }); continue; }
    const mod = moduleFor(hit);
    const unit = mod ? namedEnclosing(mod, hit) : null;
    log(`   ${sel.padEnd(28)} css=${String(cssCount).padStart(3)}  js@${hit} pattern=${JSON.stringify(used)}  module=${mod ? mod.key + '@' + mod.at + ' len=' + (mod.end - mod.at) : 'NONE'}  unit=${unit ? unit.name + ' (' + (unit.end - unit.start) + ')' : '?'}`);
    rows.push({ sel, cssCount, found: true, jsAt: hit, pattern: used, module: mod && mod.key, moduleAt: mod && mod.at, moduleLen: mod && (mod.end - mod.at), unit: unit && unit.name, unitLen: unit && (unit.end - unit.start) });
  }
  report[name] = rows;
}

fs.writeFileSync('D:/Zalo/reports/_r3_modules9.json', JSON.stringify(report, null, 1), 'utf8');
log('\nwrote _r3_modules9.json');
