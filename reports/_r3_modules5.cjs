// R3 step 3 (v5): local module-body verification.
//
// Whole-file brace depth is unreliable on this bundle (acorn's regex/division
// ambiguity drifts the global counter), so instead we take each surface needle,
// walk backwards to candidate `Key:function(a,b,c){` module starts, and verify
// each candidate *locally* by tokenizing only its own body with acorn.
//
// Module-start discriminator (all three must hold):
//   * key charset [A-Za-z0-9_$+/]{2,24}
//   * exactly three single-letter parameters
//   * preceded by `,` (a sibling property of the webpack module map)
const fs = require('fs');
const acorn = require('acorn');

const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const LOG = 'D:/Zalo/reports/_r3_modules5.txt';
fs.writeFileSync(LOG, '');
const log = (...a) => { const l = a.map(String).join(' '); console.log(l); fs.appendFileSync(LOG, l + '\n'); };

log(`bundle code units = ${js.length}`);

const CAND_RE = /,([A-Za-z0-9_$+\/]{2,24}):function\(([a-z]),([a-z]),([a-z])\)\{/g;

// ---- verify one candidate: tokenize its body locally, return close offset or null
function verifyBody(openBraceAt) {
  const sub = js.slice(openBraceAt);
  const tok = acorn.tokenizer(sub, { ecmaVersion: 2022 });
  let depth = 0;
  const center = sub.length / 2 | 0;
  for (let guard = 0; guard < 4_000_000; guard++) {
    let t;
    try { t = tok.getToken(); } catch (e) { return null; }
    if (t.type.label === 'eof') return null;
    if (t.type.label === '{') depth++;
    else if (t.type.label === '}') {
      depth--;
      if (depth === 0) return openBraceAt + t.start;
    }
    if (t.end >= sub.length) return null;
  }
  return null;
}

// ---- enumerate all candidates once
const cands = [];
{
  CAND_RE.lastIndex = 0;
  let m;
  while ((m = CAND_RE.exec(js))) {
    cands.push({ key: m[1], at: m.index + 1, openAt: m.index + m[0].length - 1 });
  }
}
log(`structural module candidates = ${cands.length}`);

// ---- known-key sanity: do the known modules appear as candidates with verified bodies?
const KNOWN = ['TmDO', 'euSg', 'B5Cg', 'iwo6', 'xPHB', 'HuPi', 'CYG6', 'RFxn',
               'iKSP', 'KCaC', 'W0O7', 'nahq', 'j6F3', 'Fuol', 'I9t9', 'GQ8g', 'y1FZ', 'FCc4'];
log('\n=== known module keys (candidate + local body verification) ===');
let verified = 0;
for (const k of KNOWN) {
  const hits = cands.filter((c) => c.key === k);
  if (!hits.length) { log(`  ${k}: MISSING`); continue; }
  const parts = hits.map((h) => {
    const end = verifyBody(h.openAt);
    if (end !== null) verified++;
    return `@${h.at} ${end === null ? 'UNVERIFIED' : `len=${end - h.at}`}`;
  });
  log(`  ${k}: ${parts.join(', ')}`);
}
log(`known keys with a locally verified body: ${verified}/${KNOWN.length}`);

// ---- offset -> candidate module
function moduleFor(off) {
  // walk backwards through candidates; verify only the nearest few
  let idx = cands.length - 1;
  let lo = 0, hi = cands.length - 1, best = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (cands[mid].at <= off) { best = mid; lo = mid + 1; } else hi = mid - 1; }
  if (best < 0) return null;
  let tried = 0;
  for (let k = best; k >= 0 && tried < 6; k--, tried++) {
    const c = cands[k];
    const end = verifyBody(c.openAt);
    if (end !== null && off > c.openAt && off < end) return { ...c, end, verified: true };
  }
  const c = cands[best];
  return { ...c, end: null, verified: false };
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

log('\n=== surface class literal -> enclosing module ===');
const found = {};
for (const [label, needle] of NEEDLES) {
  const offs = [];
  let i = -1;
  while ((i = js.indexOf(needle, i + 1)) >= 0 && offs.length < 8) offs.push(i);
  const rows = offs.map((o) => ({ o, r: moduleFor(o) }));
  const uniq = [...new Set(rows.map((x) => x.r ? `${x.r.key}@${x.r.at}${x.r.verified ? '' : '(?)'}` : '?'))];
  log(`\n## ${label} ("${needle}") occ=${offs.length}`);
  log(`   modules: ${uniq.join(' | ') || '(none)'}`);
  for (const x of rows.slice(0, 4)) {
    log(`   @${x.o} -> ${x.r ? x.r.key : '?'} @${x.r ? x.r.at : '?'} ${x.r?.verified ? 'VERIFIED' : 'UNVERIFIED'}`);
  }
  found[label] = { needle, count: offs.length, modules: uniq, rows: rows.map((x) => ({ off: x.o, key: x.r?.key ?? null, at: x.r?.at ?? null, end: x.r?.end ?? null, verified: x.r?.verified ?? false })) };
}

fs.writeFileSync('D:/Zalo/reports/_r3_modules5.json', JSON.stringify({ bundleCodeUnits: js.length, candidates: cands.length, verifiedKnown: verified, known: KNOWN, found }, null, 1), 'utf8');
log('\nwrote _r3_modules5.json');
