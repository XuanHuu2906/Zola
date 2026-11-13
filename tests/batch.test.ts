import test from 'node:test';
import assert from 'node:assert/strict';
import { BATCH_DELAY_MS, BATCH_MAX_ITEMS, createBatcher } from '../src/renderer/live/batch.ts';
import type { Chat } from '../src/renderer/types.ts';
import type { LiveMessage, LiveThread } from '../src/shared/ipc-contract.ts';
import { reduceLive } from '../src/renderer/live/apply.ts';
import type { LiveEvent } from '../src/renderer/live/apply.ts';

/**
 * Gom cập nhật UI (plan §8.1).
 *
 * Bộ hẹn giờ và đồng hồ đều bơm vào, nên không test nào phải `sleep`: một cửa sổ
 * 50 ms nhân với hàng chục test sẽ thành vài giây chờ vô nghĩa.
 */

const now = new Date(2026, 10, 7, 10, 30).getTime();

interface FakeTimer { id: number; flush: () => void; at: number }

function fakeClock() {
  let at = 0;
  let next = 1;
  const timers: FakeTimer[] = [];
  return {
    now: () => at,
    schedule: (flush: () => void, delayMs: number) => {
      const timer: FakeTimer = { id: next++, flush, at: at + delayMs };
      timers.push(timer);
      return timer.id;
    },
    cancelScheduled: (handle: unknown) => {
      const index = timers.findIndex(timer => timer.id === handle);
      if (index >= 0) timers.splice(index, 1);
    },
    /** Chạy đồng hồ tới `ms`; hẹn giờ nào tới hạn thì chạy, đúng thứ tự thời gian. */
    advance(ms: number) {
      at += ms;
      for (;;) {
        const due = timers.filter(timer => timer.at <= at).sort((a, b) => a.at - b.at)[0];
        if (!due) return;
        timers.splice(timers.indexOf(due), 1);
        due.flush();
      }
    },
    get pending() { return timers.length; },
  };
}

function batcher() {
  const clock = fakeClock();
  const applied: number[][] = [];
  const batch = createBatcher<number>({
    apply: items => applied.push(items),
    schedule: clock.schedule,
    cancelScheduled: clock.cancelScheduled,
    now: clock.now,
  });
  return { batch, applied, clock };
}

test('gom tin trong cùng cửa sổ thành một lần ghi', () => {
  const { batch, applied, clock } = batcher();
  batch.push(1); batch.push(2); batch.push(3);
  assert.deepEqual(applied, [], 'chưa tới cửa sổ thì chưa ghi');
  assert.equal(batch.size, 3);
  clock.advance(BATCH_DELAY_MS);
  assert.deepEqual(applied, [[1, 2, 3]], 'một lần ghi, đúng thứ tự');
  assert.equal(batch.size, 0);
});

test('tin tới sau khi cửa sổ đóng mở lô mới, không gộp vào lô đã xả', () => {
  const { batch, applied, clock } = batcher();
  batch.push(1);
  clock.advance(BATCH_DELAY_MS);
  batch.push(2);
  clock.advance(BATCH_DELAY_MS);
  assert.deepEqual(applied, [[1], [2]]);
});

test('một tin lẻ vẫn được ghi sau đúng một cửa sổ', () => {
  const { batch, applied, clock } = batcher();
  batch.push(7);
  assert.deepEqual(applied, []);
  clock.advance(BATCH_DELAY_MS);
  assert.deepEqual(applied, [[7]]);
});

test('chạm trần thì xả ngay, không đợi đồng hồ', () => {
  const clock = fakeClock();
  const applied: number[][] = [];
  const batch = createBatcher<number>({
    apply: items => applied.push(items), maxItems: 4,
    schedule: clock.schedule, cancelScheduled: clock.cancelScheduled, now: clock.now,
  });
  for (const item of [1, 2, 3]) batch.push(item);
  assert.deepEqual(applied, [], 'chưa chạm trần');
  batch.push(4);
  assert.deepEqual(applied, [[1, 2, 3, 4]], 'chạm trần là xả ngay');
  assert.equal(clock.pending, 0, 'không để lại hẹn giờ mồ côi');
});

test('`flush` ghi ngay và huỷ hẹn giờ cũ', () => {
  const { batch, applied, clock } = batcher();
  batch.push(1); batch.push(2);
  batch.flush();
  assert.deepEqual(applied, [[1, 2]]);
  assert.equal(clock.pending, 0);
  clock.advance(BATCH_DELAY_MS);
  assert.deepEqual(applied, [[1, 2]], 'hẹn giờ cũ không được xả lần hai');
});

