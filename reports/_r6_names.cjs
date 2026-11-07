const fs = require('fs');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const P = ROOT + '/main-dist/preload-render.js';
const s = fs.readFileSync(P, 'utf8');
const out = [];
const log = (...a) => out.push(a.join(' '));

const names = [];
const seen = new Set();
const re = /exposeInMainWorld\(\s*"([^"]+)"/g;
let m;
while ((m = re.exec(s))) {
  if (!seen.has(m[1])) { seen.add(m[1]); names.push([m[1], m.index]); }
}
log(`=== ${names.length} UNIQUE exposeInMainWorld NAMES (preload-render.js) ===`);
names.forEach(([n, i]) => log(`  ${n.padEnd(24)} @${i}`));

const winNames = new Set();
const rw = /window\.(\$[A-Za-z_$][\w$]*)\s*=\s*(?:Object\([A-Za-z_$][\w$]*\.a\)|Object\()/g;
while ((m = rw.exec(s))) winNames.add(m[1]);
log('');
log(`=== ${winNames.size} descriptor-driven window.$X assignments ===`);
log('  ' + [...winNames].sort().join(', '));

// which exposed names are declared in the preload but their MOUNT lives in renderer?
fs.writeFileSync(__dirname + '/_r6_names.txt', out.join('\n') + '\n');
console.log(out.join('\n'));
