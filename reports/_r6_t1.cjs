const fs = require('fs'), path = require('path');
const acorn = require('acorn');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const FILE = process.argv[2] || path.join(ROOT, 'main-dist/preload-render.js');
const OUTFILE = process.argv[3] || '_r6_ast_contract2';
const src = fs.readFileSync(FILE, 'utf8');
const out = [];
const log = (...a) => out.push(a.join(' '));

let ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'script', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true });
// Webpack bundles wrap everything in a SequenceExpression statement; unwrap to a body list.
if (ast.body.length === 1 && ast.body[0].type === 'ExpressionStatement' && ast.body[0].expression.type === 'SequenceExpression') {
  const exprs = ast.body[0].expression.expressions;
  ast = { type: 'Program', start: 0, end: src.length, body: exprs.map(e => ({ type: 'ExpressionStatement', expression: e, start: e.start, end: e.end })) };
}

// ---- namespaces ----
const namespaces = [];
const seen = new Set();
(function visit(node) {
  if (node.type === 'AssignmentExpression' && node.operator === '=') {
    const L = node.left, R = node.right;
    if (L.type === 'MemberExpression' && L.object.type === 'Identifier' && L.object.name === 'window') {
      const ns = L.computed ? (L.property.type === 'Literal' ? L.property.value : null) : (L.property.type === 'Identifier' ? L.property.name : null);
      if (ns && ns.startsWith('$') && !seen.has(ns)) {
        let mapId = null, entries = null;
        if (R.type === 'CallExpression' && R.arguments[0]) {
          const a0 = R.arguments[0];
          if (a0.type === 'Identifier') mapId = a0.name;
          else if (a0.type === 'MemberExpression' && !a0.computed && a0.object.type === 'Identifier') mapId = a0.object.name;
          if (mapId) entries = null;
        }
        seen.add(ns);
        namespaces.push({ ns, mapId, entries });
      }
    }
  }
  for (const k of Object.keys(node)) {
    if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'range') continue;
    const v = node[k];
    if (Array.isArray(v)) for (const c of v) if (c && typeof c.type === 'string') visit(c);
    else if (v && typeof v.type === 'string') visit(v);
  }
})(ast);

log(`file: ${FILE}`);
log(`namespaces: ${namespaces.length}, with contract: ${namespaces.filter(n => n.entries).length}`);
const modeCount = {};
let unresolved = 0, resolved = 0;

log('');
log('=== NAMESPACE TABLE ===');
for (const n of namespaces) {
  const cnt = n.entries ? n.entries.length : 0;
  log(`${n.ns.padEnd(22)} ${String(n.mapId).padEnd(6)} ${n.entries ? cnt + ' methods' : 'NO-DESCRIPTOR-MAP'}`);
}

log('');
log('=== FULL CONTRACT ===');
for (const n of namespaces) {
  if (!n.entries) continue;
  log('');
  log(`## ${n.ns}`);
  for (const e of n.entries) {
    modeCount[e.mode] = (modeCount[e.mode] || 0) + 1;
    if (e.apiKey) resolved++; else unresolved++;
    log(`   ${e.method.padEnd(38)} ${String(e.apiKey || ('?' + e.enumRef + '.' + e.keyRef)).padEnd(58)} ${e.mode}`);
  }
}
log('');
log(`resolved channels: ${resolved}, unresolved: ${unresolved}`);
log('=== MODES ===');
for (const [k, v] of Object.entries(modeCount).sort((a, b) => b[1] - a[1])) log(`  ${k.padEnd(14)} ${v}`);

fs.writeFileSync(path.join(__dirname, OUTFILE + '.txt'), out.join('\n') + '\n');
fs.writeFileSync(path.join(__dirname, OUTFILE + '.json'), JSON.stringify({ src: FILE, namespaces }, null, 1));
console.log(out.join('\n'));
