const fs = require('fs');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const out = [];
const log = (...a) => { const l = a.map(String).join(' '); out.push(l); console.log(l); };

// Build a module index by scanning "Key:function(" at top level of the webpack map.
// Then map each offset to the nearest preceding module start, verifying the offset
// falls inside that module's brace-balanced body.
const MOD_RE = /[{,]([A-Za-z0-9_$+\/]{3,24}):function\(/g;
const mods = [];
let m;
while ((m = MOD_RE.exec(js))) mods.push({ key: m[1], at: m.index, fnAt: m.index + m[0].length });
log(`module entries indexed = ${mods.length}`);

function moduleEnd(start) {
  let d = 0, j = js.indexOf('{', js.indexOf('function(', start));
  for (; j < js.length; j++) {
    if (js[j] === '{') d++;
    else if (js[j] === '}') { d--; if (d === 0) return j; }
  }
  return js.length;
}

// binary search nearest preceding module
function moduleFor(off) {
  let lo = 0, hi = mods.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (mods[mid].at <= off) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (best < 0) return null;
  // walk forward a few to find the one whose body contains off
  for (let k = best; k >= Math.max(0, best - 4); k--) {
    const end = moduleEnd(mods[k].at);
    if (off > mods[k].at && off < end) return { key: mods[k].key, at: mods[k].at, end };
  }
  return { key: mods[best].key, at: mods[best].at, end: null, uncertain: true };
}

// ---- weave key component class literals to their module
const NEEDLES = [
  ['conv-item', 'className:"conv-item"'],
  ['conv-item-title__name', 'conv-item-title__name'],
  ['conv-message', 'conv-message'],
  ['chat-message', 'className:"chat-message"'],
  ['chat-box-bar', 'chat-box-bar'],
  ['chat-input-v2', 'chat-input-v2'],
  ['content-message-container', 'content-message-container'],
  ['titlebar__btns', 'titlebar__btns'],
  ['zmenu-item', 'className:"zmenu-item"'],
  ['zl-modal', 'zl-modal'],
  ['chat-date', 'chat-date'],
  ['chat-box-input__tools', 'chat-box-input__tools__btn'],
];

log('\n=== component class literal -> enclosing webpack module ===');
const found = {};
for (const [label, needle] of NEEDLES) {
  const offs = [];
  let i = -1;
  while ((i = js.indexOf(needle, i + 1)) >= 0 && offs.length < 6) offs.push(i);
  log(`\n## ${label}  ("${needle}")  occurrences=${offs.length}`);
  for (const off of offs) {
    const mod = moduleFor(off);
    log(`   @${off}  module=${mod ? mod.key : '?'}@${mod ? mod.at : '?'}${mod && mod.uncertain ? ' (uncertain)' : ''}`);
    log('     ' + js.slice(Math.max(0, off - 150), off + 120).replace(/\n/g, '\\n'));
  }
  found[label] = offs.map((off) => ({ off, mod: moduleFor(off) }));
}

// ---- cross-check: known modules from R1 must be re-found at these offsets
log('\n=== sanity: known module key offsets ===');
for (const k of ['TmDO', 'euSg', 'B5Cg', 'iwo6', 'xPHB', 'HuPi', 'CYG6', 'RFxn', 'iKSP', 'KCaC', 'W0O7', 'nahq', 'j6F3']) {
  const hit = mods.find((x) => x.key === k);
  log(`  ${k}: ${hit ? '@' + hit.at : 'NOT FOUND'}`);
}

fs.writeFileSync('D:/Zalo/reports/_r3_modules.txt', out.join('\n'), 'utf8');
fs.writeFileSync('D:/Zalo/reports/_r3_modules.json', JSON.stringify(found, null, 1), 'utf8');
