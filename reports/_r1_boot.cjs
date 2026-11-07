const fs = require('fs');
const p = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js';
const s = fs.readFileSync(p, 'latin1');
const out = [];
const log = (...a) => { const l = a.map(String).join(' '); out.push(l); console.log(l); };

log('--- bootstrap definition window @1,300,000..1,316,000 ---');
log(s.slice(1300000, 1316600));

// find Pt and Lt definitions near the bootstrap module
const boot = 1311604;
const modStart = Math.max(0, s.lastIndexOf('function(e,t,n){', boot) - 60);
log(`\n--- enclosing module head from ${modStart} (2500 chars) ---\n` + s.slice(modStart, modStart + 2500));

// 9Tg7 module
const nine = s.indexOf('9Tg7:function');
log(`\n--- 9Tg7 @ ${nine} ---\n` + (nine > 0 ? s.slice(nine, nine + 1400) : 'NOT FOUND'));

// theme provider component head @6,113,504 -> find module start
const tp = 6113504;
const tpStart = s.lastIndexOf('function(e,t,n){', tp) - 60;
log(`\n--- theme provider module head from ${tpStart} (3000 chars) ---\n` + s.slice(tpStart, tpStart + 3000));

fs.writeFileSync('D:/Zalo/reports/_r1_boot.txt', out.join('\n'), 'utf8');
