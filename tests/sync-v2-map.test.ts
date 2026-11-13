import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && specifier.endsWith('.js')) {
      try {
        return nextResolve(specifier.replace(/\.js$/, '.ts'), context);
      } catch {
        // Không có bản `.ts`: giữ nguyên đường dẫn gốc.
      }
    }
    return nextResolve(specifier, context);
  },
});

const { parsePartition, chunkToMessages, textOfSyncMessage, makeIdResolver, isServerMsgId } =
  await import('../electron/protocol/sync-v2-map.ts');

/**
 * Ánh xạ `SyncChunk` → `LiveMessage`.
 *
 * Bốn quyết định được khoá ở đây vì mỗi cái sai đều hỏng **âm thầm**: tin nhảy
 * năm 1970 nếu `ts` hiểu là giây; tin của mình hiện thành của người khác nếu
 * `from` suy từ `msgStatus`; tin ảnh thành bong bóng rỗng nếu ghi chuỗi rỗng;
 * và đồng bộ lặp tạo bản sao nếu dùng `clientId` làm khoá.
 */

const OWN = '1234567890';
/**
 * `senderId` của Sync V2 là id **nhiễu**, còn `OWN` là uid số. Các test cũ so
 * thẳng hai thứ đó, tức là kiểm chính cái sai vừa sửa; ở đây id nhiễu của
 * chính mình là một hằng riêng để phép so đúng không gian id.
 */
const OWN_NOISED = 'zOwnNoisedId000000000000000000000';
const resolver = makeIdResolver({ ownNoisedId: OWN_NOISED, ownId: OWN });

const message = (over: Partial<Record<string, string>> & { content?: string } = {}) => ({
  senderId: OWN,
  clientId: '0',
  msgStatus: 0,
  msgType: 1,
  timestamp: '1731000000000',
  globalId: '9876543210987654321',
  content: 'xin chào',
  ...over,
});

const chunk = (partitions: Array<{ id: string; messages: ReturnType<typeof message>[] }>) =>
  ({ platform: 1, partitions });

test('phân vùng: oneone → user, group → group', () => {
  assert.deepEqual(parsePartition('oneone/123'), { threadId: '123', kind: 'user' });
  assert.deepEqual(parsePartition('group/456'), { threadId: '456', kind: 'group' });
});

test('phân vùng metadata và tên lạ bị bỏ', () => {
  // `metadata_...` là bản ghi phiên, không phải tin.
  assert.equal(parsePartition('metadata_abcdef'), null);
  assert.equal(parsePartition('other/1'), null);
  assert.equal(parsePartition('không-có-gạch'), null);
  assert.equal(parsePartition('oneone/'), null);
  assert.equal(parsePartition('/123'), null);
});

test('msgId lấy từ globalId, clientId đi vào clientId', () => {
  const result = chunkToMessages(chunk([
    { id: 'oneone/1', messages: [message({ globalId: '111', clientId: '222' })] },
  ]), resolver);

  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].message.msgId, '111', 'khoá chống trùng là id máy chủ, không phải id thiết bị');
  assert.equal(result.messages[0].message.clientId, '222');
});

test('tin không có clientId để null, không để chuỗi "0"', () => {
  const result = chunkToMessages(chunk([
    { id: 'oneone/1', messages: [message({ clientId: '0' })] },
  ]), resolver);

  assert.equal(result.messages[0].message.clientId, null);
});

test('from suy từ senderId so với id nhiễu của mình, không phải uid', () => {
  const result = chunkToMessages(chunk([
    { id: 'oneone/1', messages: [
      message({ senderId: OWN_NOISED, content: 'của tôi' }),
      message({ senderId: '999', content: 'của họ' }),
    ] },
  ]), resolver);

  assert.deepEqual(result.messages.map((m) => m.message.from), ['me', 'them']);
});

