const fs = require('fs');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const F = ROOT + '/main-dist/preload-render.js';
const s = fs.readFileSync(F, 'utf8');
const out = [];
const log = (...a) => out.push(a.join(' '));

function moduleBody(modId) {
  const needles = [`"${modId}":function`, `${modId}:function`];
  for (const nd of needles) {
    const found = scanFor(nd);
    if (found) return found;
  }
  return null;
}

function scanFor(nd) {
  let i = s.indexOf(nd);
  while (i !== -1) {
    const prev = s[i - 1];
    if (nd[0] === '"' || prev === '{' || prev === ',') {
      const brace = s.indexOf('{', s.indexOf(')', i) + 1);
      let depth = 0, j = brace;
      for (; j < s.length; j++) {
        if (s[j] === '{') depth++;
        else if (s[j] === '}') { depth--; if (depth === 0) break; }
      }
      return { text: s.slice(brace, j + 1), off: brace };
    }
    i = s.indexOf(nd, i + 1);
  }
  return null;
}

for (const mod of ['a4Xj', '3sbe', '+NII', '7jJJ', 'HVQM', 'ntSb', 'RbSv']) {
  const b = moduleBody(mod);
  log('');
  log('######## module ' + mod + (b ? ' @' + b.off + ' (' + b.text.length + ' bytes)' : ' NOT FOUND'));
  if (!b) continue;
  // local enum IIFEs with values
  const er = /([A-Za-z_$][\w$]*)=function\(([A-Za-z_$][\w$]*)\)\{return([\s\S]{0,4000}?)\}\(\{\}\)/g;
  let em;
  while ((em = er.exec(b.text))) {
    const p = em[2];
    const pairs = [...em[3].matchAll(new RegExp('\\b' + p + '\\.([A-Za-z0-9_$]+)\\s*=\\s*("(?:[^"\\\\]|\\\\.)*")', 'g'))]
      .map(x => x[1] + '=' + x[2]);
    if (pairs.length) log('  enum ' + em[1] + ' [' + pairs.length + ']: ' + pairs.join(', '));
  }
  // all string literals, deduped
  const strs = [...new Set([...b.text.matchAll(/"((?:[^"\\]|\\.){2,60})"/g)].map(x => x[1]))];
  log('  strings (' + strs.length + '): ' + strs.slice(0, 90).join(' | '));
}

fs.writeFileSync(__dirname + '/_r6_mod_raw.txt', out.join('\n') + '\n');
console.log(out.join('\n').slice(0, 14000));
