// R3 step 2b: surface token census for the corrected surface set.
//
// The first census (v1) keyed on class names guessed from the bundle's own strings;
// some roots (chat header, layout shell) do not exist under those names. This pass
// uses selectors that are actually present in the shipped stylesheet and records
// which CSS custom properties each surface's rules consume.
const fs = require('fs');

const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const css = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.css', 'latin1');
const LOG = 'D:/Zalo/reports/_r3_surfaces2.txt';
fs.writeFileSync(LOG, '');
const out = [];
const log = (...a) => { const l = a.map(String).join(' '); out.push(l); console.log(l); };

// top-level rule scanner (flat: the shipped CSS is minified and nesting-free apart
// from @media blocks, which we treat as transparent containers)
function rules() {
  const res = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const sel = css.slice(i, open).trim();
    const close = css.indexOf('}', open);
    if (close < 0) break;
    const body = css.slice(open + 1, close);
    res.push({ sel, body, at: i });
    i = close + 1;
    // skip `;` separators
    while (i < css.length && /[\s;]/.test(css[i])) i++;
  }
  return res;
}
const RULES = rules();
log(`parsed rules = ${RULES.length}`);

const SURFACES = [
  ['app shell / leftpanel', ['.leftpanel']],
  ['right panel', ['.rightpanel']],
  ['conversation list row', ['.conv-item', '.conv-item-title__name', '.conv-message', '.conv-item__avatar']],
  ['chat header (thread title)', ['.threadChat__title', '.threadChat__avatar']],
  ['message row wrapper', ['.chat-content', '.chat-message']],
  ['bubble container', ['.content-message-container']],
  ['date divider', ['.chat-date']],
  ['composer bar', ['.chat-box-bar', '.chat-box-input', '.chat-box-input__tools']],
  ['titlebar', ['.titlebar__title', '.titlebar__btns', '.titlebar']],
  ['context menu', ['.zmenu-item', '#zmenu']],
  ['modal dialog', ['.zl-modal__dialog', '.zl-modal__footer', '.zl-modal__body']],
];

const TOKEN_RE = /var\(\s*(--[A-Za-z0-9_-]+)/g;
const GLASS = {
  'backdrop-filter': /backdrop-filter\s*:\s*([^;}]+)/g,
  'filter:blur': /(?:^|;|\s)filter\s*:\s*[^;}]*blur\(/g,
};

function surfaceFor(selList) {
  const hit = RULES.filter((r) => selList.some((s) => new RegExp('(^|[\\s,>+~(])' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9_-])').test(r.sel)));
  const tokens = new Map();
  let semitransparent = 0, opaque = 0, blur = 0, bf = 0;
  for (const r of hit) {
    for (const m of r.body.matchAll(TOKEN_RE)) tokens.set(m[1], (tokens.get(m[1]) || 0) + 1);
    const rgba = (r.body.match(/rgba?\([^)]*\)/g) || []);
    for (const c of rgba) {
      const a = /rgba\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*([\d.]+)\s*\)/.exec(c);
      if (a && Number(a[1]) < 1) semitransparent++;
      else if (!a) opaque++;
    }
    if (/backdrop-filter/.test(r.body)) bf++;
    for (const m of r.body.matchAll(/(?:^|;|\s)filter\s*:\s*([^;}]+)/g)) if (m[1].includes('blur(')) blur++;
  }
  return { rules: hit.length, tokens, semitransparent, opaque, blur, bf };
}

log('\n=== surface -> token census (values that exist in shipped CSS) ===');
const found = {};
for (const [label, sels] of SURFACES) {
  const r = surfaceFor(sels);
  const toks = [...r.tokens.entries()].sort((a, b) => b[1] - a[1]);
  log(`\n## ${label}  rules=${r.rules}  uniqVars=${toks.length}`);
  log(`   selectors probed: ${sels.join(' ')}`);
  log(`   vars: ${toks.map(([t, n]) => `${t}(${n})`).join(' ') || '(none)'}`);
  log(`   glass: backdrop-filter=${r.bf}  filter:blur=${r.blur}  semi-transparent-colors=${r.semitransparent}`);
  found[label] = { selectors: sels, rules: r.rules, vars: toks.map(([t, n]) => [t, n]), glass: { backdropFilter: r.bf, filterBlur: r.blur, semiTransparent: r.semitransparent } };
}

// design spine = tokens used by >= 4 surfaces
const counts = new Map();
for (const [, v] of Object.entries(found)) for (const [t] of v.vars) counts.set(t, (counts.get(t) || 0) + 1);
log('\n=== tokens shared across >= 4 probed surfaces (design spine) ===');
log([...counts.entries()].filter(([, n]) => n >= 4).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}(${n})`).join(' '));

fs.writeFileSync('D:/Zalo/reports/_r3_surfaces2.json', JSON.stringify(found, null, 1), 'utf8');
fs.writeFileSync(LOG, out.join('\n'), 'utf8');
log('\nwrote _r3_surfaces2.json');
