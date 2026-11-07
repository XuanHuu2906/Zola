const fs = require('fs');
const acorn = require('acorn');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const out = [];
const log = (...a) => { const l = a.map(String).join(' '); out.push(l); console.log(l); };

const tok = acorn.tokenizer(js, { ecmaVersion: 2022, allowHashBang: true });
let depth = 0, prevName = null, prevStart = -1, pendingName = null;
const mods = [];
let n = 0;
const t0 = Date.now();
for (;;) {
  let t;
  try { t = tok.getToken(); } catch (e) { log(`tokenizer stopped @${tok.pos}: ${e.message}`); break; }
  n++;
  const type = t.type;
  if (type.label === '{') depth++;
  else if (type.label === '}') depth--;
  if (type.label === 'name') { pendingName = { name: t.value, at: t.start, d: depth }; continue; }
  if (type.label === ':' && pendingName) { prevName = pendingName; prevStart = t.start; pendingName = null; continue; }
  if (type.keyword === 'function' && prevName) {
    mods.push({ key: prevName.name, at: prevName.at, d: prevName.d });
    prevName = null;
  } else if (type.label !== ':' && type.label !== 'name') { pendingName = null; prevName = null; }
  if (n % 2000000 === 0) log(`  ...${n} tokens, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
log(`tokens=${n} in ${((Date.now() - t0) / 1000).toFixed(1)}s   name:function entries=${mods.length}`);

const hist = {};
for (const m of mods) hist[m.d] = (hist[m.d] || 0) + 1;
log('depth histogram: ' + Object.entries(hist).sort((a, b) => a[0] - b[0]).map((e) => `d${e[0]}=${e[1]}`).join(' '));

log('\n=== known keys ===');
const KNOWN = ['TmDO', 'euSg', 'B5Cg', 'iwo6', 'xPHB', 'HuPi', 'CYG6', 'RFxn', 'iKSP', 'KCaC', 'W0O7', 'nahq', 'j6F3', 'Fuol', 'I9t9', 'GQ8g', 'y1FZ', 'FCc4'];
for (const k of KNOWN) {
  const hits = mods.filter((m) => m.key === k);
  log(`  ${k}: ${hits.length ? hits.map((h) => `@${h.at}(d${h.d})`).join(',') : 'MISSING'}`);
}

const depths = Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 5);
log('\ntop depths by count: ' + depths.map((e) => `d${e[0]}=${e[1]}`).join(' '));
fs.writeFileSync('D:/Zalo/reports/_r3_tokens.json', JSON.stringify(mods.map((m) => [m.key, m.at, m.d])), 'utf8');
fs.writeFileSync('D:/Zalo/reports/_r3_tokenize.txt', out.join('\n'), 'utf8');
