const fs = require('fs'), path = require('path');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const out = []; const log = (...a) => out.push(a.join(' '));
const pcd = path.join(ROOT, 'pc-dist');

const targets = [
  'pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js',
  'pc-dist/search-worker.f32c58b63b6f4273a8a4.js',
  'pc-dist/sync-v2-sub-worker.f32c58b63b6f4273a8a4.js',
  'pc-dist/lazy/default-login-main-startup-shared-worker-znotification.aafd08147de6e983b76f.js',
];

// Find the enclosing module bounds for an absolute offset by scanning for "<KEY>:function(a,b,c){".
function moduleBounds(s, pos) {
  // walk backwards
  let start = -1, key = null;
  for (let i = pos; i > Math.max(0, pos - 800000); i--) {
    if (s.startsWith(':function(', i)) {
      let k = i - 1;
      while (k > 0 && /[A-Za-z0-9_+$\/.-]/.test(s[k])) k--;
      key = s.slice(k + 1, i);
      if (key && key.length <= 24) { start = k + 1; break; }
    }
  }
  if (start < 0) return null;
  // walk forwards: next ",<KEY>:function(" at depth 0 is hard; approximate with next match containing typical module header
  const re = /,([A-Za-z0-9_+$\/.-]{2,24}):function\(([a-z]),([a-z]),([a-z])\)\{/g;
  re.lastIndex = pos;
  const m = re.exec(s);
  return { key, start, end: m ? m.index : s.length };
}

for (const rel of targets) {
  const s = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  log('######## ' + path.basename(rel) + ' ########');

  const sink = s.indexOf('document.getElementById("app-custom-theme")');
  const owner = moduleBounds(s, sink);
  log('  owner module = ' + owner.key + ' [' + owner.start + ',' + owner.end + ')');

  // exports of owner
  const obody = s.slice(owner.start, owner.end);
  const decls = [...obody.matchAll(/\.d\([a-z],"(?<x>[^"]+)",\(function\(\)\{return (?<y>\w+)\}\)\)/g)].map(x => x.groups.x + '->' + x.groups.y);
  log('  exports = ' + JSON.stringify(decls));

  // scrubber local + export
  const arrAt = obody.indexOf('"l","i","n","k"');
  let scrubLocal = null;
  if (arrAt >= 0) {
    const pre = obody.slice(Math.max(0, arrAt - 300), arrAt);
    const mm = /([A-Za-z_$][\w$]*)=\(\)=>\{var [a-z](?:,[a-z])+;const [a-z]=\[[^]{0,120}$/.exec(pre);
    scrubLocal = mm ? mm[1] : null;
  }
  let scrubExport = null;
  for (const d of decls) { const [k, v] = d.split('->'); if (v === scrubLocal) scrubExport = k; }
  log('  scrubber local=' + scrubLocal + ' export=' + scrubExport);

  // every import of owner.key, with the enclosing module bounds and whether alias.<scrubExport> is used inside
  const re = new RegExp('([A-Za-z_$][\\w$]*)\\s*=\\s*([A-Za-z_$][\\w$]*)\\("' + owner.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"\\)', 'g');
  const imports = [];
  let m;
  while ((m = re.exec(s)) !== null) imports.push({ alias: m[1], at: m.index });
  log('  imports of "' + owner.key + '" = ' + imports.length);

  for (const imp of imports) {
    const ib = moduleBounds(s, imp.at);
    if (!ib) { log('    import @' + imp.at + ' alias=' + imp.alias + ' (module bounds unresolved)'); continue; }
    const body = s.slice(ib.start, ib.end);
    const rel = imp.at - ib.start;
    const uses = [];
    let i = 0;
    while ((i = body.indexOf(imp.alias + '.' + scrubExport, i)) !== -1) { uses.push(i); i += 2; }
    log('    import @' + imp.at + ' alias=' + imp.alias + ' in module ' + ib.key + ' [' + (ib.end - ib.start) + ' B]; ' +
        imp.alias + '.' + scrubExport + ' uses inside that module = ' + uses.length +
        (uses.length ? ' :: ' + uses.slice(0, 6).map(x => 'rel@' + x).join(' ') : ''));
    for (const u of uses.slice(0, 4)) log('      :: ' + JSON.stringify(body.slice(Math.max(0, u - 180), u + 220)));
  }

  // belt-and-braces: any string-dispatch of the export name?
  for (const pat of ['"' + owner.key + '"', "'" + owner.key + "'"]) {
    // already counted; just note eval presence
  }
  log('  eval( = ' + (s.match(/\beval\(/g) || []).length + ' ; new Function( = ' + (s.match(/new Function\(/g) || []).length);
  log('');
}

fs.writeFileSync(path.join(__dirname, '_r5_census20.txt'), out.join('\n') + '\n');
console.log(out.join('\n'));
