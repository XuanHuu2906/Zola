const fs = require('fs');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const css = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.css', 'utf8');
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const tm = JSON.parse(fs.readFileSync('D:/Zalo/reports/_token_map_light.json', 'utf8'));
const dm = JSON.parse(fs.readFileSync('D:/Zalo/reports/_r2_darkmix.json', 'utf8'));
const res = JSON.parse(fs.readFileSync('D:/Zalo/reports/_r2_resolved.json', 'utf8'));

const out = [];
const log = (...a) => { const l = a.map(String).join(' '); out.push(l); console.log(l); };

// ---------- token groups used by R2
const GROUP_RULES = [
  ['Background / layer', /^--(bg-default|title-bar|title-ptv|tab-txt|tip-bg|surface-|layer-background|layer-alert|layer-error|layer-success|layer-warning|layer-information|layer-neutral|layer-accent|curtain|skeleton|background-inactiveness|background-activeness|background-focus-ui|background-popover-tips|background-hovertips|bg-divide|bg-message|background-control|background-row|backdrop)/],
  ['Text', /^--(text-|link$|tab-txt)/],
  ['Border / divider', /^--(border|divider)/],
  ['Navigation / leftmenu / navbar', /^--(layer-background-leftmenu|layer-background-navbar|text-navbar|item-wa)/],
  ['Conversation / message', /^--(blue-message|blue-quote|white-message|white-quote|self-bubble-chat-shadow|shadow-bubble|emoji-status-bubble|jump-to-message|media-message|msg-|layer-accent-message)/],
  ['Control / button', /^--(button-|cta-|input-|switch-|checkbox-|radio-)/],
  ['Icon', /^--icon/],
  ['Accent scale', /^--accent-/],
  ['Shadow', /^--shadow/],
];

function groupOf(tok) {
  for (const [g, re] of GROUP_RULES) if (re.test(tok)) return g;
  return 'Other';
}

const groups = {};
for (const t of tm) {
  const g = groupOf(t.token);
  (groups[g] ||= []).push(t);
}
log('=== TOKEN_MAP (376) by group ===');
for (const [g, arr] of Object.entries(groups).sort((a, b) => b[1].length - a[1].length)) {
  log(`${String(arr.length).padStart(4)}  ${g}`);
}

// ---------- divergence stats
const tmBy = Object.fromEntries(tm.map((t) => [t.token, t]));
function diffSet(mixin) {
  const d = [];
  const seen = new Set();
  for (const e of mixin || []) {
    if (seen.has(e.token)) continue;
    seen.add(e.token);
    const t = tmBy[e.token];
    if (!t) { d.push({ token: e.token, kind: 'css-only', css: e.alias + e.step }); continue; }
    if (t.alias !== e.alias || String(t.step) !== e.step)
      d.push({ token: e.token, kind: 'step-differs', light: t.alias + t.step, dark: e.alias + e.step });
  }
  return d;
}
const lightDiff = diffSet(dm.lightMixin);
const darkDiff = diffSet(dm.darkMixin);
log(`\n=== divergence vs TOKEN_MAP ===`);
log(`light mixin entries=${dm.lightMixin.length} unique=${new Set(dm.lightMixin.map(x => x.token)).size} differing=${lightDiff.length}`);
log(`dark  mixin entries=${dm.darkMixin.length} unique=${new Set(dm.darkMixin.map(x => x.token)).size} differing=${darkDiff.length}`);
log('  css-only (declared in shipped SCSS, absent from TOKEN_MAP), light: ' + lightDiff.filter(d => d.kind === 'css-only').map(d => d.token).join(' '));
log('  step-differs, light: ' + lightDiff.filter(d => d.kind === 'step-differs').length);
log('  step-differs, dark : ' + darkDiff.filter(d => d.kind === 'step-differs').length);

// ---------- alias actually used in the dark mixin vs light
const aliasUsage = {};
for (const e of dm.darkMixin) aliasUsage[e.alias] = (aliasUsage[e.alias] || 0) + 1;
log('\n=== dark mixin alias histogram ===');
log(Object.entries(aliasUsage).sort((a, b) => b[1] - a[1]).map((e) => e.join('=')).join(' '));

// ---------- which tokens the dashboard can actually retint
log('\n=== dashboard retint reach ===');
log('The "Magic" tab only iterates TOKEN_MAP.light entries whose alias is in MAIN_COLOR_TOKEN [N,NG,DN,B,R].');
const main = ['N', 'NG', 'DN', 'B', 'R'];
const reach = tm.filter((t) => t.alias && main.includes(t.alias));
log(`  reachable tokens: ${reach.length}/${tm.length} (${(reach.length / tm.length * 100).toFixed(1)}%)`);
const byAlias = {};
for (const t of reach) byAlias[t.alias] = (byAlias[t.alias] || 0) + 1;
log('  ' + Object.entries(byAlias).map((e) => e.join('=')).join(' '));
const unreach = tm.filter((t) => !t.alias || !main.includes(t.alias));
log(`  NOT retintable via Magic: ${unreach.length} — aliases: ${[...new Set(unreach.map(t => t.alias || 'literal'))].join(' ')}`);

// ---------- literal / non-alias tokens
const lits = tm.filter((t) => !t.alias);
log(`\n=== literal tokens (alias:null) = ${lits.length} ===`);
for (const t of lits) log(`  ${t.token} = ${t.color}`);

// ---------- glass feasibility primitives present in shipped CSS
log('\n=== glass primitives in shipped CSS ===');
for (const [label, re] of [
  ['backdrop-filter', /backdrop-filter/g],
  ['filter:blur(', /filter:\s*blur\(/g],
  ['box-shadow', /box-shadow/g],
  ['border-radius', /border-radius/g],
  ['rgba(', /rgba\(/g],
  ['hsla(', /hsla\(/g],
  ['linear-gradient(', /linear-gradient\(/g],
  ['radial-gradient(', /radial-gradient\(/g],
  ['conic-gradient(', /conic-gradient\(/g],
]) log(`  ${String((css.match(re) || []).length).padStart(6)}  ${label}`);

// ---------- css-only candidate check: is any of this reachable from outside?
log('\n=== external reachability checks in shipped renderer JS ===');
for (const [label, needle] of [
  ['<link href injection', 'createElement("link")'],
  ['<style> injection', 'createElement("style")'],
  ['document.head.appendChild', 'head.appendChild'],
  ['dangerouslySetInnerHTML', 'dangerouslySetInnerHTML'],
  ['style.setProperty (body)', 'body.style.setProperty'],
]) log(`  ${label}: ${(js.split(needle).length - 1)}`);

fs.writeFileSync('D:/Zalo/reports/_r2_stats.txt', out.join('\n'), 'utf8');
