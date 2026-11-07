const fs = require('fs');
const acorn = require('acorn');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');

const modAt = 12278564, off = 12393315;
const fnAt = js.indexOf('function', modAt);
const node = acorn.parseExpressionAt(js, fnAt, { ecmaVersion: 2022 });
const body = node.type === 'SequenceExpression' ? node.expressions[0] : node;

// iterative walk with explicit ancestor stack; nearest named function/variable wins
const stack = [{ n: body, label: null }];
let best = null, visited = 0;
while (stack.length) {
  const { n, label } = stack.pop();
  if (!n || typeof n.type !== 'string') continue;
  visited++;
  let here = label;
  if (n.type === 'FunctionDeclaration' && n.id) here = n.id.name;
  if (n.type === 'ClassDeclaration' && n.id) here = n.id.name;
  if ((n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') && n.id) here = n.id.name;
  if (n.type === 'VariableDeclarator' && n.id && n.id.type === 'Identifier' && n.init && /Function|Class/.test(n.init.type)) here = n.id.name;
  const contains = n.start <= off && off < n.end;
  if (contains && here) {
    const size = n.end - n.start;
    if (!best || size < best.size) best = { name: here, start: n.start, end: n.end, size };
  }
  if (!contains) continue;   // prune subtrees that cannot contain off
  for (const k in n) {
    if (k === 'loc' || k === 'type') continue;
    const v = n[k];
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') stack.push({ n: c, label: here }); }
    else if (v && typeof v.type === 'string') stack.push({ n: v, label: here });
  }
}
console.log('visited', visited, 'best', best);
if (best) console.log(JSON.stringify(js.slice(best.start, best.start + 160)));
