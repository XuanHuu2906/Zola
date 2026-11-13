import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATTACHMENT_LABELS, ATTACH_TEXT_MAX, attachmentsOf, extensionOf, kindOfMsgType, keepLocalPaths,
  linkOf, toIpcAttachments, toIpcMessage, type RawAttachment, type StoredAttachment,
} from '../electron/protocol/attachment.ts';

/**
 * Ranh giới của tệp đính kèm: hình dạng nào được nhận, loại nào được suy ra, và
 * — quan trọng nhất — cái gì **không** được rời khỏi tiến trình main.
 *
 * Toàn bộ file thuần dữ liệu khai báo: không DB, không mạng, không zca-js.
 */

const attach = (over: Partial<RawAttachment> = {}): RawAttachment => ({
  type: 'chat.photo', href: 'https://s120-ava-talk.zadn.vn/a/b.jpg',
  thumb: 'https://res-zalo.zadn.vn/a/thumb.jpg', title: 'ảnh.jpg', ...over,
});

test('bảng mã `Ai` của Zalo PC: số quyết định loại, kể cả khi chuỗi vắng mặt', () => {
  // Enum đọc từ bundle Zalo PC 26.11.10 — xem ghi chú đầu `attachment.ts`.
  const expected: Array<[number, string | null]> = [
    [0, null], [2, 'doodle'], [3, 'photo'], [4, 'photo'], [6, 'voice'], [10, 'sticker'],
    [12, 'contact'], [15, null], [18, 'location'], [19, 'video'], [20, null],
    [21, null], [22, 'file'], [23, 'gif'], [24, 'link'], [25, 'video'],
    [26, null], [31, 'photo'], [33, null], [36, null], [53, 'link'],
  ];
  for (const [msgType, kind] of expected) {
    assert.equal(kindOfMsgType(msgType), kind, `msgType ${msgType}`);
  }
});

test('chuỗi `type` cụ thể hơn số, nhưng chỉ khi cả hai cùng có', () => {
  // Loại 3 là ảnh; `chat.sticker` nói rõ hơn "loại 10".
  assert.equal(attachmentsOf(10, [attach({ type: 'chat.sticker' })])[0].kind, 'sticker');
  assert.equal(attachmentsOf(10, [attach({ type: '' })])[0].kind, 'sticker');
  // Chuỗi lạ không làm mất mục: số vẫn còn để dựa vào.
  assert.equal(attachmentsOf(22, [attach({ type: 'chat.unknown.future' })])[0].kind, 'file');
});

test('tin chắc chắn không mang tệp thì trả rỗng, dù có `attach`', () => {
  // Chữ định dạng của tin `Text`, tin hệ thống, tin đã xoá, tin thu hồi.
  for (const msgType of [0, 1, 20, 33, 36]) {
    assert.deepEqual(attachmentsOf(msgType, [attach()]), [], `msgType ${msgType}`);
  }
  assert.deepEqual(attachmentsOf(1, [attach({ type: 'chat.photo' })]), [],
    'số nói "chữ" thì chuỗi không được lật lại');
});

test('realtime nói `msgType` bằng TÊN, không bằng số — đây là lỗi đã làm mọi ảnh realtime biến mất', () => {
  // Đo 2026-11-11 từ log listener trên một ảnh vào lúc app đang mở:
  //   inbound {"msgType":"chat.photo","contentType":"object","mapped":false}
  // Bản trước ép `Number("chat.photo")` → NaN → 0, rồi danh sách loại-trừ đọc
  // 0 là "tin chữ" và nuốt luôn tấm ảnh. Test cũ không bắt được vì nó bơm số
  // vào đường realtime — hình dạng mà zca-js không bao giờ gửi.
  const photo = attachmentsOf('chat.photo', [attach()]);
  assert.equal(photo[0].kind, 'photo');
  assert.equal(attachmentsOf('share.file', [attach({ type: '', title: 'a.pdf' })])[0].kind, 'file');
  // Tên của chính tin chữ cũng phải bị loại — `webchat` là 1 trong không gian số.
  assert.deepEqual(attachmentsOf('webchat', [attach()]), []);
  // Tên lạ vẫn giữ mục nếu có nội dung tải được, y như số lạ.
  assert.equal(attachmentsOf('chat.something.new', [attach({ type: '' })])[0].kind, 'other');
});

test('`msgType` dạng chuỗi số vẫn đi đường số — hai đầu của cùng một trường', () => {
  // `SyncMessage.msgType` có thể tới dạng chuỗi tuỳ bản proto; đừng để nó rơi
  // vào nhánh tên rồi thành "loại chưa biết".
  assert.equal(attachmentsOf('22', [attach({ type: 'share.file' })])[0].kind, 'file');
  assert.deepEqual(attachmentsOf('1', [attach()]), [], 'chuỗi "1" vẫn là tin chữ');
  assert.deepEqual(attachmentsOf(' 0 ', [attach()]), [], 'khoảng trắng không đổi nghĩa');
});

