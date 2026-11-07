const fs = require('fs');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const F = ROOT + '/main-dist/preload-render.js';
const s = fs.readFileSync(F, 'utf8');
const out = [];
const log = (...a) => out.push(a.join(' '));

// Find `let/var/const <id>={` or `<id>=n("module")` declarations near the main init.
// Locate the init block
const anchor = s.indexOf('window.$zcommon=Object(W.a)()');
const lead = s.slice(Math.max(0, anchor - 14000), anchor);

const nsMap = {
  '$zwindow': 'y', '$zresource': 'A', '$zlogger': 'b', '$zupdater': 'S', '$zapp': 'T',
  '$zdownload': 'R', '$zdb': 'O', '$zsessionManager': 'et', '$zmulti': 'D', '$zcall': 'k',
  '$zsharedWorker': 'L', '$zuri': 'F', '$zscreencap': 'Q', '$zlogin': 'G', '$zperf': 'z',
  '$zconfig': 'K', '$zFileManager': 'v', '$zMsgChannel': 'ee', '$zscript': 'te',
  '$zsqlitebw': 'tt', '$zsafeStorage': 'nt',
};

// For each numeric/identifier map id, find its declaration in the WHOLE file:
// patterns:  ,b=n("XXX")   ;  b={...}   ;  b.a={...}
function declOf(id) {
  const pats = [
    new RegExp('[,;{(]\\s*' + id + '\\s*=\\s*n\\(("[^"]+")\\)', 'g'),
    new RegExp('[,;{(]\\s*' + id + '\\s*=\\s*\\{', 'g'),
    new RegExp('[,;\\s]' + id + '\\.a\\s*=\\s*\\{', 'g'),
    new RegExp('[,;\\s]' + id + '\\.a\\s*=\\s*n\\(("[^"]+")\\)', 'g'),
  ];
  for (const p of pats) {
    p.lastIndex = 0;
    const m = p.exec(s);
    if (m) return { idx: m.index, kind: p.source, mod: m[1] || null };
  }
  return null;
}

// Extract a module definition body: "<modid>":function(e,t,n){...}
function moduleBody(modId) {
  const raw = modId[0] === '"' || modId[0] === "'" ? modId.slice(1, -1) : modId;
  const key = raw.replace(/\\(.)/g, '$1');
  const needles = [`${key}:function`];
  for (const nd of needles) {
    let i = s.indexOf(nd);
    while (i !== -1) {
      // ensure it's a module key (preceded by { or ,)
      const prev = s[i - 1];
      if (i > 0 && !(prev === '{' || prev === ',')) { i = s.indexOf(nd, i + 1); continue; }
      if (prev === '{' || prev === ',') {
        // find body start
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

function keysOfMapLiteral(body) {
  // top-level keys of the returned object
  const res = [];
  // find `return{...}` or `e.exports={...}` at low depth
  let i = body.indexOf('return{');
  if (i < 0) i = body.indexOf('exports={');
  if (i < 0) return res;
  const brace = body.indexOf('{', i);
  let depth = 0, j = brace;
  for (; j < body.length; j++) {
    if (body[j] === '{') depth++;
    else if (body[j] === '}') { depth--; if (depth === 0) break; }
  }
  const inner = body.slice(brace + 1, j);
  // top-level commas
  let d = 0, cur = '', parts = [];
  for (const ch of inner) {
    if ('{[('.includes(ch)) d++;
    else if ('}])'.includes(ch)) d--;
    if (ch === ',' && d === 0) { parts.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  for (const p of parts) {
    const m = /^\s*([A-Za-z_$][\w$]*)\s*:/.exec(p);
    if (m) res.push(m[1]);
    else if (/^\s*[A-Za-z_$][\w$]*\s*$/.test(p)) res.push(p.trim());
  }
  return res;
}

log('=== INFRASTRUCTURE PRELOAD NAMESPACES ===');
for (const [ns, id] of Object.entries(nsMap)) {
  const d = declOf(id);
  if (!d) { log(`\n## ${ns} (${id}) — declaration not found`); continue; }
  if (!d.mod) {
    log(`\n## ${ns} (${id}) — inline object literal at @${d.idx}`);
    const seg = s.slice(d.idx, d.idx + 1400);
    const keys = [...seg.matchAll(/([A-Za-z_$][\w$]*):\{/g)].map(x => x[1]).slice(0, 40);
    log('   keys: ' + (keys.join(', ') || '(none parsed)'));
    continue;
  }
  const body = moduleBody(d.mod);
  if (!body) { log(`\n## ${ns} (${id}) — module ${d.mod} not found`); continue; }
  const keys = keysOfMapLiteral(body);
  log(`\n## ${ns} (${id} -> n(${d.mod}))  body ${body.length} bytes`);
  log('   keys (' + keys.length + '): ' + (keys.join(', ') || '(not a return-literal)'));
}

fs.writeFileSync(__dirname + '/_r6_infra_ns.txt', out.join('\n') + '\n');
console.log(out.join('\n'));
