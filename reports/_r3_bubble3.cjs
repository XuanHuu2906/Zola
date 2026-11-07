const fs = require('fs');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const css = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.css', 'latin1');
const out = [];
const log = (...a) => out.push(a.map(String).join(' '));
const R = [];
(function () {
  let i = 0;
  while (i < css.length) {
    const o = css.indexOf('{', i); if (o < 0) break;
    const c = css.indexOf('}', o); if (c < 0) break;
    const sel = css.slice(i, o).trim();
    if (sel && !sel.startsWith('@')) R.push({ at: i, sel, body: css.slice(o + 1, c) });
    i = c + 1; while (i < css.length && /[\s;]/.test(css[i])) i++;
  }
})();

// selector parts (split commas) that are exactly .card or .card.<mod>
function parts(sel) { return sel.split(',').map(s => s.trim()); }
log('=== rules with an exact ".card" selector part ===');
let n = 0;
for (const r of R) {
  const ps = parts(r.sel);
  if (ps.some(p => /^\.card(\.[A-Za-z0-9_-]+)*$/.test(p))) {
    const idx = ps.findIndex(p => /^\.card(\.[A-Za-z0-9_-]+)*$/.test(p));
    log(`\n@${r.at}  part= ${ps[idx]}`);
    log(`   sel(${ps.length} parts, showing 3): ${ps.slice(0, 3).join(' | ').slice(0, 300)}`);
    log(`   body: ${r.body}`);
    if (++n >= 12) break;
  }
}

log('\n=== .card--text full rules ===');
for (const r of R) {
  const ps = parts(r.sel);
  if (ps.some(p => /\.card--text/.test(p)) && r.body.length < 900) {
    log(`\n@${r.at} parts=${ps.length}`);
    log(`   sel: ${ps.filter(p => /card--text/.test(p)).slice(0, 3).join(' | ').slice(0, 300)}`);
    log(`   body: ${r.body}`);
  }
}

log('\n=== token definitions for bubble surfaces ===');
const TOK = ['--blue-message', '--white-message', '--blue-message-selected', '--shadow-bubble', '--bg-message-info', '--timestamp', '--jump-to-message', '--NG10', '--layer-background-CSC', '--divider-bold', '--layer-background-navbar-normal', '--title-bar', '--curtain', '--shadow-overlay', '--border'];
for (const t of TOK) {
  const re = new RegExp('(^|[;{])' + t.replace(/-/g, '\\-') + ':([^;}]+)', 'g');
  const hits = [...css.matchAll(re)].slice(0, 6).map(m => m[2].trim());
  log(`  ${t} => ${JSON.stringify(hits)}`);
}

fs.writeFileSync('D:/Zalo/reports/_r3_bubble3.txt', out.join('\n'));
console.log('done ' + out.length);
