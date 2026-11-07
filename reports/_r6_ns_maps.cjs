const fs = require('fs');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const F = ROOT + '/main-dist/preload-render.js';
const s = fs.readFileSync(F, 'utf8');
const body = fs.readFileSync(__dirname + '/_r6_t5sj.txt', 'utf8');
const out = [];
const log = (...a) => out.push(a.join(' '));

// full-file enum resolution: <id>=function(e){return e.KEY="value",...}({})
const enums = new Map();
{
  const re = /(?:let|var|const)\s+([A-Za-z_$][\w$]*)=function\(([A-Za-z_$][\w$]*)\)\{return([\s\S]{0,8000}?)\}\(\{\}\)/g;
  let m;
  while ((m = re.exec(s))) {
    const p = m[2];
    const map = new Map();
    const pre = m[3];
    // two forms:  e.KEY="str"  and  e[e.KEY="str"]="realValue" or e.KEY="A",e[e.KEY="B"]="B"
    const ra = new RegExp('\\b' + p + '\\.([A-Za-z0-9_$]+)\\s*=\\s*("(?:[^"\\\\]|\\\\.)*")', 'g');
    let mm;
    while ((mm = ra.exec(pre))) map.set(mm[1], JSON.parse(mm[2]));
    // form e[e.KEY="v"]="v"  -> handled above (inner assignment captured)
    if (map.size) enums.set(m[1], map);
  }
}
log('enums: ' + enums.size);

function findMapLiteral(idExpr) {
  // idExpr like "O.a" or "y"
  const esc = idExpr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(?:[,;{(\\s])' + esc + '\\s*=\\s*\\{', 'g');
  const m = re.exec(body);
  if (!m) return null;
  const brace = body.indexOf('{', m.index);
  let depth = 0, j = brace;
  for (; j < body.length; j++) {
    if (body[j] === '{') depth++;
    else if (body[j] === '}') { depth--; if (depth === 0) break; }
  }
  return { text: body.slice(brace, j + 1), off: m.index };
}

// enum var for a given alias: need `X=n("mod")` then inside module `let E=function(e){...}` — but our
// full-file enum scan keys by variable name (E, g, P, ...), so we resolve by looking for the
// descriptor key object names used in the literal and matching any enum that has the key.
function resolveEnumKey(enumVar, keyName) {
  const m = enums.get(enumVar);
  if (!m) return null;
  return m.get(keyName) ?? null;
}

const targets = [
  ['$zdb', 'O.a'], ['$zsessionManager', 'et.a'], ['$zconfig', 'K.a'],
  ['$zMsgChannel', 'ee.a'], ['$zscript', 'te.a'], ['$zsqlitebw', 'tt.a'],
  ['$zsafeStorage', 'nt.a'], ['$zlogger', 'b.a'],
];

for (const [ns, idExpr] of targets) {
  log('');
  log('## ' + ns + '  <- ' + idExpr);
  const lit = findMapLiteral(idExpr);
  if (!lit) { log('   literal not found'); continue; }
  const entries = [...lit.text.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*\{([^{}]*)\}/g)];
  if (!entries.length) { log('   parsed 0 entries; raw head: ' + lit.text.slice(0, 300)); continue; }
  log('   entries: ' + entries.length);
  for (const e of entries) {
    const method = e[1], inner = e[2];
    const ak = /apiKey\s*:\s*([A-Za-z_$][\w$]*)\.([A-Za-z0-9_$]+)/.exec(inner);
    const ty = /type\s*:\s*([A-Za-z_$][\w$]*)(?:\.([A-Za-z0-9_$]+))?/.exec(inner);
    let apiKey = '?', enumVar = ak ? ak[1] : null, keyName = ak ? ak[2] : null, resolved = null;
    if (ak) resolved = resolveEnumKey(enumVar, keyName);
    apiKey = resolved || (ak ? '?' + enumVar + '.' + keyName : '?');
    const mode = ty ? (ty[2] || ty[1]) : '?';
    log(`   ${method.padEnd(34)} ${String(apiKey).padEnd(40)} ${mode}`);
  }
}

fs.writeFileSync(__dirname + '/_r6_ns_maps.txt', out.join('\n') + '\n');
console.log(out.join('\n').slice(0, 10000));
