const fs = require('fs'), path = require('path');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const out = []; const log = (...a) => out.push(a.join(' '));
const pcd = path.join(ROOT, 'pc-dist');
const s = fs.readFileSync(path.join(pcd, 'lazy', 'default-login-main-startup-shared-worker-znotification.aafd08147de6e983b76f.js'), 'utf8');

const idx = s.indexOf('TmDO:function');
const m = /,([A-Za-z0-9_+$\/.-]{2,24}):function\([a-z],[a-z],[a-z]\)\{/.exec(s.slice(idx, idx + 400000));
const body = s.slice(idx, m ? idx + m.index : idx + 400000);
log('TmDO body = ' + body.length + ' B');
log('');

// correct record shape: {token_name:"--x",alias:"B",step:"55",color:"#{...}"}
const recs = [...body.matchAll(/\{token_name:"([^"]+)",alias:"([^"]+)",step:"?(\d+)"?,color:/g)]
  .map(x => ({ token: x[1], alias: x[2], step: x[3] }));
log('=== TOKEN_MAP records parsed: ' + recs.length + ' ===');

// split light vs dark arrays
const lightAt = body.indexOf('f={light:[');
const darkAt = body.indexOf('],dark:[', lightAt);
const lightSeg = body.slice(lightAt, darkAt);
const darkSeg = body.slice(darkAt, darkAt + 60000);
const lightRecs = [...lightSeg.matchAll(/\{token_name:"([^"]+)",alias:"([^"]+)",step:"?(\d+)"?,color:/g)].map(x => x[1]);
const darkRecs = [...darkSeg.matchAll(/\{token_name:"([^"]+)",alias:"([^"]+)",step:"?(\d+)"?,color:/g)].map(x => x[1]);
log('  TOKEN_MAP.light = ' + lightRecs.length + ', TOKEN_MAP.dark = ' + darkRecs.length);
log('  unique token names total = ' + new Set([...lightRecs, ...darkRecs]).size);
log('');

// MAIN_COLOR_TOKEN value
const mi = body.indexOf('MAIN_COLOR_TOKEN');
// find "I=[" nearest after the export declaration
let mt = -1, mtn = body.indexOf('I=[');
if (mtn >= 0) mt = mtn;
if (mt < 0) { const re = /\bI=\[([^\]]*)\]/g; let mm; while ((mm = re.exec(body)) !== null) { mt = mm.index; break; } }
log('=== MAIN_COLOR_TOKEN raw (I=[...]) ===');
if (mt >= 0) log(JSON.stringify(body.slice(mt, mt + 700))); else log('not found by I=[');
log('');

// The generator A() iterates TOKEN_MAP.light and requires alias in MAIN_COLOR_TOKEN
// Extract the alias array textually
let aliases = [];
{
  const mm = /\bI=\[((?:"[^"]+"\s*,?\s*)+)\]/.exec(body);
  if (mm) aliases = [...mm[1].matchAll(/"([^"]+)"/g)].map(x => x[1]);
}
log('MAIN_COLOR_TOKEN entries (' + aliases.length + '): ' + JSON.stringify(aliases));
log('');

// Emittable set per generator A(): TOKEN_MAP.light ∩ alias∈MAIN_COLOR_TOKEN ∩ !token_name.includes('input-field-bg'|'border'|'divider')
const caught = new Set(['input-field-bg', 'border', 'divider']);
const lightFull = [...lightSeg.matchAll(/\{token_name:"([^"]+)",alias:"([^"]+)",step:"?(\d+)"?,color:/g)]
  .map(x => ({ token: x[1], alias: x[2] }));
const emittableLight = lightFull.filter(r => aliases.includes(r.alias) && ![...caught].some(c => r.token.includes(c)));
log('=== generator A() emittable (TOKEN_MAP.light) ===');
log('  candidates = ' + lightFull.length + ' ; emittable = ' + emittableLight.length);
log('  unique tokens = ' + new Set(emittableLight.map(r => r.token)).size);
log('  sample: ' + JSON.stringify(emittableLight.slice(0, 25).map(r => r.token)));
log('');

// Also: what fraction of all 376 tokens can ever be written?
const allTokens = new Set([...lightRecs, ...darkRecs]);
log('=== ceiling ===');
log('  TOKEN_MAP total unique = ' + allTokens.size);
log('  generator-A emittable unique = ' + new Set(emittableLight.map(r => r.token)).size);
log('  plus hardcoded extras emitted outside the loop (--text-primary, --title-bar, --layer-background-navbar-normal/hover/selected, --layer-background-gradient-on-color, --layer-background-selected/hover/pinned, --text-mention, --f*)');
log('');

fs.writeFileSync(path.join(__dirname, '_r5_census23.txt'), out.join('\n') + '\n');
console.log(out.join('\n'));