test('ts giữ nguyên mili-giây', () => {
  const result = chunkToMessages(chunk([
    { id: 'oneone/1', messages: [message({ timestamp: '1731000000000' })] },
  ]), resolver);

  assert.equal(result.messages[0].message.ts, 1731000000000);
  // Nếu ai đó đổi sang giây, con số này thành 1.7 tỉ (năm 1970).
  assert.equal(new Date(result.messages[0].message.ts).getUTCFullYear(), 2024);
});

test('phân vùng nhóm giữ kind group', () => {
  const result = chunkToMessages(chunk([
    { id: 'group/77', messages: [message({ senderId: '888' })] },
  ]), resolver);

  assert.equal(result.messages[0].kind, 'group');
  assert.equal(result.messages[0].threadId, '77');
  assert.equal(result.messages[0].message.kind, 'group');
  assert.equal(result.messages[0].message.senderId, '888');
});

test('mention Sync V2 giữ range UTF-16 hợp lệ, không truyền UID sang message', () => {
  const withMentions = {
    ...message({ content: '😀 @Mai' }),
    meta: {
      attachs: [],
      mentions: [
        { uid: 'private-user-id', pos: 3, len: 4, type: 1 },
        { uid: 'ignored', pos: 99, len: 2, type: 1 },
      ],
    },
  };
  const result = chunkToMessages(chunk([
    { id: 'group/77', messages: [withMentions as never] },
  ]), resolver);

  assert.deepEqual(result.messages[0].message.mentions, [{ pos: 3, len: 4 }]);
  assert.equal(JSON.stringify(result.messages[0].message).includes('private-user-id'), false);
});

test('tin rỗng và tin metadata bị bỏ; tin thiếu globalId vẫn được ghi', () => {
  // Trước 2026-11-11 test này khẳng định tin `globalId: '0'` **bị bỏ**. Đo trên
  // dữ liệu thật cho thấy đó đúng là tin của chính chủ tài khoản, nên khẳng
  // định cũ chính là lỗi "tin của tôi thiếu". Giờ nó được ghi bằng khoá cục bộ.
  const result = chunkToMessages(chunk([
    { id: 'oneone/1', messages: [
      message({ content: '   ' }),        // chỉ khoảng trắng
      message({ globalId: '0' }),          // chưa được cấp id máy chủ — vẫn ghi
      message({ content: 'giữ lại' }),
    ] },
    { id: 'metadata_sync', messages: [message({ content: 'bản ghi phiên' })] },
  ]), resolver);

  assert.equal(result.messages.length, 2, 'tin thiếu id vẫn được ghi');
  assert.equal(result.messages[1].message.text, 'giữ lại');
  assert.equal(result.locallyKeyed, 1);
  assert.equal(result.skipped, 2, 'một tin rỗng cộng một tin metadata');
});

test('nhiều phân vùng: tin của mọi hội thoại, đúng thứ tự', () => {
  const result = chunkToMessages(chunk([
    { id: 'oneone/1', messages: [message({ content: 'a', globalId: '1' })] },
    { id: 'group/2', messages: [
      message({ content: 'b', globalId: '2' }),
      message({ content: 'c', globalId: '3' }),
    ] },
  ]), resolver);

  assert.deepEqual(
    result.messages.map((m) => `${m.threadId}:${m.message.text}`),
    ['1:a', '2:b', '2:c'],
  );
});

test('text bị cắt ở 2000 ký tự, cùng giới hạn với TEXT_MAX', () => {
  const long = 'x'.repeat(5000);
  assert.equal(textOfSyncMessage(message({ content: long })).length, 2000);
});

test('timestamp không phải số thì rơi về hiện tại, không ra NaN', () => {
  const result = chunkToMessages(chunk([
    { id: 'oneone/1', messages: [message({ timestamp: 'không-phải-số' })] },
  ]), resolver);

  assert.equal(Number.isFinite(result.messages[0].message.ts), true);
  assert.ok(result.messages[0].message.ts > 1_700_000_000_000);
});