test('`flush` trên lô rỗng không gọi `apply`', () => {
  const { batch, applied } = batcher();
  batch.flush();
  assert.deepEqual(applied, []);
});

test('`discard` bỏ lô đang chờ nhưng vẫn nhận tin tiếp theo', () => {
  const { batch, applied, clock } = batcher();
  batch.push(1);
  batch.discard();
  assert.equal(batch.size, 0);
  clock.advance(BATCH_DELAY_MS);
  assert.deepEqual(applied, [], 'lô bị bỏ không bao giờ được ghi');
  batch.push(2);
  clock.advance(BATCH_DELAY_MS);
  assert.deepEqual(applied, [[2]], 'rời phiên rồi vào lại vẫn gom được');
});

test('`apply` ném lỗi không để lại trạng thái dở: lô sau vẫn chạy', () => {
  const clock = fakeClock();
  const seen: number[][] = [];
  let boom = true;
  const batch = createBatcher<number>({
    apply: items => { if (boom) { boom = false; throw new Error('lô hỏng'); } seen.push(items); },
    schedule: clock.schedule, cancelScheduled: clock.cancelScheduled, now: clock.now,
  });
  batch.push(1);
  assert.throws(() => clock.advance(BATCH_DELAY_MS), /lô hỏng/);
  assert.equal(batch.size, 0, 'lô hỏng không ở lại để xả lại');
  assert.equal(clock.pending, 0, 'không còn hẹn giờ trỏ vào lô đã xả');
  batch.push(2);
  clock.advance(BATCH_DELAY_MS);
  assert.deepEqual(seen, [[2]]);
});

test('đồng hồ nhảy quá cửa sổ khi chưa kịp hẹn giờ thì vẫn xả', () => {
  // Máy ngủ dậy hoặc tab bị treo: hẹn giờ có thể trễ rất lâu. Tin đã già hơn cửa
  // sổ thì chờ thêm không mang lại gì.
  let at = 0;
  const applied: number[][] = [];
  const batch = createBatcher<number>({
    apply: items => applied.push(items),
    schedule: () => 0, cancelScheduled: () => {}, now: () => at,
  });
  batch.push(1);
  at = BATCH_DELAY_MS + 1;
  batch.push(2);
  assert.deepEqual(applied, [[1, 2]], 'tin thứ hai thấy cửa sổ đã hết hạn');
});

test('trần mặc định đủ lớn cho một đợt tin thật nhưng không phình bộ nhớ', () => {
  assert.ok(BATCH_MAX_ITEMS >= 50 && BATCH_MAX_ITEMS <= 1000, `trần bất thường: ${BATCH_MAX_ITEMS}`);
  assert.ok(BATCH_DELAY_MS > 0 && BATCH_DELAY_MS <= 100, `cửa sổ quá dài: ${BATCH_DELAY_MS}`);
});

// --- reduceLive: gộp lô phải cho ra đúng trạng thái như áp riêng từng sự kiện ---

const thread = (patch: Partial<LiveThread> = {}): LiveThread => ({
  id: 'u-1', kind: 'user', name: 'Minh Anh', avatar: null,
  pinned: false, unread: 0, lastText: 'Chào bạn', lastTs: now, ...patch,
});

const message = (patch: Partial<LiveMessage> = {}): LiveMessage => ({
  threadId: 'u-1', kind: 'user', msgId: 'm-1', clientId: null,
  from: 'them', text: 'Chào bạn', ts: now, ...patch,
});

const chat = (patch: Partial<Chat> = {}): Chat => ({
  id: 'u-1', name: 'Minh Anh', avatar: null, pinned: false, unread: 0,
  isGroup: false,  time: '09:00', preview: 'Cũ', lastTs: now,
  messages: [], historyRemaining: 0, ...patch,
});

const view = (chats: Chat[]): { chats: Chat[]; activeId: string; toast: string } =>
  ({ chats, activeId: 'u-1', toast: '' });

