const fs = require('fs');
const acorn = require('acorn');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');

const CAND_RE = /[,{]\s*"?([A-Za-z0-9_$+\/]{1,30})"?\s*:\s*function\(([a-z]),([a-z]),([a-z])\)\{/g;
CAND_RE.lastIndex = 0;
let m;
const cands = [];
while ((m = CAND_RE.exec(js))) {
  const fnAt = m.index + m[0].indexOf('function');
  cands.push({ key: m[1], at: m.index + 1, fnAt });
}
const tgt = cands.find((c) => c.key === 'euSg');
console.log('euSg candidate:', tgt);
try {
  const node = acorn.parseExpressionAt(js, tgt.fnAt, { ecmaVersion: 2022 });
  console.log('node.type', node.type, 'end', node.end, 'char', JSON.stringify(js[node.end - 1]));
} catch (e) {
  console.log('ERR', e.message, 'at', e.pos);
  const p = typeof e.pos === 'number' ? e.pos : tgt.fnAt + 2000;
  console.log('context:', JSON.stringify(js.slice(p - 250, p + 250)));
}
