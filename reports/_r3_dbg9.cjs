// R3 diagnostic: what surrounds the un-attributable conversation-list region?
const fs = require('fs');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const out = [];
const log = (...a) => { const l = a.map(String).join(' '); out.push(l); console.log(l); };

const ivs = JSON.parse(fs.readFileSync('D:/Zalo/reports/_r3_modules6_intervals.json', 'utf8'));
log(`intervals=${ivs.length}`);

// intervals starting between 12.1M and 12.5M
const near = ivs.filter((v) => v[1] > 12_100_000 && v[1] < 12_600_000);
log(`intervals with start in 12.1M..12.6M = ${near.length}`);
for (const [k, at, end] of near) log(`  ${k} @${at} end=${end} len=${end - at}`);

// nearest preceding interval of 12,393,315
let best = null;
for (const v of ivs) if (v[1] <= 12_393_315 && (!best || v[1] > best[1])) best = v;
log(`\nnearest preceding: ${best[0]} @${best[1]} end=${best[2]}`);
log('\n--- text at that module end .. +1200 ---');
log(JSON.stringify(js.slice(best[2] - 400, best[2] + 800)));

// any header-like thing in 12,305,492..12,400,000 of other shapes
const span = js.slice(best[2], 12_400_000);
const shapes = {
  'name:function(': (span.match(/[A-Za-z0-9_$+\/]{1,40}:function\(/g) || []).length,
  'name:function (': (span.match(/[A-Za-z0-9_$+\/]{1,40}:function\s+\(/g) || []).length,
  'name:(e,t,n)=>{': (span.match(/[A-Za-z0-9_$+\/]{1,40}:\([a-z],[a-z],[a-z]\)=>\{/g) || []).length,
  'name:(e,t,n)=>': (span.match(/[A-Za-z0-9_$+\/]{1,40}:\([a-z],[a-z],[a-z]\)=>/g) || []).length,
  'anykey:function': (span.match(/"[^"]{1,40}":function\(/g) || []).length,
  'function(e,t,n){': (span.match(/function\([a-z],[a-z],[a-z]\)\{/g) || []).length,
  'webpackJsonp': (span.match(/webpackJsonp/g) || []).length,
  'push([[id]': (span.match(/\.push\(\[\[/g) || []).length,
};
log('\n--- header shapes in gap ---');
for (const [k, v] of Object.entries(shapes)) log(`  ${k} = ${v}`);

// find the enclosing braces of 12,393,315 by scanning backwards/forwards with balanced brace count
// crude but regex-free: count only via tokenizer on a modest window
const acorn = require('acorn');
const lo = 12_280_000;
const sub = js.slice(lo, 12_460_000);
const tok = acorn.tokenizer(sub, { ecmaVersion: 2022 });
let d = 0, n = 0;
for (;;) {
  let t;
  try { t = tok.getToken(); } catch (e) { log(`tokenizer stop @+${tok.pos}: ${e.message}`); break; }
  n++;
  if (t.type.label === 'eof') break;
}
log(`\ntokenizer over window 12.28M..12.46M: tokens=${n}, stopped at abs=${lo + tok.pos}`);

fs.writeFileSync('D:/Zalo/reports/_r3_dbg9.txt', out.join('\n'), 'utf8');
