const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const dir = path.resolve('release');
const artifacts = fs.readdirSync(dir).filter(name => name.endsWith('.exe')).map(name => {
  const file = path.join(dir, name);
  return { file, bytes: fs.statSync(file).size, sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
});
if (!artifacts.length) throw new Error('No portable executable was produced');
fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync('reports/desktop-artifacts.json', JSON.stringify({ date: new Date().toISOString(), artifacts, smoke: 'NOT RUN by this script' }, null, 2));
console.table(artifacts);
console.log('Packaging evidence saved. Runtime smoke remains a separate required check.');
