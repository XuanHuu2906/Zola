const fs = require('fs'), path = require('path');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const out = []; const log = (...a) => out.push(a.join(' '));
const findAll = (s, n, max = 40) => { const h = []; let i = 0; while ((i = s.indexOf(n, i)) !== -1) { h.push(i); i += n.length; if (h.length >= max) break; } return h; };

const f = 'compact-app-pc.f32c58b63b6f4273a8a4.js';
const s = fs.readFileSync(path.join(ROOT, 'pc-dist', f), 'utf8');

// 1. Full anti-ZaDark guard: starts at the function that builds the obfuscated selectors.
log('=== ANTI-TAMPER GUARD (full, from selector array to end) ===');
{
  const o = s.indexOf('"l","i","n","k","[","h","r","e","f","^","="');
  log(o < 0 ? 'NOT FOUND' : JSON.stringify(s.slice(o - 260, o + 2600)));
}
log('');

// 2. The CSS writers p() and g() and their call sites
log('=== style writers p() / g() (full) ===');
{
  const o = s.indexOf('document.getElementById("app-custom-theme")');
  log(o < 0 ? 'NOT FOUND' : JSON.stringify(s.slice(o - 400, o + 700)));
}
log('');

log('=== call sites of the custom-theme writer (by id string) ===');
for (const o of findAll(s, 'app-custom-theme', 20)) log('  @' + o + ' :: ' + JSON.stringify(s.slice(Math.max(0, o - 900), o + 200)));
log('');

log('=== "app-custom-font" sites ===');
for (const o of findAll(s, 'app-custom-font', 12)) log('  @' + o + ' :: ' + JSON.stringify(s.slice(Math.max(0, o - 600), o + 160)));
log('');

// 3. What feeds the CSS text? Search for the generator returning contentCss
log('=== contentCss producers / consumers ===');
for (const o of findAll(s, 'contentCss', 20)) log('  @' + o + ' :: ' + JSON.stringify(s.slice(Math.max(0, o - 500), o + 500)));
log('');

// 4. Does anything read raw css from storage?
log('=== raw CSS-from-storage reads? ===');
for (const k of ['customCss', 'custom_css', 'cssText', 'rawCss', 'userCss', 'themeCss']) {
  log('  ' + k + ' = ' + findAll(s, k, 99999).length);
}
log('');

// 5. za_theme shape: what keys are read
log('=== za_theme parse sites (first 5) ===');
for (const o of findAll(s, 'localStorage.getItem("za_theme")', 5)) log('  @' + o + ' :: ' + JSON.stringify(s.slice(Math.max(0, o - 500), o + 700)));
log('');

fs.writeFileSync(path.join(__dirname, '_r5_census13.txt'), out.join('\n') + '\n');
console.log(out.join('\n'));
