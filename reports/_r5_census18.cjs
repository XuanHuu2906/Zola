const fs = require('fs'), path = require('path');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const out = []; const log = (...a) => out.push(a.join(' '));
const findAll = (s, n, max = 60, from = 0, to = Infinity) => { const h = []; let i = from; while ((i = s.indexOf(n, i)) !== -1 && i < to) { h.push(i); i += n.length; if (h.length >= max) break; } return h; };

const pcd = path.join(ROOT, 'pc-dist');
const chunk1 = path.join(pcd, 'lazy', 'default-login-main-startup-shared-worker-znotification.aafd08147de6e983b76f.js');
const s = fs.readFileSync(chunk1, 'utf8');

// Module euSg body range: from its declaration to the next top-level module key.
const start = s.indexOf('euSg:function(t,n,a)');
log('euSg module start @' + start);
// find next ",<KEY>:function(" after the sink
const after = s.indexOf('_=e=>{let t=document.getElementById("app-custom-font")', start);
const nextMod = /,\s*([A-Za-z0-9_+$\/.-]{2,24}):function\(([a-z]),([a-z]),([a-z])\)\{/.exec(s.slice(after, after + 30000));
const end = nextMod ? after + nextMod.index : -1;
log('next module key after sink: ' + (nextMod ? nextMod[1] : 'not found') + ' @' + end);
log('euSg module body length ≈ ' + (end > 0 ? (end - start) : 'unknown'));
log('');

const body = s.slice(start, end > 0 ? end : start + 60000);
log('=== is the scrubber p() called inside its own module? ===');
for (const o of findAll(body, 'p()', 20)) log('  rel@' + o + ' :: ' + JSON.stringify(body.slice(Math.max(0, o - 260), o + 200)));
log('');

log('=== is the sink writer g(...) called inside its own module? ===');
for (const o of findAll(body, 'g(', 30)) log('  rel@' + o + ' :: ' + JSON.stringify(body.slice(Math.max(0, o - 160), o + 160)));
log('');

log('=== imports of euSg and all member accesses on the alias, within the importing module ===');
{
  const impAt = s.indexOf('dt=a("euSg")');
  log('  import site @' + impAt);
  // importing module boundary: find module start
  const mStart = s.lastIndexOf(':function(e,t,n){', impAt);
  const mNext = /,\s*([A-Za-z0-9_+$\/.-]{2,24}):function\(([a-z]),([a-z]),([a-z])\)\{/.exec(s.slice(impAt, impAt + 400000));
  const mEnd = mNext ? impAt + mNext.index : impAt + 400000;
  log('  importing module: start @' + mStart + ' end @' + mEnd + ' (len ' + (mEnd - mStart) + ')');
  const mod = s.slice(mStart, mEnd);
  const members = {};
  for (const m of mod.matchAll(/\bdt\.([a-z])\b/g)) members[m[1]] = (members[m[1]] || 0) + 1;
  log('  dt.<member> counts: ' + JSON.stringify(members));
  for (const [mem, cnt] of Object.entries(members)) {
    for (const o of findAll(mod, 'dt.' + mem, 6)) log('    dt.' + mem + ' rel@' + o + ' :: ' + JSON.stringify(mod.slice(Math.max(0, o - 220), o + 260)));
  }
}
log('');

fs.writeFileSync(path.join(__dirname, '_r5_census18.txt'), out.join('\n') + '\n');
console.log(out.join('\n'));
