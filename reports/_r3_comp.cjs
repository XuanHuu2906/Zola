// R3: bundle-provided component/state boundaries.
// (1) DataAttributes.Component enum = shipped component identity, not a guess.
// (2) ModuleContainer.resolve = DI container boundaries.
// (3) React version + class-vs-function component census.
const fs = require('fs');
const acorn = require('acorn');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const LOG = 'D:/Zalo/reports/_r3_comp.txt';
fs.writeFileSync(LOG, '');
const log = (...a) => { const l = a.map(String).join(' '); console.log(l); fs.appendFileSync(LOG, l + '\n'); };

function occurrences(s, max = 0) {
  const out = []; let p = 0;
  while ((p = js.indexOf(s, p)) >= 0) { out.push(p); p += s.length; if (max && out.length >= max) break; }
  return out;
}

// ---------- (1) DataAttributes.Component enum ----------
log('=== DataAttributes.Component enum ===');
let enumSrc = null, enumAt = -1;
for (const anchor of ['Component.BUBBLE_MESSAGE', 'DataAttributes']) {
  const hits = occurrences(anchor, 6);
  log(`  anchor ${JSON.stringify(anchor)} -> ${hits.length} shown: ${hits.join(',')}`);
}
// find a literal object whose values look like component ids
const cands = [];
const re = /Component\s*:\s*\{/g; let m;
while ((m = re.exec(js))) cands.push(m.index);
log(`  /Component:\{/ candidates = ${cands.length}`);
for (const at of cands.slice(0, 6)) {
  log(`\n  --- candidate @${at} ---`);
  log('  ' + JSON.stringify(js.slice(at, at + 1400)));
}

// ---------- (2) module container ----------
log('\n=== DI / module container ===');
for (const s of ['ModuleContainer', 'resolve(', 'registerModule', 'ModuleRegistry', 'injectModule']) {
  const h = occurrences(s);
  log(`  ${s.padEnd(18)} occ=${String(h.length).padStart(5)} first=${h[0] ?? -1}`);
}
{
  const at = js.indexOf('ModuleContainer');
  if (at >= 0) log('  ctx: ' + JSON.stringify(js.slice(at - 300, at + 500)));
}

// ---------- (3) react version + component census ----------
log('\n=== react version ===');
for (const s of ['react-dom', 'ReactVersion', '18.', '17.0.2', '16.14', 'version:"1']) {
  const h = occurrences(s, 4);
  if (h.length) log(`  ${JSON.stringify(s).padEnd(20)} occ=${h.length} first=${h[0]}`);
}
{
  const at = js.indexOf('version:"');
  if (at >= 0) log('  version-literal ctx: ' + JSON.stringify(js.slice(at, at + 80)));
}

// createElement alias census: which identifier holds React
const aliasCensus = {};
for (const a of ['o.a.createElement', 'r.a.createElement', 'i.a.createElement', 's.a.createElement', 'A.a.createElement', 'c.a.createElement', 'l.a.createElement', 'u.a.createElement']) {
  const h = occurrences(a);
  if (h.length) aliasCensus[a] = h.length;
}
log('\n=== createElement alias census (top) ===');
for (const [k, v] of Object.entries(aliasCensus).sort((a, b) => b[1] - a[1]).slice(0, 12)) log(`  ${k.padEnd(24)} ${v}`);

log('\n=== class vs function component signals ===');
const CLS = [
  ['createClass(', ], ['extends ', ], ['React.Component', ], ['React.PureComponent', ],
  ['componentDidMount', ], ['componentWillUnmount', ], ['shouldComponentUpdate', ],
  ['render(){', ], ['render:function', ], ['this.state', ], ['this.props', ],
  ['useState(', ], ['useEffect(', ], ['useMemo(', ], ['useCallback(', ], ['useRef(', ],
  ['React.forwardRef', ], ['forwardRef(', ], ['memo(', ], ['PropTypes', ], ['propTypes=', ],
];
for (const [s] of CLS) {
  const n = occurrences(s).length;
  log(`  ${s.padEnd(26)} ${String(n).padStart(5)}`);
}

// ---------- (4) data-component values ----------
log('\n=== data-component / data-id literal values (top 40) ===');
const dc = new Map();
for (const mm of js.matchAll(/"data-component"\s*:\s*([A-Za-z0-9_.]+)/g)) {
  dc.set(mm[1], (dc.get(mm[1]) || 0) + 1);
}
log('  data-component attr count = ' + [...dc.values()].reduce((a, b) => a + b, 0));
for (const [k, v] of [...dc.entries()].slice(0, 40)) log(`    ${k.padEnd(46)} ${v}`);

log('\nwrote _r3_comp.txt');
