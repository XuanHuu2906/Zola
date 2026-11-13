import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateReactions, applyReaction, isRemoval, parseReactionMap } from '../electron/protocol/reactions.ts';
import { applyReactions, toggleReaction } from '../src/renderer/live/map.ts';
import { recalledTarget } from '../electron/protocol/undo.ts';
import { reduceLive } from '../src/renderer/live/apply.ts';
import { reactionEmoji } from '../src/shared/logic.ts';
import type { Chat, Message } from '../src/renderer/types.ts';
import type { LiveMessage } from '../src/shared/ipc-contract.ts';

/**
 * Cảm xúc có **hai** nửa và chúng sai theo hai kiểu khác hẳn nhau:
 *
 * - nửa main: mỗi sự kiện `reaction` là hành động của **một người**, nên trạng
 *   thái mới là "bản đồ cũ + hành động". Cộng dồn một bảng đếm sẽ trôi mỗi lần
 *   ai đó bỏ cảm xúc, và sự kiện bỏ (`rType < 0`) không nói đã bỏ biểu tượng nào;
 * - nửa renderer: một tin cũ vừa được thả tim phải sửa **tại chỗ**. Đi nhầm vào
 *   `appendIncoming` là đặt lại một tin của năm ngoái xuống cuối hội thoại.
 *
 * Toàn bộ hình dạng `rType → rIcon` lấy từ bundle Zalo PC; `Reactions` của zca-js
 * là bản sao cùng bảng, nên test dưới đây dùng đúng chuỗi máy chủ gửi.
 */

const live = (over: Partial<LiveMessage> = {}): LiveMessage => ({
  threadId: 'u-1', kind: 'user', msgId: 'm-1', clientId: null,
  from: 'them', text: 'Chào', ts: 1_700_000_000_000, ...over,
});

const chat = (over: Partial<Chat> = {}): Chat => ({
  id: 'u-1', name: 'Minh Anh', avatar: null, pinned: false, unread: 0,
  isGroup: false, time: '14:06', preview: 'Chào', lastTs: 1_700_000_000_000,
  messages: [], historyRemaining: 0, ...over,
});

// --- nửa main: bản đồ người thả → biểu tượng ---

test('rType âm hoặc rIcon rỗng là **gỡ**, không phải một biểu tượng thứ n', () => {
  // Zalo PC: `a.rType<0 ? … : {"-1":1}` và sentinel `{rType:-1, rIcon:""}`.
  assert.equal(isRemoval(-1, ''), true);
  assert.equal(isRemoval(-1, '/-heart'), true, 'rType âm thắng cả khi rIcon còn giá trị');
  assert.equal(isRemoval(0, ''), true, 'rIcon rỗng một mình cũng là gỡ');
  assert.equal(isRemoval(5, '/-heart'), false, 'rType 5 là ❤️');
  assert.equal(isRemoval(0, ':>'), false, 'rType 0 là 😆 — số 0 **không** phải "không có"');
});

test('mỗi người một cảm xúc: thả biểu tượng khác là đổi, không phải thêm', () => {
  let map = applyReaction(undefined, { uid: 'a', icon: '/-heart', remove: false });
  map = applyReaction(map, { uid: 'b', icon: '/-heart', remove: false });
  map = applyReaction(map, { uid: 'c', icon: ':>', remove: false });
  assert.deepEqual(map, { a: '/-heart', b: '/-heart', c: ':>' });
  // `a` đổi sang 😆: bản đồ vẫn đúng ba người, hai biểu tượng.
  map = applyReaction(map, { uid: 'a', icon: ':>', remove: false });
  assert.deepEqual(map, { a: ':>', b: '/-heart', c: ':>' });
  const shown = aggregateReactions(map, 'a');
  assert.deepEqual(shown, [
    { icon: ':>', count: 2, mine: true },
    { icon: '/-heart', count: 1, mine: false },
  ]);
});

