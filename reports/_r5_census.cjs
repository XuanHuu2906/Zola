const fs = require('fs');
const path = require('path');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const out = [];
const log = (...a) => out.push(a.join(' '));

function read(rel) { return fs.readFileSync(path.join(ROOT, rel)); }
function text(rel) { return read(rel).toString('utf8'); }
function count(buf, needle) {
  const s = buf.toString('utf8');
  let n = 0, i = 0;
  while ((i = s.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}
function findAll(s, needle, max = 8) {
  const hits = []; let i = 0;
  while ((i = s.indexOf(needle, i)) !== -1) { hits.push(i); i += needle.length; if (hits.length >= max) break; }
  return hits;
}

log('=== R5 CENSUS ===');
log('root =', ROOT);
log('');

const mainIdx = path.join(ROOT, 'main-dist');
log('main-dist files:');
for (const f of fs.readdirSync(mainIdx)) {
  const st = fs.statSync(path.join(mainIdx, f));
  if (st.isDirectory()) { log('  DIR ', f); continue; }
  log('  ', f, st.size);
}
log('');

const probes = ['insertCSS', 'executeJavaScript', 'addStyleSheet', 'loadExtension', 'getAllExtensions',
  'setBackgroundMaterial', 'vibrancy', 'Vibrancy', 'acrylic', 'transparent:!0', 'titleBarStyle',
  'appendSwitch', 'commandLine', 'setWindowOpenHandler', 'will-attach-webview',
  'exposeInMainWorld', 'contextBridge', 'trustPathFromBlob', 'nativeWindowOpen', 'backgroundColor'];
const files = ['main-dist/main.js', 'main-dist/preload-render.js', 'main-dist/compact-app.js',
  'main-dist/compact-app-preload.js', 'main-dist/preload-noti.js', 'main-dist/bootstrap.js'];
log('=== API CENSUS (literal substring counts) ===');
log(['file', 'bytes', ...probes].join('\t'));
for (const f of files) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) { log(f + '\tMISSING'); continue; }
  const buf = fs.readFileSync(p);
  log([f, buf.length, ...probes.map(n => count(buf, n))].join('\t'));
}
log('');

// CSP
const idxHtml = text('pc-dist/index.html');
log('=== CSP (pc-dist/index.html) ===');
const cspMatch = idxHtml.match(/Content-Security-Policy" content="([^"]+)"/s);
log('csp has meta:', !!cspMatch, 'index.html bytes:', idxHtml.length);
if (cspMatch) {
  log('csp offset:', idxHtml.indexOf('Content-Security-Policy'));
  log(cspMatch[1]);
}
log('');
const compactHtml = text('pc-dist/compact-app.html');
log('compact-app.html has CSP meta:', /Content-Security-Policy/.test(compactHtml), 'bytes:', compactHtml.length);
log('');

// appendSwitch literals
const main = text('main-dist/main.js');
log('=== commandLine.appendSwitch call sites (main.js) ===');
for (const off of findAll(main, 'appendSwitch')) log('  @' + off + ' :: ' + JSON.stringify(main.slice(off - 60, off + 140)));
log('');

log('=== process.argv reads (main.js) ===');
const argvHits = findAll(main, 'process.argv', 40);
for (const off of argvHits) log('  @' + off + ' :: ' + JSON.stringify(main.slice(off - 80, off + 100)));
log('');

// window creation
log('=== setBackgroundColor / app_theme near window creation ===');
for (const off of findAll(main, 'setBackgroundColor', 6)) log('  @' + off + ' :: ' + JSON.stringify(main.slice(off - 220, off + 80)));
log('');

// electron-devtools-installer identity
log('=== electron-devtools-installer identity ===');
for (const off of findAll(main, 'electron-devtools-installer', 8)) log('  @' + off + ' :: ' + JSON.stringify(main.slice(off - 120, off + 120)));
log('');

// preload allowlist
const preloadName = fs.existsSync(path.join(ROOT, 'main-dist/preload-render.js')) ? 'main-dist/preload-render.js' : null;
if (preloadName) {
  const pre = text(preloadName);
  const names = [...pre.matchAll(/exposeInMainWorld\(\s*"([^"]+)"/g)].map(m => m[1]);
  log('=== exposeInMainWorld names (' + names.length + ') ===');
  log(names.join(' '));
  log('');
  const trustHits = findAll(pre, 'trustPathFromBlob', 4);
  for (const off of trustHits) log('  trustPathFromBlob @' + off + ' :: ' + JSON.stringify(pre.slice(off - 160, off + 120)));
  log('');
}

fs.writeFileSync(path.join(__dirname, '_r5_census.txt'), out.join('\n') + '\n');
console.log(out.join('\n'));
