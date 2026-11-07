// R3 step 3 (v6): verify every structural candidate once, build containment intervals.
//
// The webpack module map is `{ Key:function(e,t,n){...}, ... }`. Regexes inside
// handler objects produce look-alike `name:function(`${...})` entries, so every
// candidate is verified locally with acorn (tokenize only its own body) and only
// verified bodies become containment intervals.
const fs = require('fs');
const acorn = require('acorn');

const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const LOG = 'D:/Zalo/reports/_r3_modules6.txt';
fs.writeFileSync(LOG, '');
const log = (...a) => { const l = a.map(String).join(' '); console.log(l); fs.appendFileSync(LOG, l + '\n'); };

log(`bundle code units = ${js.length}`);

// webpack keys are unquoted when identifier-safe and double-quoted otherwise
// (e.g. `"Zb+t"`, `"9Tg7"`), so both forms must match.
const CAND_RE = /[,{]\s*"?([A-Za-z0-9_$+\/]{1,30})"?\s*:\s*function\(([a-z]),([a-z]),([a-z])\)\{/g;
const cands = [];
{
  CAND_RE.lastIndex = 0;
  let m;
  while ((m = CAND_RE.exec(js))) cands.push({ key: m[1], at: m.index + 1, openAt: m.index + m[0].length - 1 });
}
log(`structural candidates = ${cands.length}`);

function bodyEnd(openAt) {
  const sub = js.slice(openAt);
  const tok = acorn.tokenizer(sub, { ecmaVersion: 2022 });
  let depth = 0, n = 0;
  for (;;) {
    let t;
    try { t = tok.getToken(); } catch (e) { return null; }
    n++;
    const label = t.type.label;
    if (label === 'eof') return null;
    if (label === '{') depth++;
    else if (label === '}') { depth--; if (depth === 0) return openAt + t.start; }
    if (n > 12_000_000) return null;
  }
}

const ivs = [];
const t0 = Date.now();
for (const c of cands) {
  const end = bodyEnd(c.openAt);
  if (end !== null && end > c.openAt) ivs.push({ key: c.key, at: c.at, openAt: c.openAt, end });
}
ivs.sort((a, b) => a.at - b.at);
log(`verified bodies = ${ivs.length}/${cands.length} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// ---- known-key check
const KNOWN = ['TmDO', 'euSg', 'B5Cg', 'iwo6', 'xPHB', 'HuPi', 'CYG6', 'RFxn',
               'iKSP', 'KCaC', 'W0O7', 'nahq', 'j6F3', 'Fuol', 'I9t9', 'GQ8g', 'y1FZ', 'FCc4'];
log('\n=== known module keys ===');
for (const k of KNOWN) {
  const hit = ivs.find((v) => v.key === k);
  log(`  ${k}: ${hit ? `@${hit.at} len=${hit.end - hit.at}` : 'MISSING'}`);
}

// ---- innermost verified module containing an offset
function moduleFor(off) {
  let lo = 0, hi = ivs.length - 1, best = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (ivs[mid].at <= off) { best = mid; lo = mid + 1; } else hi = mid - 1; }
  let pick = null;
  for (let k = best; k >= 0; k--) {
    const v = ivs[k];
    if (v.end < off) continue;
    if (off > v.openAt && off < v.end) {
      if (!pick || v.at > pick.at) pick = v;   // innermost
    }
    if (best - k > 400) break;
  }
  return pick;
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
  ['leftpanel', 'className:"leftpanel'],
];

log('\n=== surface class literal -> innermost verified module ===');
const found = {};
for (const [label, needle] of NEEDLES) {
  const offs = [];
  let i = -1;
  while ((i = js.indexOf(needle, i + 1)) >= 0 && offs.length < 10) offs.push(i);
  const rows = offs.map((o) => ({ o, m: moduleFor(o) }));
  const uniq = [...new Set(rows.map((x) => x.m ? `${x.m.key}@${x.m.at}` : 'NONE'))];
  log(`\n## ${label} ("${needle}") occ=${offs.length}`);
  log(`   modules: ${uniq.join(' | ')}`);
  for (const x of rows.slice(0, 5)) {
    log(`   @${x.o} -> ${x.m ? `${x.m.key}@${x.m.at} len=${x.m.end - x.m.at}` : 'NO VERIFIED MODULE'}`);
  }
  found[label] = { needle, count: offs.length, modules: uniq, rows: rows.map((x) => ({ off: x.o, key: x.m?.key ?? null, at: x.m?.at ?? null, len: x.m ? x.m.end - x.m.at : null })) };
}

fs.writeFileSync('D:/Zalo/reports/_r3_modules6.json', JSON.stringify({ bundleCodeUnits: js.length, candidates: cands.length, verified: ivs.length, known: KNOWN, found }, null, 1), 'utf8');
fs.writeFileSync('D:/Zalo/reports/_r3_modules6_intervals.json', JSON.stringify(ivs.map((v) => [v.key, v.at, v.end])), 'utf8');
log('\nwrote _r3_modules6.json + _r3_modules6_intervals.json');
