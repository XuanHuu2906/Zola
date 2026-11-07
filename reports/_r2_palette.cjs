const fs = require('fs');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const css = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.css', 'utf8');
const out = [];
const log = (...a) => { const l = a.map(String).join(' '); out.push(l); console.log(l); };

function enclosingBlock(off) {
  // walk back to the '{' whose matching '}' is after off
  let j = off;
  let depth = 0;
  for (; j >= 0; j--) {
    if (css[j] === '}') depth++;
    else if (css[j] === '{') { if (depth === 0) break; depth--; }
  }
  const open = j;
  let d = 0;
  for (let k = open; k < css.length; k++) {
    if (css[k] === '{') d++;
    else if (css[k] === '}') { d--; if (d === 0) return { open, close: k, selStart: -1 }; }
  }
}

function selectorFor(open) {
  // selector text preceding '{', bounded by previous '}' or '}' + @-rule
  let st = open - 1;
  while (st >= 0 && css[st] !== '}' && css[st] !== ';' && css[st] !== '{') st--;
  return css.slice(st + 1, open).trim();
}

function vars(body) {
  const m = {};
  for (const mm of body.matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;}]+)/g)) {
    if (!(mm[1] in m)) m[mm[1]] = mm[2].trim();
  }
  return m;
}

const idxs = [];
let i = -1;
while ((i = css.indexOf('--N0:', i + 1)) >= 0) idxs.push(i);

const palettes = {};
for (const off of idxs) {
  const b = enclosingBlock(off);
  const sel = selectorFor(b.open);
  const body = (() => {
    // capture only this rule's own declarations (skip nested blocks)
    let d = 0, res = '';
    for (let k = b.open + 1; k < b.close; k++) {
      const ch = css[k];
      if (ch === '{') d++;
      if (ch === '}') d--;
      if (d === 0) res += ch;
    }
    return res;
  })();
  const v = vars(body);
  log(`\n### palette @${off} selector="${sel}" vars=${Object.keys(v).length}`);
  log('  N0=' + v['--N0'] + ' N300=' + v['--N300'] + ' B55=' + v['--B55'] + ' BA55=' + v['--BA55'] + ' BLA55=' + v['--BLA55'] + ' WA100=' + v['--WA100']);
  palettes[sel + '@' + off] = v;
}

// also report which top-level selectors define the big token set
for (const [k, v] of Object.entries(palettes)) {
  log(`\n${k}: ${Object.keys(v).length} vars`);
  const keys = Object.keys(v).filter((x) => /^--(N|B|WA|BA|BLA)\d+$/.test(x));
  log('  scale vars: ' + keys.length);
}

fs.writeFileSync('D:/Zalo/reports/_r2_palettes.json', JSON.stringify(palettes, null, 1), 'utf8');
fs.writeFileSync('D:/Zalo/reports/_r2_palette.txt', out.join('\n'), 'utf8');
