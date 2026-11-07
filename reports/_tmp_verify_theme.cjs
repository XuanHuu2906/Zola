const fs = require('node:fs');
const s = fs.readFileSync('D:/Zalo/reports/_tmp_main.js', 'utf8');
function ctx(needle, before = 400, after = 400, max = 3) {
  let i = s.indexOf(needle), n = 0;
  while (i !== -1 && n < max) {
    console.log(`--- ${needle} @ ${i} ---`);
    console.log(s.slice(Math.max(0, i - before), i + after).replace(/\s+/g, ' '));
    i = s.indexOf(needle, i + 1); n++;
  }
}
ctx('const I=', 200, 400, 2);
ctx('function A()', 100, 500, 2);
ctx('getResourceDir', 300, 300, 2);
ctx('DEFAULT_LOGIN_WIDTH', 200, 300, 1);
