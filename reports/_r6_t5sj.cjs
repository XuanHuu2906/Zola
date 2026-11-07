const fs = require('fs');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const F = ROOT + '/main-dist/preload-render.js';
const s = fs.readFileSync(F, 'utf8');
const out = [];
const log = (...a) => out.push(a.join(' '));

const start = s.indexOf('T5SJ:function');
// find matching brace of the module function body
const brace = s.indexOf('{', s.indexOf(')', start) + 1);
let depth = 0, j = brace;
for (; j < s.length; j++) {
  const ch = s[j];
  if (ch === '{') depth++;
  else if (ch === '}') { depth--; if (depth === 0) break; }
}
const body = s.slice(brace, j + 1);
log(`T5SJ body: ${body.length} bytes, @${brace}`);
fs.writeFileSync(__dirname + '/_r6_t5sj.txt', body + '\n');

const ids = ['y', 'A', 'b', 'et', 'D', 'k', 'L', 'F', 'Q', 'G', 'z', 'K', 'v', 'ee', 'te', 'tt', 'nt', 'j', 'M', 'q', 'h', 'a', 'le', 'fe', 'de', '_e', 'ae', 'ge', 've', 'gt', 'pt', 'ut', 'ht', '_t', 'Ze', 'oe', 'ce', 'ct', 'J', 'W', 'Y', 'R', 'S', 'T', 'O', 'he'];

log('');
log('=== DECLARATIONS OF NAMESPACE IDS IN T5SJ ===');
for (const id of ids) {
  const re = new RegExp('(?:[,;{(\\s])' + id.replace(/[$]/g, '\\$') + '\\s*=\\s*', 'g');
  const hits = [];
  let m;
  while ((m = re.exec(body)) && hits.length < 3) hits.push(m.index);
  if (!hits.length) continue;
  log('');
  log(`## ${id} (${hits.length} sites)`);
  for (const h of hits) log('   @' + h + '  ' + body.slice(h, Math.min(h + 260, body.length)).replace(/\s+/g, ' '));
}

fs.writeFileSync(__dirname + '/_r6_t5sj_decls.txt', out.join('\n') + '\n');
console.log(out.join('\n').slice(0, 14000));
