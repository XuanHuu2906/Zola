const fs = require('fs');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const tm = JSON.parse(fs.readFileSync('D:/Zalo/reports/_token_map_light.json', 'utf8'));
const out = [];
const log = (...a) => { const l = a.map(String).join(' '); out.push(l); console.log(l); };

function modSlice(off) {
  let d = 0, j = js.indexOf('{', js.indexOf('function(', off));
  for (; j < js.length; j++) {
    if (js[j] === '{') d++;
    else if (js[j] === '}') { d--; if (d === 0) return js.slice(off, j); }
  }
}
const lightMod = modSlice(8774196); // RFxn
const darkMod = modSlice(4245911);  // CYG6

function mixinTokens(mod, mixinName) {
  const i = mod.indexOf('@mixin ' + mixinName);
  if (i < 0) return null;
  // mixin ends at the next "@mixin" or "@function" or end
  let end = mod.length;
  for (const mk of ['@mixin ', '@function ']) {
    const k = mod.indexOf(mk, i + 10);
    if (k > 0 && k < end) end = k;
  }
  const body = mod.slice(i, end);
  const toks = [];
  for (const m of body.matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*#\{\s*colorOrgv2\(\s*'([A-Za-z_]+)'\s*,\s*'([0-9]+)'/g)) {
    toks.push({ token: m[1], alias: m[2], step: m[3] });
  }
  return toks;
}

const lt = mixinTokens(lightMod, 'alias_variable');
const dk = mixinTokens(darkMod, 'dark_alias_variable');
log(`alias_variable tokens=${lt ? lt.length : 'n/a'}   dark_alias_variable tokens=${dk ? dk.length : 'n/a'}`);

const tmBy = Object.fromEntries(tm.map((t) => [t.token, t]));

// compare light mixin vs TOKEN_MAP
let ldiff = [];
if (lt) for (const e of lt) {
  const t = tmBy[e.token];
  if (!t) { ldiff.push(`${e.token}: mixin=${e.alias}${e.step} but NOT in TOKEN_MAP`); continue; }
  if (t.alias !== e.alias || String(t.step) !== e.step)
    ldiff.push(`${e.token}: TOKEN_MAP=${t.alias}${t.step} mixin=${e.alias}${e.step}`);
}
log(`\nlight mixin vs TOKEN_MAP differences: ${ldiff.length}`);
for (const d of ldiff.slice(0, 30)) log('  ' + d);

// compare dark mixin vs TOKEN_MAP
let ddiff = [];
if (dk) for (const e of dk) {
  const t = tmBy[e.token];
  if (!t) { ddiff.push(`${e.token}: dark=${e.alias}${e.step} NOT in TOKEN_MAP`); continue; }
  if (t.alias !== e.alias || String(t.step) !== e.step)
    ddiff.push(`${e.token}: light=${t.alias}${t.step} dark=${e.alias}${e.step}`);
}
log(`\ndark mixin vs TOKEN_MAP differences: ${ddiff.length}`);
for (const d of ddiff.slice(0, 40)) log('  ' + d);

// tokens declared in dark mixin but NOT in light mixin (dark-only tokens)
if (lt && dk) {
  const ls = new Set(lt.map((x) => x.token));
  const ds = new Set(dk.map((x) => x.token));
  log(`\nlight-only tokens (${[...ls].filter((x) => !ds.has(x)).length}): ${[...ls].filter((x) => !ds.has(x)).join(' ')}`);
  log(`dark-only tokens (${[...ds].filter((x) => !ls.has(x)).length}): ${[...ds].filter((x) => !ls.has(x)).join(' ')}`);
  log(`TOKEN_MAP tokens absent from dark mixin (${tm.filter((t) => !ds.has(t.token)).length}): ${tm.filter((t) => !ds.has(t.token)).map((t) => t.token).join(' ')}`);
}

fs.writeFileSync('D:/Zalo/reports/_r2_darkmix.txt', out.join('\n'), 'utf8');
fs.writeFileSync('D:/Zalo/reports/_r2_darkmix.json', JSON.stringify({ lightMixin: lt, darkMixin: dk }, null, 1), 'utf8');
