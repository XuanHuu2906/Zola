const fs = require('fs'), path = require('path');
const acorn = require('acorn');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const FILE = path.join(ROOT, 'main-dist/preload-render.js');
const src = fs.readFileSync(FILE, 'utf8');
const out = [];
const log = (...a) => out.push(a.join(' '));

const t0 = Date.now();
const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'script', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true });
log(`parsed in ${Date.now() - t0} ms`);

// --- generic walker ---
function* walk(node, parent) {
  yield [node, parent];
  for (const k of Object.keys(node)) {
    if (k === 'type' || k === 'start' || k === 'end') continue;
    const v = node[k];
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') yield* walk(c, node); }
    else if (v && typeof v.type === 'string') yield* walk(v, node);
  }
}

// helper: resolve literal string from node (string literal OR enum-defined member)
const strLit = n => (n && n.type === 'Literal' && typeof n.value === 'string') ? n.value : null;

// --- Pass 1: enum IIFEs `function(e){return e.X="str", ..., e}({})`
// Pattern: VariableDeclarator init = CallExpression(callee=FunctionExpression, args=[ObjectExpression{}])
const enums = new Map();       // varName -> Map(KEY -> value)
const enumAlias = new Map();   // memberNode mapping not needed; record by key name
{
  for (const [node] of walk(ast)) {
    if (node.type !== 'VariableDeclarator' || !node.init || !node.id || node.id.type !== 'Identifier') continue;
    const init = node.init;
    if (init.type !== 'CallExpression') continue;
    const callee = init.callee;
    if (!callee || (callee.type !== 'FunctionExpression' && callee.type !== 'ArrowFunctionExpression')) continue;
    let param = callee.params?.[0];
    if (!param || param.type !== 'Identifier') continue;
    const pname = param.name;
    // collect `e.KEY = "value"` within callee body via sequence/assignment
    const map = new Map();
    for (const [n] of walk(callee.body)) {
      if (n.type !== 'AssignmentExpression' || n.operator !== '=') continue;
      const L = n.left, R = n.right;
      if (L.type === 'MemberExpression' && !L.computed && L.object.type === 'Identifier' && L.object.name === pname && L.property.type === 'Identifier') {
        const v = strLit(R);
        if (v != null) map.set(L.property.name, v);
      }
    }
    if (map.size) enums.set(node.id.name, map);
  }
}
log(`enums resolved: ${enums.size}, total keys: ${[...enums.values()].reduce((a, m) => a + m.size, 0)}`);

// --- Pass 2: descriptor maps `var X = { method: { apiKey: ENUM.KEY, type: Mode.SOMETHING } }`
const descMaps = new Map(); // varName -> entries[]
{
  for (const [node] of walk(ast)) {
    if (node.type !== 'VariableDeclarator' || !node.init || !node.id || node.id.type !== 'Identifier') continue;
    if (node.init.type !== 'ObjectExpression') continue;
    const entries = [];
    let looksLikeDesc = false;
    for (const prop of node.init.properties) {
      if (prop.type !== 'Property' || prop.computed || prop.value.type !== 'ObjectExpression') continue;
      const obj = {};
      for (const p2 of prop.value.properties) {
        if (p2.type !== 'Property' || p2.computed || p2.key.type !== 'Identifier') continue;
        obj[p2.key.name] = p2.value;
      }
      if (!obj.apiKey || !obj.type) continue;
      looksLikeDesc = true;
      const methodName = prop.key.type === 'Identifier' ? prop.key.name : (prop.key.type === 'Literal' ? String(prop.key.value) : null);
      // apiKey: <Enum>.<KEY>  OR  <Enum>.<KEY>  where Enum is Identifier
      let apiKey = null, enumRef = null, keyRef = null;
      const ak = obj.apiKey;
      if (ak.type === 'MemberExpression' && !ak.computed && ak.object.type === 'Identifier' && ak.property.type === 'Identifier') {
        enumRef = ak.object.name; keyRef = ak.property.name;
        const m = enums.get(enumRef);
        if (m && m.has(keyRef)) apiKey = m.get(keyRef);
      } else if (ak.type === 'Literal') {
        apiKey = ak.value;
      }
      // type: <Mode>.<MODE>
      let mode = null;
      const ty = obj.type;
      if (ty.type === 'MemberExpression' && !ty.computed && ty.property.type === 'Identifier') mode = ty.property.name;
      entries.push({ method: methodName, enumRef, keyRef, apiKey, mode });
    }
    if (looksLikeDesc && entries.length) descMaps.set(node.id.name, entries);
  }
}
log(`descriptor maps resolved: ${descMaps.size}, methods: ${[...descMaps.values()].reduce((a, e) => a + e.length, 0)}`);

// --- Pass 3: window.$X = Object(h.a)(DESC) / Object(h.a)(DESC.a)
const namespaces = [];
{
  const seen = new Set();
  for (const [node] of walk(ast)) {
    if (node.type !== 'AssignmentExpression' || node.operator !== '=') continue;
    const L = node.left, R = node.right;
    if (L.type !== 'MemberExpression' || L.object.type !== 'Identifier' || L.object.name !== 'window') continue;
    const ns = L.computed ? strLit(L.property) : (L.property.type === 'Identifier' ? L.property.name : null);
    if (!ns || !ns.startsWith('$')) continue;
    // R = CallExpression(callee = MemberExpression(Object(h.a)|M.b), args[0])
    let mapId = null;
    if (R.type === 'CallExpression' && R.arguments[0]) {
      const a0 = R.arguments[0];
      if (a0.type === 'Identifier') mapId = a0.name;
      else if (a0.type === 'MemberExpression' && !a0.computed && a0.object.type === 'Identifier') mapId = a0.object.name;
    }
    if (seen.has(ns)) continue;
    seen.add(ns);
    namespaces.push({ ns, mapId, entries: mapId ? (descMaps.get(mapId) || null) : null });
  }
}

log('');
log('=== NAMESPACE TABLE ===');
for (const n of namespaces) {
  log(`${n.ns.padEnd(22)} map=${String(n.mapId).padEnd(6)} ${n.entries ? n.entries.length + ' methods' : 'NO-DESCRIPTOR-MAP'}`);
}

log('');
log('=== FULL CONTRACT ===');
const modeCount = {};
for (const n of namespaces) {
  log('');
  log(`## ${n.ns}`);
  if (!n.entries) { log('   (no descriptor map recovered)'); continue; }
  for (const e of n.entries) {
    modeCount[e.mode] = (modeCount[e.mode] || 0) + 1;
    log(`   ${e.method.padEnd(36)} ${String(e.apiKey || ('?' + e.enumRef + '.' + e.keyRef)).padEnd(56)} ${e.mode}`);
  }
}
log('');
log('=== MODES ===');
for (const [k, v] of Object.entries(modeCount).sort((a, b) => b[1] - a[1])) log(`  ${k.padEnd(14)} ${v}`);

fs.writeFileSync(path.join(__dirname, '_r6_ast_contract.txt'), out.join('\n') + '\n');
fs.writeFileSync(path.join(__dirname, '_r6_ast_contract.json'), JSON.stringify({
  namespaces,
  enums: Object.fromEntries([...enums].map(([k, v]) => [k, Object.fromEntries(v)])),
  descMaps: Object.fromEntries(descMaps),
}, null, 1));
console.log(out.join('\n'));
