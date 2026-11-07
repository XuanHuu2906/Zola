const fs = require('fs');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const s = fs.readFileSync(ROOT + '/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js', 'utf8');
const out = [];
const log = (...a) => out.push(a.join(' '));
const base = 14443000, end = 14800000;
const region = s.slice(base, end);

function esc(x) { return x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

for (const pat of ['Q=', 'Y=', 'q=', 'initConfig', 'SET_CONFIG', 'ckey', 'socket_url', 'ws_']) {
  log('##### ' + pat);
  const re = new RegExp(esc(pat), 'g');
  let m, c = 0;
  while ((m = re.exec(region)) && c < 4) {
    const abs = base + m.index;
    log('@' + abs + ': ' + s.slice(Math.max(0, abs - 220), abs + 330).replace(/\s+/g, ' '));
    log('');
    c++;
  }
  if (!c) log('(none)');
  log('');
}
fs.writeFileSync(__dirname + '/_r6_epassign.txt', out.join('\n') + '\n');
console.log(out.join('\n').slice(0, 12000));
