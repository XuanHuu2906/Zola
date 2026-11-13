// npm scripts spawn a bare `node`. Fedora 45 ships Node 22 at /usr/bin/node while
// package.json requires >=24, and Node 22 predates `--test-isolation`, so
// `npm test` died with "bad option: --test-isolation=none" before running a single
// test. Telling people to edit PATH is easy to forget and invisible in CI, so the
// script itself finds a suitable Node and re-execs with the same arguments.
//
// Node 22 can run this file fine — it only uses features from long before that.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Must match `engines.node` in package.json. */
const REQUIRED_MAJOR = 24;

const majorOf = version => Number(String(version).replace(/^v/, '').split('.')[0]);

/** Đường dẫn ứng viên, theo thứ tự ưu tiên. `NODE24` cho phép ép thủ công. */
const nodeCandidates = (env, home) => [
  env.NODE24,
  path.join(home, '.local/lib/nodejs/bin/node'), // README: cài per-user
  '/usr/bin/node-24',                            // Fedora: dnf install nodejs24
  '/usr/bin/nodejs24',
  '/usr/local/bin/node',
  '/opt/homebrew/bin/node',
].filter(Boolean);

/**
 * Chọn binary đầu tiên tồn tại **và** đủ phiên bản. Trả `null` nếu không có.
 *
 * `isFile`/`versionOf` được truyền vào để test được mà không cần đĩa thật hay
 * cài nhiều bản Node trên máy chạy test.
 */
function pickNode(candidates, isFile, versionOf, required = REQUIRED_MAJOR) {
  for (const candidate of candidates) {
    if (!isFile(candidate)) continue;
    if (majorOf(versionOf(candidate)) >= required) return candidate;
  }
  return null;
}

const isFile = file => {
  try { return fs.statSync(file).isFile(); } catch { return false; }
};

const versionOf = file => {
  try { return String(spawnSync(file, ['--version'], { encoding: 'utf8' }).stdout || ''); }
  catch { return ''; }
};

const run = (bin, args) => {
  const child = spawnSync(bin, args, { stdio: 'inherit' });
  if (child.error) { console.error(child.error.message); return 1; }
  return child.status ?? 1;
};

function main(argv) {
  const args = argv.slice(2);
  if (!args.length) {
    console.error('Usage: node tools/node-run.cjs <node args...>   (vd: --test tests/live.test.ts)');
    return 64;
  }
  if (majorOf(process.versions.node) >= REQUIRED_MAJOR) return run(process.execPath, args);

  const node = pickNode(nodeCandidates(process.env, os.homedir()), isFile, versionOf);
  if (!node) {
    console.error(`Cần Node.js >= ${REQUIRED_MAJOR} nhưng \`node\` đang là v${process.versions.node}.`);
    console.error('Cài một bản rồi chạy lại:');
    console.error('  mkdir -p ~/.local/lib/nodejs && curl -sSL https://nodejs.org/dist/v24.22.2/node-v24.22.2-linux-x64.tar.xz \\');
    console.error('    | tar -xJ -C ~/.local/lib/nodejs --strip-components=1');
    console.error('Hoặc trỏ thẳng: NODE24=/đường/dẫn/tới/node npm test');
    return 1;
  }
  if (node !== process.execPath) {
    console.error(`[node-run] \`node\` là v${process.versions.node}; dùng ${node} thay thế.`);
  }
  return run(node, args);
}

if (require.main === module) process.exitCode = main(process.argv);

module.exports = { REQUIRED_MAJOR, majorOf, nodeCandidates, pickNode };