test('tin đồng bộ mang cờ `backfill` — renderer mới chèn theo thời điểm được', () => {
  // Không có cờ này thì renderer nối tin cũ vào **cuối** hội thoại và bắn một
  // thông báo cho mỗi tin: một lần đồng bộ đầu sẽ đảo lộn thứ tự đọc và làm
  // điện thoại rung hàng nghìn lần.
  const result = chunkToMessages(chunk([
    { id: 'oneone/1', messages: [message({ globalId: '111', content: 'cũ' })] },
  ]), resolver);

  assert.equal(result.messages[0].message.backfill, true);
  assert.equal(result.skipped, 0);
});

test('hội thoại một-một đổi từ id nhiễu sang uid, để tin rơi đúng hội thoại', () => {
  // Đo 2026-11-10: mọi `convId` của Sync V2 là id nhiễu (363/363), còn danh
  // sách hội thoại bên trái khoá bằng uid số. Không đổi thì mỗi tin lịch sử
  // tạo một hội thoại ma tên "Người dùng Zalo" chứ không vào hội thoại thật.
  const withIds = makeIdResolver({
    globalIds: new Map([['zFriendNoised0000000000000000000', '555']]),
    ownNoisedId: OWN_NOISED,
  });
  const result = chunkToMessages(chunk([
    { id: 'oneone/zFriendNoised0000000000000000000', messages: [message({ senderId: '999' })] },
  ]), withIds);

  assert.equal(result.messages[0].threadId, '555', 'id hội thoại phải là uid');
  assert.equal(result.messages[0].message.threadId, '555');
});

test('không tra được id nhiễu thì giữ nguyên, không đoán bừa', () => {
  // Đoán sang một uid khác là gán tin của người này cho hội thoại người kia.
  const result = chunkToMessages(chunk([
    { id: 'oneone/zLaNguoi0000000000000000000000', messages: [message()] },
  ]), resolver);

  assert.equal(result.messages[0].threadId, 'zLaNguoi0000000000000000000000');
});

test('nhóm tra id nhiễu về groupId số, cùng bảng với người', () => {
  // `partition` của tin nhóm là `group/<globalId nhóm>`, còn `threads` khoá
  // bằng `groupId` số. Đo 2026-11-10: 35 nhóm / 81 619 tin nằm trong hội thoại
  // ma tên "Nhóm Zalo" vì chỉ tra phía người.
  const withGroup = makeIdResolver({
    ownNoisedId: OWN_NOISED,
    globalIds: new Map([['5I6VC2EC7T4FDJH9I5PHJDHH9K09G280', '778899']]),
  });

  test('tin nhóm Sync V2 lấy tên người gửi từ danh bạ đã biết', () => {
    const withNames = makeIdResolver({
      ownNoisedId: OWN_NOISED,
      globalNames: new Map([['zFriendNoised0000000000000000000', 'Mai Anh']]),
    });
    const result = chunkToMessages(chunk([
      { id: 'group/5I6VC2EC7T4FDJH9I5PHJDHH9K09G280',
        messages: [message({ senderId: 'zFriendNoised0000000000000000000' })] },
    ]), withNames);
    assert.equal(result.messages[0].message.fromName, 'Mai Anh');
  });
  const result = chunkToMessages(chunk([
    { id: 'group/5I6VC2EC7T4FDJH9I5PHJDHH9K09G280', messages: [message()] },
  ]), withGroup);

  assert.equal(result.messages[0].threadId, '778899');
  assert.equal(result.messages[0].message.threadId, '778899');
  // `kind` vẫn lấy từ tiền tố `group/`, không lấy từ bảng ánh xạ: bảng chỉ trả
  // id, và một `globalId` lạ không được phép biến nhóm thành hội thoại riêng.
  assert.equal(result.messages[0].kind, 'group');
});

test('nhóm chưa có id nhiễu thì giữ nguyên convId', () => {
  const withIds = makeIdResolver({ ownNoisedId: OWN_NOISED });
  const result = chunkToMessages(chunk([
    { id: 'group/5I6VC2EC7T4FDJH9I5PHJDHH9K09G280', messages: [message()] },
  ]), withIds);

  assert.equal(result.messages[0].threadId, '5I6VC2EC7T4FDJH9I5PHJDHH9K09G280');
  assert.equal(result.messages[0].kind, 'group');
});

