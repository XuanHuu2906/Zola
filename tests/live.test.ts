import test from 'node:test';
import assert from 'node:assert/strict';
import type { Chat } from '../src/renderer/adapters/types.ts';
import type { LiveMessage, LiveThread } from '../src/shared/ipc-contract.ts';
import {
  appendIncoming, appendOutgoing, nextMessageId, retryTarget, settleOutgoing, threadToChat, upsertThread,
} from '../src/renderer/live/map.ts';
import { subscribeLive } from '../src/renderer/live/subscribe.ts';
import type { ChatEvents, LiveHandlers } from '../src/renderer/live/subscribe.ts';
import { adoptEcho } from '../src/renderer/live/echo.ts';
import { liveConnectionLabel, liveConnectionReconnectable, liveConnectionTone } from '../src/shared/live.ts';

/**
 * `src/renderer/live/map.ts` là toàn bộ phần suy luận của chế độ thật, tách khỏi
 * store để kiểm được bằng node: không `window`, không React, không IPC.
 */

const now = new Date(2026, 10, 7, 10, 30);

const thread = (patch: Partial<LiveThread> = {}): LiveThread => ({
  id: 'u-1', kind: 'user', name: 'Minh Anh', avatar: null,
  pinned: false, unread: 0, lastText: 'Chào bạn', lastTs: now.getTime(), ...patch,
});

const live = (patch: Partial<LiveMessage> = {}): LiveMessage => ({
  threadId: 'u-1', kind: 'user', msgId: 'm-1', clientId: null,
  from: 'them', text: 'Chào bạn', ts: now.getTime(), ...patch,
});

const chat = (patch: Partial<Chat> = {}): Chat => ({
  id: 'u-1', name: 'Minh Anh', avatar: null, pinned: false, unread: 0,
  isGroup: false, isWork: false, time: '09:00', preview: 'Cũ',
  messages: [], historyRemaining: 0, ...patch,
});

test('nextMessageId đếm trên mọi hội thoại, không chỉ hội thoại đang mở', () => {
  assert.equal(nextMessageId([]), 1);
  assert.equal(nextMessageId([chat({ messages: [{ id: 4, from: 'them', time: '09:00' }] })]), 5);
  assert.equal(nextMessageId([
    chat({ messages: [{ id: 2, from: 'them', time: '09:00' }] }),
    chat({ id: 'u-2', messages: [{ id: 9, from: 'them', time: '09:00' }] }),
  ]), 10);
});

test('threadToChat map đủ trường UI và không bịa lịch sử', () => {
  assert.deepEqual(threadToChat(thread({ kind: 'group', pinned: true, unread: 3 })), {
    id: 'u-1', name: 'Minh Anh', avatar: null, pinned: true, unread: 3,
    isGroup: true, isWork: false, time: '10:30', preview: 'Chào bạn',
    messages: [], historyRemaining: 0,
  });
  // lastTs 0 nghĩa là server không cho mốc thời gian: để trống, không lấy giờ máy.
  assert.equal(threadToChat(thread({ lastTs: 0 })).time, '');
});

test('upsertThread thêm mới, cập nhật tại chỗ và tôn trọng hội thoại đang mở', () => {
  const added = upsertThread([chat({ id: 'u-9', name: 'Khác' })], thread({ pinned: true }), 'u-1');
  assert.deepEqual(added.map(item => item.id), ['u-1', 'u-9'], 'ghim lên đầu, tin đang có giữ nguyên');
  assert.equal(added[0].messages.length, 0);

  const existing = chat({ messages: [{ id: 1, from: 'them', time: '09:00', text: 'cũ' }] });
  const kept = upsertThread([existing], thread({ name: 'Tên mới', unread: 5, lastText: '' }), 'u-1');
  assert.equal(kept[0].name, 'Tên mới');
  assert.equal(kept[0].unread, 0, 'hội thoại đang mở luôn đọc hết');
  assert.equal(kept[0].messages, existing.messages, 'tin đã có không bị dựng lại');
  assert.equal(kept[0].preview, 'Cũ', 'preview rỗng không xoá preview cũ');

  const background = upsertThread([existing], thread({ unread: 5 }), 'u-2');
  assert.equal(background[0].unread, 5, 'hội thoại nền giữ số chưa đọc');
});

test('appendOutgoing tạo bong bóng tạm khoá bằng clientId', () => {
  const [row] = appendOutgoing([chat()], 'u-1', 'Xin chào', 'c-1', now);
  const message = row.messages[0];
  assert.equal(row.messages.length, 1);
  assert.equal(message.from, 'me');
  assert.equal(message.text, 'Xin chào');
  assert.equal(message.status, 'pending');
  assert.equal(message.clientId, 'c-1');
  assert.equal(message.time, '10:30');
  assert.equal(row.preview, 'Xin chào');
  assert.equal(row.time, '10:30');
  assert.equal(appendOutgoing([chat()], 'u-404', 'Xin chào', 'c-1', now)[0].messages.length, 0);
});

