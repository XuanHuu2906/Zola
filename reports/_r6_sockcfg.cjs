const fs = require('fs');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const s = fs.readFileSync(ROOT + '/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js', 'utf8');
const out = [];
const log = (...a) => out.push(a.join(' '));

function ctx(needle, before = 250, after = 800, max = 2) {
  let i = -1, n = 0;
  while ((i = s.indexOf(needle, i + 1)) !== -1 && n < max) {
    log('');
    log(`### ${needle} @${i}`);
    log(s.slice(Math.max(0, i - before), i + after).replace(/\s+/g, ' '));
    n++;
  }
  if (n === 0) { log(''); log(`### ${needle} -> NOT FOUND`); }
}

log('=== socket defaults: ping_interval / establish_timeout / close_timeout ===');
ctx('ping_interval:', 400, 900, 3);

log('');
log('=== WS close codes 3000-3003 ===');
ctx('3003', 500, 500, 3);

log('');
log('=== KEEP_CONNECTION timeout interval ===');
ctx('KEEP_CONNECTION', 500, 500, 2);

log('');
log('=== renderer ipcRenderer usage ===');
let i = -1, n = 0;
while ((i = s.indexOf('ipcRenderer', i + 1)) !== -1 && n < 6) {
  log('');
  log(`### ipcRenderer @${i}`);
  log(s.slice(Math.max(0, i - 400), i + 300).replace(/\s+/g, ' '));
  n++;
}

fs.writeFileSync(__dirname + '/_r6_sockcfg.txt', out.join('\n') + '\n');
console.log(out.join('\n').slice(0, 11000));
