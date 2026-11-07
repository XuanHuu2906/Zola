const fs = require('fs'), path = require('path');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const out = []; const log = (...a) => out.push(a.join(' '));
const pcd = path.join(ROOT, 'pc-dist');
const chunk1 = path.join(pcd, 'lazy', 'default-login-main-startup-shared-worker-znotification.aafd08147de6e983b76f.js');
const s = fs.readFileSync(chunk1, 'utf8');

// Module TmDO holds COLOR keys. Locate it.
const idx = s.indexOf('TmDO:function');
log('TmDO module @' + idx);
// module bounds
let start = idx, end = -1;
const m = /,([A-Za-z0-9_+$\/.-]{2,24}):function\([a-z],[a-z],[a-z]\)\{/.exec(s.slice(idx, idx + 400000));
end = m ? idx + m.index : idx + 400000;
const body = s.slice(start, end);
log('TmDO module body = ' + body.length + ' B');
log('');

// exports
const decls = [...body.matchAll(/\.d\([a-z],"(?<x>[^"]+)",\(function\(\)\{return (?<y>\w+)\}\)\)/g)].map(x => x.groups.x + '->' + x.groups.y);
log('TmDO exports: ' + JSON.stringify(decls));
log('');

// Which export is TOKEN_MAP / MAIN_COLOR_TOKEN / COLORS_ALIAS / CORE_TOKEN_COLORS / DISPLAY_MEDIA_QUERY
for (const name of ['TOKEN_MAP', 'MAIN_COLOR_TOKEN', 'COLORS_ALIAS', 'COLORS_MAP', 'CORE_TOKEN_COLORS', 'DISPLAY_MEDIA_QUERY', 'THEME']) {
  const o = body.indexOf(name + '=');
  log('  ' + name + ' @rel' + o + (o >= 0 ? ' :: ' + JSON.stringify(body.slice(o, o + 220)) : ''));
}
log('');

// Count TOKEN_MAP.light entries by alias/step shape: token_name occurrences inside the light array
const lightAt = body.indexOf('light:');
log('=== TOKEN_MAP-ish structure around "light:" ===');
log(JSON.stringify(body.slice(Math.max(0, lightAt - 400), lightAt + 900)));
log('');

// Count {alias:...,step:...,token_name:"..."} records in the whole TmDO module
const recs = [...body.matchAll(/\{[^{}]*alias:[^{}]*step:[^{}]*token_name:"[^"]+"[^{}]*\}/g)].map(x => x[0]);
log('=== token records (alias+step+token_name) found in TmDO: ' + recs.length + ' ===');
const aliases = {};
const tokenNames = new Set();
for (const r of recs) {
  const al = /alias:"([^"]+)"/.exec(r); const st = /step:(\d+|"[^"]+")/.exec(r); const tn = /token_name:"([^"]+)"/.exec(r);
  const key = al ? al[1] : 'none';
  aliases[key] = (aliases[key] || 0) + 1;
  if (tn) tokenNames.add(tn[1]);
}
log('  aliases: ' + JSON.stringify(aliases));
log('  unique token_name count = ' + tokenNames.size);
log('  sample token_names: ' + JSON.stringify([...tokenNames].slice(0, 40)));
log('');

// MAIN_COLOR_TOKEN membership => which token_names the generator can emit
const mainAt = body.indexOf('MAIN_COLOR_TOKEN');
log('=== MAIN_COLOR_TOKEN definition ===');
log(JSON.stringify(body.slice(mainAt - 60, mainAt + 500)));
log('');

// Alternative record shape: token_name might come first
const recs2 = [...body.matchAll(/token_name:"([^"]+)"/g)].map(x => x[1]);
log('all token_name literals in TmDO = ' + recs2.length + ', unique = ' + new Set(recs2).size);
log('');

fs.writeFileSync(path.join(__dirname, '_r5_census22.txt'), out.join('\n') + '\n');
console.log(out.join('\n'));