test('lô có thread trước message: một tin, tên hội thoại là tên thật', () => {
  const events: LiveEvent[] = [
    { type: 'thread', thread: thread({ name: 'Lan', lastText: 'Chào bạn', lastTs: now }) },
    { type: 'message', message: message({ text: 'Chào bạn' }) },
  ];
  const outcome = reduceLive(view([]), events);
  assert.equal(outcome.chats.length, 1);
  assert.equal(outcome.chats[0].name, 'Lan');
  assert.equal(outcome.chats[0].messages.length, 1);
  assert.deepEqual(outcome.notified, [{ threadId: 'u-1', name: 'Lan', text: 'Chào bạn' }]);
  assert.equal(outcome.toast, 'Lan: Chào bạn');
});

test('lô nhiều tin: mọi tin được giữ, thứ tự đúng, mỗi tin một thông báo', () => {
  const events: LiveEvent[] = [1, 2, 3].map(n =>
    ({ type: 'message', message: message({ msgId: `m-${n}`, text: `tin ${n}`, ts: now + n }) }) as LiveEvent);
  const outcome = reduceLive(view([chat()]), events);
  assert.deepEqual(outcome.chats[0].messages.map(row => row.text), ['tin 1', 'tin 2', 'tin 3']);
  assert.equal(outcome.notified.length, 3);
});

test('lô có thu hồi: bong bóng mất nội dung, không thành tin mới, không báo toast', () => {
  const existing = chat({ messages: [{ id: 1, from: 'me', time: '09:00', text: 'bí mật', msgId: 'm-9' }] });
  const outcome = reduceLive(view([existing]), [
    { type: 'message', message: message({ msgId: 'm-9', from: 'me', text: '', recalled: true }) },
  ]);
  assert.equal(outcome.chats[0].messages.length, 1, 'thu hồi không thêm bong bóng');
  assert.equal(outcome.chats[0].messages[0].recalled, true);
  assert.equal(outcome.chats[0].messages[0].text, '');
  assert.deepEqual(outcome.notified, []);
});

test('lô có echo của chính mình: gắn msgId vào bong bóng chờ, không thêm bong bóng', () => {
  const pending = chat({
    id: 'u-1',
    messages: [{ id: 1, from: 'me', time: '09:00', text: 'đã gửi', status: 'pending', clientId: 'c-1' }],
  });
  const outcome = reduceLive(view([pending]), [
    { type: 'message', message: message({ msgId: 'm-new', from: 'me', text: 'đã gửi' }) },
  ]);
  assert.equal(outcome.chats[0].messages.length, 1);
  assert.equal(outcome.chats[0].messages[0].msgId, 'm-new');
  assert.equal(outcome.chats[0].messages[0].status, 'sent');
});

test('lô toàn tin trùng `msgId` trả nguyên `chats`, để store không phát render thừa', () => {
  const existing = chat({ messages: [{ id: 1, from: 'them', time: '09:00', text: 'Chào bạn', msgId: 'm-1' }] });
  const chats = [existing];
  const outcome = reduceLive(view(chats), [
    // Server dội lại tin đã có: không được thành bong bóng thứ hai, và không có
    // gì đổi thì giữ nguyên tham chiếu mảng.
    { type: 'message', message: message({ msgId: 'm-1' }) },
  ]);
  assert.equal(outcome.chats, chats);
  assert.equal(outcome.chats[0].messages.length, 1);
  assert.deepEqual(outcome.notified, []);
});

test('tin của người khác trên hội thoại đang mở: tên lấy từ thread trong cùng lô', () => {
  const outcome = reduceLive(view([chat()]), [
    { type: 'thread', thread: thread({ name: 'Tên Mới', lastText: 'Có ai không' }) },
    { type: 'message', message: message({ text: 'Có ai không' }) },
  ]);
  assert.deepEqual(outcome.notified, [{ threadId: 'u-1', name: 'Tên Mới', text: 'Có ai không' }]);
  assert.equal(outcome.chats[0].messages[0].text, 'Có ai không');
});

test('group avatar refresh before history loads inserts cached messages silently', () => {
  const group = chat({ id: 'g-1', isGroup: true, unread: 4, messages: [] });
  const outcome = reduceLive(view([group]), [
    { type: 'message', message: message({ threadId: 'g-1', kind: 'group', msgId: 'old-1', ts: 1, text: 'Tin cũ', backfill: true, senderAvatar: 'glass://app/avatars/member.png' }) },
  ]);
  assert.deepEqual(outcome.notified, []);
  assert.equal(outcome.toast, '');
  assert.equal(outcome.chats[0].unread, 4);
  assert.equal(outcome.chats[0].messages[0].senderAvatar, 'glass://app/avatars/member.png');
});
