const fs = require('fs'), path = require('path');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const out = []; const log = (...a) => out.push(a.join(' '));
const pcd = path.join(ROOT, 'pc-dist');
const s = fs.readFileSync(path.join(pcd, 'lazy', 'default-login-main-startup-shared-worker-znotification.aafd08147de6e983b76f.js'), 'utf8');

function moduleBounds(str, pos) {
  let start = -1, key = null;
  for (let i = pos; i > Math.max(0, pos - 900000); i--) {
    if (str.startsWith(':function(', i)) {
      let k = i - 1;
      while (k > 0 && /[A-Za-z0-9_+$\/.-]/.test(str[k])) k--;
      key = str.slice(k + 1, i);
      if (key && key.length <= 24) { start = k + 1; break; }
    }
  }
  if (start < 0) return null;
  const re = /,([A-Za-z0-9_+$\/.-]{2,24}):function\(([a-z]),([a-z]),([a-z])\)\{/g;
  re.lastIndex = pos;
  const m = re.exec(str);
  return { key, start, end: m ? m.index : str.length };
}

log('=== all euSg consumers and which exports each touches ===');
const impRe = /([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\("euSg"\)|([A-Za-z_$][\w$]*)\s*=\s*\(([^)]*),([A-Za-z_$][\w$]*)\("euSg"\)\)/g;
let m;
const seen = new Set();
while ((m = impRe.exec(s)) !== null) {
  const alias = m[1] || m[3];
  if (!alias || seen.has(m.index)) continue;
  seen.add(m.index);
  const mb = moduleBounds(s, m.index);
  if (!mb) continue;
  const body = s.slice(mb.start, mb.end);
  const members = {};
  for (const x of body.matchAll(new RegExp('\\b' + alias + '\\.([a-zA-Z])\\b', 'g'))) members[x[1]] = (members[x[1]] || 0) + 1;
  log('  alias ' + alias + ' in module ' + mb.key + ' :: ' + JSON.stringify(members));
}
log('');

log('=== does any module apply the theme (dt.a = sink writer) at module/boot scope? ===');
// dt.a call sites and their enclosing modules, excluding iJkc
const callRe = /\bdt\.a\)?\(/g;
while ((m = callRe.exec(s)) !== null) {
  const mb = moduleBounds(s, m.index);
  if (!mb) continue;
  if (mb.key === 'iJkc') continue;
  log('  dt.a @' + m.index + ' in ' + mb.key + ' :: ' + JSON.stringify(s.slice(Math.max(0, m.index - 200), m.index + 120)));
}
log('');

log('=== theme provider: getThemeSetting / apply on mount ===');
for (const pat of ['getThemeSetting', 'THEME_LISTENER_EVENTS.SETTING_UPDATED', 'applyTheme']) {
  let i = 0, n = 0;
  while ((i = s.indexOf(pat, i)) !== -1 && n < 8) { log('  ' + pat + ' @' + i + ' :: ' + JSON.stringify(s.slice(Math.max(0, i - 260), i + 260))); i += pat.length; n++; }
  log('  (' + pat + ' shown ' + n + ')');
  log('');
}

fs.writeFileSync(path.join(__dirname, '_r5_census26.txt'), out.join('\n') + '\n');
console.log(out.join('\n'));
