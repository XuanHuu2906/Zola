// R3 step 3b (v8): component-level attribution inside each verified module.
//
// Module keys come from v7 (AST-verified bodies). Inside a module we still need the
// nearest *named* unit (function decl, const/let/var initializer, or class) that
// encloses the surface literal, because several surfaces live in very large
// multi-component modules (Zb+t ~588k, +ISi ~576k).
const fs = require('fs');
const acorn = require('acorn');

const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const LOG = 'D:/Zalo/reports/_r3_modules8.txt';
fs.writeFileSync(LOG, '');
const log = (...a) => { const l = a.map(String).join(' '); console.log(l); fs.appendFileSync(LOG, l + '\n'); };

const ivs = JSON.parse(fs.readFileSync('D:/Zalo/reports/_r3_modules7_intervals.json', 'utf8'))
  .map(([k, at, end]) => ({ key: k, at, end }))
  .sort((a, b) => a.at - b.at);
log(`verified modules = ${ivs.length}`);

function moduleFor(off) {
  let lo = 0, hi = ivs.length - 1, best = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (ivs[mid].at <= off) { best = mid; lo = mid + 1; } else hi = mid - 1; }
  let pick = null;
  for (let k = best; k >= 0; k--) {
    const v = ivs[k];
    if (!pick || v.at > pick.at) { if (off > v.at && off < v.end) pick = v; }
    if (best - k > 500) break;
  }
  return pick;
}

// ---- nearest named enclosing unit, by scanning backwards from the literal
const NAME_PATTERNS = [
  /(?:^|[;,}\s])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g,
  /(?:^|[;,}\s])function\s+([A-Za-z_$][\w$]*)\s*\(/g,
  /(?:^|[;,}\s])class\s+([A-Za-z_$][\w$]*)/g,
  /(?:^|[;,}])n\.d\([a-z],\(\(\)=>[A-Za-z_$][\w$]*\)\),?/g,
];
function namedUnitBefore(off, floor) {
  const from = Math.max(floor, off - 60_000);
  const win = js.slice(from, off);
  let best = null;
  for (const re of NAME_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(win))) {
      const name = m[1];
      if (!name) continue;
      best = { name, at: from + m.index, dist: off - (from + m.index) };
    }
  }
  return best;
}

// ---- AST-derived named enclosing function: parse the module body once and walk it.
function namedEnclosing(module, off) {
  try {
    const fnAt = js.indexOf('function', module.at);
    const node = acorn.parseExpressionAt(js, fnAt, { ecmaVersion: 2022 });
    let body = node.type === 'SequenceExpression' ? node.expressions[0] : node;
    if (!body || body.type !== 'FunctionExpression') return null;
    let best = null;
    (function walk(n, inherited) {
      if (!n || typeof n.type !== 'string') return;
      let label = inherited;
      if (n.type === 'FunctionDeclaration' && n.id) label = n.id.name;
      if (n.type === 'ClassDeclaration' && n.id) label = n.id.name;
      if ((n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') && n.id) label = n.id.name;
      if (n.type === 'VariableDeclarator' && n.id && n.id.type === 'Identifier') {
        const init = n.init;
        if (init && /Function/.test(init.type)) label = n.id.name;
      }
      if (n.start <= off && off < n.end && label) {
        if (!best || (n.end - n.start) < (best.end - best.start)) best = { name: label, start: n.start, end: n.end };
      }
      for (const k in n) {
        if (k === 'loc' || k === 'type') continue;
        const v = n[k];
        if (Array.isArray(v)) for (const c of v) if (c && typeof c.type === 'string') walk(c, label);
        else if (v && typeof v.type === 'string') walk(v, label);
      }
    })(body, null);
    return best;
  } catch (e) { return null; }
}

const NEEDLES = [
  ['sidebar / leftpanel root', 'leftpanel'],
  ['conv list row', 'className:"conv-item'],
  ['conv preview text', 'conv-message truncate'],
  ['conv title name', 'conv-item-title__name'],
  ['chat header', 'chat-header'],
  ['message wrapper', 'className:"chat-message'],
  ['composer bar', 'className:"chat-box-bar"'],
  ['composer toolbar btn', 'chat-box-input__tools__btn'],
  ['bubble container', 'content-message-container'],
  ['titlebar buttons', 'titlebar__btns'],
  ['menu item', 'className:"zmenu-item'],
  ['modal footer', 'zl-modal__footer'],
  ['date chip', 'className:"chat-date'],
  ['left chat box bar', '"left-chat-box-bar"'],
  ['right chat box bar', '"right-chat-box-bar"'],
];

log('\n=== surface -> module -> named enclosing unit (AST) ===');
const found = {};
for (const [label, needle] of NEEDLES) {
  const offs = [];
  let i = -1;
  while ((i = js.indexOf(needle, i + 1)) >= 0 && offs.length < 12) offs.push(i);
  const rows = offs.map((o) => {
    const mod = moduleFor(o);
    const unit = mod ? namedEnclosing(mod, o) : null;
    const back = mod ? namedUnitBefore(o, mod.at) : null;
    return { off: o, mod, unit, back };
  });
  const mods = [...new Set(rows.map((r) => r.mod ? `${r.mod.key}@${r.mod.at}` : 'NONE'))];
  const units = [...new Set(rows.map((r) => r.unit ? r.unit.name : '-'))];
  log(`\n## ${label} ("${needle}") occ=${offs.length}`);
  log(`   modules: ${mods.join(' | ')}`);
  log(`   units  : ${units.join(' | ')}`);
  for (const r of rows.slice(0, 6)) {
    log(`   @${r.off} -> ${r.mod ? r.mod.key : 'NONE'}::${r.unit ? r.unit.name : '?'}` +
        ` (unit span ${r.unit ? `${r.unit.start}..${r.unit.end}` : '-'}; last decl ${r.back ? r.back.name + '@' + r.back.at : '-'})`);
  }
  found[label] = { needle, count: offs.length, modules: mods, units, rows: rows.map((r) => ({
    off: r.off, module: r.mod ? r.mod.key : null, moduleAt: r.mod ? r.mod.at : null,
    unit: r.unit ? r.unit.name : null, unitStart: r.unit ? r.unit.start : null, unitEnd: r.unit ? r.unit.end : null,
    lastDecl: r.back ? r.back.name : null, lastDeclAt: r.back ? r.back.at : null,
  })) };
}

// ---- j6F3 / 9Tg7 lookups
log('\n=== unresolved module-key references ===');
for (const key of ['j6F3', '9Tg7']) {
  const pat = new RegExp(`(?<![A-Za-z0-9_$])${key}(?![A-Za-z0-9_$])`, 'g');
  const hits = [];
  let m;
  while ((m = pat.exec(js)) && hits.length < 12) hits.push(m.index);
  log(`  ${key}: refs=${hits.length} -> ${hits.join(', ')}`);
  for (const h of hits.slice(0, 4)) log(`    @${h}: ${JSON.stringify(js.slice(h - 110, h + 90))}`);
}

fs.writeFileSync('D:/Zalo/reports/_r3_modules8.json', JSON.stringify({ found }, null, 1), 'utf8');
log('\nwrote _r3_modules8.json');