test('settleOutgoing gắn kết quả vào đúng clientId, kể cả khi đã đổi thứ tự', () => {
  const sent = settleOutgoing(appendOutgoing([chat()], 'u-1', 'A', 'c-1', now), 'c-1', { status: 'sent', msgId: 'm-9' });
  assert.equal(sent[0].messages[0].status, 'sent');
  assert.equal(sent[0].messages[0].msgId, 'm-9');

  const failed = settleOutgoing(appendOutgoing([chat()], 'u-1', 'A', 'c-1', now), 'c-1', { status: 'failed' });
  assert.equal(failed[0].messages[0].status, 'failed');
  assert.equal(failed[0].messages[0].msgId, undefined, 'thất bại không có msgId');

  // clientId lạ không được đụng vào tin khác.
  const untouched = appendOutgoing([chat()], 'u-1', 'A', 'c-1', now);
  assert.deepEqual(settleOutgoing(untouched, 'c-2', { status: 'sent' }), untouched);
});

test('appendIncoming thêm tin và bỏ bản dội lại cùng msgId', () => {
  const base = [chat()];
  const once = appendIncoming(base, live({ msgId: 'm-1', text: 'Một' }), 'u-1');
  assert.equal(once[0].messages.length, 1);
  assert.equal(once[0].messages[0].msgId, 'm-1');
  assert.equal(once[0].messages[0].status, undefined, 'tin của bạn không có nhãn trạng thái');
  assert.equal(once[0].preview, 'Một');

  const twice = appendIncoming(once, live({ msgId: 'm-1', text: 'Một' }), 'u-1');
  assert.equal(twice, once, 'trùng msgId trả nguyên mảng cũ');

  const echo = appendIncoming(base, live({ from: 'me', msgId: 'm-2' }), 'u-1');
  assert.equal(echo[0].messages[0].status, 'sent', 'tin của mình dội về đã gửi');

  // Main chưa gọi `setActiveThread`, nên quy tắc "đang mở thì đọc hết" phải
  // nằm ở đây, nếu không số chưa đọc của hội thoại đang xem sẽ tự tăng.
  const visible = appendIncoming([chat({ unread: 4 })], live({ msgId: 'm-4' }), 'u-1');
  assert.equal(visible[0].unread, 0);
  const hidden = appendIncoming([chat({ unread: 4 })], live({ threadId: 'u-2', msgId: 'm-5' }), 'u-1');
  assert.equal(hidden.find(item => item.id === 'u-1')?.unread, 4, 'hội thoại nền giữ số chưa đọc');
});

test('appendIncoming dựng hội thoại tạm khi thread event chưa tới', () => {
  const [placeholder] = appendIncoming([], live({ threadId: 'g-7', kind: 'group', msgId: 'm-3' }), 'g-7');
  assert.equal(placeholder.id, 'g-7');
  assert.equal(placeholder.isGroup, true);
  assert.equal(placeholder.name, 'Nhóm Zalo');
  assert.equal(placeholder.historyRemaining, 0);
  assert.equal(placeholder.messages.length, 1);

  const [user] = appendIncoming([], live({ threadId: 'u-7', kind: 'user' }), 'g-7');
  assert.equal(user.name, 'Người dùng Zalo');
  assert.equal(user.unread, 0, 'hội thoại chưa tồn tại thì không có gì chưa đọc');
});

test('retryTarget chỉ nhặt tin thất bại có đủ dữ liệu gửi lại', () => {
  const failed = chat({ isGroup: true, messages: [{ id: 1, from: 'me', time: '09:00', text: 'A', status: 'failed', clientId: 'c-1' }] });
  assert.deepEqual(retryTarget([failed], 'u-1', 1), { kind: 'group', text: 'A', clientId: 'c-1' });

  const sent = chat({ messages: [{ id: 1, from: 'me', time: '09:00', text: 'A', status: 'sent', clientId: 'c-1' }] });
  const noClient = chat({ messages: [{ id: 1, from: 'me', time: '09:00', text: 'A', status: 'failed' }] });
  assert.equal(retryTarget([sent], 'u-1', 1), null, 'tin đã gửi không gửi lại');
  assert.equal(retryTarget([noClient], 'u-1', 1), null, 'thiếu clientId thì không nối được');
  assert.equal(retryTarget([failed], 'u-1', 2), null);
  assert.equal(retryTarget([failed], 'u-404', 1), null);
});

const handlers: LiveHandlers = {
  login() {}, connection() {}, message() {}, thread() {},
};

test('subscribeLive không bridge thì không đăng ký gì và huỷ được nhiều lần', () => {
  const off = subscribeLive(undefined, handlers);
  assert.equal(typeof off, 'function');
  assert.doesNotThrow(() => { off(); off(); });
});

