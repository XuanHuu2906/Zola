import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * `tools/node-run.cjs` là CommonJS vì nó phải chạy được trên Node 22 (chính nó tồn
 * tại để nâng cấp Node). Nạp qua `createRequire` thay vì import để không phải đổi
 * module system của cả repo.
 */
const require = createRequire(import.meta.url);
const { REQUIRED_MAJOR, majorOf, nodeCandidates, pickNode } = require('../tools/node-run.cjs') as {
  REQUIRED_MAJOR: number;
  majorOf(version: string): number;
  nodeCandidates(env: Record<string, string | undefined>, home: string): string[];
  pickNode(candidates: string[], isFile: (f: string) => boolean,
    versionOf: (f: string) => string, required?: number): string | null;
};

test('majorOf đọc được cả "v24.22.2" lẫn "24"', () => {
  assert.equal(majorOf('v24.22.2'), 24);
  assert.equal(majorOf('22.23.1'), 22);
  assert.equal(majorOf('24'), 24);
  assert.equal(majorOf(''), 0, 'rỗng không được thành NaN rồi lọt so sánh');
});

test('pickNode bỏ qua file không tồn tại và bản quá cũ', () => {
  const files = new Set(['/a/node', '/b/node', '/c/node']);
  const versions: Record<string, string> = { '/a/node': 'v22.23.1', '/b/node': 'v20.1.0', '/c/node': 'v24.0.0' };
  assert.equal(pickNode(['/a/node', '/b/node', '/c/node'], f => files.has(f), f => versions[f]), '/c/node');
});

test('pickNode trả null khi không có bản nào đủ mới', () => {
  assert.equal(pickNode(['/a/node'], () => true, () => 'v22.23.1'), null);
  assert.equal(pickNode([], () => true, () => 'v24.0.0'), null);
});

test('pickNode tôn trọng ngưỡng phiên bản truyền vào', () => {
  assert.equal(pickNode(['/a/node'], () => true, () => 'v22.23.1', 22), '/a/node');
});

test('thứ tự ứng viên: NODE24 trước, rồi bản cài per-user trong README', () => {
  const list = nodeCandidates({ NODE24: '/custom/node' }, '/home/u');
  assert.equal(list[0], '/custom/node', 'biến môi trường phải thắng, để ép bản cụ thể');
  assert.equal(list[1], path.join('/home/u', '.local/lib/nodejs/bin/node'));
  assert.ok(list.includes('/usr/bin/node-24'), 'đường dẫn gói nodejs24 của Fedora phải có trong danh sách');
});

test('không có NODE24 thì danh sách không chứa undefined', () => {
  assert.ok(nodeCandidates({}, '/home/u').every(item => typeof item === 'string' && item.length > 0));
});

test('ngưỡng phiên bản khớp engines.node trong package.json', () => {
  const pkg = require('../package.json') as { engines: { node: string } };
  assert.equal(REQUIRED_MAJOR, Number(pkg.engines.node.replace(/[^0-9.]/g, '').split('.')[0]),
    'sửa engines.node mà quên node-run.cjs thì test này bắt được');
});
