const fs = require('fs'), path = require('path');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const out = []; const log = (...a) => out.push(a.join(' '));
const findAll = (s, n, max = 60) => { const h = []; let i = 0; while ((i = s.indexOf(n, i)) !== -1) { h.push(i); i += n.length; if (h.length >= max) break; } return h; };

const pcd = path.join(ROOT, 'pc-dist');
const chunk1 = path.join(pcd, 'lazy', 'default-login-main-startup-shared-worker-znotification.aafd08147de6e983b76f.js');
const s = fs.readFileSync(chunk1, 'utf8');

log('=== consumers of module euSg (which owns sink=g / guard=p) ===');
const imports = findAll(s, '"euSg"', 60);
log('  literal "euSg" occurrences: ' + imports.length);
for (const o of imports.slice(0, 40)) log('  @' + o + ' :: ' + JSON.stringify(s.slice(Math.max(0, o - 220), o + 300)));
log('');

// The namespace variable assigned from euSg, then .g( / .a( calls on it
log('=== namespace aliases for euSg and their member calls ===');
{
  const seen = new Set();
  for (const o of imports) {
    const seg = s.slice(Math.max(0, o - 60), o + 10);
    const m = /([A-Za-z_$][\w$]*)\s*=\s*(?:Object\()?\s*[A-Za-z_$][\w$]*\("euSg"\)/.exec(seg);
    if (m && !seen.has(m[1])) {
      seen.add(m[1]);
      log('  alias = ' + m[1]);
      for (const mem of ['g', 'a', 'i', 'c', 'd', 'e', 'b', 'f', 'h', 'j']) {
        const sites = findAll(s, m[1] + '.' + mem + '(', 20);
        if (sites.length) log('    ' + m[1] + '.' + mem + '() x' + sites.length + ' :: ' + sites.slice(0, 8).map(x => '@' + x).join(','));
      }
    }
  }
}
log('');

// Also catch inline Object(x)("euSg").g(...) style
log('=== inline Object(...)("euSg").member calls ===');
for (const o of imports) {
  const after = s.slice(o + 6, o + 40);
  if (/^\)\.[a-z]\(/.test(after)) log('  @' + o + ' :: ' + JSON.stringify(s.slice(Math.max(0, o - 90), o + 160)));
}
log('');

// Does .g( appear with a string/template argument? show the call site context
log('=== scrubber export .g( call sites with arguments ===');
{
  const seen = new Set();
  for (const o of imports) {
    const seg = s.slice(Math.max(0, o - 60), o + 10);
    const m = /([A-Za-z_$][\w$]*)\s*=\s*(?:Object\()?\s*[A-Za-z_$][\w$]*\("euSg"\)/.exec(seg);
    if (!m || seen.has(m[1])) continue; seen.add(m[1]);
    for (const p of findAll(s, m[1] + '.g(', 10)) log('  ' + m[1] + '.g @' + p + ' :: ' + JSON.stringify(s.slice(Math.max(0, p - 200), p + 260)));
  }
}
log('');

fs.writeFileSync(path.join(__dirname, '_r5_census17.txt'), out.join('\n') + '\n');
console.log(out.join('\n'));
