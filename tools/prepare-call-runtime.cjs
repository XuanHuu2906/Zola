// Explicit local extraction only. Never opens Zalo, reads its profile, or places a call.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('This runtime is for Linux x64.');
const source = path.resolve(process.argv[2] || path.join(os.homedir(), '.local/opt/zalo/Zalo.AppImage'));
const destination = path.resolve(__dirname, '../.zola-call-runtime');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'zola-call-extract-'));
try {
  if (fs.existsSync(destination)) throw new Error('Runtime already exists. Keep it or choose a separate checkout before extracting another version.');
  const result = spawnSync(source, ['--appimage-extract'], { cwd: temporary, stdio: 'inherit', timeout: 120000 });
  if (result.error || result.status !== 0) throw new Error('AppImage extraction failed.');
  const base = ['AppDir', 'squashfs-root'].map(d => path.join(temporary, d, 'zcall-native')).find(d => fs.existsSync(path.join(d, 'native-engine/engine-core.js')));
  if (!base) throw new Error('No compatible Linux call engine found in this package.');
  fs.mkdirSync(destination);
  fs.cpSync(path.join(base, 'native-engine'), path.join(destination, 'native-engine'), { recursive: true });
  if (fs.existsSync(path.join(base, 'README.md'))) fs.copyFileSync(path.join(base, 'README.md'), path.join(destination, 'README.md'));
  fs.writeFileSync(path.join(destination, 'provenance.json'), JSON.stringify({ source, sha256: crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'), extractedAt: new Date().toISOString() }, null, 2) + '\n');
  console.log(`Prepared local call engine: ${destination}`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
