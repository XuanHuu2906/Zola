// Record every distributable this run produced, whatever the host platform.
// Linux builds an AppImage and an unpacked directory; Windows builds a portable
// .exe and win-unpacked. Both are hashed the same way so the evidence file keeps
// one shape.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const dir = path.resolve('release');
const ARTIFACT = /\.(exe|AppImage|deb|rpm|dmg|zip)$/;
const artifacts = fs.readdirSync(dir).filter(name => ARTIFACT.test(name)).map(name => {
  const file = path.join(dir, name);
  return { file, bytes: fs.statSync(file).size, sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
});
if (!artifacts.length) throw new Error('No distributable artifact was produced');
fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync('reports/desktop-artifacts.json', JSON.stringify({ date: new Date().toISOString(), platform: process.platform, artifacts, smoke: 'NOT RUN by this script' }, null, 2));
console.table(artifacts);
console.log('Packaging evidence saved. Runtime smoke remains a separate required check.');