test('adoptEcho gắn msgId của bản dội vào bong bóng đang chờ, không thêm tin thứ hai', () => {
  const pending = chat({ messages: [
    { id: 1, from: 'me', time: '10:30', text: 'Xin chào', status: 'pending', clientId: 'c-1' },
  ] });
  assert.deepEqual(adoptEcho([pending], live({ from: 'me', msgId: 'srv-9', text: 'Xin chào' })), {
    adopted: true,
    chats: [chat({ messages: [
      { id: 1, from: 'me', time: '10:30', text: 'Xin chào', status: 'sent', clientId: 'c-1', msgId: 'srv-9' },
    ] })],
  });
});

test('adoptEcho bỏ qua tin của người khác, hội thoại lạ và bản dội trùng msgId', () => {
  const pending = chat({ messages: [
    { id: 1, from: 'me', time: '10:30', text: 'Xin chào', status: 'pending', clientId: 'c-1' },
  ] });
  assert.equal(adoptEcho([pending], live({ from: 'them', text: 'Xin chào' })), null);
  assert.equal(adoptEcho([pending], live({ from: 'me', threadId: 'u-9', text: 'Xin chào' })), null);
  assert.equal(adoptEcho([pending], live({ from: 'me', text: 'Khác hẳn' })), null);
  const settled = chat({ messages: [
    { id: 1, from: 'me', time: '10:30', text: 'Xin chào', status: 'sent', clientId: 'c-1', msgId: 'srv-9' },
  ] });
  assert.equal(adoptEcho([settled], live({ from: 'me', msgId: 'srv-9', text: 'Xin chào' })), null);
});

test('adoptEcho chọn bong bóng chờ cũ nhất khi nội dung trùng nhau', () => {
  const twin = chat({ messages: [
    { id: 7, from: 'me', time: '10:30', text: 'Ok', status: 'pending', clientId: 'c-2' },
    { id: 3, from: 'me', time: '10:30', text: 'Ok', status: 'pending', clientId: 'c-1' },
  ] });
  const result = adoptEcho([twin], live({ from: 'me', msgId: 'srv-1', text: 'Ok' }));
  assert.ok(result);
  assert.deepEqual(result.chats[0].messages.map(message => [message.id, message.msgId ?? null]),
    [[7, null], [3, 'srv-1']]);
});

test('nhãn, tông màu và khả năng kết nối lại khớp bốn trạng thái plan §5.5', () => {
  assert.equal(liveConnectionLabel('connected'), '');
  assert.equal(liveConnectionLabel('connecting'), 'Đang kết nối Zalo…');
  assert.equal(liveConnectionLabel('disconnected'), 'Mất kết nối. Đang thử lại.');
  assert.equal(liveConnectionLabel('replaced'), 'Đã dừng vì Zalo đang mở ở nơi khác');
  assert.equal(liveConnectionTone('replaced'), 'danger');
  for (const state of ['connected', 'connecting', 'disconnected'] as const) assert.equal(liveConnectionTone(state), 'wait');
  // `replaced` có nút bấm nhưng không tự kết nối lại: chỉ `requestReconnect` mới nối.
  assert.equal(liveConnectionReconnectable('replaced'), true);
  assert.equal(liveConnectionReconnectable('disconnected'), true);
  assert.equal(liveConnectionReconnectable('connected'), false);
  assert.equal(liveConnectionReconnectable('connecting'), false);
});

test('subscribeLive đăng ký đủ bốn kênh và huỷ đúng bốn lần', () => {
  const registered: string[] = [];
  const offs: Record<string, () => void> = {};
  const fake = (name: string) => () => {
    registered.push(name);
    offs[name] = () => { registered.push(`off:${name}`); };
    return offs[name];
  };
  const off = subscribeLive({
    onLoginState: fake('login'),
    onConnection: fake('connection'),
    onMessageUpsert: fake('message'),
    onThreadUpsert: fake('thread'),
  } as unknown as ChatEvents, handlers);

  assert.deepEqual(registered, ['login', 'connection', 'message', 'thread']);
  off();
  assert.deepEqual(registered.slice(4), ['off:login', 'off:connection', 'off:message', 'off:thread']);
});

test('subscribeLive vẫn huỷ nốt các kênh còn lại khi một off() ném lỗi', () => {
  const offs: string[] = [];
  const throwing = () => { offs.push('off:login'); throw new Error('window is gone'); };
  const subscribeLiveWith = (name: string, go: () => void) => () => {
    offs.push(`on:${name}`);
    return go;
  };
  const off = subscribeLive({
    onLoginState: subscribeLiveWith('login', throwing),
    onConnection: subscribeLiveWith('connection', () => { offs.push('off:connection'); }),
    onMessageUpsert: subscribeLiveWith('message', () => { offs.push('off:message'); }),
    onThreadUpsert: subscribeLiveWith('thread', () => { offs.push('off:thread'); }),
  } as unknown as ChatEvents, handlers);

  assert.doesNotThrow(() => off());
  assert.deepEqual(offs, [
    'on:login', 'on:connection', 'on:message', 'on:thread',
    'off:login', 'off:connection', 'off:message', 'off:thread',
  ]);
});
