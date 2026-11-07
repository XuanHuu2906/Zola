const fs = require('fs'), path = require('path');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const out = []; const log = (...a) => out.push(a.join(' '));
const findAll = (s, n, max = 40) => { const h = []; let i = 0; while ((i = s.indexOf(n, i)) !== -1) { h.push(i); i += n.length; if (h.length >= max) break; } return h; };
const ctx = (s, o, b = 300, f = 400) => JSON.stringify(s.slice(Math.max(0, o - b), o + f));

const pcd = path.join(ROOT, 'pc-dist');
const chunk1 = path.join(pcd, 'lazy', 'default-login-main-startup-shared-worker-znotification.aafd08147de6e983b76f.js');
const s = fs.readFileSync(chunk1, 'utf8');
log('=== chunk1 = ' + path.basename(chunk1) + ' (' + s.length + ' B) — the main-window chunk loaded by render.js ===');
log('');

// --- locate the module that owns the sink ---
const sinkAt = s.indexOf('"app-custom-theme"');
log('sink anchor @' + sinkAt);
const modStart = s.lastIndexOf(':function(e,t,n){', sinkAt);
log('module start @' + modStart);
const keyMatch = /([A-Za-z0-9_+$/.-]{2,20}):function\(e,t,n\)\{$/.exec(s.slice(Math.max(0, modStart - 40), modStart + 24));
const modKey = keyMatch ? keyMatch[1] : null;
log('module key = ' + modKey);
log('');

// --- export map of that module ---
if (modKey) {
  const end = s.indexOf('},' + modKey, modStart); // unlikely; find next module key instead
  // slice from module start to +20000
  const seg = s.slice(modStart, modStart + 22000);
  const decls = [...seg.matchAll(/n\.d\(t,"([^"]+)",\(function\(\)\{return (\w+)\}\)\)/g)].map(m => m[1] + '->' + m[2]);
  log('export decls in this module: ' + JSON.stringify(decls));
  log('');
  // callers of the module by key
  const refs = findAll(s, 'n("' + modKey + '")', 20).concat(findAll(s, '("' + modKey + '")', 20))
    .filter((v, i, a) => a.indexOf(v) === i);
  log('references to module key (' + modKey + '): ' + refs.length);
  for (const r of refs.slice(0, 10)) log('  @' + r + ' :: ' + ctx(s, r, 200, 260));
}
log('');

// --- exact tail of the scrubber then what follows ---
const guardAt = s.indexOf('document.getElementsByTagName("body")', sinkAt);
log('=== scrubber tail (from body query to close) ===');
log(ctx(s, guardAt, 300, 700));
log('');

// --- is the scrubber invoked at module init, or exported as a function? ---
// find the local name the scrubber is bound to: "NAME=()=>{...selector...}"
{
  const seg = s.slice(Math.max(0, sinkAt - 4000), sinkAt + 200);
  const m = [...seg.matchAll(/([A-Za-z_$][\w$]*)=\(\)=>\{var e,t,n,a,i,r,s/g)].map(x => x[1]);
  log('scrubber binding candidates: ' + JSON.stringify(m));
  for (const name of m) {
    const calls = findAll(s, name + '()', 20);
    log('  ' + name + '()  call sites = ' + calls.length + (calls.length ? ' :: ' + calls.map(o => '@' + o).join(',') : ''));
  }
}
log('');

// --- does CUSTOM theme apply at boot? look for dt.a(contentCss) callers and the CUSTOM branch ---
log('=== "custom" class add/remove sites (context) ===');
for (const o of findAll(s, 'classList.add', 99)) {
  const snip = s.slice(o, o + 120);
  if (/CUSTOM|custom/.test(snip)) log('  @' + o + ' :: ' + JSON.stringify(snip));
}
log('');

fs.writeFileSync(path.join(__dirname, '_r5_census16.txt'), out.join('\n') + '\n');
console.log(out.join('\n'));
