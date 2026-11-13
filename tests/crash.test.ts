import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  describeError, FATAL_WINDOW_MS, installCrashGuard, MAX_FATAL, type CrashReport,
} from '../electron/crash.ts';

/**
 * Bắt lỗi toàn cục của main (plan §9.1). Test chạy trên `EventEmitter` thật, nên
 * nó kiểm đúng thứ Electron sẽ làm: phát `uncaughtException` /
 * `unhandledRejection` trên `process`.
 *
 * Không có test nào phát sự kiện trên `process` thật — làm vậy sẽ giết chính lượt
 * chạy test.
 */

function rig() {
  const emitter = new EventEmitter();
  const reports: CrashReport[] = [];
  let clock = 1_000;
  const off = installCrashGuard(emitter, report => reports.push(report), { now: () => clock });
  return { emitter, reports, off, advance: (ms: number) => { clock += ms; } };
}

test('một uncaughtException được báo chứ không giết tiến trình', () => {
  const { emitter, reports } = rig();
  emitter.emit('uncaughtException', new TypeError('không đọc được thuộc tính'));
  assert.equal(reports.length, 1);
  assert.equal(reports[0].kind, 'uncaught');
  assert.equal(reports[0].message, 'TypeError: không đọc được thuộc tính');
  assert.equal(reports[0].fatal, false, 'lỗi đầu tiên không đáng chết app');
});

test('một promise bị từ chối cũng được báo', () => {
  const { emitter, reports } = rig();
  emitter.emit('unhandledRejection', new Error('máy chủ im lặng'));
  assert.equal(reports.length, 1);
  assert.equal(reports[0].kind, 'rejection');
  assert.match(reports[0].message, /máy chủ im lặng/);
});

test('mô tả lỗi không bao giờ ném, kể cả với giá trị lạ', () => {
  assert.equal(describeError('chuỗi trần'), 'chuỗi trần');
  assert.equal(describeError(42), 'Unknown: number');
  assert.equal(describeError(undefined), 'Unknown: undefined');
  assert.equal(describeError({ get message() { throw new Error('bẫy'); } }), 'Unknown: object');
  // Object có `name`/`message` không phải Error thì không được coi là Error.
  assert.equal(describeError(new Error('')), 'Error: (không có thông điệp)');
  assert.ok(describeError(new Error('x'.repeat(500))).length <= 200, 'không đổ cả stack vào log');
});

test('lỗi lặp lại quá nhanh trong cửa sổ thì lần thứ ba là fatal', () => {
  const { emitter, reports } = rig();
  for (let i = 0; i < MAX_FATAL; i += 1) emitter.emit('uncaughtException', new Error(`lần ${i}`));
  assert.deepEqual(reports.map(r => r.fatal), [false, false, true]);
});

test('lỗi rải rác ngoài cửa sổ không cộng dồn thành fatal', () => {
  const { emitter, reports, advance } = rig();
  emitter.emit('uncaughtException', new Error('một'));
  advance(FATAL_WINDOW_MS + 1);
  emitter.emit('uncaughtException', new Error('hai'));
  advance(FATAL_WINDOW_MS + 1);
  emitter.emit('uncaughtException', new Error('ba'));
  assert.deepEqual(reports.map(r => r.fatal), [false, false, false],
    'ba lỗi trong một năm không phải là hỏng vòng lặp');
});

test('báo cáo hỏng không tạo ra một lỗi mới', () => {
  const emitter = new EventEmitter();
  let calls = 0;
  installCrashGuard(emitter, () => { calls += 1; throw new Error('chỗ ghi log cũng hỏng'); });
  // Nếu lỗi của `report` rò ra, EventEmitter sẽ ném ra chính test này.
  assert.doesNotThrow(() => emitter.emit('uncaughtException', new Error('gốc')));
  assert.equal(calls, 1);
});

test('gỡ đăng ký thì cả hai kênh đều im', () => {
  const { emitter, reports, off } = rig();
  off();
  emitter.emit('uncaughtException', new Error('sau khi gỡ'));
  emitter.emit('unhandledRejection', new Error('sau khi gỡ'));
  assert.equal(reports.length, 0);
});

test('gỡ đăng ký hai lần không ném', () => {
  const { off } = rig();
  assert.doesNotThrow(off);
});
