const fs = require('fs');
const p = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js';
const s = fs.readFileSync(p, 'latin1');
const out = [];
const log = (...a) => { const l = a.map(String).join(' '); out.push(l); console.log(l); };

const pats = [
  /add\(\s*["']dark["']\s*\)/g,
  /remove\(\s*["']dark["']\s*\)/g,
  /toggle\(\s*["']dark["']/g,
  /classList\.add\([a-zA-Z_$][\w$]*\.theme\b/g,
  /classList\.add\([a-zA-Z_$][\w$]*\.(DARK|LIGHT|CUSTOM)\b/g,
  /"(light|dark)"===/g,
  /===["']dark["']/g,
  /body\.className\s*=/g,
];

for (const re of pats) {
  const hits = [];
  let m;
  while ((m = re.exec(s))) hits.push(m.index);
  log(`\n### ${re}: ${hits.length} @ ${hits.slice(0, 12).join(',')}`);
  for (const h of hits.slice(0, 4)) log(`--- @${h} ---\n` + s.slice(h - 400, h + 400).replace(/\n/g, '\\n'));
}

// find the app bootstrap that applies theme class: look for theme + classList in same 600-char window
log('\n\n### windows containing both "theme" and "classList" within 400 chars');
let count = 0;
let i = -1;
const seen = new Set();
while ((i = s.indexOf('classList', i + 1)) >= 0 && count < 40) {
  const w = s.slice(Math.max(0, i - 400), i + 400);
  if (/theme/i.test(w)) {
    const key = Math.round(i / 200);
    if (seen.has(key)) continue;
    seen.add(key);
    count++;
    log(`--- @${i} ---\n` + w.replace(/\n/g, '\\n'));
  }
}

fs.writeFileSync('D:/Zalo/reports/_r1_darkapply.txt', out.join('\n'), 'utf8');