test('gỡ cảm xúc chỉ xoá đúng người đó, và không đổi gì thì trả nguyên bản đồ', () => {
  const map = { a: '/-heart', b: '/-heart' };
  const removed = applyReaction(map, { uid: 'a', icon: '', remove: true });
  assert.deepEqual(removed, { b: '/-heart' }, 'người khác giữ nguyên');
  assert.deepEqual(aggregateReactions(removed, 'a'), [{ icon: '/-heart', count: 1, mine: false }]);
  // Gỡ một cảm xúc vốn không có: trả **cùng tham chiếu** để chỗ gọi bỏ được một
  // lần ghi DB và một lần phát IPC.
  assert.equal(applyReaction(map, { uid: 'z', icon: '', remove: true }), map);
  // Thả lại đúng biểu tượng cũ cũng không đổi gì.
  assert.equal(applyReaction(map, { uid: 'a', icon: '/-heart', remove: false }), map);
});

test('uid rỗng bị bỏ qua thay vì ghi dưới khoá ""', () => {
  const map = { a: '/-heart' };
  assert.equal(applyReaction(map, { uid: '', icon: ':>', remove: false }), map,
    'một khoá rỗng là một người không tồn tại, và nó sẽ cộng vào số đếm mãi mãi');
});

test('aggregateReactions: nhiều người nhất trước, và `mine` cần biết uid của mình', () => {
  const map = { a: ':>', b: ':>', c: '/-heart', d: '/-strong' };
  assert.deepEqual(aggregateReactions(map, 'c'), [
    { icon: ':>', count: 2, mine: false },
    { icon: '/-heart', count: 1, mine: true },
    { icon: '/-strong', count: 1, mine: false },
  ]);
  // Không biết uid thì không mục nào là của mình: thà thiếu một đường viền hơn
  // là tô đậm phản ứng của người khác thành của mình.
  assert.ok(aggregateReactions(map, null).every(item => !item.mine));
  assert.deepEqual(aggregateReactions(undefined, 'a'), []);
});

test('cột reactions hỏng không làm hỏng trang tin: đọc ra bản đồ rỗng', () => {
  assert.deepEqual(parseReactionMap(null), {});
  assert.deepEqual(parseReactionMap('{'), {});
  assert.deepEqual(parseReactionMap('[]'), {});
  assert.deepEqual(parseReactionMap('{"a":5,"b":"","c":"/-heart"}'), { c: '/-heart' },
    'chỉ nhận cặp uid → chuỗi khác rỗng');
});

// --- nửa renderer: sửa tại chỗ, không thêm bong bóng ---

test('applyReactions sửa đúng bong bóng theo msgId, không đụng preview hay thời gian', () => {
  const base = [chat({ messages: [
    { id: 1, from: 'them', time: '09:00', text: 'Cũ', msgId: 'm-1' },
    { id: 2, from: 'me', time: '10:00', text: 'Mới', msgId: 'm-2' },
  ] })];
  const next = applyReactions(base, live({ msgId: 'm-1', text: '', reacted: true, reactions: [{ icon: '/-heart', count: 2, mine: true }] }));
  assert.ok(next, 'khớp được dòng thì phải trả mảng mới');
  assert.deepEqual(next![0].messages.map(row => row.reactions), [
    [{ icon: '/-heart', count: 2, mine: true }], undefined,
  ]);
  assert.deepEqual(next![0].messages.map(row => row.id), [1, 2], 'không thêm bong bóng');
  assert.equal(next![0].preview, base[0].preview, 'cảm xúc không phải tin mới');
  assert.equal(next![0].time, base[0].time);
  assert.equal(base[0].messages[0].reactions, undefined, 'đầu vào không bị sửa tại chỗ');
});

test('applyReactions: gỡ mục cuối thì trường biến mất, và trạng thái trùng thì trả nguyên mảng', () => {
  const reacted = [chat({ messages: [
    { id: 1, from: 'them', time: '09:00', text: 'A', msgId: 'm-1', reactions: [{ icon: '/-heart', count: 1, mine: true }] },
  ] })];
  const cleared = applyReactions(reacted, live({ msgId: 'm-1', text: '', reacted: true, reactions: [] }));
  assert.ok(cleared);
  assert.equal(cleared![0].messages[0].reactions, undefined, 'không để lại mảng rỗng');
  // Phát lại cùng một trạng thái: không có gì mới để vẽ.
  assert.equal(applyReactions(reacted, live({ msgId: 'm-1', text: '', reacted: true, reactions: [{ icon: '/-heart', count: 1, mine: true }] })), reacted);
});

