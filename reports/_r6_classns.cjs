const fs = require('fs');
const acorn = require('acorn');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const FILE = ROOT + '/main-dist/preload-render.js';
const src = fs.readFileSync(FILE, 'utf8');
const out = [];
const log = (...a) => out.push(a.join(' '));

let ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'script', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true });
if (ast.body.length === 1 && ast.body[0].type === 'ExpressionStatement' && ast.body[0].expression.type === 'SequenceExpression') {
  ast = { type: 'Program', start: 0, end: src.length, body: ast.body[0].expression.expressions.map(e => ({ type: 'ExpressionStatement', expression: e, start: e.start, end: e.end })) };
}

const children = n => {
  const r = [];
  for (const k of Object.keys(n)) {
    if (k === 'type' || k === 'start' || k === 'end') continue;
    const v = n[k];
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') r.push(c); }
    else if (v && typeof v.type === 'string') r.push(v);
  }
  return r;
};

// collect top-level-ish declarations by name (last wins is fine; we report ambiguity)
const decls = new Map(); // name -> [nodes]
const all = [];
(function walk(n) {
  all.push(n);
  if (n.type === 'VariableDeclarator' && n.id && n.id.type === 'Identifier') {
    if (!decls.has(n.id.name)) decls.set(n.id.name, []);
    decls.get(n.id.name).push(n.init);
  }
  if ((n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') && n.id) {
    if (!decls.has(n.id.name)) decls.set(n.id.name, []);
    decls.get(n.id.name).push(n);
  }
  for (const c of children(n)) walk(c);
})(ast);

// map all AssignmentExpressions window.$X = <identifier>
const targets = [];
for (const n of all) {
  if (n.type !== 'AssignmentExpression' || n.operator !== '=') continue;
  const L = n.left, R = n.right;
  if (L.type !== 'MemberExpression' || L.object.type !== 'Identifier' || L.object.name !== 'window') continue;
  const ns = L.computed ? (L.property.type === 'Literal' ? L.property.value : null) : (L.property.type === 'Identifier' ? L.property.name : null);
  if (!ns || ns[0] !== '$') continue;
  if (R.type !== 'Identifier') continue;
  targets.push({ ns, id: R.name, off: n.start });
}

function className(node) {
  if (!node) return null;
  if (node.type === 'ClassExpression' || node.type === 'ClassDeclaration') return node;
  if (node.type === 'NewExpression' && node.callee.type === 'Identifier') return className((decls.get(node.callee.name) || [])[0]);
  if (node.type === 'CallExpression') {
    const a0 = node.arguments && node.arguments[0];
    if (a0 && a0.type === 'FunctionExpression') return { type: 'ClassExpression', body: a0.body };
    if (a0 && a0.type === 'Identifier') return className((decls.get(a0.name) || [])[0]);
  }
  return null;
}

function methodsOf(node) {
  const names = [];
  if (!node) return names;
  if (node.type === 'ClassExpression' || node.type === 'ClassDeclaration') {
    for (const b of node.body.body) {
      if (b.type === 'MethodDefinition' && b.key) names.push((b.computed ? '[' : '') + (b.key.type === 'Identifier' ? b.key.name : b.key.type === 'Literal' ? b.key.value : '?') + (b.computed ? ']' : '') + (b.static ? ' (static)' : ''));
    }
    return names;
  }
  if (node.type === 'BlockStatement') {
    // function body: walk for this.X = and X = function
    for (const s of node.body) {
      if (s.type === 'ExpressionStatement' && s.expression.type === 'AssignmentExpression') {
        const L = s.expression.left;
        if (L.type === 'MemberExpression' && L.object.type === 'ThisExpression' && L.property.type === 'Identifier') names.push(L.property.name);
        if (L.type === 'Identifier') names.push(L.name + ' (local)');
      }
      if (s.type === 'ReturnStatement' && s.argument) {
        let a = s.argument;
        if (a.type === 'ObjectExpression') {
          for (const p of a.properties) if (p.type === 'Property' && p.key) names.push((p.key.type === 'Identifier' ? p.key.name : String(p.key.value)));
        }
        if (a.type === 'Identifier') {
          const d = (decls.get(a.name) || [])[0];
          if (d && d.type === 'ObjectExpression') for (const p of d.properties) if (p.type === 'Property' && p.key) names.push(p.key.type === 'Identifier' ? p.key.name : String(p.key.value));
        }
      }
    }
  }
  return names;
}

log('=== CLASS/OBJECT-BACKED PRELOAD NAMESPACES ===');
for (const t of targets) {
  const cands = decls.get(t.id) || [];
  const node = cands.length === 1 ? cands[0] : cands[cands.length - 1];
  const cls = className(node);
  const ms = methodsOf(cls);
  log('');
  log(`## ${t.ns}  (from ${t.id}, ${cands.length} decls, off @${t.off})`);
  if (!ms.length) {
    log(`   unresolved shape: ${node ? node.type : 'null'}`);
    if (node) log('   src: ' + src.slice(node.start, Math.min(node.start + 220, node.end)).replace(/\s+/g, ' '));
  } else {
    log('   methods: ' + ms.length);
    for (const m of ms) log('     ' + m);
  }
}

fs.writeFileSync(__dirname + '/_r6_classns.txt', out.join('\n') + '\n');
console.log('wrote _r6_classns.txt (' + out.length + ' lines)');
