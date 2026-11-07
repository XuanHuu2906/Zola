const fs = require('fs');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const s = fs.readFileSync(ROOT + '/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js', 'utf8');
const out = [];
const i = 7856330;
out.push(s.slice(i + 200, i + 3800).replace(/\s+/g, ' '));
fs.writeFileSync(__dirname + '/_r6_cfgflags.txt', out.join('\n') + '\n');
console.log(out.join('\n'));
