const fs = require('fs');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const F = ROOT + '/main-dist/preload-render.js';
const s = fs.readFileSync(F, 'utf8');
const body = fs.readFileSync(__dirname + '/_r6_t5sj.txt', 'utf8');
const out = [];
const log = (...a) => out.push(a.join(' '));

// every exposeInMainWorld / window.$X assignment in T5SJ with its RHS expression
log('=== EXPOSURE SITES IN T5SJ ===');
const re = /(?:exposeInMainWorld\(\s*"([^"]+)"\s*,|window\.(\$[A-Za-z_$][\w$]*)\s*=\s*)([^;\n]{0,120})/g;
let m;
const seen = new Set();
while ((m = re.exec(body))) {
  const name = m[1] || m[2];
  if (seen.has(name)) continue;
  seen.add(name);
  log(`@${String(m.index).padEnd(7)} ${name.padEnd(22)} = ${m[3].trim()}`);
}

log('');
log('=== alias decls for n("mod") in T5SJ (with prefix context) ===');
const ra = /([A-Za-z_$][\w$]*)\s*=\s*n\(\s*"((?:[^"\\]|\\.)+)"\s*\)/g;
let a;
while ((a = ra.exec(body))) {
  const before = body.slice(Math.max(0, a.index - 60), a.index).replace(/\s+/g, ' ');
  log(`@${String(a.index).padEnd(7)} ${a[1].padEnd(5)} -> ${a[2]}   | ...${before}`);
}

fs.writeFileSync(__dirname + '/_r6_t5sj_all.txt', out.join('\n') + '\n');
console.log(out.join('\n'));
