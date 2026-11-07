const fs = require('fs'), path = require('path');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const out = []; const log = (...a) => out.push(a.join(' '));
const pcd = path.join(ROOT, 'pc-dist');

const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
  const fp = path.join(d, e.name);
  return e.isDirectory() ? walk(fp) : [fp];
});
const js = walk(pcd).filter(f => f.endsWith('.js'));
log('total js files = ' + js.length);
log('');

log('=== every reference to the module key "euSg" (all quoting/forms) ===');
for (const f of js) {
  const s = fs.readFileSync(f, 'utf8');
  let i = -1, hits = [];
  while ((i = s.indexOf('euSg', i + 1)) !== -1) hits.push(i);
  if (!hits.length) continue;
  log('  [' + path.relative(pcd, f) + '] x' + hits.length);
  for (const o of hits) log('    @' + o + ' :: ' + JSON.stringify(s.slice(Math.max(0, o - 60), o + 40)));
}
log('');

log('=== Object(x)("euSg") / n("euSg") / any call form, per file ===');
for (const f of js) {
  const s = fs.readFileSync(f, 'utf8');
  const forms = [...s.matchAll(/(?:Object\()?([A-Za-z_$][\w$]*)(?:\))?\("euSg"\)/g)];
  if (forms.length) log('  [' + path.relative(pcd, f) + '] ' + forms.map(m => m[0]).join(' , '));
}
log('');

log('=== eval() / new Function() sites in the four guard-bearing bundles ===');
for (const rel of ['compact-app-pc.f32c58b63b6f4273a8a4.js', 'search-worker.f32c58b63b6f4273a8a4.js', 'sync-v2-sub-worker.f32c58b63b6f4273a8a4.js', 'lazy/default-login-main-startup-shared-worker-znotification.aafd08147de6e983b76f.js']) {
  const s = fs.readFileSync(path.join(pcd, rel), 'utf8');
  log('  [' + rel + ']');
  for (const m of s.matchAll(/\beval\(/g)) log('    eval @' + m.index + ' :: ' + JSON.stringify(s.slice(Math.max(0, m.index - 140), m.index + 140)));
  for (const m of s.matchAll(/new Function\(/g)) log('    newFunction @' + m.index + ' :: ' + JSON.stringify(s.slice(Math.max(0, m.index - 140), m.index + 140)));
}
log('');

log('=== sanity: is the sink writer (doc.getElementById("app-custom-theme")) reachable? count callers of the owner exports a/p ===');
log('  (exports map from euSg: in main chunks a->p(theme sink), g->f(scrubber); in lazily loaded chunk a->g(sink), g->p(scrubber))');

fs.writeFileSync(path.join(__dirname, '_r5_census21.txt'), out.join('\n') + '\n');
console.log(out.join('\n'));
