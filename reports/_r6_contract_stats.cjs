const fs = require('fs');
const txt = fs.readFileSync(__dirname + '/_r6_ast_contract2.txt', 'utf8');
const lines = txt.split('\n');
let inContract = false;
let total = 0;
const modes = {};
const channels = new Set();
const perNs = {};
let cur = null;
for (const l of lines) {
  if (l.startsWith('=== FULL CONTRACT')) { inContract = true; continue; }
  if (!inContract) continue;
  if (l.startsWith('## ')) { cur = l.slice(3).trim(); perNs[cur] = { n: 0, modes: {}, chans: new Set() }; continue; }
  const m = l.match(/^\s{3}(\S+)\s+(\S+)\s+([A-Z_]+)\s*$/);
  if (m) {
    total++;
    modes[m[3]] = (modes[m[3]] || 0) + 1;
    channels.add(m[2]);
    if (cur) { perNs[cur].n++; perNs[cur].modes[m[3]] = (perNs[cur].modes[m[3]] || 0) + 1; perNs[cur].chans.add(m[2]); }
  }
}
console.log('methods', total, 'uniqueChannels', channels.size);
console.log('modes', JSON.stringify(modes));
console.log('');
for (const [k, v] of Object.entries(perNs)) {
  if (v.n) console.log(String(v.n).padStart(3) + '  ' + k.padEnd(20) + ' uniqueCh=' + v.chans.size + '  ' + JSON.stringify(v.modes));
}
