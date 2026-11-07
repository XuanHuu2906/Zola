const fs = require('fs');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const F = ROOT + '/main-dist/preload-render.js';
const s = fs.readFileSync(F, 'utf8');
const out = [];
const log = (...a) => out.push(a.join(' '));

function moduleBody(modId) {
  const needles = [`"${modId}":function`, `${modId}:function`];
  for (const nd of needles) {
    const found = scanFor(nd);
    if (found) return found;
  }
  return null;
}

function scanFor(nd) {
  let i = s.indexOf(nd);
  while (i !== -1) {
    const prev = s[i - 1];
    if (nd[0] === '"' || prev === '{' || prev === ',') {
      const brace = s.indexOf('{', s.indexOf(')', i) + 1);
      let depth = 0, j = brace;
      for (; j < s.length; j++) {
        if (s[j] === '{') depth++;
        else if (s[j] === '}') { depth--; if (depth === 0) break; }
      }
      return { text: s.slice(brace, j + 1), off: brace };
    }
    i = s.indexOf(nd, i + 1);
  }
  return null;
}

// resolve enums globally
const enums = new Map();
{
  const re = /(?:let|var|const)\s+([A-Za-z_$][\w$]*)=function\(([A-Za-z_$][\w$]*)\)\{return([\s\S]{0,8000}?)\}\(\{\}\)/g;
  let m;
  while ((m = re.exec(s))) {
    const p = m[2], map = new Map();
    const ra = new RegExp('\\b' + p + '\\.([A-Za-z0-9_$]+)\\s*=\\s*("(?:[^"\\\\]|\\\\.)*")', 'g');
    let mm;
    while ((mm = ra.exec(m[3]))) map.set(mm[1], JSON.parse(mm[2]));
    if (map.size) enums.set(m[1], map);
  }
}

const targets = [
  ['$zdb', 'a4Xj'], ['$zsessionManager', 'ntSb'], ['$zconfig', 'RbSv'],
  ['$zMsgChannel', '3sbe'], ['$zscript', 'Pjj5'], ['$zsqlitebw', '+NII'],
  ['$zsafeStorage', 'HVQM'], ['$zlogger', '7jJJ'],
];

for (const [ns, mod] of targets) {
  log('');
  log('## ' + ns + '  (module ' + mod + ')');
  const b = moduleBody(mod);
  if (!b) { log('   module body not found'); continue; }
  // local enum aliases within this module
  const localEnums = new Map(enums);
  {
    const er = /([A-Za-z_$][\w$]*)=function\(([A-Za-z_$][\w$]*)\)\{return([\s\S]{0,8000}?)\}\(\{\}\)/g;
    let em;
    while ((em = er.exec(b.text))) {
      const p = em[2], map = new Map();
      const pr = new RegExp('\\b' + p + '\\.([A-Za-z0-9_$]+)\\s*=\\s*("(?:[^"\\\\]|\\\\.)*")', 'g');
      let pm;
      while ((pm = pr.exec(em[3]))) map.set(pm[1], JSON.parse(pm[2]));
      if (map.size) localEnums.set(em[1], map);
    }
  }
  const ra = /([A-Za-z_$][\w$]*)\s*=\s*n\(\s*"((?:[^"\\]|\\.)+)"\s*\)/g;
  let m;
  while ((m = ra.exec(b.text))) {
    const inner = moduleBody(m[2]);
    if (!inner) continue;
    const er = /(?:let|var|const)\s+([A-Za-z_$][\w$]*)=function\(([A-Za-z_$][\w$]*)\)\{return([\s\S]{0,8000}?)\}\(\{\}\)/g;
    let em;
    while ((em = er.exec(inner.text))) {
      const p = em[2], map = new Map();
      const pr = new RegExp('\\b' + p + '\\.([A-Za-z0-9_$]+)\\s*=\\s*("(?:[^"\\\\]|\\\\.)*")', 'g');
      let pm;
      while ((pm = pr.exec(em[3]))) map.set(pm[1], JSON.parse(pm[2]));
      if (map.size) { localEnums.set(m[1], map); localEnums.set(em[1], map); }
    }
  }
  // find descriptor entries
  const entries = [...b.text.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*\{\s*apiKey\s*:\s*([A-Za-z_$][\w$]*)\.([A-Za-z0-9_$]+)\s*,\s*type\s*:\s*([A-Za-z_$][\w$]*)(?:\.([A-Za-z0-9_$]+))?/g)];
  if (!entries.length) { log('   no descriptor entries (' + b.text.length + ' bytes)'); continue; }
  log('   entries: ' + entries.length);
  for (const e of entries) {
    const method = e[1], ev = e[2], key = e[3], mode = e[5] || e[4];
    const em = localEnums.get(ev);
    const val = em ? (em.get(key) ?? null) : null;
    log(`   ${method.padEnd(36)} ${String(val || '?' + ev + '.' + key).padEnd(42)} ${mode}`);
  }
}

fs.writeFileSync(__dirname + '/_r6_mod_contract.txt', out.join('\n') + '\n');
console.log(out.join('\n').slice(0, 12000));
