const fs = require('fs');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const css = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.css', 'latin1');

console.log('=== JS context for candidate chat-header selectors ===');
for (const n of ['chat-title', 'chat-info__header__title', 'chat-header-v2', 'chat-top-header', 'conv-header', 'conversation-header']) {
  let i = -1, c = 0;
  while ((i = js.indexOf(n, i + 1)) >= 0 && c < 2) {
    console.log(`\n[${n}] @${i}\n  ${JSON.stringify(js.slice(i - 260, i + 260))}`);
    c++;
  }
  if (!c) console.log(`\n[${n}] none`);
}

console.log('\n=== CSS: selectors containing "header" that also mention chat/message ===');
const cssClasses = new Set();
for (const m of css.matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g)) cssClasses.add(m[1]);
const hit = [...cssClasses].filter((c) => /header/i.test(c) && /chat|message|msg|conv/i.test(c));
console.log(hit.sort().join('\n'));

console.log('\n=== CSS rules for layout roots ===');
function rulesFor(sel) {
  const out = [];
  let i = -1;
  while ((i = css.indexOf(sel, i + 1)) >= 0 && out.length < 3) {
    const open = css.indexOf('{', i);
    const close = css.indexOf('}', open);
    if (open < 0) break;
    out.push(css.slice(i - 60, Math.min(close + 1, open + 500)));
  }
  return out;
}
for (const s of ['.chat-box{', '.leftpanel', '.rightpanel', '.chat-content', '.chat-box-bar', '.chat-date']) {
  console.log(`\n--- ${s} ---`);
  const r = rulesFor(s);
  if (!r.length) console.log('(no literal match)');
  for (const x of r) console.log(x);
}
