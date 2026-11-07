// R3 step 3 (v7): real AST parse, not tokenizer heuristics.
//
// v4/v5/v6 relied on acorn.tokenizer, which has no parse goal context and so reads
// a regex-opening `/` as division; any module body containing a regex therefore
// ended early, which is what produced the "no module contains the conversation
// list" result. Here each candidate is parsed as a complete FunctionExpression
// with acorn.parseExpressionAt, so acorn's own goal context decides `/` and the
// returned node.end is the true body-closing brace.
const fs = require('fs');
const acorn = require('acorn');

const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const LOG = 'D:/Zalo/reports/_r3_modules7.txt';
fs.writeFileSync(LOG, '');
const log = (...a) => { const l = a.map(String).join(' '); console.log(l); fs.appendFileSync(LOG, l + '\n'); };

log(`bundle code units = ${js.length}`);

const CAND_RE = /[,{]\s*"?([A-Za-z0-9_$+\/]{1,30})"?\s*:\s*function\(([a-z]),([a-z]),([a-z])\)\{/g;
const cands = [];
{
  CAND_RE.lastIndex = 0;
  let m;
  while ((m = CAND_RE.exec(js))) {
    const fnAt = m.index + m[0].indexOf('function');
    cands.push({ key: m[1], at: m.index + 1, fnAt, openAt: m.index + m[0].length - 1 });
  }
}
log(`structural candidates = ${cands.length}`);

function bodyEnd(c) {
  try {
    let node = acorn.parseExpressionAt(js, c.fnAt, { ecmaVersion: 2022, allowHashBang: true });
    // The sibling `,` after the closing brace makes acorn fold the whole thing into
    // a SequenceExpression; the module body is its first operand.
    if (node && node.type === 'SequenceExpression') node = node.expressions[0];
    if (!node || node.type !== 'FunctionExpression') return null;
    if (!node.body || node.body.type !== 'BlockStatement') return null;
    if (node.body.start !== c.openAt) return null;   // parsed a different function
    return node.body.end - 1;
  } catch (e) {
    return null;
  }
}

const ivs = [];
const fails = [];
const t0 = Date.now();
for (const c of cands) {
  const end = bodyEnd(c);
  if (end !== null) ivs.push({ key: c.key, at: c.at, openAt: c.openAt, end });
  else fails.push(c);
}
ivs.sort((a, b) => a.at - b.at);
log(`verified bodies = ${ivs.length}/${cands.length} (parse fails ${fails.length}) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const KNOWN = ['TmDO', 'euSg', 'B5Cg', 'iwo6', 'xPHB', 'HuPi', 'CYG6', 'RFxn',
               'iKSP', 'KCaC', 'W0O7', 'nahq', 'j6F3', 'Fuol', 'I9t9', 'GQ8g', 'y1FZ', 'FCc4'];
log('\n=== known module keys ===');
for (const k of KNOWN) {
  const hit = ivs.find((v) => v.key === k);
  log(`  ${k}: ${hit ? `@${hit.at} len=${hit.end - hit.at}` : 'MISSING'}`);
}

function moduleFor(off) {
  let lo = 0, hi = ivs.length - 1, best = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (ivs[mid].at <= off) { best = mid; lo = mid + 1; } else hi = mid - 1; }
  let pick = null;
  for (let k = best; k >= 0; k--) {
    const v = ivs[k];
    if (off > v.openAt && off < v.end) { if (!pick || v.at > pick.at) pick = v; }
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

log('\n=== surface class literal -> innermost verified module (AST) ===');
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

fs.writeFileSync('D:/Zalo/reports/_r3_modules7.json', JSON.stringify({ bundleCodeUnits: js.length, candidates: cands.length, verified: ivs.length, known: KNOWN, found }, null, 1), 'utf8');
fs.writeFileSync('D:/Zalo/reports/_r3_modules7_intervals.json', JSON.stringify(ivs.map((v) => [v.key, v.at, v.end])), 'utf8');
log('\nwrote _r3_modules7.json + _r3_modules7_intervals.json');
