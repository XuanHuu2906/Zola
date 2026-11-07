const fs = require('fs');
const path = require('path');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const out = [];
const log = (...a) => out.push(a.join(' '));
const txt = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const findAll = (s, needle, max = 10) => {
  const h = []; let i = 0;
  while ((i = s.indexOf(needle, i)) !== -1) { h.push(i); i += needle.length; if (h.length >= max) break; }
  return h;
};

// 1. Resolve the module that defines loadExtension, then count require sites of its key.
for (const file of ['main-dist/main.js', 'main-dist/compact-app.js']) {
  const s = txt(file);
  log('=== ' + file + ' :: loadExtension definitions ===');
  for (const off of findAll(s, 'loadExtension', 6)) log('  @' + off + ' :: ' + JSON.stringify(s.slice(off - 260, off + 220)));
  log('');
}

// module key search: webpack-ish map entries "KEY":function(e,t,n){...}
const main = txt('main-dist/main.js');
log('=== module keys containing getAllExtensions (definition site) ===');
for (const off of findAll(main, 'getAllExtensions', 6)) {
  // walk backwards to nearest quoted module key of form "xxxx":function
  const back = main.slice(Math.max(0, off - 6000), off);
  const m = [...back.matchAll(/"([A-Za-z0-9+/_\-]{3,12})":function\(/g)];
  const key = m.length ? m[m.length - 1][1] : 'UNRESOLVED';
  log('  @' + off + ' key=' + JSON.stringify(key) + ' :: ' + JSON.stringify(main.slice(off - 120, off + 120)));
  if (key !== 'UNRESOLVED') {
    const reqs = findAll(main, 'n("' + key + '")', 20).concat(findAll(main, "'" + key + "'", 20));
    log('    require-site candidates (n("KEY") + quoted):', reqs.length);
  }
}
log('');

// 2. titleBarStyle sites
log('=== titleBarStyle sites (main.js) ===');
for (const off of findAll(main, 'titleBarStyle', 10)) log('  @' + off + ' :: ' + JSON.stringify(main.slice(off - 420, off + 320)));
log('');

// 3. webPreferences sites
log('=== webPreferences sites (main.js) ===');
for (const off of findAll(main, 'webPreferences', 12)) log('  @' + off + ' :: ' + JSON.stringify(main.slice(off - 60, off + 420)));
log('');

// 4. Any other style/script delivery surface
const surfaces = ['insertCSS', 'executeJavaScript', 'addStyleSheet', 'webRequest', 'onBeforeRequest',
  'onHeadersReceived', 'protocol.intercept', 'interceptHttpProtocol', 'setWindowOpenHandler',
  'dom-ready', 'did-finish-load', 'will-navigate', 'setUserAgent', 'loadFile', 'loadURL', 'BrowserView', 'WebContentsView'];
log('=== delivery-surface census ===');
log(['surface', ...['main.js', 'preload-render.js', 'compact-app.js', 'compact-app-preload.js'].map(f => f)].join('\t'));
for (const sName of surfaces) {
  const row = [sName];
  for (const f of ['main-dist/main.js', 'main-dist/preload-render.js', 'main-dist/compact-app.js', 'main-dist/compact-app-preload.js']) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    let n = 0, i = 0; while ((i = s.indexOf(sName, i)) !== -1) { n++; i += sName.length; }
    row.push(n);
  }
  log(row.join('\t'));
}
log('');

// 5. User-writable config paths that might be a supported customization hook
log('=== config/user customization vocabulary (main.js) ===');
for (const v of ['custom.css', 'customCss', 'userstyles', 'userscript', 'userChrome', 'style.css', 'theme.json', 'customTheme']) {
  let n = 0, i = 0; while ((i = main.indexOf(v, i)) !== -1) { n++; i += v.length; }
  log('  ' + v + ' = ' + n);
}
log('');

fs.writeFileSync(path.join(__dirname, '_r5_census2.txt'), out.join('\n') + '\n');
console.log(out.join('\n'));
