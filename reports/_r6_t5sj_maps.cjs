const fs = require('fs');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const F = ROOT + '/main-dist/preload-render.js';
const s = fs.readFileSync(F, 'utf8');
const body = fs.readFileSync(__dirname + '/_r6_t5sj.txt', 'utf8');
const out = [];
const log = (...a) => out.push(a.join(' '));

function scanModule(modId) {
  const needles = [`"${modId}":function`, `${modId}:function`];
  for (const nd of needles) {
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
        return s.slice(brace, j + 1);
      }
      i = s.indexOf(nd, i + 1);
    }
  }
  return null;
}

function enumOf(text) {
  const map = new Map();
  const er = /([A-Za-z_$][\w$]*)=function\(([A-Za-z_$][\w$]*)\)\{return([\s\S]{0,12000}?)\}\(\{\}\)/g;
  let em;
  while ((em = er.exec(text))) {
    const p = em[2];
    const pr = new RegExp('\\b' + p + '\\.([A-Za-z0-9_$]+)\\s*=\\s*("(?:[^"\\\\]|\\\\.)*")', 'g');
    let pm;
    while ((pm = pr.exec(em[3]))) {
      if (!map.has(em[1])) map.set(em[1], new Map());
      map.get(em[1]).set(pm[1], JSON.parse(pm[2]));
    }
  }
  return map;
}

const enums = enumOf(body);
// also pull enums from every module alias used in T5SJ
const aliases = new Map();
{
  const ra = /([A-Za-z_$][\w$]*)\s*=\s*n\(\s*"((?:[^"\\]|\\.)+)"\s*\)/g;
  let a;
  while ((a = ra.exec(body))) aliases.set(a[1], a[2]);
}
for (const [alias, mod] of aliases) {
  const mb = scanModule(mod);
  if (!mb) continue;
  const sub = enumOf(mb);
  for (const [k, v] of sub) {
    if (!enums.has(k)) enums.set(k, v);
    // module-local enum commonly aliased to `a`; expose under alias-qualified key too
    if (k === 'a') enums.set(alias + '.a', v);
  }
}

// enumerate descriptor map literals in T5SJ:  var NAME={ ... } containing "apiKey:" entries
log('=== DESCRIPTOR MAPS IN T5SJ ===');
const mapRe = /(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*\{/g;
let mm;
let last = -1;
while ((mm = mapRe.exec(body))) {
  const name = mm[1];
  const brace = body.indexOf('{', mm.index);
  let depth = 0, j = brace;
  for (; j < body.length; j++) {
    if (body[j] === '{') depth++;
    else if (body[j] === '}') { depth--; if (depth === 0) break; }
  }
  const txt = body.slice(brace, j + 1);
  if (!/apiKey\s*:/.test(txt)) continue;
  const entries = [...txt.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*\{([^{}]*apiKey[^{}]*)\}/g)];
  if (!entries.length) continue;
  log('');
  log(`## map ${name}  (${entries.length} entries, ${txt.length} bytes) @${brace}`);
  for (const e of entries) {
    const method = e[1], inner = e[2];
    const ak = /apiKey\s*:\s*([A-Za-z_$][\w$]*)(?:\.([A-Za-z0-9_$]+))?/.exec(inner);
    let key = '?';
    if (ak) {
      const ev = ak[1], kn = ak[2];
      if (kn) {
        const em = enums.get(ev);
        const v = em && em.get(kn);
        key = v || `?${ev}.${kn}`;
      } else {
        // plain string literal or enum var referenced directly
        const lit = new RegExp('apiKey\\s*:\\s*"([^"]*)"').exec(inner);
        key = lit ? lit[1] : ev;
      }
    }
    const ty = /type\s*:\s*([A-Za-z_$][\w$]*)(?:\.([A-Za-z0-9_$]+))?/.exec(inner);
    log(`   ${method.padEnd(38)} ${String(key).padEnd(46)} ${ty ? (ty[2] || ty[1]) : '?'}`);
  }
}

fs.writeFileSync(__dirname + '/_r6_t5sj_maps.txt', out.join('\n') + '\n');
console.log(out.join('\n').slice(0, 20000));
