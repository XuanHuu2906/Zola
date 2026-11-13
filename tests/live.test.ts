import test from 'node:test';
import assert from 'node:assert/strict';
import type { Chat } from '../src/renderer/types.ts';
import type { LiveMessage, LiveThread } from '../src/shared/ipc-contract.ts';
import {
  appendIncoming, appendOutgoing, applyRecall, insertBackfill, nextMessageId, prependHistory, RECALLED_LABEL,
  retryTarget, settleOutgoing, threadToChat, upsertThread,
} from '../src/renderer/live/map.ts';
import { subscribeLive } from '../src/renderer/live/subscribe.ts';
import type { ChatEvents, LiveHandlers } from '../src/renderer/live/subscribe.ts';
import { adoptEcho } from '../src/renderer/live/echo.ts';
import { reduceLive } from '../src/renderer/live/apply.ts';
import { renderErrorReport } from '../src/renderer/live/error-report.ts';
import { liveConnectionLabel, liveConnectionReconnectable, liveConnectionTone, syncPercent } from '../src/shared/live.ts';
import { formatListTime } from '../src/shared/logic.ts';

/**
 * `src/renderer/live/map.ts` là toàn bộ phần suy luận của renderer, tách khỏi
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
  isGroup: false,  time: '09:00', preview: 'Cũ', lastTs: now.getTime(),
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
    isGroup: true,
    // Mốc kiểu danh sách hội thoại, không phải giờ: `thread` ở trên là **hôm nay**
    // (`now` của bộ kiểm là 10:30 hôm nay), nên hình dạng đúng là `HH:mm`.
    // Hình dạng theo độ xa ("Hôm qua", thứ, dd/MM) do `formatListTime` quyết định
    // và được khoá riêng trong `tests/core.test.ts`.
    time: formatListTime(now.getTime()),
    preview: 'Chào bạn', lastTs: now.getTime(),
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

test('mention ranges vào message UI và được bổ sung trên tin trùng đã có', () => {
  const initial = appendIncoming([chat()], live({ text: '😀 @Mai' }), 'u-1');
  const withMention = appendIncoming(initial, live({
    text: '😀 @Mai', mentions: [{ pos: 3, len: 4 }],
  }), 'u-1');
  assert.deepEqual(withMention[0].messages[0].mentions, [{ pos: 3, len: 4 }]);
});

/**
 * Avatar về **sau** danh sách hội thoại: main tải ảnh xuống đĩa rồi mới phát
 * `evThreadUpsert` cho cùng hội thoại. Đây là đường duy nhất để ảnh đã tải tới
 * được UI, nên thiếu nó thì 164 ảnh nằm trên đĩa mà màn hình vẫn toàn biểu tượng
 * mặc định (đo 2026-11-11).
 */
test('upsertThread mang avatar về UI, và không xoá ảnh đã có bằng null', () => {
  const existing = chat({ avatar: null });
  const url = 'glass://app/avatars/u-1.png';
  const withAvatar = upsertThread([existing], thread({ avatar: url }), 'u-1');
  assert.equal(withAvatar[0].avatar, url, 'avatar tải xong phải hiện lên');
  // `threadToChat` (đường thêm mới) cũng phải mang avatar.
  const added = upsertThread([], thread({ avatar: url }), 'u-1');
  assert.equal(added[0].avatar, url);

  // Danh sách hội thoại từ `getAllFriends` luôn đi kèm `avatar: null` (ảnh chỉ
  // về ở sự kiện riêng), nên `null` không được coi là "gỡ ảnh": nếu coi vậy thì
  // mỗi lần làm mới danh sách lại xoá sạch ảnh vừa tải.
  const kept = upsertThread(withAvatar, thread({ avatar: null }), 'u-1');
  assert.equal(kept[0].avatar, url, 'null từ danh sách không gỡ ảnh trên đĩa');
});

test('upsertThread không làm lùi mốc thời gian của hội thoại', () => {
  const newer = new Date(2026, 10, 7, 15, 0).getTime();
  const existing = chat({ lastTs: newer, time: formatListTime(newer) });
  // Danh sách hội thoại từ server mang `lastTs: 0` (nó không có tin cuối); một
  // sự kiện như vậy không được đẩy hội thoại về "chưa có tin nào".
  const kept = upsertThread([existing], thread({ lastTs: 0 }), 'u-1');
  assert.equal(kept[0].lastTs, newer);
  assert.equal(kept[0].time, formatListTime(newer));
});

