// Prove the packaged app.asar was built from the current tree: compare every
// bundled program file byte-for-byte against its on-disk source. This is a
// content check, not a timestamp check — a rebuilt package that differs in one
// byte fails here.
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SCOPE = ['dist/', 'dist-electron/'];

function readIndex(asarPath) {
  const fd = fs.openSync(asarPath, 'r');
  try {
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    const headerPickleSize = head.readUInt32LE(4);
    const jsonLength = head.readUInt32LE(12);
    if (jsonLength <= 0 || jsonLength > 64 * 1024 * 1024) throw new Error(`Implausible header length ${jsonLength}`);
    const json = Buffer.alloc(jsonLength);
    fs.readSync(fd, json, 0, jsonLength, 16);
    const raw = Buffer.alloc(fs.statSync(asarPath).size);
    fs.readSync(fd, raw, 0, raw.length, 0);
    return { root: JSON.parse(json.toString('utf8')), raw, base: 8 + headerPickleSize };
  } finally {
    fs.closeSync(fd);
  }
}

function walk(node, prefix, out) {
  for (const [name, child] of Object.entries(node.files || {})) {
    if (child.files) walk(child, `${prefix}${name}/`, out);
    else out.push({ path: `${prefix}${name}`, size: Number(child.size), offset: Number(child.offset), unpacked: !!child.unpacked });
  }
  return out;
}

// electron-builder names the unpacked directory after the host: win-unpacked,
// linux-unpacked, mac. Accept an explicit path first so a cross-built package
// can still be checked.
const defaultAsar = process.platform === 'win32' ? 'release/win-unpacked/resources/app.asar'
  : process.platform === 'darwin' ? 'release/mac/Zola.app/Contents/Resources/app.asar'
    : 'release/linux-unpacked/resources/app.asar';
const asarPath = path.resolve(process.argv[2] || defaultAsar);
const { root, raw, base } = readIndex(asarPath);
const entries = walk(root, '', []).filter(e => SCOPE.some(prefix => e.path.startsWith(prefix)));
const sha = buffer => createHash('sha256').update(buffer).digest('hex');

const rows = entries.map(entry => {
  const local = path.resolve(entry.path);
  const archive = entry.unpacked ? null : raw.subarray(base + entry.offset, base + entry.offset + entry.size);
  const disk = fs.existsSync(local) ? fs.readFileSync(local) : null;
  const result = {
    path: entry.path,
    archiveBytes: entry.size,
    archiveSha256: archive ? sha(archive) : null,
    unpacked: entry.unpacked,
    localBytes: disk ? disk.length : null,
    localSha256: disk ? sha(disk) : null,
  };
  result.same = archive != null && disk != null && result.archiveSha256 === result.localSha256;
  return result;
});

const differing = rows.filter(r => !r.same);
const evidence = {
  date: new Date().toISOString(),
  asar: asarPath,
  asarSha256: sha(fs.readFileSync(asarPath)),
  scope: SCOPE,
  compared: rows.length,
  identical: rows.length - differing.length,
  differing: differing.map(r => r.path),
  rows,
  status: rows.length > 0 && differing.length === 0 ? 'PASS' : 'FAIL',
};
fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync('reports/asar-parity.json', JSON.stringify(evidence, null, 2));
console.log(`${evidence.status}: ${evidence.identical}/${evidence.compared} bundled files byte-identical to the current tree`);
if (differing.length) {
  for (const r of differing) console.error(`  DIFFERS ${r.path} (${r.archiveBytes ?? 'unpacked'} vs ${r.localBytes ?? 'missing'})`);
  process.exitCode = 1;
}
