const fs = require('fs'), path = require('path');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const SRC = path.join(ROOT, 'main-dist/preload-render.js');
const s = fs.readFileSync(SRC, 'utf8');
const out = [];
const log = (...a) => out.push(a.join(' '));

// 1. Collect enum maps: <id>=function(e){return e.KEY="value",...}({})
const enums = new Map();
{
  const re = /(?:let|var|const)\s+([A-Za-z_$][\w$]*)=function\(e\)\{return([\s\S]{0,6000}?)\}\(\{\}\)/g;
  let m;
  while ((m = re.exec(s))) {
    const pairs = [...m[2].matchAll(/([A-Z0-9_$]+)="([^"]+)"/g)].map(x => [x[1], x[2]]);
    if (pairs.length) enums.set(m[1], pairs);
  }
}
const enumById = id => enums.get(id) || null;

// 2. Collect descriptor maps: <id>={name:{apiKey:ENUM.KEY,type:MODE},...}
const descMaps = new Map();
{
  const re = /(?:let|var|const)\s+([A-Za-z_$][\w$]*)=\{((?:[A-Za-z_$][\w$]*:\{apiKey:[^}]*\},?\s*)+)\}/g;
  let m;
  while ((m = re.exec(s))) {
    const body = m[2];
    const entries = [...body.matchAll(/([A-Za-z_$][\w$]*):\{apiKey:([A-Za-z_$][\w$]*)\.([A-Za-z0-9_$]+),type:[A-Za-z_$]+\.([a-zA-Z_]+)\}/g)]
      .map(x => ({ method: x[1], enumRef: x[2], keyRef: x[3], mode: x[4] }));
    if (entries.length) descMaps.set(m[1], entries);
  }
}

const resolveKey = (enumRef, keyRef) => {
  const list = enumById(enumRef);
  if (!list) return null;
  const hit = list.find(p => p[0] === keyRef);
  return hit ? hit[1] : null;
};

// 3. Namespaced exposure: window.$X=Object(h.a)(DESC)  (DESC may be `X.a`)
log('=== NAMESPACE -> DESCRIPTOR MAP ===');
const nsRe = /window\.(\$[A-Za-z0-9_]+)=Object\(h\.a\)\(([A-Za-z_$][\w$])(?:\.a)?\)/g;
const namespaces = [];
let nm;
while ((nm = nsRe.exec(s))) {
  const ns = nm[1], mapId = nm[2];
  const entries = descMaps.get(mapId);
  namespaces.push({ ns, mapId, entries });
  log(`${ns.padEnd(20)} -> map ${mapId.padEnd(6)} ${entries ? entries.length + ' methods' : 'UNRESOLVED'}`);
}
log('');

log('=== METHOD CONTRACT (namespace.method -> channel, mode) ===');
const modes = {};
for (const n of namespaces) {
  log(`-- ${n.ns} (${n.mapId})`);
  if (!n.entries) { log('   (descriptor map not found by regex; see raw)'); continue; }
  for (const e of n.entries) {
    const ch = resolveKey(e.enumRef, e.keyRef);
    modes[e.mode] = (modes[e.mode] || 0) + 1;
    log(`   ${e.method.padEnd(34)} ${String(ch || ('?' + e.enumRef + '.' + e.keyRef)).padEnd(52)} ${e.mode}`);
  }
}
log('');
log('=== MODE DISTRIBUTION ===');
for (const [k, v] of Object.entries(modes).sort((a, b) => b[1] - a[1])) log(`  ${k.padEnd(12)} ${v}`);

log('');
log('=== ALL CHANNEL STRINGS (unique, sorted) ===');
const allCh = new Set();
for (const [, list] of enums) for (const [, v] of list) allCh.add(v);
log('unique channels: ' + allCh.size);
log([...allCh].sort().join('\n'));

fs.writeFileSync(path.join(__dirname, '_r6_preload_contract.txt'), out.join('\n') + '\n');
fs.writeFileSync(path.join(__dirname, '_r6_preload_contract.json'), JSON.stringify({ namespaces, enums: Object.fromEntries(enums), descMaps: Object.fromEntries(descMaps) }, null, 1));
console.log(out.join('\n'));