test('loại chưa biết nhưng có nội dung tải được thì hiện thành tệp, không biến mất', () => {
  const [item] = attachmentsOf(99, [attach({ type: '', href: 'https://f12-zpcloud.zdn.vn/x.bin' })]);
  assert.equal(item.kind, 'other');
  // Không có gì để tải và không có gì để hiện: bỏ, thay vì dựng thẻ rỗng.
  assert.deepEqual(attachmentsOf(99, [attach({ type: '', href: '', thumb: '', title: '' })]), []);
});

test('một album ảnh giữ đủ mọi phần tử, đúng thứ tự', () => {
  const items = attachmentsOf(3, [
    attach({ href: 'https://a.zadn.vn/1.jpg', title: 'một' }),
    attach({ href: 'https://a.zadn.vn/2.jpg', title: 'hai' }),
  ]);
  assert.deepEqual(items.map(item => item.title), ['một', 'hai']);
});

test('URL: chỉ https tuyệt đối, không credential; sai thì trường bị bỏ chứ không ghi rác', () => {
  const [item] = attachmentsOf(22, [attach({
    type: 'share.file',
    href: 'https://user:pw@f12-zpcloud.zdn.vn/a.pdf',
    thumb: 'http://res-zalo.zadn.vn/t.jpg',
  })]);
  assert.equal(item.remote, undefined, 'credential không vào cột này');
  assert.equal(item.remoteThumb, undefined, 'http bị bỏ');
  assert.equal(item.kind, 'file');
  // Thiếu mọi URL vẫn giữ mục: một tệp không tải được là chuyện của tầng tải.
  assert.equal(item.src, null);
});

test('kích thước và thời lượng đọc từ `params`, chỉ nhận số dương', () => {
  const [item] = attachmentsOf(6, [attach({
    type: 'chat.voice', params: JSON.stringify({ fileSize: '20480', duration: 8300 }),
  })]);
  assert.equal(item.size, 20480);
  assert.equal(item.duration, 8300);
  const [bad] = attachmentsOf(6, [attach({ type: 'chat.voice', params: '{"fileSize":"-1"}' })]);
  assert.equal(bad.size, undefined);
  const [broken] = attachmentsOf(6, [attach({ type: 'chat.voice', params: 'không-phải-json' })]);
  assert.equal(broken.size, undefined, 'params hỏng không được ném');
});

test('liên kết: đích lấy từ `href` hoặc từ `params`, ưu tiên `href`', () => {
  const fromHref = attachmentsOf(24, [attach({ type: 'chat.webcontent', href: 'https://vnexpress.net/a' })])[0];
  assert.equal(fromHref.url, 'https://vnexpress.net/a');

  // Hình dạng `zinstant` của Zalo PC: `params` là JSON lồng một tầng nữa.
  const params = JSON.stringify({
    pcItem: { title: 'Bài báo', description: 'Mô tả', href: 'https://vnexpress.net/b' },
  });
  const fromParams = attachmentsOf(53, [attach({
    type: 'chat.webcontent.v2', href: '', thumb: '', title: '', params,
  })])[0];
  assert.equal(fromParams.url, 'https://vnexpress.net/b');
  assert.equal(fromParams.title, 'Bài báo');
  assert.equal(fromParams.description, 'Mô tả');

  // Trang đích không bao giờ được tải, nên ảnh xem trước là nội dung duy nhất.
  assert.equal(fromParams.remote, undefined);
});

test('linkOf không đoán URL từ một chuỗi trông giống URL', () => {
  assert.deepEqual(linkOf('vnexpress.net/a'), {});
  assert.deepEqual(linkOf(undefined), {});
  assert.equal(linkOf('{"data":"https://evil.example/x"}').url, undefined,
    'một chuỗi trần trong `data` không phải hình dạng của Zalo');
});

test('extensionOf: tên tệp trước, URL sau, và không nhầm dấu chấm trong đường dẫn', () => {
  assert.equal(extensionOf('Báo cáo.PDF'), 'pdf');
  assert.equal(extensionOf('báo cáo (1).docx'), 'docx');
  assert.equal(extensionOf('', 'https://f12-zpcloud.zdn.vn/a/b/c.xlsx?token=1'), 'xlsx');
  assert.equal(extensionOf('không có đuôi', 'https://f12-zpcloud.zdn.vn/a/b/c'), undefined);
});

test('cắt độ dài: `title`/`description` không được là kênh đẩy dữ liệu lớn', () => {
  const [item] = attachmentsOf(22, [attach({ title: 'x'.repeat(1000), description: 'y'.repeat(1000) })]);
  assert.equal(item.title?.length, ATTACH_TEXT_MAX);
  assert.equal(item.description?.length, ATTACH_TEXT_MAX);
});

test('`raw` giữ trường gốc để đọc lại được, và chứa số loại tin', () => {
  const [item] = attachmentsOf(22, [attach({ type: 'share.file', action: 'send', extInfo: '{}' })]);
  assert.equal(item.raw?.msgType, 22);
  assert.equal(item.raw?.type, 'share.file');
  assert.equal(item.raw?.action, 'send');
});

