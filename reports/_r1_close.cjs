const fs = require('fs');
const p = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js';
const s = fs.readFileSync(p, 'latin1');
const out = [];
const log = (...a) => { const l = a.map(String).join(' '); out.push(l); console.log(l); };

function moduleEnd(start) {
  // find the end of a webpack module function body: scan for "\n}," at depth 0
  let i = s.indexOf('function(', start);
  if (i < 0) i = start;
  let depth = 0, j = s.indexOf('{', i);
  for (; j < s.length; j++) {
    const c = s[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
  }
  return j;
}

function scanModule(name, start, limit) {
  const head = s.indexOf('function(', start);
  const end = moduleEnd(start);
  const len = end - start;
  log(`\n=== ${name} @${start} len=${len} ===`);
  const slice = s.slice(start, Math.min(end, start + limit));
  for (const needle of ['locals', 'backgroundPrimary', 'colorPrimary', 'mask-sidebar', 'className', 'classList', 'showModal']) {
    let idx = -1, n = 0, firsts = [];
    while ((idx = slice.indexOf(needle, idx + 1)) >= 0) { n++; if (firsts.length < 3) firsts.push(start + idx); }
    log(`  ${needle}: ${n}` + (n ? `  @${firsts.join(',')}` : ''));
  }
  return { start, end, len };
}

const cg = scanModule('CYG6', 4245911, 500000);
const rf = scanModule('RFxn', 8774196, 500000);

log('\n--- CYG6 tail (last 1200 chars) ---\n' + s.slice(cg.end - 1200, cg.end + 40));
log('\n--- RFxn tail (last 1200 chars) ---\n' + s.slice(rf.end - 1200, rf.end + 40));

for (const off of [18602657, 18606150]) {
  log(`\n--- site @${off} ---\n` + s.slice(off - 900, off + 900));
}

fs.writeFileSync('D:/Zalo/reports/_r1_close.txt', out.join('\n'), 'utf8');
