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

for (const rel of targets) {
  const s = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  log('######## ' + rel + ' (' + s.length + ' B) ########');

  // module that owns the sink
  const sink = s.indexOf('document.getElementById("app-custom-theme")');
  const modStart = s.lastIndexOf(':', sink);
  // find enclosing module declaration by scanning back for "<key>:function("
  let keyStart = -1, key = null;
  for (let i = sink; i > sink - 40000 && i > 0; i--) {
    if (s.startsWith(':function(', i)) {
      // read key backwards
      let j = i - 1, k = j;
      while (k > 0 && /[A-Za-z0-9_+$\/.-]/.test(s[k])) k--;
      key = s.slice(k + 1, j + 1);
      keyStart = k + 1;
      break;
    }
  }
  log('  module key = ' + key + ' @' + keyStart);

  // module end: next ",<KEY>:function(" after sink
  const m = /,([A-Za-z0-9_+$\/.-]{2,24}):function\([a-z],[a-z],[a-z]\)\{/.exec(s.slice(sink, sink + 60000));
  const modEnd = m ? sink + m.index : s.length;
  const body = s.slice(keyStart, modEnd);
  log('  module body = ' + body.length + ' B, next key = ' + (m ? m[1] : 'EOF'));

  // export map
  const decls = [...body.matchAll(/\.d\([a-z],"(?<x>[^"]+)",\(function\(\)\{return (?<y>\w+)\}\)\)/g)].map(x => x.groups.x + '->' + x.groups.y);
  log('  exports = ' + JSON.stringify(decls));

  // scrubber local name:  NAME=()=>{...["l","i","n","k"...
  const arrAt = body.indexOf('"l","i","n","k"');
  let scrubLocal = null;
  if (arrAt >= 0) {
    const pre = body.slice(Math.max(0, arrAt - 260), arrAt);
    const mm = /([A-Za-z_$][\w$]*)=\(\)=>\{var [a-z],[a-z],[a-z],[a-z],[a-z],[a-z],[a-z];const [a-z]=\[[^]{0,80}$/.exec(pre);
    scrubLocal = mm ? mm[1] : null;
  }
  log('  scrubber local = ' + scrubLocal + ' (selector array @rel' + arrAt + ')');

  // which export name maps to scrubber local
  let scrubExport = null;
  for (const d of decls) { const [k, v] = d.split('->'); if (v === scrubLocal) scrubExport = k; }
  log('  scrubber export = ' + scrubExport);

  // is scrubLocal invoked anywhere in this bundle?
  if (scrubLocal) {
    const inv = [];
    let i = 0;
    while ((i = s.indexOf(scrubLocal + '(', i)) !== -1) { inv.push(i); i += scrubLocal.length + 1; }
    // exclude definition site and other identifiers ending in the name
    const real = inv.filter(o => s[o - 1] !== '.' && /[^A-Za-z0-9_$]/.test(s[o - 1] || ' '));
    log('  bare ' + scrubLocal + '() occurrences in whole bundle = ' + real.length + (real.length ? ' :: ' + real.slice(0, 12).map(x => '@' + x).join(' ') : ''));
  }

  // any import of this module key elsewhere, and .<scrubExport>( usage
  if (key) {
    const imp = [];
    let i = 0;
    while ((i = s.indexOf('("' + key + '")', i)) !== -1) { imp.push(i); i += key.length + 4; }
    log('  imports of "' + key + '" = ' + imp.length);
    if (scrubExport) {
      // collect aliases
      const aliases = new Set();
      for (const o of imp) {
        const pre = s.slice(Math.max(0, o - 80), o);
        const mm = /([A-Za-z_$][\w$]*)\s*=\s*[A-Za-z_$][\w$]*\s*$/.exec(pre);
        if (mm) aliases.add(mm[1]);
      }
      log('  aliases = ' + JSON.stringify([...aliases]));
      let used = 0;
      for (const al of aliases) {
        let j = 0;
        while ((j = s.indexOf(al + '.' + scrubExport, j)) !== -1) { used++; log('    ' + al + '.' + scrubExport + ' @' + j + ' :: ' + JSON.stringify(s.slice(Math.max(0, j - 120), j + 160))); j += 2; }
      }
      log('  scrubber export member accesses = ' + used);
    }
  }
  log('');
}

fs.writeFileSync(path.join(__dirname, '_r5_census19.txt'), out.join('\n') + '\n');
console.log(out.join('\n'));