test('ranh giới IPC bóc mọi URL xa; renderer không bao giờ thấy `.zadn.vn`', () => {
  const stored = attachmentsOf(3, [attach({ href: 'https://s120-talk.zadn.vn/a.jpg' })]);
  const wire = toIpcAttachments(stored);
  assert.ok(wire?.length);
  const serialized = JSON.stringify(wire);
  assert.ok(!serialized.includes('zadn.vn'), 'không chuỗi host nào sống sót');
  assert.ok(!serialized.includes('zdn.vn'));
  assert.equal(wire[0].src, null, 'chưa tải thì `src` là null, không phải chuỗi rỗng');
  assert.equal(wire[0].thumb, null);
});

test('ranh giới IPC giữ đường dẫn cục bộ và các trường hiển thị', () => {
  const [stored] = attachmentsOf(22, [attach({ title: 'báo cáo.pdf', params: '{"fileSize":1024}' })]);
  const wire = toIpcAttachments([{ ...stored, src: 'glass://app/media/m1.jpg', thumb: 'glass://app/media/m1t.jpg' }]);
  assert.equal(wire?.[0].src, 'glass://app/media/m1.jpg');
  assert.equal(wire?.[0].thumb, 'glass://app/media/m1t.jpg');
  assert.equal(wire?.[0].title, 'báo cáo.pdf');
  assert.equal(wire?.[0].size, 1024);
  assert.equal(wire?.[0].ext, 'pdf');
  assert.equal(toIpcAttachments([]), undefined, 'rỗng đi ra là `undefined`, không phải `[]`');
});

test('toIpcMessage chỉ bóc tệp, mọi trường khác giữ nguyên', () => {
  const message = {
    threadId: 'u-1', kind: 'user' as const, msgId: '9', clientId: null,
    from: 'them' as const, text: '', ts: 1, backfill: true, senderId: 'internal-id',
    attachments: attachmentsOf(3, [attach()]),
  };
  const wire = toIpcMessage(message);
  assert.equal(wire.text, '');
  assert.equal(wire.backfill, true);
  assert.equal(wire.attachments?.length, 1);
  assert.ok(!('senderId' in wire), 'sender identity key stays in main and is not exposed over IPC');
  assert.ok(!('remote' in (wire.attachments?.[0] ?? {})), 'không có `remote` trên dây');
});

test('keepLocalPaths giữ đường dẫn đã tải qua một lần đồng bộ lại', () => {
  const fresh = attachmentsOf(3, [attach()]);
  const stored: StoredAttachment[] = [{ ...fresh[0], src: 'glass://app/media/x.jpg', thumb: null }];
  const merged = keepLocalPaths(attachmentsOf(3, [attach()]), stored);
  assert.equal(merged[0].src, 'glass://app/media/x.jpg');
});

test('keepLocalPaths bỏ đường dẫn cũ khi dấu nhận dạng lệch — không trỏ vào sai nội dung', () => {
  const stored: StoredAttachment[] = [{
    ...attachmentsOf(3, [attach()])[0], src: 'glass://app/media/x.jpg', thumb: null,
  }];
  // Cùng vị trí nhưng khác URL: đây không phải cùng một tệp.
  const incoming = attachmentsOf(3, [attach({ href: 'https://s120-talk.zadn.vn/khac.jpg' })]);
  assert.equal(keepLocalPaths(incoming, stored)[0].src, null);
});

test('keepLocalPaths không dùng đường dẫn cũ cho tin không còn tệp', () => {
  const stored: StoredAttachment[] = [{
    ...attachmentsOf(3, [attach()])[0], src: 'glass://app/media/x.jpg', thumb: null,
  }];
  assert.equal(keepLocalPaths(attachmentsOf(1, [attach()]), stored).length, 0);
});

test('mọi loại đều có nhãn hiển thị — một loại mới không được ra chuỗi rỗng', () => {
  for (const kind of ['photo', 'video', 'voice', 'sticker', 'doodle', 'file', 'link',
    'location', 'contact', 'gif', 'other'] as const) {
    assert.ok(ATTACHMENT_LABELS[kind]?.trim(), kind);
  }
});

test('Sync V2 sticker ID survives persistence so cached stickers can resolve their image', () => {
  const item = attachmentsOf(10, [{ type: '7', id: 45417, catId: 11906 }])[0];
  const restored = JSON.parse(JSON.stringify(item));
  assert.equal(restored.raw.id, 45417);
  assert.equal(restored.raw.catId, 11906);
});

 test('file metadata falls back to params filename and extension', () => {
  const [file] = attachmentsOf('chat.file', [{ href: 'https://f6-group-zf.zdn.vn/opaque', params: JSON.stringify({ fileName: 'Báo cáo.PDF', fileSize: 1234 }) }]);
  assert.equal(file.title, 'Báo cáo.PDF');
  assert.equal(file.ext, 'pdf');
  assert.equal(file.size, 1234);
});