test('`unresolved` đếm phân vùng không nối được, không đếm tin bị bỏ', () => {
  // Hai phân vùng lạ cộng một phân vùng tra được. `skipped` và `unresolved`
  // trả lời hai câu hỏi khác nhau — "mất bao nhiêu tin" và "bao nhiêu hội thoại
  // vẫn mang id nhiễu" — nên không được lẫn: phân vùng lạ vẫn ghi tin bình
  // thường, chỉ là dưới id nhiễu.
  const withIds = makeIdResolver({
    ownNoisedId: OWN_NOISED,
    globalIds: new Map([['zBietRoi000000000000000000000000', '555']]),
  });
  const result = chunkToMessages(chunk([
    { id: 'oneone/zBietRoi000000000000000000000000', messages: [message()] },
    { id: 'oneone/zLaNguoi0000000000000000000000', messages: [message()] },
    { id: 'oneone/zLaNguoi0000000000000000000000', messages: [message({ content: '' })] },
  ]), withIds);

  assert.equal(result.unresolved, 2, 'đếm theo phân vùng, không theo từng tin');
  assert.equal(result.messages.length, 2);
  assert.equal(result.skipped, 1);
});

/**
 * Bỏ vì rỗng phải đếm được **cả tin của mình**, vì đó là ảnh/tệp mình đã gửi.
 *
 * Trước 2026-11-11 test này còn khoá một lý do bỏ thứ hai (`no-id`) cho tin
 * `globalId === '0'`. Lý do đó đã bị bỏ: nó chính là thứ làm mất 37 955 tin
 * của chính chủ tài khoản mỗi lượt. Xem `localKey`.
 */
test('bỏ vì rỗng, và tin của mình rỗng được đếm riêng', () => {
  const self = makeIdResolver({ ownNoisedId: OWN_NOISED, ownId: OWN });
  const result = chunkToMessages(chunk([
    { id: 'oneone/999', messages: [
      message({ content: '' }),                        // rỗng, của người khác
      message({ content: '', senderId: OWN_NOISED }),  // rỗng, của mình
    ] },
  ]), self);

  assert.deepEqual(result.skipReasons, { empty: 2 });
  assert.deepEqual(result.selfSkipped, { empty: 1 });
  assert.equal(result.messages.length, 0);
  assert.equal(result.skipped, 2);
});

test('tin ghi được thì không vào bất kỳ bộ đếm bỏ nào', () => {
  const self = makeIdResolver({ ownNoisedId: OWN_NOISED, ownId: OWN });
  const result = chunkToMessages(chunk([
    { id: 'oneone/999', messages: [message({ senderId: OWN_NOISED })] },
  ]), self);

  assert.deepEqual(result.skipReasons, { empty: 0 });
  assert.deepEqual(result.selfSkipped, { empty: 0 });
  assert.equal(result.messages[0].message.from, 'me');
});

/**
 * Tin `globalId === '0'` **không** bị bỏ nữa — nó được cấp khoá cục bộ.
 *
 * Đo 2026-11-11: Zalo PC trên cùng máy có 35 780 tin của chính chủ tài khoản,
 * DB của repo chỉ có 5 892, và log cho thấy 37 955 tin bị bỏ mỗi lượt vì thiếu
 * `globalId` — tất cả đều của mình. Đây là lỗi làm mất lịch sử phía mình.
 */
test('tin không có globalId vẫn được ghi, bằng khoá cục bộ', () => {
  const self = makeIdResolver({ ownNoisedId: OWN_NOISED, ownId: OWN });
  const result = chunkToMessages(chunk([
    { id: 'oneone/999', messages: [message({ globalId: '0', senderId: OWN_NOISED })] },
  ]), self);

  assert.equal(result.messages.length, 1, 'tin của mình phải được ghi');
  assert.equal(result.messages[0].message.from, 'me');
  assert.equal(result.locallyKeyed, 1);
  assert.equal(result.messages[0].message.msgId, 'syncv2:1731000000000:0');
  assert.equal(result.skipped, 0);
});

