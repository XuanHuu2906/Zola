import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMessage, buildThreads, buildThreadsWithIds, isTextMessage, stickerContentOf, textOf, toLiveMessage,
} from '../electron/protocol/mapper.ts';
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

test('tin nhóm mang tên người gửi; tin của mình và tin 1-1 không hiện tên này', () => {
  const received = toLiveMessage(raw({ uidFrom: 'u-7', dName: '  Mai Anh  ' }), 'g-1', 'group', false);
  assert.equal(received?.fromName, 'Mai Anh');
  assert.equal(received?.senderId, 'u-7');
  const fromContact = toLiveMessage(raw({ uidFrom: 'u-7', dName: 'Tên cũ' }), 'g-1', 'group', false,
    uid => uid === 'u-7' ? 'Tên danh bạ' : undefined);
  assert.equal(fromContact?.fromName, 'Tên danh bạ', 'ưu tiên tên tra theo uid như Zalo chính thức');
  assert.equal(toLiveMessage(raw({ dName: 'Tên tài khoản' }), 'g-1', 'group', true)?.fromName, undefined);
  assert.equal(toLiveMessage(raw({ dName: 'Mai Anh' }), 'u-1', 'user', false)?.fromName, undefined);
});

test('mention realtime chỉ phát range hợp lệ, không để lộ UID', () => {
  const mentions = [
    { uid: 'private-user-id', pos: 3, len: 4, type: 1 },
    { uid: 'ignored', pos: -1, len: 2, type: 1 },
    { uid: 'ignored', pos: 3, len: 99, type: 1 },
  ];
  const message = toLiveMessage(raw({ content: '😀 @Mai', mentions }), 'g-1', 'group', false);
  assert.deepEqual(message?.mentions, [{ pos: 3, len: 4 }], 'offset là UTF-16 và phải nằm trong text');
  assert.equal(JSON.stringify(message).includes('private-user-id'), false);
});

test('ts hỏng thì rơi về now, không ném', () => {
  const message = toLiveMessage(raw({ ts: 'không-phải-số' }), 'u-1', 'user', false) as LiveMessage;
  assert.equal(Number.isFinite(message.ts), true);
  assert.ok(message.ts > 0);
  assert.equal(toLiveMessage(raw({ ts: '1700000000123' }), 'u-1', 'user', false)?.ts, 1700000000123);
});

test('tin rỗng sau khi cắt là null, không tạo bubble trống', () => {
  assert.equal(toLiveMessage(raw({ content: '   ' }), 'u-1', 'user', false), null);
  // JSON trên một loại tin có tệp nhưng **không** mang gì dựng được thẻ: một
  // object rỗng không phải là hình vẽ tay, và dựng thẻ cho nó là bịa ra một tệp.
  assert.equal(toLiveMessage(raw({ msgType: '2', content: '{"a":1}' }), 'u-1', 'user', false), null);
});

test('tin realtime chỉ có tệp vẫn sống — đây là chỗ thứ hai ảnh/tệp từng biến mất', () => {
  // Đường đồng bộ đã sửa lỗi này (`chunkToMessages`); listener thì chưa, nên
  // một ảnh đến lúc đang mở app bị bỏ hẳn trong khi ảnh cùng loại trong lịch sử
  // lại hiện ra. Hai đường vào phải cùng một luật: có chữ **hoặc** có tệp.
  //
  // `msgType` ở đây là **tên** (`"chat.photo"`), đúng như zca-js gửi — xem
  // `attachmentsOf`. Bơm số vào đây từng làm test xanh trong khi ảnh thật rơi.
  const photo = toLiveMessage(raw({
    msgType: 'chat.photo', content: '{"title":"ảnh.jpg","href":"https://s120-ava-talk.zadn.vn/a/b.jpg"}',
  }), 'u-1', 'user', false);
  assert.ok(photo);
  assert.equal(photo.text, '', 'không bịa chữ thay cho tệp');
  assert.equal(photo.attachments?.[0].kind, 'photo');
  assert.equal(photo.attachments?.[0].remote, 'https://s120-ava-talk.zadn.vn/a/b.jpg');

  // Một tệp có tên nhưng không có URL vẫn vào hội thoại: nó là nội dung thật.
  const named = toLiveMessage(raw({ msgType: 'share.file', content: '{"type":"share.file","title":"báo cáo.pdf"}' }),
    'u-1', 'user', false);
  assert.equal(named?.attachments?.[0].kind, 'file');
  assert.equal(named?.text, '');
});

test('tin realtime vừa có chữ vừa có tệp giữ cả hai', () => {
  // Text có tệp là chuyện bình thường với ảnh kèm chú thích trên Zalo.
  const mixed = toLiveMessage(raw({
    msgType: 'chat.photo', content: '{"title":"a.jpg","href":"https://s120-talk.zadn.vn/a.jpg"}',
  }), 'u-1', 'user', false);
  assert.equal(mixed?.text, '', 'content JSON không thành chữ');
  // Nội dung không phải JSON và msgType là text vẫn là tin chữ, không có tệp.
  const plain = toLiveMessage(raw({ msgType: 'webchat', content: 'xin chào' }), 'u-1', 'user', false);
  assert.equal(plain?.text, 'xin chào');
  assert.equal(plain?.attachments, undefined, 'không có tệp thì không có trường');
});

