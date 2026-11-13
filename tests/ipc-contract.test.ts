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
  // `setActiveThread` là một chiều để main biết group nào đang mở khi WebSocket
  // kết nối xong. `reconnect` vì §5.5 cần nút "Kết nối lại",
  // `reportError` vì §9.1 cần ghi nhận lỗi render; `evCrash` cùng lý do đó.
  // `evMedia` là kênh **một chiều** của tệp đính kèm: một tệp tải xong thì chỉ
  // đường dẫn cục bộ của nó đổi, không phải một tin mới và không có phản hồi.
  assert.deepEqual(Object.keys(shared.IPC).sort(), [
    'evCatchUp', 'evConnection', 'evCrash', 'evLoginState', 'evMedia', 'evMessageUpsert', 'evSync', 'evThreadUpsert',
    'forwardMessage',
    'getMessages', 'listConversations', 'login', 'logout', 'markRead',
    // Ghim, đánh dấu chưa đọc và cảm xúc đều là **trạng thái máy chủ** (Zalo
    // trên điện thoại thấy cùng thay đổi), nên mỗi thao tác cần kênh riêng.
    'react',
    'recall',
    'reconnect', 'reportError', 'retryMessage', 'sendMessage',
    'setActiveThread', 'setPinned', 'setUnread',
    'syncFromPhone',
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

  const reactions: unknown[] = [
    { threadId: 'u-1', kind: 'user', msgId: 'm-1', icon: '/-heart' },
    { threadId: 'g-1', kind: 'group', msgId: 'm-1', icon: '/-strong' },
    // `icon: ''` là **gỡ** cảm xúc — hợp lệ, và là lý do validator không dùng
    // lại `readSendRequest` (hàm đó đòi text không rỗng).
    { threadId: 'u-1', kind: 'user', msgId: 'm-1', icon: '' },
    { threadId: 'u-1', kind: 'user', msgId: '', icon: '/-heart' },
    { threadId: 'u-1', kind: 'user', icon: '/-heart' },
    { threadId: 'u-1', kind: 'user', msgId: 'm-1', icon: 5 },
    { threadId: 'u-1', kind: 'user', msgId: 'm-1', icon: 'x'.repeat(33) },
    { threadId: 'u-1', kind: 'room', msgId: 'm-1', icon: '/-heart' },
    null,
  ];
  for (const payload of reactions) {
    assert.deepEqual(main.readReactionRequest(payload), shared.readReactionRequest(payload), JSON.stringify(payload));
  }
  assert.ok(shared.readReactionRequest(reactions[2]), 'chuỗi rỗng là gỡ, phải qua được validator');

  const recalls: unknown[] = [
    { threadId: 'u-1', kind: 'user', msgId: 'm-1' },
    { threadId: 'g-1', kind: 'group', msgId: 'm-1' },
    { threadId: 'u-1', kind: 'user', msgId: '' },
    { threadId: 'u-1', kind: 'user' },
    { threadId: 'u-1', kind: 'user', msgId: 42 },
    { threadId: 'u-1', kind: 'room', msgId: 'm-1' },
    { threadId: 'u-1', kind: 'user', msgId: longId },
    null,
  ];
  for (const payload of recalls) {
    assert.deepEqual(main.readRecallRequest(payload), shared.readRecallRequest(payload), JSON.stringify(payload));
  }
  assert.ok(shared.readRecallRequest(recalls[0]));

  const forwards: unknown[] = [
    { threadId: 'u-1', kind: 'user', text: 'Chuyển tiếp' },
    { threadId: 'g-1', kind: 'group', text: 'Chuyển tiếp', msgId: 'm-1', ts: 123456 },
    { threadId: 'u-1', kind: 'user', text: '' },
    { threadId: 'u-1', kind: 'user', text: '   ' },
    { threadId: 'u-1', kind: 'user', text: longText },
    { threadId: 'u-1', kind: 'room', text: 'Chuyển tiếp' },
    { threadId: '', kind: 'user', text: 'Chuyển tiếp' },
    null,
  ];
  for (const payload of forwards) {
    assert.deepEqual(main.readForwardRequest(payload), shared.readForwardRequest(payload), JSON.stringify(payload));
  }
  assert.ok(shared.readForwardRequest(forwards[0]));
  assert.ok(shared.readForwardRequest(forwards[1]));
});