/**
 * Khoá cục bộ phải **tiền định**: cùng một tin ở hai lượt đồng bộ ra cùng một
 * khoá, nếu không mỗi lượt lại chèn thêm một bản sao — đúng cái bẫy mà việc bỏ
 * tin `globalId === '0'` từng tránh được nhưng phải trả giá bằng cả lịch sử.
 */
test('khoá cục bộ ổn định giữa hai lượt, và tách được tin cùng giây', () => {
  const self = makeIdResolver({ ownNoisedId: OWN_NOISED, ownId: OWN });
  const build = () => chunkToMessages(chunk([
    { id: 'oneone/999', messages: [
      message({ globalId: '0', timestamp: '1731000000000' }),
      message({ globalId: '0', timestamp: '1731000000000' }),
      message({ globalId: '0', timestamp: '1731000000001' }),
    ] },
  ]), self);

  const first = build();
  const second = build();
  const ids = first.messages.map(item => item.message.msgId);

  assert.deepEqual(ids, [
    'syncv2:1731000000000:0',
    'syncv2:1731000000000:1',
    'syncv2:1731000000001:0',
  ]);
  assert.deepEqual(second.messages.map(item => item.message.msgId), ids,
    'lượt sau phải ra đúng khoá cũ, không phải bản sao');
});

/**
 * Khoá cục bộ không được đụng id máy chủ. `msgId` thật là chuỗi thuần chữ số,
 * nên tiền tố `syncv2:` đủ để hai không gian khoá rời nhau vĩnh viễn.
 */
test('khoá cục bộ không bao giờ trùng hình dạng với id máy chủ', () => {
  const self = makeIdResolver({ ownNoisedId: OWN_NOISED, ownId: OWN });
  const result = chunkToMessages(chunk([
    { id: 'oneone/999', messages: [
      message({ globalId: '0' }),
      message({ globalId: '9876543210987654321' }),
    ] },
  ]), self);

  const [local, server] = result.messages.map(item => item.message.msgId);
  assert.match(local ?? '', /^syncv2:/);
  assert.match(server ?? '', /^[0-9]+$/);
  assert.equal(result.locallyKeyed, 1, 'chỉ tin thiếu id mới bị cấp khoá cục bộ');
});

/**
 * Khoá cục bộ **không bao giờ** được đi ra máy chủ.
 *
 * Đo 2026-11-11 18:29, ngay sau khi bật khoá cục bộ: `history-cursor asked
 * "syncv2:1790145644615:0"`, rồi `Cannot read properties of undefined (reading
 * 'map')`, rồi mọi lượt xin lịch sử treo 5 s và trả `timeout`. Nguyên nhân:
 * `olderMsgId` trả `true` cho con trỏ đang `null` mà không thử `BigInt`, nên
 * khoá cục bộ đầu tiên lọt vào con trỏ phân trang.
 */
test('chỉ id máy chủ mới được đi ra ngoài; khoá cục bộ thì không', () => {
  const server = { ...message({ globalId: '9876543210987654321' }) };
  const local = { ...message({ globalId: '0' }) };
  const result = chunkToMessages(chunk([
    { id: 'oneone/999', messages: [server, local] },
  ]), resolver);

  const ids = result.messages.map(item => item.message.msgId);
  assert.equal(isServerMsgId(ids[0]), true, 'id máy chủ phải qua được');
  assert.equal(isServerMsgId(ids[1]), false, 'khoá cục bộ phải bị chặn');
  assert.equal(isServerMsgId(null), false);
  assert.equal(isServerMsgId(''), false);
  assert.equal(isServerMsgId('syncv2:1731000000000:0'), false);
  assert.equal(isServerMsgId('0'), true, '"0" vẫn là hình dạng id máy chủ');
});