test('content là object (không phải chuỗi) cũng đọc được như tệp', () => {
  const object = toLiveMessage(raw({
    msgType: 'share.file', content: { type: 'share.file', title: 'hop-dong.docx', href: 'https://f12-zpcloud.zdn.vn/a.docx' },
  }), 'u-1', 'user', false);
  assert.equal(object?.attachments?.[0].kind, 'file');
  assert.equal(object?.attachments?.[0].ext, 'docx');
  // Object rỗng thì không có gì để dựng, và cũng không có chữ.
  assert.equal(toLiveMessage(raw({ msgType: 'chat.doodle', content: {} }), 'u-1', 'user', false), null);
});

test('sticker realtime giữ lại metadata ID khi URL phải tra từ API', () => {
  const payload = raw({
    msgType: 'chat.sticker',
    content: { id: 123, catId: 7, type: 1 },
  });
  assert.deepEqual(stickerContentOf(payload), { id: 123, catId: 7, type: 1 });
  const message = toLiveMessage(payload, 'g-1', 'group', false);
  assert.equal(message?.attachments?.[0].kind, 'sticker');
  assert.equal(message?.attachments?.[0].remote, undefined);
  assert.equal(message?.attachments?.[0].raw?.params, '{"id":123,"catId":7,"type":1}');

  const withUrl = toLiveMessage(raw({
    msgType: 'chat.sticker',
    content: { id: 123, catId: 7, type: 1, href: 'https://stc.zdn.vn/stickers/123.webp' },
  }), 'g-1', 'group', false);
  assert.equal(withUrl?.attachments?.[0].remote, 'https://stc.zdn.vn/stickers/123.webp');
  assert.equal(stickerContentOf(raw({
    msgType: 'chat.sticker', content: { id: Number.MAX_SAFE_INTEGER + 1 },
  })), null, 'ID không an toàn không được gửi sang API');
});

test('preview của danh sách đọc được tin chỉ có tệp', () => {
  // `lastText` là dòng người dùng thấy trong danh sách hội thoại. Trước đây nó
  // là `message.text`, nên một tin ảnh hiện thành dòng trống.
  const photo = toLiveMessage(raw({
    msgType: 'chat.photo', content: '{"title":"ảnh.jpg","href":"https://s120-talk.zadn.vn/a.jpg"}',
  }), 'u-7', 'user', false)!;
  const threads = applyMessage([], photo, null);
  assert.equal(threads[0].lastText, 'ảnh.jpg', 'tên tệp, không phải nhãn loại');
  const unnamed = toLiveMessage(raw({
    msgType: 'chat.photo', content: '{"href":"https://s120-talk.zadn.vn/a.jpg"}',
  }), 'u-7', 'user', false)!;
  assert.equal(applyMessage([], unnamed, null)[0].lastText, 'Hình ảnh');
});

test('clientId luôn null: tin từ server không mang id tạm của mình', () => {
  assert.equal(toLiveMessage(raw(), 'u-1', 'user', false)?.clientId, null);
  assert.equal(toLiveMessage(raw({ msgId: '' }), 'u-1', 'user', false)?.msgId, null);
});

test('buildThreads ghim lên đầu, avatar vẫn null cho tới khi main tải về', () => {
  const threads = buildThreads(
    [{ userId: 'u-1', displayName: 'An', zaloName: '', avatar: 'https://zalo/x.png', avatarSource: 'https://zalo/x.png' },
      { userId: 'u-2', displayName: '', zaloName: 'Bình', avatar: '', avatarSource: 'https://zalo/y.png' }],
    [{ groupId: 'g-1', name: 'Nhóm', avt: 'https://zalo/g.png', totalMember: 3, avatarSource: 'https://zalo/g.png' }],
    ['g-1'], ['u-2'], [],
  );
  assert.deepEqual(threads.map(thread => thread.id), ['g-1', 'u-1', 'u-2']);
  assert.equal(threads[0].kind, 'group');
  assert.equal(threads[2].name, 'Bình');
  assert.equal(threads[1].unread, 0);
  assert.equal(threads[2].unread, 1);
  for (const thread of threads) {
    // `avatar` là đường dẫn **cục bộ** đã có trên đĩa; URL của Zalo nằm ở
    // `BuiltThreads.avatars` cho main tải, không bao giờ ở đây. Renderer thấy
    // `null` cho tới khi ảnh thật sự về — và đó là hành vi đúng.
    assert.equal(thread.avatar, null, 'URL từ xa không bao giờ vào model đi qua IPC');
    assert.equal(thread.lastText, '');
    assert.equal(thread.lastTs, 0);
  }
});

