const fs = require('fs');
const acorn = require('acorn');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');

function innermost(modAt, off) {
  const fnAt = js.indexOf('function', modAt);
  const node = acorn.parseExpressionAt(js, fnAt, { ecmaVersion: 2022 });
  const body = node.type === 'SequenceExpression' ? node.expressions[0] : node;
  let best = null;
  const stack = [[body, 0]];
  while (stack.length) {
    const [n] = stack.pop();
    if (!n || typeof n.type !== 'string') continue;
    if (!(n.start <= off && off < n.end)) continue;
    if (/Function|Class/.test(n.type)) {
      const size = n.end - n.start;
      if (!best || size < best.size) best = { type: n.type, start: n.start, end: n.end, size, id: n.id && n.id.name };
    }
    for (const k in n) {
      if (k === 'loc' || k === 'type') continue;
      const v = n[k];
      if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') stack.push([c]); }
      else if (v && typeof v.type === 'string') stack.push([v]);
    }
  }
  return best;
}

for (const [label, modAt, off] of [
  ['conv-item', 12278564, 12393315],
  ['conv-message truncate', 12278564, 12389658],
  ['chat-message', 965564, 987109],
  ['leftpanel', 13277118, 13285432],
  ['chat-box-bar', 5458193, 5463373],
  ['content-message-container', 1841295, 1847070],
  ['titlebar__btns', 19641108, 19646838],
]) {
  const r = innermost(modAt, off);
  console.log(`\n## ${label} @${off}`);
  console.log(`   innermost fn: ${r ? `${r.type} ${r.start}..${r.end} size=${r.size} id=${r.id}` : 'none'}`);
  if (r) {
    console.log('   head: ' + JSON.stringify(js.slice(r.start, r.start + 200)));
    // how is it bound? look 300 chars before the function start
    console.log('   before: ' + JSON.stringify(js.slice(Math.max(0, r.start - 300), r.start)));
  }
}
