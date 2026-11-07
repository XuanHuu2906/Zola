const fs = require('fs');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/';
const out = [];
const log = (...a) => { const l = a.map(String).join(' '); out.push(l); console.log(l); };

for (const rel of ['main-dist/main.js']) {
  const p = base + rel;
  if (!fs.existsSync(p)) { log(`MISSING ${rel}`); continue; }
  const s = fs.readFileSync(p, 'latin1');
  log(`\n########## ${rel} bytes=${s.length}`);
  for (const needle of ['update-theme-conf', 'get-theme-conf', 'updateThemeConfig', 'getThemeConfig', 'app_theme', 'za_theme', 'theme_conf', 'nativeTheme', 'shouldUseDarkColors', 'titleBarOverlay', 'backgroundColor']) {
    const hits = [];
    let i = -1;
    while ((i = s.indexOf(needle, i + 1)) >= 0) hits.push(i);
    log(`  ${needle}: ${hits.length}` + (hits.length ? `  @${hits.slice(0, 8).join(',')}` : ''));
  }
  for (const needle of ['update-theme-conf', 'get-theme-conf', 'updateThemeConfig']) {
    let i = s.indexOf(needle);
    if (i >= 0) log(`\n--- ${needle} @${i} ---\n` + s.slice(Math.max(0, i - 700), i + 700).replace(/\n/g, '\\n'));
  }
  // nativeTheme usage
  let i = s.indexOf('nativeTheme');
  if (i >= 0) log(`\n--- nativeTheme @${i} ---\n` + s.slice(Math.max(0, i - 500), i + 900).replace(/\n/g, '\\n'));
}
fs.writeFileSync('D:/Zalo/reports/_r1_main.txt', out.join('\n'), 'utf8');
