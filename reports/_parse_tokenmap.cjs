const fs = require('fs');
const path = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js';
const s = fs.readFileSync(path, 'latin1');
const start = s.indexOf('token_name:', 9461200);
const end = s.indexOf(',v=["N"', start);
const arr = s.slice(start - 1, end + 1);
const re = /\{token_name:"([^"]+)",alias:(null|"[A-Za-z_]+"),step:(null|"[^"]*"),color:"([^"]*)"\}/g;
const out = [];
let m;
while ((m = re.exec(arr))) {
  out.push({
    token: m[1],
    alias: m[2] === 'null' ? null : m[2].slice(1, -1),
    step: m[3] === 'null' ? null : m[3].slice(1, -1),
    color: m[4],
  });
}
console.log('region bytes', arr.length, 'parsed', out.length);
console.log('first', out[0]);
console.log('last', out[out.length - 1]);
const nonToken = out.filter((o) => o.alias === null);
console.log('literal (non-palette) tokens:', nonToken.length);
for (const n of nonToken) console.log('  ', n.token, '=', n.color.slice(0, 90));
const aliases = {};
for (const o of out) if (o.alias) aliases[o.alias] = (aliases[o.alias] || 0) + 1;
console.log('alias histogram:', Object.entries(aliases).sort((a, b) => b[1] - a[1]).map((e) => e.join('=')).join(' '));
fs.writeFileSync('D:/Zalo/reports/_token_map_light.json', JSON.stringify(out, null, 1), 'utf8');
