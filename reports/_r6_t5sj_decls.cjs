const fs = require('fs');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const F = ROOT + '/main-dist/preload-render.js';
const s = fs.readFileSync(F, 'utf8');
const body = fs.readFileSync(__dirname + '/_r6_t5sj.txt', 'utf8');
const out = [];
const log = (...a) => out.push(a.join(' '));

log('=== ALL <id>=n("mod") ALIASES IN T5SJ (in order) ===');
const re = /([A-Za-z_$][\w$]*)\s*=\s*n\(\s*"((?:[^"\\]|\\.)+)"\s*\)/g;
let m;
const seenIdx = new Set();
while ((m = re.exec(body))) {
  log(`@${String(m.index).padEnd(7)} ${m[1].padEnd(6)} -> n("${m[2]}")`);
}
fs.writeFileSync(__dirname + '/_r6_t5sj_decls.txt', out.join('\n') + '\n');
console.log(out.join('\n'));
