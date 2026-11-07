const fs = require('fs');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const F = ROOT + '/main-dist/preload-render.js';
const s = fs.readFileSync(F, 'utf8');
const out = [];
const log = (...a) => out.push(a.join(' '));

log('file bytes: ' + s.length);

// every exposeInMainWorld("NAME", <expr>
const re = /exposeInMainWorld\(\s*("(?:[^"\\]|\\.)*")\s*,\s*([^)]{0,80})/g;
const rows = [];
let m;
while ((m = re.exec(s))) rows.push({ off: m.index, name: JSON.parse(m[1]), expr: m[2] });
log('exposeInMainWorld call sites: ' + rows.length);
const uniq = new Map();
for (const r of rows) if (!uniq.has(r.name)) uniq.set(r.name, r);
log('unique exposed names: ' + uniq.size);
log('');
for (const r of uniq.values()) log(`@${String(r.off).padEnd(9)} ${r.name.padEnd(24)} ${r.expr.replace(/\s+/g, ' ')}`);

log('');
log('=== window.$X = ... ASSIGNMENTS IN PRELOAD ===');
const re2 = /window\.(\$[A-Za-z0-9_]+)\s*=\s*([A-Za-z_$][\w$.]{0,40})/g;
const u2 = new Map();
while ((m = re2.exec(s))) if (!u2.has(m[1])) u2.set(m[1], { off: m.index, expr: m[2] });
for (const [k, v] of u2) log(`@${String(v.off).padEnd(9)} ${k.padEnd(24)} = ${v.expr}`);
log('window.$X assignments: ' + u2.size);

log('');
log('=== OBJECT(h.a)(...) WRAPPED (descriptor-driven) ===');
const re3 = /window\.(\$[A-Za-z0-9_]+)\s*=\s*Object\(([\w$]+)\.a\)\(/g;
const u3 = new Set();
while ((m = re3.exec(s))) u3.add(m[1]);
log('names: ' + u3.size + ' -> ' + [...u3].join(', '));

fs.writeFileSync(__dirname + '/_r6_exposes.txt', out.join('\n') + '\n');
console.log(out.join('\n').slice(0, 8000));
