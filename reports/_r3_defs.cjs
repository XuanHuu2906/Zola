const fs = require('fs');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const css = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.css', 'latin1');
const LOG = 'D:/Zalo/reports/_r3_defs.txt';
fs.writeFileSync(LOG, '');
const log = (...a) => { const l = a.map(String).join(' '); fs.appendFileSync(LOG, l + '\n'); console.log(l); };

// blocks: dark @13665 (725), light @43288 (418)
function block(off) {
  const b = css.indexOf('{', off), c = css.indexOf('}', b);
  const m = new Map();
  for (const x of css.slice(b + 1, c).matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;]+)/g)) m.set(x[1], x[2].trim());
  return m;
}
const D = block(13665), L = block(43288);
const T = ['--layer-background', '--layer-background-subtle', '--layer-background-hover', '--layer-background-selected',
  '--layer-background-pinned', '--layer-background-navbar-normal', '--layer-background-navbar-hover',
  '--layer-background-navbar-selected', '--layer-background-leftmenu', '--layer-background-leftmenu-hover',
  '--layer-background-leftmenu-selected', '--layer-background-CSC', '--layer-background-inverse',
  '--text-primary', '--text-secondary', '--text-information', '--text-on-color', '--text-placeholder',
  '--text-disabled', '--icon-primary', '--icon-secondary', '--icon-on-color',
  '--border', '--border-subtle', '--border-focused', '--divider', '--divider-bold',
  '--background-activeness', '--background-inactiveness-subtle', '--surface-background-subtle',
  '--input-field-bg', '--input-field-bg-filled', '--input-field-bg-outline',
  '--timestamp', '--chat-date', '--curtain', '--curtain-bold',
  '--shadow-overlay', '--shadow-bubble', '--shadow-overflow',
  '--media-message', '--toast', '--blue-quote', '--white-quote',
  '--space-xxs', '--space-xs', '--space-sm', '--space-md', '--nav-width', '--medium',
  '--background-control-alpha', '--background-control-alpha-hover', '--cta-link', '--cta-link-pressed'];
log('token'.padEnd(40) + 'light'.padEnd(30) + 'dark');
for (const t of T) log(`${t.padEnd(40)}${String(L.get(t) ?? '—').padEnd(30)}${D.get(t) ?? '—'}`);

log('\n=== shadow tokens full ===');
for (const k of [...L.keys(), ...D.keys()]) if (/^--shadow/.test(k)) log(`  ${k}  L=${L.get(k) ?? '—'}  D=${D.get(k) ?? '—'}`);

log('\n=== radius-ish tokens (border-radius literal census) ===');
const radii = new Map();
for (const m of css.matchAll(/border-radius\s*:\s*([^;}]+)/g)) radii.set(m[1].trim(), (radii.get(m[1].trim()) || 0) + 1);
for (const [k, v] of [...radii.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18)) log(`  ${String(v).padStart(4)}  ${k}`);

log('\n=== var-defined radius tokens ===');
for (const [m, src] of [[L, 'light'], [D, 'dark']]) for (const [k, v] of m) if (/radius|round/i.test(k)) log(`  [${src}] ${k} = ${v}`);
