import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLogFile, LOG_MAX_BYTES } from '../electron/log-file.ts';

/** Mỗi test một thư mục riêng để không phụ thuộc thứ tự chạy và dọn sạch sau đó. */
function scratch(): { dir: string; file: string; done: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'glass-log-'));
  return {
    dir,
    file: path.join(dir, 'live-listener.log'),
    done: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const lines = (file: string): string[] =>
  readFileSync(file, 'utf8').split('\n').filter(Boolean);

test('log ghi một dòng timestamp event json và giữ đúng đường dẫn', () => {
  const s = scratch();
  try {
    const log = createLogFile(s.file);
    assert.equal(log.path, s.file);
    log.write('history', { count: 2 }, new Date('2026-11-08T03:04:05.000Z'));
    assert.deepEqual(lines(s.file), ['2026-11-08T03:04:05.000Z history {"count":2}']);
  } finally { s.done(); }
});

test('vượt trần thì xoay sang .1 và tiếp tục ghi file mới', () => {
  const s = scratch();
  try {
    // Mỗi dòng 35 byte: trần 70 thì hai dòng đầu đầy file, dòng thứ ba buộc xoay.
    const log = createLogFile(s.file, 70);
    for (let i = 0; i < 3; i += 1) log.write('history', i, new Date('2026-11-08T03:04:05.000Z'));
    assert.equal(lines(`${s.file}.1`).length, 2, 'hai dòng đầu nằm ở bản cũ');
    assert.equal(lines(s.file).length, 1, 'dòng thứ ba mở file mới');
    assert.match(lines(s.file)[0], / history 2$/);
  } finally { s.done(); }
});

test('xoay nhiều lần vẫn chỉ giữ một bản .1, không sinh .2', () => {
  const s = scratch();
  try {
    const log = createLogFile(s.file, 70);
    for (let i = 0; i < 12; i += 1) log.write('history', i, new Date('2026-11-08T03:04:05.000Z'));
    assert.ok(existsSync(`${s.file}.1`));
    assert.equal(existsSync(`${s.file}.2`), false, 'chỉ giữ đúng một bản cũ');
    assert.ok(statSync(s.file).size <= 70 + 35, 'file hiện tại không vượt trần quá một dòng');
  } finally { s.done(); }
});

test('file đã có sẵn vượt trần bị xoay ngay lần ghi đầu', () => {
  const s = scratch();
  try {
    writeFileSync(s.file, 'x'.repeat(LOG_MAX_BYTES));
    const log = createLogFile(s.file, 64);
    log.write('history', 1, new Date('2026-11-08T03:04:05.000Z'));
    assert.equal(lines(`${s.file}.1`).length, 1, 'file cũ (một dòng dài) thành bản .1');
    assert.equal(lines(s.file).length, 1);
  } finally { s.done(); }
});

test('thư mục chưa tồn tại: không ném, không tạo file', () => {
  const s = scratch();
  try {
    const log = createLogFile(path.join(s.dir, 'chưa-có', 'live-listener.log'));
    assert.doesNotThrow(() => log.write('history', 1));
    assert.equal(existsSync(path.join(s.dir, 'chưa-có')), false, 'không tự tạo thư mục');
  } finally { s.done(); }
});

test('đường dẫn hỏng (cha là file) không ném ra vào luồng tin', () => {
  const s = scratch();
  try {
    const blocker = path.join(s.dir, 'blocker');
    writeFileSync(blocker, 'not a dir');
    const log = createLogFile(path.join(blocker, 'live-listener.log'), 64);
    assert.doesNotThrow(() => log.write('history', { cờ: true }));
    assert.doesNotThrow(() => log.write('history', { cờ: true }), 'lần ghi thứ hai cũng im lặng');
  } finally { s.done(); }
});

test('dữ liệu có ký tự đặc biệt vẫn thành đúng một dòng', () => {
  const s = scratch();
  try {
    const log = createLogFile(s.file);
    log.write('history', { text: 'dòng\nmới "ngoặc"' }, new Date('2026-11-08T03:04:05.000Z'));
    const rows = lines(s.file);
    assert.equal(rows.length, 1, 'JSON.stringify đã thoát newline');
    assert.match(rows[0], /"text":"dòng\\nmới \\"ngoặc\\""\}$/);
  } finally { s.done(); }
});
