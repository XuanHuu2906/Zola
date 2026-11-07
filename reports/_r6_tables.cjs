const fs = require('fs');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const s = fs.readFileSync(ROOT + '/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js', 'utf8');
const out = [];
const log = (...a) => out.push(a.join(' '));

const names = [];
const seen = new Set();
const re = /tableName:"([^"]+)"/g;
let m;
while ((m = re.exec(s))) {
  if (!seen.has(m[1])) { seen.add(m[1]); names.push(m[1]); }
}
log(`=== ${names.length} distinct tableName declarations ===`);
names.sort((a, b) => a.localeCompare(b));
for (const n of names) log('  ' + n);

// Core schema DB config near offset 17004516
const anchor = 17004516;
log('');
log('=== Core DB config context @17004000..17005400 ===');
log(s.slice(17004000, 17005400).replace(/\s+/g, ' '));

fs.writeFileSync(__dirname + '/_r6_tables.txt', out.join('\n') + '\n');
console.log(out.join('\n').slice(0, 12000));