test('applyReactions chỉ nhận sự kiện cảm xúc, không nhận tin thường', () => {
  const base = [chat({ messages: [{ id: 1, from: 'them', time: '09:00', text: 'A', msgId: 'm-1' }] })];
  // Không có `reacted` = tin bình thường; nhánh này phải nhường cho
  // `appendIncoming`, nếu không mọi tin mới đều bị nuốt thành "đã có".
  assert.equal(applyReactions(base, live({ msgId: 'm-1', text: 'A' })), null);
});

/**
 * Hồi quy: `toLive` bỏ trường `reactions` khi danh sách rỗng, nên nếu renderer
 * suy "đây là sự kiện cảm xúc" từ **sự có mặt** của trường thì sự kiện của
 * người cuối cùng gỡ cảm xúc trông y hệt một tin thường. Hai triệu chứng, cả
 * hai đều đã từng xảy ra với `applyReactions` trả `null`:
 *
 * 1. chip cũ nằm lại trên bong bóng vĩnh viễn (không ai xoá nó);
 * 2. bong bóng chưa tải về thì sự kiện rơi xuống `appendIncoming` và thêm một
 *    bong bóng rỗng vào cuối hội thoại.
 */
test('cờ `reacted` cứu đúng trường hợp gỡ cảm xúc cuối cùng', () => {
  const base = [chat({ messages: [{ id: 1, from: 'them', time: '09:00', text: 'A', msgId: 'm-1' }] })];
  // Không có `reacted` và cũng không có `reactions`: tin thường, phải nhường.
  assert.equal(applyReactions(base, live({ msgId: 'm-1', text: 'A' })), null);
  // Có `reacted` nhưng bong bóng chưa tải: đã xử lý (trả mảng cũ), **không**
  // phải `null` — nếu không, `reduceLive` nối một bong bóng rỗng vào cuối.
  const untouched = applyReactions(base, live({ msgId: 'm-404', text: '', reacted: true, reactions: [] }));
  assert.equal(untouched, base, 'không có bong bóng để sửa thì trả nguyên mảng');
  const outcome = reduceLive({ chats: base, activeId: '', toast: '' }, [
    { type: 'message', message: live({ msgId: 'm-404', text: '', reacted: true, reactions: [] }) },
  ]);
  assert.equal(outcome.chats[0].messages.length, 1, 'sự kiện cảm xúc không được thêm bong bóng');
  assert.deepEqual(outcome.notified, []);
});

test('reduceLive áp cảm xúc tại chỗ thay vì nối tin xuống cuối', () => {
  const base = [chat({
    messages: [
      { id: 1, from: 'them', time: '09:00', text: 'Cũ', msgId: 'm-1' },
      { id: 2, from: 'me', time: '10:00', text: 'Mới', msgId: 'm-2' },
    ],
    preview: 'Mới', time: '10:00',
  })];
  const outcome = reduceLive({ chats: base, activeId: 'u-404', toast: '' }, [
    { type: 'message', message: live({ msgId: 'm-1', text: '', reacted: true, reactions: [{ icon: ':>', count: 1, mine: false }] }) },
  ]);
  assert.equal(outcome.chats[0].messages.length, 2, 'không thêm bong bóng');
  assert.deepEqual(outcome.chats[0].messages[0].reactions, [{ icon: ':>', count: 1, mine: false }]);
  assert.equal(outcome.toast, '', 'người khác thả tim không phải một tin mới để báo');
  assert.deepEqual(outcome.notified, []);
});

