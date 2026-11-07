const fs = require('fs');
const acorn = require('acorn');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');

const modAt = 12278564;
const fnAt = js.indexOf('function', modAt);
console.log('fnAt', fnAt, JSON.stringify(js.slice(fnAt, fnAt + 80)));
let node;
try {
  node = acorn.parseExpressionAt(js, fnAt, { ecmaVersion: 2022 });
  console.log('ok type', node.type, 'end', node.end);
} catch (e) {
  console.log('ERR', e.message, 'pos', e.pos);
  console.log(JSON.stringify(js.slice(e.pos - 250, e.pos + 250)));
  process.exit(0);
}
let body = node.type === 'SequenceExpression' ? node.expressions[0] : node;
console.log('body type', body.type, body.start, body.end);

// count nodes with names quickly
let n = 0, named = 0, depthMax = 0;
const stack = [[body, 0]];
while (stack.length) {
  const [nd, d] = stack.pop();
  if (!nd || typeof nd.type !== 'string') continue;
  n++; depthMax = Math.max(depthMax, d);
  if (nd.id && nd.id.name) named++;
  for (const k in nd) {
    if (k === 'loc' || k === 'type') continue;
    const v = nd[k];
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') stack.push([c, d + 1]); }
    else if (v && typeof v.type === 'string') stack.push([v, d + 1]);
  }
}
console.log('nodes', n, 'named', named, 'depthMax', depthMax);
