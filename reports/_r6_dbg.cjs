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

// ---- scope tree ----
// Each scope: { node, parent, decls: Map<name, node>, isFunction }
function buildScopes(root) {
  const scopes = new WeakMap(); // node -> scope
  const rootScope = { node: root, parent: null, decls: new Map(), isFunction: true };
  scopes.set(root, rootScope);

  const isScopeNode = n =>
    n.type === 'Program' || n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' ||
    n.type === 'ArrowFunctionExpression' || n.type === 'CatchClause';

  function visit(node, scope) {
    let cur = scope;
    if (isScopeNode(node) && node !== root) {
      cur = { node, parent: scope, decls: new Map(), isFunction: true };
      scopes.set(node, cur);
    }
    // declarations
    if (node.type === 'VariableDeclarator' && node.id && node.id.type === 'Identifier') {
      if (!cur.decls.has(node.id.name)) cur.decls.set(node.id.name, node);
    }
    if ((node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') && node.id && node.id.type === 'Identifier') {
      if (!cur.decls.has(node.id.name)) cur.decls.set(node.id.name, node);
    }
    if (node.type === 'VariableDeclarator' && node.id && node.id.type === 'ObjectPattern') {
      for (const p of node.id.properties) if (p.value && p.value.type === 'Identifier' && !cur.decls.has(p.value.name)) cur.decls.set(p.value.name, node);
    }
    for (const k of Object.keys(node)) {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'range') continue;
      const v = node[k];
      if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') visit(c, cur); }
      else if (v && typeof v.type === 'string') visit(v, cur);
    }
  }
  visit(root, rootScope);
  return scopes;
}
const scopes = buildScopes(ast);

const resolveDecl = (name, scope) => {
  let s = scope;
  while (s) { if (s.decls.has(name)) return s.decls.get(name); s = s.parent; }
  return null;
};

// enum IIFE -> Map(KEY,value)
const enumCache = new WeakMap();
function enumOf(decl) {
  if (!decl || decl.type !== 'VariableDeclarator' || !decl.init) return null;
  if (enumCache.has(decl)) return enumCache.get(decl);
  enumCache.set(decl, null);
  const init = decl.init;
  if (init.type !== 'CallExpression') return null;
  let callee = init.callee;
  // handle (0, x.y)(...) etc — require function expression
  if (!callee || (callee.type !== 'FunctionExpression' && callee.type !== 'ArrowFunctionExpression')) return null;
  const p = callee.params?.[0];
  if (!p || p.type !== 'Identifier') return null;
  const pn = p.name;
  const map = new Map();
  // walk only inside callee body
  const stack = [callee.body];
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n !== 'object') continue;
    if (n.type === 'AssignmentExpression' && n.operator === '=') {
      const L = n.left, R = n.right;
      if (L.type === 'MemberExpression' && !L.computed && L.object.type === 'Identifier' && L.object.name === pn && L.property.type === 'Identifier'
        && R.type === 'Literal' && typeof R.value === 'string') {
        if (!map.has(L.property.name)) map.set(L.property.name, R.value);
      }
    }
    for (const k of Object.keys(n)) {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'range') continue;
      const v = n[k];
      if (Array.isArray(v)) for (const c of v) if (c && typeof c.type === 'string') stack.push(c);
      else if (v && typeof v.type === 'string') stack.push(v);
    }
  }
  const res = map.size ? map : null;
  enumCache.set(decl, res);
  return res;
}

// ---- descriptor maps ----
const descMaps = new Map(); // declNode -> entries
function descOf(decl) {
  if (!decl || decl.type !== 'VariableDeclarator' || !decl.init || decl.init.type !== 'ObjectExpression') return null;
  if (descMaps.has(decl)) return descMaps.get(decl);
  const scopeOfDecl = null; // resolved via scopes map on nearest function containing decl
  const entries = [];
  for (const prop of decl.init.properties) {
    if (prop.type !== 'Property' || prop.computed || prop.value.type !== 'ObjectExpression') continue;
    const obj = {};
    for (const p2 of prop.value.properties) {
      if (p2.type !== 'Property' || p2.computed) continue;
      const k = p2.key.type === 'Identifier' ? p2.key.name : (p2.key.type === 'Literal' ? String(p2.key.value) : null);
      if (k) obj[k] = p2.value;
    }
    if (!obj.apiKey || !obj.type) continue;
    const method = prop.key.type === 'Identifier' ? prop.key.name : (prop.key.type === 'Literal' ? String(prop.key.value) : null);
    let apiKey = null, enumRef = null, keyRef = null, enumMissing = false;
    const ak = obj.apiKey;
    if (ak.type === 'Literal') apiKey = ak.value;
    else if (ak.type === 'MemberExpression' && !ak.computed && ak.object.type === 'Identifier' && ak.property.type === 'Identifier') {
      enumRef = ak.object.name; keyRef = ak.property.name;
      const edecl = resolveDecl(enumRef, scopes.get(decl) || scopes.get(ast));
      const em = enumOf(edecl);
      if (em && em.has(keyRef)) apiKey = em.get(keyRef); else enumMissing = true;
    }
    let mode = null;
    if (obj.type.type === 'MemberExpression') {
      const pr = obj.type.property;
      mode = pr.type === 'Identifier' ? pr.name : (pr.type === 'Literal' ? pr.value : null);
    }
    entries.push({ method, enumRef, keyRef, apiKey, enumMissing, mode });
  }
  const res = entries.length ? entries : null;
  descMaps.set(decl, res);
  return res;
}

// ---- namespaces ----
const namespaces = [];
const seen = new Set();
(function visit(node) {
  if (node.type === 'AssignmentExpression' && node.operator === '=') {
    const L = node.left, R = node.right;
    if (L.type === 'MemberExpression' && L.object.type === 'Identifier' && L.object.name === 'window') { console.error('WINASSIGN', L.property.name);
      const ns = L.computed ? (L.property.type === 'Literal' ? L.property.value : null) : (L.property.type === 'Identifier' ? L.property.name : null);
      if (ns && ns.startsWith('$') && !seen.has(ns)) {
        let mapId = null, entries = null;
        if (R.type === 'CallExpression' && R.arguments[0]) {
          const a0 = R.arguments[0];
          if (a0.type === 'Identifier') mapId = a0.name;
          else if (a0.type === 'MemberExpression' && !a0.computed && a0.object.type === 'Identifier') mapId = a0.object.name;
          if (mapId) entries = descOf(resolveDecl(mapId, scopes.get(node) || scopes.get(ast)));
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
