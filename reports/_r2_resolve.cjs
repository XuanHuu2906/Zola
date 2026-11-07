const fs = require('fs');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const css = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.css', 'utf8');
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const tm = JSON.parse(fs.readFileSync('D:/Zalo/reports/_token_map_light.json', 'utf8'));

// ---- parse every CSS rule into selector -> {prop: value} (own declarations only)
const rules = [];
let i = 0;
const n = css.length;
while (i < n) {
  const open = css.indexOf('{', i);
  if (open < 0) break;
  const sel = css.slice(i, open);
  let d = 0, j = open;
  for (; j < n; j++) {
    if (css[j] === '{') d++;
    else if (css[j] === '}') { d--; if (d === 0) break; }
  }
  let own = '', dd = 0;
  for (let k = open + 1; k < j; k++) {
    const ch = css[k];
    if (ch === '{') dd++;
    if (ch === '}') dd--;
    if (dd === 0) own += ch;
  }
  rules.push({ sel: sel.trim(), own, start: i });
  i = j + 1;
}

function collect(pred) {
  const m = {};
  for (const r of rules) {
    if (!pred(r.sel)) continue;
    for (const mm of r.own.matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;}]+)/g)) {
      m[mm[1]] = mm[2].trim();
    }
  }
  return m;
}

const light = collect((s) => s === ':root' || s === ':root,:root .light' || s === ':root .light');
const dark = collect((s) => s.includes(':root .dark') || s === ':root .dark' || s.includes(':root .dark'));

const out = [];
const log = (...a) => { const l = a.map(String).join(' '); out.push(l); console.log(l); };

log(`rules parsed=${rules.length}`);
log(`light merged vars=${Object.keys(light).length}  dark merged vars=${Object.keys(dark).length}`);

// ---- resolve each TOKEN_MAP token
const rows = tm.map((t) => ({
  token: t.token,
  alias: t.alias,
  step: t.step,
  swallow: t.alias ? `--${t.alias}${t.step}` : null,
  light: light[t.token] ?? null,
  dark: dark[t.token] ?? null,
  literal: t.alias ? null : t.color,
}));

const missingLight = rows.filter((r) => r.light === null);
const missingDark = rows.filter((r) => r.dark === null);
log(`\nresolved light ${rows.length - missingLight.length}/${rows.length}, dark ${rows.length - missingDark.length}/${rows.length}`);
log(`missing light (${missingLight.length}): ${missingLight.map((r) => r.token).join(' ')}`);
log(`missing dark (${missingDark.length}): ${missingDark.map((r) => r.token).join(' ')}`);

// ---- parse the SCSS dark alias override map (token: alias/step) from CYG6
const cgStart = 4245911;
const cg = js.slice(cgStart, cgStart + 86784);
const darkMapOff = cg.indexOf('$dark_alias_name:');
const darkMap = cg.slice(darkMapOff, darkMapOff + 12000);
const mapEntries = [...darkMap.matchAll(/"(--[A-Za-z0-9_-]+)"\s*:\s*\(\s*"([A-Za-z_]+)"\s*,\s*"([0-9]+)"\s*\)/g)]
  .map((m) => ({ token: m[1], alias: m[2], step: m[3] }));
log(`\n$dark_alias_name explicit overrides parsed: ${mapEntries.length}`);
if (mapEntries.length) log('  ' + mapEntries.slice(0, 12).map((e) => `${e.token}=${e.alias}${e.step}`).join('  '));

// does any explicit dark override differ from TOKEN_MAP's light alias/step?
const tmBy = Object.fromEntries(tm.map((t) => [t.token, t]));
let diff = 0;
const diffs = [];
for (const e of mapEntries) {
  const t = tmBy[e.token];
  if (!t) { diffs.push(`${e.token}: NOT-IN-TOKEN_MAP -> ${e.alias}${e.step}`); continue; }
  if (t.alias !== e.alias || String(t.step) !== e.step) {
    diff++;
    if (diffs.length < 40) diffs.push(`${e.token}: light=${t.alias}${t.step} dark=${e.alias}${e.step}`);
  }
}
log(`dark overrides differing from TOKEN_MAP: ${diff}`);
for (const d of diffs) log('  ' + d);

fs.writeFileSync('D:/Zalo/reports/_r2_resolved.json', JSON.stringify({ light, dark, rows, mapEntries }, null, 1), 'utf8');
fs.writeFileSync('D:/Zalo/reports/_r2_resolved.txt', out.join('\n'), 'utf8');
