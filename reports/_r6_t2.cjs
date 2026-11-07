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


let cnt=[];
(function visit2(node){
  if(!node||typeof node.type!=='string')return;
  if(node.type==='AssignmentExpression'&&node.operator==='='){
    const L=node.left;
    if(L.type==='MemberExpression'&&L.object.type==='Identifier'&&L.object.name==='window'){cnt.push(L.property.name);}
  }
  for(const k of Object.keys(node)){
    if(k==='type'||k==='start'||k==='end'||k==='loc'||k==='range')continue;
    const y=node[k];
    if(Array.isArray(y)){for(const c of y)if(c&&typeof c.type==='string')visit2(c);}
    else if(y&&typeof y.type==='string')visit2(y);
  }
})(ast);
console.log(JSON.stringify(cnt));
