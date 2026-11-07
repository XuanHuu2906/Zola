const fs = require('fs');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const out = [];
const log = (...a) => { const l = a.map(String).join(' '); out.push(l); console.log(l); };

const N = js.length;
const depthAt = new Int32Array(N + 1);
{
  let d = 0, q = 0;
  for (let i = 0; i < N; i++) {
    depthAt[i] = d;
    const c = js.charCodeAt(i);
    if (q) { if (c === 92) { i++; depthAt[i] = d; continue; } if (c === q) q = 0; continue; }
    if (c === 34 || c === 39 || c === 96) { q = c; continue; }
    if (c === 123) d++; else if (c === 125) d--;
  }
  depthAt[N] = d;
}

// depth at the known module definitions
log('=== depth at known module keys ===');
const KNOWN = { TmDO: 9440450, euSg: 14376440, B5Cg: 3990965, CYG6: 4245911, RFxn: 8774196 };
for (const [k, at] of Object.entries(KNOWN)) {
  log(`  ${k} @${at}: depthAt=${depthAt[at]}  prefix="${js.slice(at - 40, at + 24)}"`);
}

// What is the depth of the webpack module map itself? Find the outermost
// "webpackJsonp" push / module map structure.
for (const needle of ['(this.webpackJsonp', 'webpackJsonp=', 'n.m=', 'function(e){var t={}']) {
  const i = js.indexOf(needle);
  log(`\n  "${needle}" @${i} depth=${i >= 0 ? depthAt[i] : 'n/a'}`);
}

// Alternative reliable discriminator: a webpack module key is immediately
// preceded by `,` or `{` and its function body is long (>2 KB) — object-literal
// handlers are short. Verify on known modules first.
const RE = /([A-Za-z0-9_$+\/]{2,24}):function\(([a-z]),([a-z]),([a-z])\)\{/g;
let m; const cands = [];
while ((m = RE.exec(js))) cands.push({ key: m[1], at: m.index, d: depthAt[m.index] });
log(`\n4-arg candidates = ${cands.length}`);

function endOf(at) { const d0 = depthAt[at]; for (let i = at; i < N; i++) if (depthAt[i] === d0 && js[i] === '}') return i; return N; }

// bucket by (depth, size)
const sized = cands.map((c) => ({ ...c, size: endOf(c.at) - c.at }));
for (const k of Object.keys(KNOWN)) {
  const at = KNOWN[k];
  const hit = sized.find((c) => c.at === at);
  log(`  ${k}: ${hit ? `found depth=${hit.d} size=${hit.size}` : 'not in 4-arg candidate list'}`);
}

// histogram of size by depth
const big = sized.filter((c) => c.size > 3000);
const dBig = {};
for (const c of big) dBig[c.d] = (dBig[c.d] || 0) + 1;
log('\nlarge(>3KB) modules by depth: ' + Object.entries(dBig).sort((a, b) => a[0] - b[0]).map((e) => `d${e[0]}=${e[1]}`).join(' '));

fs.writeFileSync('D:/Zalo/reports/_r3_modules3.txt', out.join('\n'), 'utf8');
