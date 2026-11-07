const fs = require('fs');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const files = {
  renderer: ROOT + '/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js',
  preload: ROOT + '/main-dist/preload-render.js',
};
const out = [];
const log = (...a) => out.push(a.join(' '));

// real endpoint literals: /api/... or known service prefixes
const RE = /["'`](\/(?:api|cloudmedia|zalocloud|zalocloudqos|zfamily|zpw|spcontact)[A-Za-z0-9_\-\/\.{}:]*?)["'`]/g;

for (const [name, f] of Object.entries(files)) {
  const s = fs.readFileSync(f, 'utf8');
  const set = new Set();
  let m;
  while ((m = RE.exec(s))) set.add(m[1]);
  log('');
  log(`=== ${name}: ${set.size} distinct endpoint literals ===`);
  [...set].sort().forEach((p) => log('  ' + p));
}

fs.writeFileSync(__dirname + '/_r6_endpoints.txt', out.join('\n') + '\n');
console.log(out.join('\n').slice(0, 3000));
