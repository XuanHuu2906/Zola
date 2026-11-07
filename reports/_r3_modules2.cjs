const fs = require('fs');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const out = [];
const log = (...a) => { const l = a.map(String).join(' '); out.push(l); console.log(l); };

// ---------- prefix brace depth (string-literal aware, minimal: skips "..." and '...')
const N = js.length;
const depthAt = new Int32Array(N + 1);
{
  let d = 0, q = 0;
  for (let i = 0; i < N; i++) {
    depthAt[i] = d;
    const c = js.charCodeAt(i);
    if (q) {
      if (c === 92) { i++; depthAt[i] = d; continue; }   // backslash escape
      if (c === q) q = 0;
      continue;
    }
    if (c === 34 || c === 39 || c === 96) { q = c; continue; }  // " ' `
    if (c === 123) d++;
    else if (c === 125) d--;
  }
  depthAt[N] = d;
}
log(`bundle code units = ${N}`);

// ---------- candidate module entries: key:function(e,t,n){ at a stable depth
const RE = /([A-Za-z0-9_$+\/]{2,24}):function\(([a-z]),([a-z]),?([a-z])?\)\{/g;
const cands = [];
let m;
while ((m = RE.exec(js))) cands.push({ key: m[1], at: m.index, d: depthAt[m.index] });

const hist = {};
for (const c of cands) hist[c.d] = (hist[c.d] || 0) + 1;
log('candidate depth histogram: ' + Object.entries(hist).sort((a, b) => a[0] - b[0]).map((e) => `d${e[0]}=${e[1]}`).join(' '));

const MOD_DEPTH = Number(process.argv[2] ?? 2);
const mods = cands.filter((c) => c.d === MOD_DEPTH);
log(`module-map candidates at depth ${MOD_DEPTH}: ${mods.length}`);
log('first 8 keys: ' + mods.slice(0, 8).map((x) => x.key + '@' + x.at).join(' '));

// ---------- module end via depth
function endOf(at) {
  const d0 = depthAt[at];
  for (let i = at; i < N; i++) if (depthAt[i] === d0 && js[i] === '}') return i;
  return N;
}

// ---------- verify known keys
const known = ['TmDO', 'euSg', 'B5Cg', 'iwo6', 'xPHB', 'HuPi', 'CYG6', 'RFxn', 'iKSP', 'KCaC', 'W0O7', 'nahq', 'j6F3'];
log('\n=== known keys at this depth ===');
const idx = new Map();
for (const k of known) {
  const hits = mods.filter((x) => x.key === k);
  idx.set(k, hits);
  log(`  ${k}: ${hits.length ? hits.map((h) => '@' + h.at).join(',') : 'MISSING'}`);
}

// ---------- map offset -> module
function moduleFor(off) {
  let lo = 0, hi = mods.length - 1, best = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (mods[mid].at <= off) { best = mid; lo = mid + 1; } else hi = mid - 1; }
  if (best < 0) return null;
  const end = endOf(mods[best].at);
  return off <= end ? { key: mods[best].key, at: mods[best].at, end } : { key: mods[best].key, at: mods[best].at, end, outside: true };
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

log('\n=== surface class literal -> module (depth-verified) ===');
const found = {};
for (const [label, needle] of NEEDLES) {
  const offs = [];
  let i = -1;
  while ((i = js.indexOf(needle, i + 1)) >= 0 && offs.length < 8) offs.push(i);
  const modsHit = [...new Set(offs.map((o) => { const x = moduleFor(o); return x ? x.key + '@' + x.at : '?'; }))];
  log(`\n## ${label} ("${needle}") occ=${offs.length} modules=${modsHit.join(', ')}`);
  for (const o of offs.slice(0, 3)) {
    const x = moduleFor(o);
    log(`   @${o} -> ${x ? x.key : '?'} @${x ? x.at : '?'}${x && x.outside ? ' OUTSIDE' : ''}`);
  }
  found[label] = { needle, offs, modules: modsHit };
}

fs.writeFileSync('D:/Zalo/reports/_r3_modules2.txt', out.join('\n'), 'utf8');
fs.writeFileSync('D:/Zalo/reports/_r3_modules2.json', JSON.stringify({ MOD_DEPTH, modCount: mods.length, found }, null, 1), 'utf8');
