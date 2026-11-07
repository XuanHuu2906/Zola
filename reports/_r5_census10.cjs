const fs = require('fs'), path = require('path');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const out = []; const log = (...a) => out.push(a.join(' '));
const main = fs.readFileSync(path.join(ROOT, 'main-dist/main.js'), 'utf8');
const findAll = (s, n, max = 20) => { const h = []; let i = 0; while ((i = s.indexOf(n, i)) !== -1) { h.push(i); i += n.length; if (h.length >= max) break; } return h; };

log('=== getHtml definition (ZQzv) ===');
{
  const i = main.indexOf('function A(){return p.join(__dirname');
  log(i >= 0 ? JSON.stringify(main.slice(Math.max(0, i - 300), i + 800)) : 'not found');
}
log('');

log('=== ne("login.html") call site context ===');
{
  const offs = findAll(main, 'ne("login.html")', 4);
  for (const o of offs) log('  @' + o + ' :: ' + JSON.stringify(main.slice(Math.max(0, o - 900), o + 300)));
}
log('');

log('=== definitions of ne / qt (login url builders) ===');
for (const pat of ['function ne(', 'function qt(', 'const ne=', 'ne=function']) {
  for (const o of findAll(main, pat, 6)) log('  [' + pat + '] @' + o + ' :: ' + JSON.stringify(main.slice(Math.max(0, o - 200), o + 500)));
}
log('');

log('=== CSS reachable from user-writable dirs? (.css path joins) ===');
for (const o of findAll(main, '.css', 40)) {
  const snip = main.slice(Math.max(0, o - 120), o + 60);
  if (/userData|getPath|appData|homedir|readFile/.test(snip)) log('  @' + o + ' :: ' + JSON.stringify(snip));
}
log('');

log('=== readFileSync of css anywhere in any bundle ===');
const dir = path.join(ROOT, 'main-dist');
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
  const s = fs.readFileSync(path.join(dir, f), 'utf8');
  let n = 0;
  for (const o of findAll(s, 'readFileSync', 9999)) {
    const snip = s.slice(Math.max(0, o - 200), o + 120);
    if (/\.css|style/i.test(snip)) { n++; if (n <= 3) log('  [' + f + '] @' + o + ' :: ' + JSON.stringify(snip)); }
  }
  if (n) log('  [' + f + '] total css-adjacent readFileSync = ' + n);
}
log('');

log('=== index.html boot script applyBgDefaultByTheme (full) ===');
{
  const html = fs.readFileSync(path.join(ROOT, 'pc-dist/index.html'), 'utf8');
  const i = html.indexOf('applyBgDefaultByTheme');
  log(i >= 0 ? JSON.stringify(html.slice(Math.max(0, i - 900), i + 1400)) : 'not found');
}
log('');

log('=== compact-app.html body (full) ===');
log(fs.readFileSync(path.join(ROOT, 'pc-dist/compact-app.html'), 'utf8'));
log('');

fs.writeFileSync(path.join(__dirname, '_r5_census10.txt'), out.join('\n') + '\n');
console.log(out.join('\n'));
