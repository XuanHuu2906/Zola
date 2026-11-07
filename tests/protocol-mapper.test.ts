import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMessage, buildThreads, isTextMessage, textOf, toLiveMessage } from '../electron/protocol/mapper.ts';
import type { LiveMessage } from '../electron/ipc-contract.ts';

const raw = (overrides: Record<string, unknown> = {}) => ({
  msgId: 'm-1', cliMsgId: 'c-1', uidFrom: '0', idTo: 'u-1', dName: '',
  ts: '1700000000000', msgType: '1', content: 'Chào bạn', ...overrides,
}) as never;

test('chỉ chuỗi thuần mới là tin text; attachment JSON bị bỏ', () => {
  assert.equal(isTextMessage(raw()), true);
  assert.equal(isTextMessage(raw({ msgType: '32', content: '{"href":"x"}' })), false);
  assert.equal(isTextMessage(raw({ msgType: '2', content: '   ' })), false);
  assert.equal(isTextMessage(raw({ msgType: '2', content: 'vẫn là chữ' })), true);
  assert.equal(textOf(raw({ content: '{"title":"a"}' })), '');
  assert.equal(textOf(raw({ content: '  xin chào' })), '  xin chào');
  assert.equal(textOf(raw({ content: 'x'.repeat(3000) })).length, 2000, 'text bị chặn trần 2000');
});

test('cờ `isSelf` của zca-js quyết định người gửi, không phải uidFrom', () => {
  // Constructor của zca-js tính `isSelf` rồi mới ghi đè `uidFrom` "0" bằng uid
  // thật, nên payload tới mapper không còn dấu nào để tự suy ra người gửi.
  const payload = raw({ uidFrom: 'u-9', idTo: 'u-9' });
  assert.equal(toLiveMessage(payload, 'u-9', 'user', true)?.from, 'me');
  assert.equal(toLiveMessage(payload, 'u-9', 'user', false)?.from, 'them');
});

test('ts hỏng thì rơi về now, không ném', () => {
  const message = toLiveMessage(raw({ ts: 'không-phải-số' }), 'u-1', 'user', false) as LiveMessage;
  assert.equal(Number.isFinite(message.ts), true);
  assert.ok(message.ts > 0);
  assert.equal(toLiveMessage(raw({ ts: '1700000000123' }), 'u-1', 'user', false)?.ts, 1700000000123);
});

test('tin rỗng sau khi cắt là null, không tạo bubble trống', () => {
  assert.equal(toLiveMessage(raw({ content: '   ' }), 'u-1', 'user', false), null);
  assert.equal(toLiveMessage(raw({ msgType: '2', content: '{"a":1}' }), 'u-1', 'user', false), null);
});

test('clientId luôn null: tin từ server không mang id tạm của mình', () => {
  assert.equal(toLiveMessage(raw(), 'u-1', 'user', false)?.clientId, null);
  assert.equal(toLiveMessage(raw({ msgId: '' }), 'u-1', 'user', false)?.msgId, null);
});

test('buildThreads ghim lên đầu, avatar luôn null, chưa có preview', () => {
  const threads = buildThreads(
    [{ userId: 'u-1', displayName: 'An', zaloName: '', avatar: 'https://zalo/x.png' },
      { userId: 'u-2', displayName: '', zaloName: 'Bình', avatar: '' }],
    [{ groupId: 'g-1', name: 'Nhóm', avt: '', totalMember: 3 }],
    ['g-1'], ['u-2'], [],
  );
  assert.deepEqual(threads.map(thread => thread.id), ['g-1', 'u-1', 'u-2']);
  assert.equal(threads[0].kind, 'group');
  assert.equal(threads[2].name, 'Bình');
  assert.equal(threads[1].unread, 0);
  assert.equal(threads[2].unread, 1);
  for (const thread of threads) {
    assert.equal(thread.avatar, null, 'CSP img-src không cho avatar từ xa');
    assert.equal(thread.lastText, '');
    assert.equal(thread.lastTs, 0);
  }
});

test('applyMessage tạo thread lạ, đẩy lên đầu, và chỉ tăng unread khi không mở', () => {
  const seeded = buildThreads([{ userId: 'u-1', displayName: 'An', zaloName: '', avatar: '' }], [], [], [], []);
  const incoming = toLiveMessage(raw({ uidFrom: 'u-7', idTo: '0', content: 'Này' }), 'u-7', 'user', false) as LiveMessage;
  const created = applyMessage(seeded, incoming, null);
  assert.equal(created[0].id, 'u-7');
  assert.equal(created[0].name, 'Người dùng Zalo');
  assert.equal(created[0].lastText, 'Này');
  assert.equal(created.length, 2);

  const bumped = applyMessage(seeded, incoming, 'u-7');
  assert.equal(bumped[0].unread, 0, 'thread đang mở thì không cộng unread');

  const mine = { ...incoming, from: 'me' as const };
  assert.equal(applyMessage(seeded, mine, null)[1].unread, 0, 'tin của mình không cộng unread');
});

test('applyMessage giữ lastTs đơn điệu tăng khi tin tới lệch thứ tự', () => {
  const first = toLiveMessage(raw({ ts: '2000' }), 'u-1', 'user', false) as LiveMessage;
  const state = applyMessage(buildThreads([{ userId: 'u-1', displayName: 'An', zaloName: '', avatar: '' }], [], [], [], []), first, null);
  const stale = { ...first, ts: 1000, text: 'cũ' };
  const next = applyMessage(state, stale, null);
  assert.equal(next[0].lastTs, 2000);
  assert.equal(next[0].lastText, 'cũ');
});
