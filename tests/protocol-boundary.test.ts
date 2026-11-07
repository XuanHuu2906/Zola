import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * ADR-004 mục 4: **chỉ** `electron/protocol/` được import `zca-js`. Đây là ranh
 * giới bảo mật, không phải quy ước: mọi thứ rời protocol đều đã được map sang
 * `Live*` và renderer không bao giờ thấy cookie/IMEI/userAgent/cipher_key.
 *
 * `tests/design-system.test.ts` chỉ đi qua `src/**`, nên lớp protocol đặt ở
 * `electron/` lọt lưới — test này bù đúng khoảng đó.
 */

const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);

const toPosix = (file: string) => file.split(path.sep).join('/');

const sourceFiles = (): string[] => [
  ...walk('src').filter(file => /\.(ts|tsx)$/.test(file)),
  ...walk('electron').filter(file => /\.ts$/.test(file)),
  ...walk('tests').filter(file => /\.(ts|tsx)$/.test(file)),
].map(toPosix);

/** Comment được phép *nhắc* tới zca-js/cookie/IMEI; chỉ mã mới bị soi. */
const codeOf = (file: string): string => fs.readFileSync(file, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');

const importsOf = (file: string): string[] =>
  [...codeOf(file).matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g)]
    .map(match => match[1]);

test('zca-js is imported only from electron/protocol/', () => {
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    // Chính file test này nhắc tên gói trong comment; nó không import.
    const specifiers = importsOf(file);
    const hits = specifiers.filter(specifier => specifier === 'zca-js' || specifier.startsWith('zca-js/'));
    if (hits.length && !file.startsWith('electron/protocol/')) offenders.push(`${file} -> ${hits.join(', ')}`);
  }
  assert.deepEqual(offenders, [], 'ADR-004 §4: only electron/protocol/ may reach zca-js');
});

test('electron/protocol/ is the only directory that mentions the package in imports', () => {
  // Cùng phép kiểm, nhưng khẳng định chiều ngược lại: nếu ai đó xoá hết import
  // thì test trên vẫn xanh trong khi cả tính năng đã bị gỡ. Chỉ ra nơi *phải* có.
  const importers = sourceFiles().filter(file =>
    importsOf(file).some(specifier => specifier === 'zca-js' || specifier.startsWith('zca-js/')));
  assert.deepEqual(importers.sort(), [
    'electron/protocol/session.ts',
    'electron/protocol/zalo-client.ts',
  ]);
});

test('the renderer and preload never name protocol secrets', () => {
  // Cookie/IMEI/userAgent/cipher_key chỉ được tồn tại ở main. Một chuỗi như
  // `userAgent` trong renderer gần như chắc chắn là rò rỉ qua IPC.
  const secrets = ['cipher_key', 'cipherKey', 'imei', 'IMEI', 'userAgent'];
  const offenders: string[] = [];
  for (const file of sourceFiles().filter(name => name.startsWith('src/') || name === 'electron/preload.ts')) {
    const source = codeOf(file);
    for (const secret of secrets) {
      if (source.includes(secret)) offenders.push(`${file} mentions ${secret}`);
    }
  }
  assert.deepEqual(offenders, [], 'plan §1: renderer must never see cookie, IMEI or token');
});

test('the renderer is never handed a zca-js value', () => {
  // `import type` cũng tính: kiểu zca-js trong renderer sẽ kéo suy luận payload
  // thật vào nơi không được phép biết hình dạng của nó.
  //
  // Chỉ soi *specifier* import, không soi chuỗi thô: ADR-004 bắt buộc câu cảnh
  // báo gốc ("Dùng zca-js không chính thức…") xuất hiện nguyên văn trong
  // `src/shared/live.ts`, nên tên gói hợp lệ ở dạng chữ trong giao diện — nhưng
  // không bao giờ ở dạng import.
  const offenders: string[] = [];
  for (const file of sourceFiles().filter(name => name.startsWith('src/'))) {
    const hits = importsOf(file).filter(specifier => specifier === 'zca-js' || specifier.startsWith('zca-js/'));
    if (hits.length) offenders.push(`${file} -> ${hits.join(', ')}`);
  }
  assert.deepEqual(offenders, []);
});
