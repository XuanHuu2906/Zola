const fs = require('fs'), path = require('path');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const out = []; const log = (...a) => out.push(a.join(' '));
const pcd = path.join(ROOT, 'pc-dist');
const s = fs.readFileSync(path.join(pcd, 'lazy', 'default-login-main-startup-shared-worker-znotification.aafd08147de6e983b76f.js'), 'utf8');
const findAll = (n, max = 30) => { const h = []; let i = 0; while ((i = s.indexOf(n, i)) !== -1) { h.push(i); i += n.length; if (h.length >= max) break; } return h; };

log('=== module B5Cg (theme store: getTheme/setTheme used by HuPi) ===');
{
  const i = s.indexOf('B5Cg:function');
  log('  B5Cg @' + i);
  if (i >= 0) {
    const m = /,([A-Za-z0-9_+$\/.-]{2,24}):function\([a-z],[a-z],[a-z]\)\{/.exec(s.slice(i, i + 120000));
    const b = s.slice(i, m ? i + m.index : i + 120000);
    log('  body ' + b.length + ' B');
    const decls = [...b.matchAll(/\.d\([a-z],"(?<x>[^"]+)",\(function\(\)\{return (?<y>\w+)\}\)\)/g)].map(x => x.groups.x + '->' + x.groups.y);
    log('  exports: ' + JSON.stringify(decls));
    // storage key + parse
    for (const k of ['za_theme', 'localStorage', 'JSON.parse', 'theme_setting', 'theme:']) {
      const h = findAll.call(null, 0);
    }
    const loc = [];
    let j = 0;
    while ((j = b.indexOf('za_theme"', j)) !== -1) { loc.push(j); j += 8; }
    log('  za_theme" sites in B5Cg = ' + loc.length);
    for (const o of loc.slice(0, 6)) log('    rel@' + o + ' :: ' + JSON.stringify(b.slice(Math.max(0, o - 420), o + 420)));
  }
}
log('');

log('=== where the saved CUSTOM palette is re-applied on boot ===');
{
  // the hook `Object(r.i)()` returns {themeSettingOpt, theme}; r = B5Cg
  // find provider that runs apply on mount
  const hits = findAll('themeSettingOpt', 20);
  log('  themeSettingOpt sites = ' + hits.length);
  for (const o of hits.slice(0, 8)) log('    @' + o + ' :: ' + JSON.stringify(s.slice(Math.max(0, o - 300), o + 320)));
}
log('');

fs.writeFileSync(path.join(__dirname, '_r5_census25.txt'), out.join('\n') + '\n');
console.log(out.join('\n'));
