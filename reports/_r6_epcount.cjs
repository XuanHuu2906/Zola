const fs = require('fs');
const lines = fs.readFileSync(__dirname + '/_r6_endpoints.txt', 'utf8').split('\n');
const eps = [];
for (const l of lines) {
  const t = l.trim();
  if (t.startsWith('/')) eps.push(t);
}
const groups = {};
const order = [];
for (const e of eps) {
  const p = e.split('/').filter(Boolean);
  let key;
  if (p[0] === 'api') key = '/api/' + (p[1] || '');
  else key = '/' + p[0];
  if (!(key in groups)) { groups[key] = []; order.push(key); }
  groups[key].push(e);
}
console.log(`TOTAL ${eps.length} endpoint literals`);
console.log('');
for (const k of order.sort((a, b) => groups[b].length - groups[a].length)) {
  console.log(String(groups[k].length).padStart(4) + '  ' + k);
}
