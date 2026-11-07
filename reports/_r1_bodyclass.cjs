const fs = require('fs');
const p = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js';
const s = fs.readFileSync(p, 'latin1');
const out = [];
const log = (...a) => { const l = a.map(String).join(' '); out.push(l); console.log(l); };

function findAll(needle) {
  const r = [];
  let i = -1;
  while ((i = s.indexOf(needle, i + 1)) >= 0) r.push(i);
  return r;
}

for (const needle of [
  'document.body.classList',
  'body.classList',
  'documentElement.classList',
  'body.className',
  'data-theme',
]) {
  const hits = findAll(needle);
  log(`\n### ${needle}: ${hits.length} @ ${hits.slice(0, 20).join(',')}`);
  for (const h of hits.slice(0, 6)) log(`--- @${h} ---\n` + s.slice(h - 320, h + 320).replace(/\n/g, '\\n'));
}

// token count reconciliation
const tm = JSON.parse(fs.readFileSync('D:/Zalo/reports/_token_map_light.json', 'utf8'));
const rawTok = fs.readFileSync('D:/Zalo/reports/_colors_token_array.txt', 'utf8');
const toks = [...rawTok.matchAll(/"(--[A-Za-z0-9_-]+)"/g)].map((m) => m[1]);
const uniqTok = [...new Set(toks)];
log(`\n### counts: TOKEN_MAP=${tm.length} unique=${new Set(tm.map(t=>t.token)).size}  COLORS_TOKEN parsed=${toks.length} unique=${uniqTok.length}`);

const tmSet = new Set(tm.map((t) => t.token));
const ctSet = new Set(uniqTok);
const onlyTm = [...tmSet].filter((x) => !ctSet.has(x));
const onlyCt = [...ctSet].filter((x) => !tmSet.has(x));
log(`in TOKEN_MAP not COLORS_TOKEN (${onlyTm.length}): ${onlyTm.join(' ')}`);
log(`in COLORS_TOKEN not TOKEN_MAP (${onlyCt.length}): ${onlyCt.join(' ')}`);

// aliases referenced in compiled CSS but absent from JS COLORS_ALIAS
const aliases = new Set(tm.map((t) => t.alias).filter(Boolean));
log(`\naliases used by TOKEN_MAP (${aliases.size}): ${[...aliases].sort().join(' ')}`);
for (const extra of ['BLA', 'GR', 'PU', 'BG', 'BK']) {
  const re = new RegExp(`--${extra}[0-9]+:`, 'g');
  const n = (s.match(re) || []).length;
  log(`  alias ${extra}: ${n} css decls, in TOKEN_MAP=${aliases.has(extra)}`);
}

fs.writeFileSync('D:/Zalo/reports/_r1_bodyclass.txt', out.join('\n'), 'utf8');
