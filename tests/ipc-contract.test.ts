import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as shared from '../src/shared/ipc-contract.ts';
import * as main from '../electron/ipc-contract.ts';

/**
 * `electron/ipc-contract.ts` là bản sao bắt buộc của `src/shared/ipc-contract.ts`
 * vì `tsconfig.electron.json` có `rootDir: "electron"` (TS6059). Không có cơ chế
 * nào khác giữ hai bản khớp ngoài test này — lệch một kênh là main và renderer
 * nói chuyện lệch nhau trong im lặng.
 */

test('hai bản IPC khai báo đúng cùng một tập kênh', () => {
  assert.deepEqual(main.IPC, shared.IPC);
  assert.deepEqual(Object.keys(main.IPC), Object.keys(shared.IPC));
  // 7 kênh invoke của plan §5.1, thêm `reconnect` vì plan §5.5 cần nút "Kết nối lại".
  assert.deepEqual(Object.keys(shared.IPC).sort(), [
    'evConnection', 'evLoginState', 'evMessageUpsert', 'evThreadUpsert',
    'getMessages', 'listConversations', 'login', 'logout', 'markRead',
    'reconnect', 'retryMessage', 'sendMessage',
  ]);
});

test('hằng giới hạn độ dài khớp từng giá trị', () => {
  assert.equal(main.TEXT_MAX, shared.TEXT_MAX);
  assert.equal(main.THREAD_ID_MAX, shared.THREAD_ID_MAX);
  assert.equal(main.CLIENT_ID_MAX, shared.CLIENT_ID_MAX);
  assert.equal(shared.TEXT_MAX, 2000);
  assert.equal(shared.THREAD_ID_MAX, 128);
  assert.equal(shared.CLIENT_ID_MAX, 64);
});

test('preload gọi đúng cùng tập kênh dù không import được hợp đồng', () => {
  // Preload chạy sandbox nên không `require` được `ipc-contract`; nó chép chuỗi.
  // Nếu hai bên lệch, `invoke` treo im lặng tới khi timeout — test này chặn trước.
  const source = fs.readFileSync('electron/preload.ts', 'utf8');
  const declared = [...source.matchAll(/'((?:chat|ev):[a-zA-Z]+)'/g)].map(match => match[1]);
  assert.deepEqual([...new Set(declared)].sort(), Object.values(shared.IPC).sort());
  assert.equal(declared.length, Object.keys(shared.IPC).length, 'mỗi kênh khai đúng một lần trong bảng CH');
});

test('validator từ chối và chấp nhận đúng cùng một payload', () => {
  const okSend = { threadId: 'u-1', kind: 'user', text: 'Chào', clientId: 'c-1' };
  const longId = 'x'.repeat(shared.THREAD_ID_MAX + 1);
  const longText = 'x'.repeat(shared.TEXT_MAX + 1);
  const sends: unknown[] = [
    okSend,
    { ...okSend, kind: 'group' },
    { ...okSend, kind: 'channel' },
    { ...okSend, threadId: '' },
    { ...okSend, threadId: 5 },
    { ...okSend, threadId: longId },
    { ...okSend, text: '' },
    { ...okSend, text: '   ' },
    { ...okSend, text: longText },
    { ...okSend, clientId: '' },
    { ...okSend, clientId: 'c'.repeat(shared.CLIENT_ID_MAX + 1) },
    null,
    'text',
    [],
  ];
  for (const payload of sends) {
    assert.deepEqual(main.readSendRequest(payload), shared.readSendRequest(payload), JSON.stringify(payload));
  }

  const reads: unknown[] = [
    { threadId: 'u-1' },
    { threadId: 'u-1', before: 'm-9' },
    { threadId: '' },
    { threadId: 'u-1', before: '' },
    { threadId: 'u-1', before: 42 },
    { threadId: 'u-1', before: longId },
    null,
    7,
  ];
  for (const payload of reads) {
    assert.deepEqual(main.readMessagesRequest(payload), shared.readMessagesRequest(payload), JSON.stringify(payload));
  }

  const marks: unknown[] = [
    { threadId: 'u-1', kind: 'user' },
    { threadId: 'g-1', kind: 'group' },
    { threadId: 'u-1', kind: 'room' },
    { threadId: '', kind: 'user' },
    { threadId: 'u-1' },
    null,
  ];
  for (const payload of marks) {
    assert.deepEqual(main.readReadRequest(payload), shared.readReadRequest(payload), JSON.stringify(payload));
  }
});
