const fs = require('fs');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const css = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.css', 'utf8');
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const out = [];
const log = (...a) => { const l = a.map(String).join(' '); out.push(l); console.log(l); };

// parse rules once
const rules = [];
let i = 0; const n = css.length;
while (i < n) {
  const open = css.indexOf('{', i);
  if (open < 0) break;
  const sel = css.slice(i, open);
  let d = 0, j = open;
  for (; j < n; j++) { if (css[j] === '{') d++; else if (css[j] === '}') { d--; if (d === 0) break; } }
  let own = '', dd = 0;
  for (let k = open + 1; k < j; k++) { const ch = css[k]; if (ch === '{') dd++; if (ch === '}') dd--; if (dd === 0) own += ch; }
  rules.push({ sel: sel.trim(), own });
  i = j + 1;
}

// exact class -> rules whose selector contains .class
function tokensForClass(cls, extra) {
  const toks = new Map();
  const hits = [];
  for (const r of rules) {
    if (!r.sel.includes('.' + cls)) continue;
    if (extra && !extra.test(r.sel)) continue;
    hits.push(r);
    for (const m of r.own.matchAll(/var\((--[A-Za-z0-9_-]+)/g)) toks.set(m[1], (toks.get(m[1]) || 0) + 1);
    // also literal colour declarations
    for (const m of r.own.matchAll(/(?:^|;)\s*(background(?:-color)?|color|border(?:-color)?|box-shadow|backdrop-filter|fill|stroke)\s*:\s*([^;}]+)/g)) {
      const v = m[2].trim();
      if (!v.includes('var(') && v !== 'inherit' && v !== 'transparent')
        toks.set(`LITERAL:${m[1]}=${v.slice(0, 60)}`, (toks.get(`LITERAL:${m[1]}=${v.slice(0, 60)}`) || 0) + 1);
    }
  }
  return { hits, toks };
}

const TARGETS = [
  ['conv-item', null, 'conversation list row'],
  ['chat-message', null, 'message wrapper'],
  ['chat-box-bar', null, 'composer bar'],
  ['chat-input-v2', null, 'composer input'],
  ['titlebar__title', null, 'custom titlebar'],
  ['titlebar__btns', null, 'titlebar buttons'],
  ['zmenu-item', null, 'menus'],
  ['zl-modal__dialog', null, 'dialog surface'],
  ['content-message-container', null, 'bubble container'],
  ['chat-date', null, 'date chip'],
  ['conv-item-title__name', null, 'conv title text'],
  ['conv-message', null, 'conv preview text'],
];

const report = {};
for (const [cls, extra, label] of TARGETS) {
  const { hits, toks } = tokensForClass(cls, extra);
  const vars = [...toks.entries()].filter((e) => e[0].startsWith('--')).sort((a, b) => b[1] - a[1]);
  const lits = [...toks.entries()].filter((e) => e[0].startsWith('LITERAL:'));
  report[cls] = { label, rules: hits.length, vars, lits };
  log(`\n## .${cls}  (${label})  rules=${hits.length}  vars=${vars.length}  literals=${lits.length}`);
  if (hits.length) log('  sel: ' + hits.slice(0, 3).map((h) => h.sel.slice(0, 110)).join('\n       '));
  log('  vars: ' + vars.slice(0, 34).map((e) => `${e[0]}`).join(' '));
  log('  lits: ' + lits.slice(0, 12).map((e) => e[0].replace('LITERAL:', '')).join(' | '));
}

// ---- which tokens are used by >N distinct surfaces (shared spine)
const usage = new Map();
for (const cls of Object.keys(report)) for (const [t] of report[cls].vars) usage.set(t, (usage.get(t) || 0) + 1);
log('\n=== tokens shared across >=4 probed surfaces (design spine) ===');
log([...usage.entries()].filter((e) => e[1] >= 4).sort((a, b) => b[1] - a[1]).map((e) => `${e[0]}(${e[1]})`).join(' '));

// ---- glass blockers: any backdrop-filter / transparency on these surfaces
log('\n=== glass-relevant primitives per probed surface ===');
for (const cls of Object.keys(report)) {
  const hits = report[cls].rules ? rules.filter((r) => r.sel.includes('.' + cls)) : [];
  const bf = hits.filter((r) => /backdrop-filter/.test(r.own)).length;
  const tr = hits.filter((r) => /transparent|rgba\([^)]*,\s*0?\.\d+\)|hsla\(/.test(r.own)).length;
  const op = hits.filter((r) => /(?:^|;)\s*background(?:-color)?\s*:\s*(#|rgb|hsl)/.test(r.own)).length;
  log(`  .${cls}: backdrop-filter=${bf} semi-transparent=${tr} opaque-bg=${op}`);
}

fs.writeFileSync('D:/Zalo/reports/_r3_surfaces.txt', out.join('\n'), 'utf8');
fs.writeFileSync('D:/Zalo/reports/_r3_surfaces.json', JSON.stringify(report, null, 1), 'utf8');
