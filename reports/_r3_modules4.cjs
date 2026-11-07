// R3 step 3 (corrected): webpack module attribution via acorn tokenizer.
// Regex-safe: acorn emits `regexp` tokens, so `/}/` and `/"/` cannot corrupt depth.
//
// Pass 1 tokenizes once, recording for every token its start offset and the brace
// depth *before* it. A module entry is `name : function (...) { ... }`; the body
// opens at the first `{` token after the `function` keyword (defaults inside the
// parameter list are already inside that scan) and closes when depth returns.
const fs = require('fs');
const acorn = require('acorn');

const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const LOG = 'D:/Zalo/reports/_r3_modules4.txt';
fs.writeFileSync(LOG, '');
const log = (...a) => { const l = a.map(String).join(' '); console.log(l); fs.appendFileSync(LOG, l + '\n'); };

log(`bundle code units = ${js.length}`);

// ---- single structural pass: token stream -> ordered brace events + key candidates
const tok = acorn.tokenizer(js, { ecmaVersion: 2022, allowHashBang: true });
let depth = 0;
let n = 0;
const t0 = Date.now();

// every `{` token, ordered, with the position of its matching `}`
const opens = [];
const matchEnd = new Map();   // openOffset -> closeOffset
const stack = [];
// candidate `key:function` sites
const cands = [];
let pendingName = null;
let prevName = null;

for (;;) {
  let t;
  try { t = tok.getToken(); } catch (e) { log(`tokenizer stopped @${tok.pos}: ${e.message}`); break; }
  n++;
  const label = t.type.label;

  if (label === '{') { opens.push({ pos: t.start, d: depth }); stack.push(t.start); depth++; pendingName = null; prevName = null; continue; }
  if (label === '}') { depth--; const o = stack.pop(); if (o !== undefined) matchEnd.set(o, t.start); pendingName = null; prevName = null; continue; }
  if (label === 'name') { pendingName = { name: t.value, at: t.start, d: depth }; prevName = null; continue; }
  if (label === ':') { if (pendingName) { prevName = pendingName; pendingName = null; } continue; }
  if (t.type.keyword === 'function') {
    if (prevName) cands.push({ key: prevName.name, at: prevName.at, d: prevName.d, fnAt: t.start });
    prevName = null; pendingName = null;
    continue;
  }
  pendingName = null; prevName = null;

  if (n % 2000000 === 0) log(`  ...${n} tokens, depth=${depth}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
log(`tokens=${n} in ${((Date.now() - t0) / 1000).toFixed(1)}s  final depth=${depth}  open-braces=${opens.length}  key:function candidates=${cands.length}`);

// ---- attach body extents: first `{` strictly after fnAt, close via its matcher
let bi = 0;
for (const c of cands) {
  while (bi < opens.length && opens[bi].pos < c.fnAt) bi++;
  const b = opens[bi];
  if (!b) { c.bodyStart = null; c.bodyEnd = null; continue; }
  c.bodyStart = b.pos;
  c.bodyEnd = matchEnd.has(b.pos) ? matchEnd.get(b.pos) : js.length;
}

const hist = {};
for (const c of cands) hist[c.d] = (hist[c.d] || 0) + 1;
log('candidate depth histogram: ' + Object.entries(hist).sort((a, b) => a[0] - b[0]).map((e) => `d${e[0]}=${e[1]}`).join(' '));

// ---- verify known keys
const KNOWN = ['TmDO', 'euSg', 'B5Cg', 'iwo6', 'xPHB', 'HuPi', 'CYG6', 'RFxn',
               'iKSP', 'KCaC', 'W0O7', 'nahq', 'j6F3', 'Fuol', 'I9t9', 'GQ8g', 'y1FZ', 'FCc4'];
log('\n=== known module keys ===');
const knownDepths = {};
for (const k of KNOWN) {
  const hits = cands.filter((c) => c.key === k);
  for (const h of hits) knownDepths[h.d] = (knownDepths[h.d] || 0) + 1;
  log(`  ${k}: ${hits.length ? hits.map((h) => `@${h.at}(d${h.d},len=${h.bodyEnd - h.at})`).join(',') : 'MISSING'}`);
}
const modDepth = Object.entries(knownDepths).sort((a, b) => b[1] - a[1])[0]?.[0];
log(`\nvoted module-map depth = ${modDepth}  (votes: ${JSON.stringify(knownDepths)})`);

const mods = cands.filter((c) => String(c.d) === String(modDepth)).sort((a, b) => a.at - b.at);
log(`modules at depth ${modDepth}: ${mods.length}`);

// ---- offset -> module
function moduleFor(off) {
  let lo = 0, hi = mods.length - 1, best = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (mods[mid].at <= off) { best = mid; lo = mid + 1; } else hi = mid - 1; }
  if (best < 0) return null;
  const m = mods[best];
  return { mod: m, inside: off >= m.bodyStart && off <= m.bodyEnd };
}

const NEEDLES = [
  ['conv list row', 'className:"conv-item'],
  ['conv preview text', 'conv-message truncate'],
  ['conv title name', 'conv-item-title__name'],
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

log('\n=== surface class literal -> enclosing module (acorn-verified) ===');
const found = {};
for (const [label, needle] of NEEDLES) {
  const offs = [];
  let i = -1;
  while ((i = js.indexOf(needle, i + 1)) >= 0 && offs.length < 8) offs.push(i);
  const rows = offs.map((o) => ({ o, r: moduleFor(o) }));
  const uniq = [...new Set(rows.map((x) => x.r ? `${x.r.mod.key}@${x.r.mod.at}` : '?'))];
  log(`\n## ${label} ("${needle}") occ=${offs.length}`);
  log(`   modules: ${uniq.join(' | ') || '(none)'}`);
  for (const x of rows.slice(0, 4)) {
    const m = x.r?.mod;
    log(`   @${x.o} -> ${m ? m.key : '?'} @${m ? m.at : '?'} d${m ? m.d : '?'} ${x.r?.inside ? 'IN-BODY' : 'OUTSIDE'}`);
  }
  found[label] = { needle, count: offs.length, modules: uniq, rows: rows.map((x) => ({ off: x.o, key: x.r?.mod.key ?? null, at: x.r?.mod.at ?? null, inside: x.r?.inside ?? false })) };
}

fs.writeFileSync('D:/Zalo/reports/_r3_modules4.json', JSON.stringify({ bundleCodeUnits: js.length, tokenCount: n, moduleDepth: modDepth, moduleCount: mods.length, known: KNOWN, found }, null, 1), 'utf8');
fs.writeFileSync('D:/Zalo/reports/_r3_modules4_map.json', JSON.stringify(mods.map((m) => [m.key, m.at, m.bodyEnd])), 'utf8');
log('\nwrote _r3_modules4.json and _r3_modules4_map.json');