test('toggleReaction: bấm lại là gỡ, và đổi biểu tượng thì bỏ cái cũ của mình', () => {
  const rows: Message[] = [{ id: 1, from: 'them', time: '09:00', text: 'A',
    reactions: [{ icon: '/-heart', count: 2, mine: true }, { icon: ':>', count: 1, mine: false }] }];
  // Bấm lại ❤️ đang là của mình: của mình đi, của người kia còn.
  assert.deepEqual(toggleReaction(rows, 1, '/-heart')[0].reactions,
    [{ icon: '/-heart', count: 1, mine: false }, { icon: ':>', count: 1, mine: false }]);
  // Bấm 😆 khi mình đang thả ❤️: đổi, không thành hai cảm xúc của mình.
  const moved = toggleReaction(rows, 1, ':>')[0].reactions;
  assert.deepEqual(moved, [{ icon: '/-heart', count: 1, mine: false }, { icon: ':>', count: 2, mine: true }]);
  assert.equal(moved!.filter(item => item.mine).length, 1, 'Zalo chỉ cho một cảm xúc mỗi người mỗi tin');
  // Tin không có cảm xúc nào: thêm mới.
  assert.deepEqual(toggleReaction([{ id: 9 }], 9, '/-strong')[0].reactions, [{ icon: '/-strong', count: 1, mine: true }]);
  // Mục không phải tin cần sửa giữ nguyên tham chiếu.
  const other = { id: 2 };
  assert.equal(toggleReaction([other], 1, '/-heart')[0], other);
});

// --- thu hồi: tin bị xoá nằm trong `content`, không phải ở tầng ngoài ---

/**
 * Hình dạng dưới đây lấy từ `TUndo` của zca-js. Hai bộ id cùng tồn tại trong
 * một payload và chúng **không** giống nhau, nên một lần đọc nhầm trường là
 * mọi lần thu hồi hỏng trong im lặng: không lỗi, không log lạ, chỉ là dòng
 * trong DB không đổi. Đã đo thật ngày 2026-11-11.
 */
test('thu hồi đọc id tin bị xoá từ `content`, không phải id của bản ghi điều khiển', () => {
  const event = {
    msgId: '9001', cliMsgId: '9002',        // bản ghi điều khiển
    content: { globalMsgId: 8477049528615, cliMsgId: 1794390896831, deleteMsg: 1 },
  };
  assert.deepEqual(recalledTarget(event), { msgId: '8477049528615', cliMsgId: '1794390896831' });
});

test('thu hồi: thiếu `content` mới dùng đường lùi, và id `"0"` không phải id', () => {
  // Khi `content` có id thì nó thắng — dùng tầng ngoài ở đó là thu hồi nhầm
  // bản ghi điều khiển, tức là xoá bong bóng của một tin không ai nói tới.
  assert.equal(recalledTarget({ msgId: '9001', content: { globalMsgId: '555' } })?.msgId, '555');
  // Không có `content`: tin bị xoá chỉ còn một chỗ để đọc.
  assert.equal(recalledTarget({ msgId: '9001' })?.msgId, '9001');
  // Không có gì dùng được thì trả `null` — chỗ gọi bỏ qua, không ghi nhớ id rác.
  assert.equal(recalledTarget({ msgId: '0', content: { globalMsgId: '0' } }), null);
  assert.equal(recalledTarget({ msgId: '', content: {} }), null);
  assert.equal(recalledTarget(null), null);
  assert.equal(recalledTarget({ content: 'not-an-object' }), null);
  // Số âm, NaN và văn bản không phải id đều bị từ chối.
  assert.equal(recalledTarget({ content: { globalMsgId: -5 } }), null);
  assert.equal(recalledTarget({ content: { globalMsgId: Number.NaN } }), null);
  assert.equal(recalledTarget({ content: { globalMsgId: 'abc' } }), null);
});

// --- bảng emoji: khoá là rIcon của máy chủ ---

test('bảng emoji phủ mọi biểu tượng zca-js thả được, và không nhận ra thì trả nguyên rIcon', () => {
  for (const icon of ['/-heart', '/-strong', ':>', ':o', ':-((', ':-h', '/-beer', '_()_', ';xx']) {
    assert.notEqual(reactionEmoji(icon), icon, `${icon} phải có emoji`);
  }
  // Zalo thêm biểu tượng mới theo thời gian: hiện nguyên `rIcon` còn hơn ô trống.
  assert.equal(reactionEmoji('/-brand-new-thing'), '/-brand-new-thing');
});
