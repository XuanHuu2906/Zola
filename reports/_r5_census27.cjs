const fs = require('fs'), path = require('path');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const out = []; const log = (...a) => out.push(a.join(' '));
const pcd = path.join(ROOT, 'pc-dist');
const s = fs.readFileSync(path.join(pcd, 'lazy', 'default-login-main-startup-shared-worker-znotification.aafd08147de6e983b76f.js'), 'utf8');

log('=== _saveSetting / getColorByTheme (what is persisted) ===');
for (const pat of ['getColorByTheme', '_saveSetting(']) {
  let i = 0, n = 0;
  while ((i = s.indexOf(pat, i)) !== -1 && n < 5) { log('  ' + pat + ' @' + i + ' :: ' + JSON.stringify(s.slice(Math.max(0, i - 300), i + 420))); i += pat.length; n++; }
  log('');
}

log('=== is contentCss ever persisted? ===');
const cc = [];
let i = 0;
while ((i = s.indexOf('contentCss', i)) !== -1) { cc.push(i); i += 10; }
log('  contentCss occurrences = ' + cc.length);
for (const o of cc) {
  const seg = s.slice(Math.max(0, o - 260), o + 200);
  const persists = /localStorage\.setItem|_saveSetting|\$zconfig/.test(seg);
  log('    @' + o + ' persist=' + persists + ' :: ' + JSON.stringify(seg.slice(120, 360)));
}
log('');

log('=== what does static CSS define for `.custom` (non-token chrome)? ===');
const cssFiles = fs.readdirSync(pcd).filter(f => f.endsWith('.css'));
let total = 0;
for (const f of cssFiles) {
  const c = fs.readFileSync(path.join(pcd, f), 'utf8');
  const rules = [...c.matchAll(/\.custom[^{,]*\{([^}]*)\}/g)];
  if (!rules.length) continue;
  log('  [' + f + '] .custom rules = ' + rules.length);
  const props = new Set();
  for (const r of rules) for (const m of r[1].matchAll(/([a-zA-Z-]+)\s*:/g)) props.add(m[1]);
  log('    non-custom-property declarations: ' + JSON.stringify([...props].filter(p => !p.startsWith('--')).slice(0, 30)));
  log('    custom-property declarations    : ' + [...props].filter(p => p.startsWith('--')).length);
  total += rules.length;
}
log('  total .custom rules = ' + total);
log('');

fs.writeFileSync(path.join(__dirname, '_r5_census27.txt'), out.join('\n') + '\n');
console.log(out.join('\n'));