test('URL avatar đi ra bằng bảng riêng, không nhầm với id nhiễu', () => {
  const built = buildThreadsWithIds(
    [{ userId: 'u-1', displayName: 'An', zaloName: '', avatar: '', avatarSource: 'https://s120-ava-talk.zadn.vn/1.jpg', globalId: 'zAn1' }],
    [{ groupId: 'g-1', name: 'Nhóm', avt: '', totalMember: 3, avatarSource: 'https://s120-ava-talk.zadn.vn/2.jpg' }],
    [], [], [],
  );
  assert.deepEqual([...built.avatars], [
    ['u-1', 'https://s120-ava-talk.zadn.vn/1.jpg'],
    ['g-1', 'https://s120-ava-talk.zadn.vn/2.jpg'],
  ]);
  assert.equal(built.globalIds.get('zAn1'), 'u-1', 'bảng id nhiễu không bị ảnh lấn');
  assert.equal(built.globalNames.get('zAn1'), 'An');
  // Không có URL thì không có mục: một mục rỗng là một lần tải chắc chắn hỏng.
  const empty = buildThreadsWithIds([{ userId: 'u-1', displayName: 'An', zaloName: '', avatar: '' }], [], [], [], []);
  assert.equal(empty.avatars.size, 0);
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

test('bảng globalId gồm cả nhóm — thiếu nửa này thì tin nhóm vào hội thoại ma', () => {
  // `partition` của Sync V2 là `group/<globalId nhóm>`; `threads` khoá bằng
  // `groupId` số. Đo 2026-11-10: 35 nhóm / 81 619 tin mang id nhiễu.
  const { threads, globalIds } = buildThreadsWithIds(
    [{ userId: 'u-1', displayName: 'An', zaloName: '', avatar: '', globalId: 'zAn000' }],
    [{ groupId: 'g-9', name: 'Nhóm kín', avt: '', totalMember: 3, globalId: 'zNhom09' }],
    [], [], [],
  );

  assert.equal(globalIds.get('zAn000'), 'u-1');
  assert.equal(globalIds.get('zNhom09'), 'g-9');
  assert.equal(globalIds.size, 2);
  // Ánh xạ là phụ; danh sách hội thoại vẫn khoá bằng id số như trước.
  assert.deepEqual(threads.map(t => t.id).sort(), ['g-9', 'u-1']);
});

test('tên thành viên nhóm được dùng khi người gửi không có trong danh bạ bạn bè', () => {
  const built = buildThreadsWithIds([], [{
    groupId: 'g-9', name: 'Lớp', avt: '', totalMember: 2,
    memberIds: ['u-7', 'u-8'],
    members: [{
      id: 'u-7', dName: 'Hoàng Đạt', zaloName: 'Đạt',
      avatarSource: 'https://s120-ava-talk.zadn.vn/member-7.jpg',
    }],
  }], [], [], []);
  assert.equal(built.globalNames.get('u-7'), 'Hoàng Đạt');
  assert.deepEqual(built.groupMemberIds.get('g-9'), ['u-7', 'u-8']);
  assert.equal(built.avatars.get('u-7'), 'https://s120-ava-talk.zadn.vn/member-7.jpg');
});

test('avatar bạn bè độ phân giải cao được ưu tiên hơn avatar nhỏ trong danh sách nhóm', () => {
  const built = buildThreadsWithIds([{
    userId: 'u-7', displayName: 'Hoàng Đạt', zaloName: 'Đạt', avatar: '',
    avatarSource: 'https://s120-ava-talk.zadn.vn/member-7-full.jpg',
  }], [{
    groupId: 'g-9', name: 'Lớp', avt: '', totalMember: 1,
    members: [{
      id: 'u-7', dName: 'Hoàng Đạt', zaloName: 'Đạt',
      avatarSource: 'https://s120-ava-talk.zadn.vn/member-7-small.jpg',
    }],
  }], [], [], []);
  assert.equal(built.avatars.get('u-7'), 'https://s120-ava-talk.zadn.vn/member-7-full.jpg');
});

test('bảng globalId bỏ "0" — đó là chỗ giữ của "chính mình", không phải một người', () => {
  const { globalIds } = buildThreadsWithIds(
    [{ userId: 'u-1', displayName: 'An', zaloName: '', avatar: '', globalId: '0' }],
    [{ groupId: 'g-9', name: '', avt: '', totalMember: 0, globalId: '' }],
    [], [], [],
  );

  assert.equal(globalIds.size, 0, 'không có mục nào cho "0" hay chuỗi rỗng');
});

test('counts tách "không có dòng nào" khỏi "có dòng nhưng thiếu globalId"', () => {
  // Hai ca này có cùng `globalIds.size === 0` nhưng cách sửa khác hẳn nhau:
  // một bên là lời gọi mạng hỏng (đã bị `.catch` nuốt thành danh sách rỗng),
  // một bên là trường `globalId` không có trong payload.
  const empty = buildThreadsWithIds([], [], [], [], []);
  assert.deepEqual(empty.counts, { friends: 0, groups: 0, groupIds: 0 });

  const noIds = buildThreadsWithIds(
    [{ userId: 'u-1', displayName: 'An', zaloName: '', avatar: '' }],
    [{ groupId: 'g-9', name: 'Nhóm', avt: '', totalMember: 2 }],
    [], [], [],
  );
  assert.deepEqual(noIds.counts, { friends: 1, groups: 1, groupIds: 0 });
});
