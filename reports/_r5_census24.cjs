const fs = require('fs'), path = require('path');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const out = []; const log = (...a) => out.push(a.join(' '));
const pcd = path.join(ROOT, 'pc-dist');
const s = fs.readFileSync(path.join(pcd, 'lazy', 'default-login-main-startup-shared-worker-znotification.aafd08147de6e983b76f.js'), 'utf8');
const findAll = (str, n, max = 20) => { const h = []; let i = 0; while ((i = str.indexOf(n, i)) !== -1) { h.push(i); i += n.length; if (h.length >= max) break; } return h; };

log('=== 1. shape of the persisted CUSTOM setting (default object) ===');
{
  const o = s.indexOf('isOnlyMainBar:!1,isSingleColor:!0,isFollowDarkSystemToken:!1');
  log('  default setting @' + o);
  log('  ' + JSON.stringify(s.slice(Math.max(0, o - 500), o + 300)));
}
log('');

log('=== 2. every key name on the setting object (C(<obj>,{},{key:...}) writes) ===');
{
  const seg = s.slice(12800193, 13141015);
  const keys = new Set();
  for (const m of seg.matchAll(/\},\{\},\{\s*\[([a-zA-Z]+)\]/g)) keys.add(m[1]);
  log('  computed-key writes: ' + JSON.stringify([...keys]));
  const lit = new Set();
  for (const m of seg.matchAll(/\},\{\},\{([a-zA-Z_$][\w$]*):/g)) lit.add(m[1]);
  log('  literal-key writes: ' + JSON.stringify([...lit]));
}
log('');

log('=== 3. is there a boot-time apply (outside the settings panel module)? ===');
{
  // module iKSP bounds
  const imp = s.indexOf('dt=a("euSg")');
  const mStart = s.lastIndexOf(':function(e,t,n){', imp);
  let i = mStart, k = i - 1;
  while (k > 0 && /[A-Za-z0-9_+$\/.-]/.test(s[k])) k--;
  log('  iKSP module start @' + (k + 1) + ' key=' + s.slice(k + 1, i));
  // what renders it?
  const key = s.slice(k + 1, i);
  const uses = findAll(s, '"' + key + '"', 20);
  log('  references to iKSP module key: ' + uses.length);
  for (const u of uses.slice(0, 6)) log('    @' + u + ' :: ' + JSON.stringify(s.slice(Math.max(0, u - 240), u + 200)));
}
log('');

log('=== 4. za_theme_custom history: what is stored (whole setting objects) ===');
for (const o of findAll(s, 'za_theme_custom', 6)) log('  @' + o + ' :: ' + JSON.stringify(s.slice(Math.max(0, o - 320), o + 320)));
log('');

log('=== 5. does the app read theme conf at boot from the main process? ===');
for (const pat of ['get-theme-conf', 'onThemeChanged', 'setTheme', 'getTheme(']) {
  const hits = findAll(s, pat, 6);
  log('  ' + pat + ' = ' + hits.length);
  for (const h of hits.slice(0, 3)) log('    @' + h + ' :: ' + JSON.stringify(s.slice(Math.max(0, h - 260), h + 260)));
}
log('');

fs.writeFileSync(path.join(__dirname, '_r5_census24.txt'), out.join('\n') + '\n');
console.log(out.join('\n'));