test('avatar thành viên về muộn cập nhật đúng tin cũ mà không tạo thông báo', () => {
  const group = chat({
    id: 'g-1', isGroup: true, name: 'Nhóm',
    messages: [{ id: 1, msgId: 'm-1', from: 'them', fromName: 'An', time: '09:00', text: 'Chào' }],
  });
  const outcome = reduceLive(
    { chats: [group], activeId: 'g-1', toast: '' },
    [{ type: 'message', message: live({
      threadId: 'g-1', kind: 'group', msgId: 'm-1', fromName: 'An', text: 'Chào',
      senderAvatar: 'glass://app/avatars/member-7.jpg',
    }) }],
  );
  assert.equal(outcome.chats[0].messages.length, 1);
  assert.equal(outcome.chats[0].messages[0].senderAvatar, 'glass://app/avatars/member-7.jpg');
  assert.deepEqual(outcome.notified, []);
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

test('insertBackfill chèn tin cũ vào đúng chỗ theo thời điểm', () => {
  const base = [chat({ preview: 'Ba', time: '09:05', messages: [
    { id: 1, from: 'them', time: '09:00', text: 'Một', msgId: 'm-1', ts: 1000 },
    { id: 2, from: 'me', time: '09:05', text: 'Ba', msgId: 'm-3', ts: 3000 },
  ] })];
  const next = insertBackfill(base, live({ msgId: 'm-2', text: 'Hai', ts: 2000 }), 'u-1');

  // Nối vào cuối sẽ đặt một tin của 09:02 sau tin 09:05 — thứ tự đọc sai và
  // không cách nào sửa lại được bằng mắt người dùng.
  assert.deepEqual(next[0].messages.map(m => m.text), ['Một', 'Hai', 'Ba']);
  // Preview và giờ của hội thoại thuộc tin **mới nhất**, không phải tin vừa chèn.
  assert.equal(next[0].preview, 'Ba');
  assert.equal(next[0].time, '09:05');
});

test('insertBackfill: tin mới hơn mọi tin đã có thì nối cuối và cập nhật preview', () => {
  const base = [chat({ messages: [
    { id: 1, from: 'them', time: '09:00', text: 'Một', msgId: 'm-1', ts: 1000 },
  ] })];
  const next = insertBackfill(base, live({ msgId: 'm-9', text: 'Mới', ts: 9000 }), 'u-1');

  assert.deepEqual(next[0].messages.map(m => m.text), ['Một', 'Mới']);
  assert.equal(next[0].preview, 'Mới');
});

test('insertBackfill bỏ tin đã có và không tăng số chưa đọc', () => {
  const base = [chat({ unread: 2, messages: [
    { id: 1, from: 'them', time: '09:00', text: 'Một', msgId: 'm-1', ts: 1000 },
  ] })];
  assert.equal(insertBackfill(base, live({ msgId: 'm-1', text: 'Một', ts: 1000 }), 'u-1'), base);

  const added = insertBackfill(base, live({ threadId: 'u-2', msgId: 'm-5', ts: 500 }), 'u-1');
  assert.equal(added.find(item => item.id === 'u-1')?.unread, 2, 'lịch sử cũ không phải tin chưa đọc');
  // Hội thoại mới biết qua lịch sử thì thêm vào **cuối** danh sách.
  assert.equal(added[added.length - 1].id, 'u-2');
});

test('duplicate message fills a sender name learned after the message was rendered', () => {
  const base = [chat({ messages: [
    { id: 1, from: 'them', time: '09:00', text: 'Một', msgId: 'm-1', ts: 1000 },
  ] })];
  const update = live({ msgId: 'm-1', fromName: 'Mai Anh', ts: 1000 });
  assert.equal(insertBackfill(base, update, 'u-1')[0].messages[0].fromName, 'Mai Anh');
  assert.equal(appendIncoming(base, update, 'u-1')[0].messages[0].fromName, 'Mai Anh');
});

test('reduceLive: tin backfill không sinh thông báo hệ điều hành', () => {
  // Một lần đồng bộ đầu có thể mang hàng nghìn tin nhiều năm trước: mỗi tin một
  // thông báo sẽ biến điện thoại thành máy báo thức không tắt được.
  const outcome = reduceLive(
    { chats: [chat()], activeId: 'u-9', toast: '' },
    [{ type: 'message', message: live({ backfill: true, msgId: 'm-old', ts: 1 }) }],
  );
  assert.deepEqual(outcome.notified, []);
  assert.equal(outcome.toast, '');
  assert.equal(outcome.chats[0].messages.length, 1);
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

test('appendIncoming giữ tên người gửi để renderer nhận diện tin trong nhóm', () => {
  const group = chat({ isGroup: true });
  const updated = appendIncoming([group],
    live({ kind: 'group', fromName: 'Mai Anh' }), group.id);
  assert.equal(updated[0].messages[0].fromName, 'Mai Anh');
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

test('prependHistory chèn trang cũ lên đầu, cấp id mới cho tin cũ', () => {
  const base = [chat({ messages: [
    { id: 5, from: 'them', time: '10:30', text: 'Mới', msgId: 'm-5' },
  ] })];
  const older: LiveMessage[] = [
    live({ msgId: 'm-2', text: 'Hai', ts: now.getTime() - 60_000 }),
    live({ msgId: 'm-1', text: 'Một', ts: now.getTime() - 120_000 }),
  ];
  const [merged] = prependHistory(base, 'u-1', older);
  assert.deepEqual(merged.messages.map(row => row.text), ['Một', 'Hai', 'Mới']);
  assert.deepEqual(merged.messages.map(row => row.id), [6, 7, 5]);
  // Tin mới chèn vào nhận id lớn hơn mọi id đang có, nên khoá React không đụng nhau.
  assert.equal(new Set(merged.messages.map(row => row.id)).size, 3);
  // `ChatPane` nhận ra trang vừa chèn qua `messages[0].id` đổi: id đầu mảng phải khác trước.
  assert.notEqual(merged.messages[0].id, base[0].messages[0].id);
  assert.equal(merged.messages[0].time, '10:28');
  assert.equal(base[0].messages.length, 1, 'đầu vào không bị sửa tại chỗ');
});

test('prependHistory bỏ tin trùng msgId và giữ nguyên mảng khi không có gì mới', () => {
  const base = [chat({ messages: [{ id: 1, from: 'them', time: '10:30', text: 'Đã có', msgId: 'm-1' }] })];
  assert.equal(prependHistory(base, 'u-1', [live({ msgId: 'm-1', text: 'Đã có' })]), base,
    'trang chồng lấn hoàn toàn trả nguyên mảng');
  const partly = prependHistory(base, 'u-1', [
    live({ msgId: 'm-1', text: 'Đã có' }),
    live({ msgId: 'm-0', text: 'Cũ hơn', ts: now.getTime() - 60_000 }),
  ]);
  assert.deepEqual(partly[0].messages.map(row => row.text), ['Cũ hơn', 'Đã có']);
  // Tin của mình trong lịch sử là đã gửi, không phải "đang chờ".
  const mine = prependHistory([chat()], 'u-1', [live({ from: 'me', msgId: 'm-0', text: 'Tôi gửi' })]);
  assert.equal(mine[0].messages[0].status, 'sent');
  // Hội thoại lạ / trang rỗng không tạo hội thoại mới.
  const unknown = [chat()];
  assert.equal(prependHistory(unknown, 'u-404', [live()]), unknown, 'không tìm thấy hội thoại thì trả nguyên mảng');
  assert.equal(prependHistory(unknown, 'u-1', []), unknown, 'trang rỗng không dựng mảng mới');
  assert.deepEqual(prependHistory([], 'u-1', [live()]), []);
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

test('applyRecall làm rỗng nội dung tại chỗ, giữ id và vị trí bong bóng', () => {
  const target = chat({ messages: [
    { id: 1, from: 'them', time: '09:00', text: 'câu thứ nhất', msgId: 'm-1', mentions: [{ pos: 0, len: 5 }] },
    { id: 2, from: 'me', time: '09:01', text: 'câu thứ hai', msgId: 'm-2', status: 'sent' },
  ], preview: 'câu thứ hai' });
  const next = applyRecall([target], live({ msgId: 'm-1', recalled: true, text: '' }));
  assert.equal(next[0].messages.length, 2, 'không xoá dòng: tin biến mất khỏi chỗ cũ là sai');
  assert.deepEqual(next[0].messages[0], {
    id: 1, from: 'them', time: '09:00', text: '', msgId: 'm-1', mentions: undefined, recalled: true,
  });
  assert.equal(next[0].messages[0].id, 1, 'id giữ nguyên nên React không dựng lại bong bóng');
  assert.equal(next[0].preview, 'câu thứ hai', 'thu hồi tin giữa thì preview không đổi');
});

test('applyRecall thu hồi tin cuối thì preview cũng không còn nội dung', () => {
  const target = chat({ messages: [
    { id: 1, from: 'them', time: '09:00', text: 'câu thứ nhất', msgId: 'm-1' },
    { id: 2, from: 'me', time: '09:01', text: 'câu thứ hai', msgId: 'm-2', status: 'sent' },
  ], preview: 'câu thứ hai' });
  const next = applyRecall([target], live({ msgId: 'm-2', recalled: true, text: '' }));
  assert.equal(next[0].preview, RECALLED_LABEL);
});

test('applyRecall không thêm bong bóng khi tin gốc chưa tải về', () => {
  const target = chat({ messages: [{ id: 1, from: 'them', time: '09:00', text: 'còn đó', msgId: 'm-1' }] });
  // Thu hồi của một tin cũ hơn chưa nằm trong cửa sổ đã tải: không có gì để sửa,
  // và thêm một bong bóng "đã thu hồi" ở cuối hội thoại là đặt tin vào sai chỗ.
  const next = applyRecall([target], live({ msgId: 'm-old', recalled: true, text: '' }));
  assert.deepEqual(next, [target]);
});

test('applyRecall bỏ qua hội thoại chưa mở và message không mang cờ thu hồi', () => {
  const target = chat({ messages: [{ id: 1, from: 'them', time: '09:00', text: 'còn đó', msgId: 'm-1' }] });
  assert.deepEqual(applyRecall([target], live({ threadId: 'u-404', recalled: true })), [target]);
  assert.deepEqual(applyRecall([target], live({ msgId: 'm-1' })), [target], 'tin thường không đi qua đây');
});

test('prependHistory dựng lại tin đã thu hồi không nội dung từ cache', () => {
  const target = chat({ messages: [] });
  const next = prependHistory([target], 'u-1', [live({ msgId: 'm-1', recalled: true, text: '' })]);
  assert.equal(next[0].messages[0].recalled, true);
  assert.equal(next[0].messages[0].text, '');
  assert.equal(next[0].messages[0].msgId, 'm-1');
});

test('appendIncoming đánh dấu cờ thu hồi khi tin đến đã bị thu hồi', () => {
  const next = appendIncoming([chat({ messages: [] })], live({ recalled: true, text: '' }), 'u-1');
  assert.equal(next[0].messages[0].recalled, true);
});

const handlers: LiveHandlers = {
  login() {}, connection() {}, message() {}, media() {}, thread() {}, crash() {}, sync() {}, catchUp() {},
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

test('subscribeLive đăng ký kênh bắt kịp và huỷ đầy đủ đăng ký', () => {
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
    onCatchUp: fake('catch-up'),
  } as unknown as ChatEvents, handlers);

  assert.deepEqual(registered, ['login', 'connection', 'message', 'thread', 'catch-up']);
  off();
  assert.deepEqual(registered.slice(5), ['off:login', 'off:connection', 'off:message', 'off:thread', 'off:catch-up']);
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

test('subscribeLive đăng ký kênh crash khi bridge có, và bỏ qua khi bản preload cũ thiếu', () => {
  const seen: string[] = [];
  const withCrash = subscribeLive({
    onLoginState: () => () => {}, onConnection: () => () => {},
    onMessageUpsert: () => () => {}, onThreadUpsert: () => () => {},
    onCrash: (callback: (notice: { message: string }) => void) => {
      seen.push('on:crash'); callback({ message: 'boom' }); return () => { seen.push('off:crash'); };
    },
  } as unknown as ChatEvents, { ...handlers, crash: notice => seen.push(`crash:${notice.message}`) });
  assert.deepEqual(seen, ['on:crash', 'crash:boom']);
  withCrash();
  assert.deepEqual(seen, ['on:crash', 'crash:boom', 'off:crash']);

  // Bridge cũ không có `onCrash`: không được để `undefined` lọt vào danh sách huỷ.
  const off = subscribeLive({
    onLoginState: () => () => {}, onConnection: () => () => {},
    onMessageUpsert: () => () => {}, onThreadUpsert: () => () => {},
  } as unknown as ChatEvents, handlers);
  assert.doesNotThrow(off);
});

test('subscribeLive tách `phase` khỏi số đếm rồi mới đưa cho tầng trên', () => {
  // Phong bì IPC gộp cả hai vào một object; tầng UI lại cần hai tham số để
  // không phải biết hình dạng gói. Sai chỗ này thì thanh tiến trình đọc
  // `phase` từ `stats` và đứng im ở `undefined`.
  const seen: unknown[] = [];
  subscribeLive({
    onLoginState: () => () => {}, onConnection: () => () => {},
    onMessageUpsert: () => () => {}, onThreadUpsert: () => () => {},
    onSync: (callback: (payload: {
      phase: string; received: number; total: number; written: number; skipped: number;
    }) => void) => {
      callback({ phase: 'receiving', received: 3, total: 10, written: 900, skipped: 4 });
      return () => {};
    },
  } as unknown as ChatEvents, { ...handlers, sync: (phase, stats) => seen.push([phase, stats]) });

  assert.deepEqual(seen, [['receiving', { received: 3, total: 10, written: 900, skipped: 4 }]]);
});

test('subscribeLive thiếu kênh sync: không gì được đăng ký, không ném', () => {
  // Main chạy không bật đồng bộ thì preload vẫn có hàm nhưng sự kiện không bao
  // giờ tới; bản preload cũ thì không có hàm. Cả hai phải là đường im lặng.
  const off = subscribeLive({
    onLoginState: () => () => {}, onConnection: () => () => {},
    onMessageUpsert: () => () => {}, onThreadUpsert: () => () => {},
  } as unknown as ChatEvents, handlers);
  assert.doesNotThrow(off);
});

test('renderErrorReport chỉ gửi độ dài thông điệp, không gửi nguyên văn', () => {
  const report = renderErrorReport(new TypeError('Tin nhắn: "bí mật"'), '  at ChatPane\n  at App  ');
  assert.deepEqual(report, {
    name: 'TypeError', componentStack: 'at ChatPane\n  at App', messageLength: 'Tin nhắn: "bí mật"'.length,
  });
  // Nhật ký hứa không có nội dung tin; một lỗi ném từ chỗ đang cầm nội dung tin sẽ
  // mang nguyên văn nếu ta gửi `message` thay vì độ dài của nó.
  assert.equal(Object.values(report).some(value => String(value).includes('bí mật')), false);
  assert.deepEqual(renderErrorReport(null, ''), { name: 'Error', componentStack: '', messageLength: 0 });
});

test('phần trăm đồng bộ: chưa biết tổng thì không vẽ thanh', () => {
  // Đo 2026-11-10: banner đứng ở "0 gói" suốt 28 s trong khi máy chủ chưa đẩy
  // gói nào. Một thanh 0% ở đó trông y hệt một lần treo; nhịp chạy mới là thứ
  // nói "còn sống".
  assert.equal(syncPercent({ received: 0, total: 0 }), null);
  assert.equal(syncPercent({ received: 5, total: 0 }), null);
  assert.equal(syncPercent({ received: 5, total: -1 }), null);
  assert.equal(syncPercent({ received: 5, total: Number.NaN }), null);
});

test('phần trăm đồng bộ: kẹp 0..100 và làm tròn', () => {
  assert.equal(syncPercent({ received: 0, total: 46 }), 0);
  assert.equal(syncPercent({ received: 23, total: 46 }), 50);
  assert.equal(syncPercent({ received: 46, total: 46 }), 100);
  // Gói tới sau `isLast` không được đẩy con số lên quá 100.
  assert.equal(syncPercent({ received: 99, total: 46 }), 100);
  assert.equal(syncPercent({ received: -3, total: 46 }), 0);
});
