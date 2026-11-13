import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LiveMessage, LiveThread } from '../electron/ipc-contract.ts';
import { openDb, SCHEMA_VERSION, type Db } from '../electron/db/schema.ts';
import {
  compareMsgId, countMessages, insertPending, listThreads, markFailed, markRecalled, messageAttachments,
  pageMessages, readCatchUpCursor, readSyncState, setMessageMedia, updateMessageSenderNames,
  upsertMessages, upsertThreads,
  writeCatchUpCursor, writeSyncState,
} from '../electron/db/messages.ts';
import type { StoreMessage, StoredAttachment } from '../electron/protocol/attachment.ts';

/** DB thật trong thư mục tạm: `node:sqlite` chạy được bằng node thường, nên không cần mock. */
function scratch(): { db: Db; done: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'glass-db-'));
  const db = openDb(dir, 'acc-1');
  return { db, done: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

const msg = (over: Partial<LiveMessage> = {}): LiveMessage => ({
  threadId: 'u-1', kind: 'user', msgId: '1000', clientId: null,
  from: 'them', text: 'Chào', ts: 1_700_000_000_000, ...over,
});

const thread = (over: Partial<LiveThread> = {}): LiveThread => ({
  id: 'u-1', kind: 'user', name: 'Minh Anh', avatar: null,
  pinned: false, unread: 0, lastText: 'Chào', lastTs: 1_700_000_000_000, ...over,
});

test('mở DB lần đầu tạo schema ở phiên bản hiện tại, mở lại không đổi gì', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'glass-db-'));
  try {
    const first = openDb(dir, 'acc-1');
    assert.equal(SCHEMA_VERSION, 5);
    const rows = first.handle.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[];
    assert.deepEqual(rows.map(r => r.name), ['contacts', 'kv', 'messages', 'sync_state', 'threads']);
    first.close();
    // Mở lại: không lỗi "table already exists", dữ liệu còn nguyên.
    const again = openDb(dir, 'acc-1');
    again.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('nâng DB schema v3 lên v5 để lưu tên người gửi và mentions', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'glass-db-'));
  try {
    const old = openDb(dir, 'acc-1');
    old.handle.exec('ALTER TABLE messages DROP COLUMN sender_name');
    old.handle.exec('ALTER TABLE messages DROP COLUMN mentions_json');
    old.handle.prepare("UPDATE kv SET value = '3' WHERE key = 'schema_version'").run();
    old.close();

    const upgraded = openDb(dir, 'acc-1');
    const columns = upgraded.handle.prepare('PRAGMA table_info(messages)').all() as { name: string }[];
    assert.ok(columns.some(column => column.name === 'sender_name'));
    assert.ok(columns.some(column => column.name === 'mentions_json'));
    assert.equal(upgraded.handle.prepare("SELECT value FROM kv WHERE key = 'schema_version'")
      .get()?.value, '5');
    upgraded.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('hai tài khoản khác nhau ghi hai file DB khác nhau', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'glass-db-'));
  try {
    const a = openDb(dir, 'acc-a');
    const b = openDb(dir, 'acc-b');
    assert.notEqual(a.path, b.path);
    upsertThreads(a, [thread()]);
    assert.equal(listThreads(b).length, 0, 'dữ liệu tài khoản này không được lộ sang tài khoản kia');
    a.close(); b.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('id tài khoản chứa "/" hay ".." không ghi ra ngoài thư mục dữ liệu', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'glass-db-'));
  try {
    const db = openDb(dir, '../../etc/passwd');
    assert.equal(path.dirname(db.path), dir, 'file phải nằm trong dataRoot');
    assert.match(path.basename(db.path), /^cache-[a-zA-Z0-9_-]*\.db$/);
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('upsert idempotent: cùng tin đến từ realtime rồi backfill chỉ một dòng', () => {
  const s = scratch();
  try {
    const first = upsertMessages(s.db, 'u-1', [msg()]);
    assert.equal(first.written, 1);
    const second = upsertMessages(s.db, 'u-1', [msg()]);
    assert.equal(second.written, 0, 'nội dung giống hệt thì không ghi lại');
    assert.equal(second.unchanged, 1);
    assert.equal(countMessages(s.db, 'u-1'), 1);
  } finally { s.done(); }
});

test('lưu senderId nội bộ và backfill tên khi resolve được globalId', () => {
  const s = scratch();
  try {
    upsertThreads(s.db, [thread({ kind: 'group', id: 'g-1' })]);
    upsertMessages(s.db, 'g-1', [{
      ...msg({ threadId: 'g-1', kind: 'group' }), senderId: 'noised-member-1',
    }]);
    assert.equal(updateMessageSenderNames(s.db, 'g-1',
      new Map([['noised-member-1', 'Mai Anh']])), 1);
    const saved = pageMessages(s.db, 'g-1', 'group', 10).messages[0];
    assert.equal(saved.senderId, 'noised-member-1');
    assert.equal(saved.fromName, 'Mai Anh');

    upsertMessages(s.db, 'g-1', [msg({ threadId: 'g-1', kind: 'group' })]);
    assert.equal(pageMessages(s.db, 'g-1', 'group', 10).messages[0].senderId, 'noised-member-1',
      'bản đồng bộ thiếu senderId không được xoá giá trị đã biết');
  } finally { s.done(); }
});

test('server thắng khi cùng msgId mà nội dung khác', () => {
  const s = scratch();
  try {
    upsertMessages(s.db, 'u-1', [msg({ text: 'bản cũ' })]);
    upsertMessages(s.db, 'u-1', [msg({ text: 'bản server' })]);
    const page = pageMessages(s.db, 'u-1', 'user', 10);
    assert.equal(page.messages[0].text, 'bản server');
    assert.equal(countMessages(s.db, 'u-1'), 1);
  } finally { s.done(); }
});

test('tên người gửi nhóm được lưu trong cache và không bị mất khi đồng bộ lại', () => {
  const s = scratch();
  try {
    const groupMessage = msg({ threadId: 'g-1', kind: 'group', fromName: '  Mai  ' });
    upsertMessages(s.db, 'g-1', [groupMessage]);
    upsertMessages(s.db, 'g-1', [msg({
      threadId: 'g-1', kind: 'group', text: groupMessage.text,
    })]);
    const page = pageMessages(s.db, 'g-1', 'group', 10);
    assert.equal(page.messages[0].fromName, 'Mai');
  } finally { s.done(); }
});

test('mention ranges persist, update when learned later, and never store a UID', () => {
  const s = scratch();
  try {
    const text = '😀 @Mai';
    const original = msg({ text, mentions: [{ pos: 3, len: 4 }] });
    upsertMessages(s.db, 'u-1', [original]);
    assert.deepEqual(pageMessages(s.db, 'u-1', 'user', 10).messages[0].mentions, [{ pos: 3, len: 4 }]);

    const enriched = upsertMessages(s.db, 'u-1', [msg({ text, mentions: [{ pos: 4, len: 3 }] })]);
    assert.equal(enriched.written, 1, 'metadata khác phải được ghi dù text không đổi');
    assert.deepEqual(pageMessages(s.db, 'u-1', 'user', 10).messages[0].mentions, [{ pos: 4, len: 3 }]);

    const noMetadata = upsertMessages(s.db, 'u-1', [msg({ text })]);
    assert.equal(noMetadata.unchanged, 1);
    assert.deepEqual(pageMessages(s.db, 'u-1', 'user', 10).messages[0].mentions, [{ pos: 4, len: 3 }]);
    const raw = s.db.handle.prepare('SELECT mentions_json FROM messages WHERE thread_id = ? AND msg_id = ?')
      .get('u-1', '1000') as { mentions_json: string };
    assert.equal(raw.mentions_json.includes('uid'), false);
  } finally { s.done(); }
});

test('tin lạc quan được gộp vào tin thật qua clientId, không thành hai bong bóng', () => {
  const s = scratch();
  try {
    insertPending(s.db, { ...msg({ msgId: null, clientId: 'c-9', from: 'me', text: 'đang gửi' }) } as never);
    assert.equal(countMessages(s.db, 'u-1'), 1);
    const result = upsertMessages(s.db, 'u-1', [msg({ msgId: '2000', clientId: 'c-9', from: 'me', text: 'đang gửi' })]);
    assert.equal(result.merged, 1);
    assert.equal(countMessages(s.db, 'u-1'), 1, 'dòng tạm bị thay, không thêm dòng mới');
    const page = pageMessages(s.db, 'u-1', 'user', 10);
    assert.equal(page.messages[0].msgId, '2000');
    assert.equal(page.messages[0].clientId, 'c-9');
  } finally { s.done(); }
});

test('gửi hỏng được đánh dấu failed và vẫn còn sau khi mở lại', () => {
  const s = scratch();
  try {
    insertPending(s.db, { ...msg({ msgId: null, clientId: 'c-1', from: 'me' }) } as never);
    markFailed(s.db, 'u-1', 'c-1');
    const row = s.db.handle.prepare("SELECT status FROM messages WHERE client_id = 'c-1'").get() as { status: string };
    assert.equal(row.status, 'failed');
  } finally { s.done(); }
});

test('sắp xếp theo ts server, không theo thứ tự đến', () => {
  const s = scratch();
  try {
    // Đến ngược thứ tự thời gian (plan §6.10 "Tin đến không đúng thứ tự").
    upsertMessages(s.db, 'u-1', [msg({ msgId: '3', ts: 3000 })]);
    upsertMessages(s.db, 'u-1', [msg({ msgId: '1', ts: 1000 })]);
    upsertMessages(s.db, 'u-1', [msg({ msgId: '2', ts: 2000 })]);
    const page = pageMessages(s.db, 'u-1', 'user', 10);
    assert.deepEqual(page.messages.map(m => m.msgId), ['1', '2', '3']);
  } finally { s.done(); }
});

test('msgId là chuỗi số dài: so bằng BigInt, không mất chữ số cuối', () => {
  // Hai id chỉ khác nhau ở chữ số cuối — `Number` gộp chúng thành bằng nhau.
  const a = '9007199254740993';
  const b = '9007199254740992';
  assert.equal(compareMsgId(a, b), 1);
  assert.equal(compareMsgId(b, a), -1);
  assert.equal(compareMsgId(a, a), 0);
  assert.equal(compareMsgId('9', '10'), -1, 'so chuỗi sẽ sai ở đây');
  assert.equal(compareMsgId('abc', 'abd'), -1, 'id không phải số thì so chuỗi');
});

test('con trỏ catch-up chỉ dùng và lưu ID máy chủ dạng số', () => {
  const s = scratch();
  try {
    upsertThreads(s.db, [thread()]);
    upsertMessages(s.db, 'u-1', [
      msg({ msgId: '9007199254740993', ts: 1_700_000_001_000 }),
      msg({ msgId: 'syncv2:1700000002000:0', ts: 1_700_000_002_000 }),
    ]);
    assert.equal(readCatchUpCursor(s.db), '9007199254740993',
      'ID Sync V2 cục bộ không được thắng ID máy chủ khi tìm mốc dự phòng');

    s.db.handle.prepare('INSERT INTO kv (key, value) VALUES (?, ?)').run('catchup_user_msg_id', 'syncv2:1700000003000:0');
    assert.equal(readCatchUpCursor(s.db), '9007199254740993',
      'con trỏ cục bộ cũ phải bị bỏ qua');

    writeCatchUpCursor(s.db, 'syncv2:1700000004000:0');
    assert.equal(readCatchUpCursor(s.db), '9007199254740993',
      'không được ghi con trỏ không phải ID máy chủ');
    writeCatchUpCursor(s.db, '9007199254740993');
    const stored = s.db.handle.prepare('SELECT value FROM kv WHERE key = ?').get('catchup_user_msg_id') as
      { value: string };
    assert.equal(stored.value, '9007199254740993',
      'mốc dự phòng phải được ghi ngay cả khi nó bằng ID lớn nhất trong cache');
    writeCatchUpCursor(s.db, '9007199254740994');
    assert.equal(readCatchUpCursor(s.db), '9007199254740994');
  } finally { s.done(); }
});

test('con trỏ catch-up của nhóm được tách khỏi con trỏ 1-1', () => {
  const s = scratch();
  try {
    upsertThreads(s.db, [thread({ id: 'g-1', kind: 'group' })]);
    upsertMessages(s.db, 'g-1', [
      msg({ threadId: 'g-1', kind: 'group', msgId: '9007199254740995', ts: 1_700_000_005_000 }),
      msg({ threadId: 'g-1', kind: 'group', msgId: 'syncv2:1700000006000:0', ts: 1_700_000_006_000 }),
    ]);
    assert.equal(readCatchUpCursor(s.db, 'group'), '9007199254740995');
    assert.equal(readCatchUpCursor(s.db, 'user'), null);
    writeCatchUpCursor(s.db, '9007199254740997', 'group');
    assert.equal(readCatchUpCursor(s.db, 'group'), '9007199254740997');
    assert.equal(readCatchUpCursor(s.db, 'user'), null);
  } finally { s.done(); }
});

test('phân trang: before lọc đúng tin cũ hơn, hasMore phản ánh phần còn lại', () => {
  const s = scratch();
  try {
    upsertMessages(s.db, 'u-1', [1, 2, 3, 4, 5].map(n => msg({ msgId: String(n), ts: n * 1000 })));
    const firstPage = pageMessages(s.db, 'u-1', 'user', 2);
    assert.deepEqual(firstPage.messages.map(m => m.msgId), ['4', '5'], 'trang mới nhất, cũ trước');
    assert.equal(firstPage.hasMore, true);
    const older = pageMessages(s.db, 'u-1', 'user', 2, '4');
    assert.deepEqual(older.messages.map(m => m.msgId), ['2', '3']);
    assert.equal(older.hasMore, true);
    const oldest = pageMessages(s.db, 'u-1', 'user', 2, '2');
    assert.deepEqual(oldest.messages.map(m => m.msgId), ['1']);
    assert.equal(oldest.hasMore, false);
  } finally { s.done(); }
});

test('hội thoại trống không tạo trang giả', () => {
  const s = scratch();
  try {
    const page = pageMessages(s.db, 'u-404', 'user', 20);
    assert.deepEqual(page.messages, []);
    assert.equal(page.hasMore, false);
  } finally { s.done(); }
});

test('tin chưa có msgId server không vào DB', () => {
  const s = scratch();
  try {
    const result = upsertMessages(s.db, 'u-1', [
      msg({ msgId: null, clientId: 'x' }), msg({ msgId: '7' }),
    ]);
    assert.equal(result.written, 1);
    assert.equal(countMessages(s.db, 'u-1'), 1);
  } finally { s.done(); }
});

test('một tin hỏng giữa lô thì cả lô không ghi (transaction)', () => {
  const s = scratch();
  try {
    // `kind` sai làm CHECK constraint nổ ở bảng threads, không liên quan tới
    // messages — nên dùng chính ràng buộc của messages: status ngoài bảng.
    assert.throws(() => s.db.handle.prepare(
      "INSERT INTO messages (thread_id, msg_id, sender_id, from_me, ts, status) VALUES ('u-1','9','',0,1,'bogus')").run(),
    /CHECK|constraint/i);
    assert.equal(countMessages(s.db, 'u-1'), 0);
  } finally { s.done(); }
});

test('upsertThreads giữ preview mới nhất, không bị trang lịch sử cũ kéo lùi', () => {
  const s = scratch();
  try {
    upsertThreads(s.db, [thread({ lastTs: 5000, lastText: 'mới' })]);
    upsertThreads(s.db, [thread({ lastTs: 1000, lastText: 'cũ' })]);
    const [row] = listThreads(s.db);
    assert.equal(row.lastTs, 5000);
    assert.equal(row.lastText, 'mới');
  } finally { s.done(); }
});

test('listThreads xếp ghim trước rồi tới mới nhất', () => {
  const s = scratch();
  try {
    upsertThreads(s.db, [
      thread({ id: 'a', lastTs: 3000 }),
      thread({ id: 'b', lastTs: 1000, pinned: true }),
      thread({ id: 'c', lastTs: 2000 }),
    ]);
    assert.deepEqual(listThreads(s.db).map(t => t.id), ['b', 'a', 'c']);
  } finally { s.done(); }
});

test('tên hội thoại trống vẫn có nhãn đọc được', () => {
  const s = scratch();
  try {
    upsertThreads(s.db, [thread({ id: 'g-1', kind: 'group', name: '' })]);
    assert.equal(listThreads(s.db)[0].name, 'Nhóm Zalo');
  } finally { s.done(); }
});

test('nhãn mặc định không đè lên tên thật — theo cả hai chiều', () => {
  // Đo 2026-11-10: 81/250 hội thoại mang "Người dùng Zalo"/"Nhóm Zalo" dù tên
  // đã có. Đồng bộ lịch sử tạo thread trước khi danh sách bạn bè về, rồi mỗi
  // lần ghi sau lại đưa nhãn mặc định vào `excluded.title` và đè ngược.
  const s = scratch();
  try {
    upsertThreads(s.db, [thread({ id: 'u-1', kind: 'user', name: 'Đức Tú' })]);
    upsertThreads(s.db, [thread({ id: 'u-1', kind: 'user', name: 'Người dùng Zalo' })]);
    assert.equal(listThreads(s.db)[0].name, 'Đức Tú', 'nhãn mặc định không được thay tên');

    upsertThreads(s.db, [thread({ id: 'u-2', kind: 'user', name: 'Người dùng Zalo' })]);
    upsertThreads(s.db, [thread({ id: 'u-2', kind: 'user', name: 'Kim Dung' })]);
    assert.equal(
      listThreads(s.db).find(t => t.id === 'u-2')?.name, 'Kim Dung', 'tên thật phải nâng cấp được');
  } finally { s.done(); }
});

test('mốc đồng bộ: mốc cũ chỉ lùi, mốc mới chỉ tiến', () => {
  const s = scratch();
  try {
    writeSyncState(s.db, 'u-1', { lastSyncedMsgId: '100', oldestLoadedMsgId: '50' });
    // Một trang cũ không được kéo mốc catch-up lùi về quá khứ.
    writeSyncState(s.db, 'u-1', { lastSyncedMsgId: '40', oldestLoadedMsgId: '10' });
    const state = readSyncState(s.db, 'u-1');
    assert.equal(state.lastSyncedMsgId, '100', 'mốc mới nhất không được lùi');
    assert.equal(state.oldestLoadedMsgId, '10', 'mốc cũ nhất phải lùi khi tải thêm tin cũ');
  } finally { s.done(); }
});

test('mốc đồng bộ mặc định: chưa đồng bộ, còn tin cũ để tải', () => {
  const s = scratch();
  try {
    assert.deepEqual(readSyncState(s.db, 'u-404'), {
      lastSyncedMsgId: null, oldestLoadedMsgId: null, hasMoreOlder: true, lastFullSyncAt: null,
    });
  } finally { s.done(); }
});

test('bấm "Gửi lại" đưa dòng đã failed về sending, không tạo thêm dòng', () => {
  const s = scratch();
  try {
    insertPending(s.db, { ...msg({ msgId: null, clientId: 'c-retry', from: 'me' }) } as never);
    markFailed(s.db, 'u-1', 'c-retry');
    insertPending(s.db, { ...msg({ msgId: null, clientId: 'c-retry', from: 'me', ts: 1_700_000_009_000 }) } as never);
    const rows = s.db.handle.prepare(
      "SELECT status, ts FROM messages WHERE client_id = 'c-retry'").all() as { status: string; ts: number }[];
    assert.equal(rows.length, 1, 'cùng clientId chỉ một bong bóng');
    assert.equal(rows[0].status, 'sending', 'phải gửi lại được, không kẹt ở failed');
    assert.equal(rows[0].ts, 1_700_000_009_000, 'ts là lần gửi mới nhất');
  } finally { s.done(); }
});

test('gửi lại sau khi đã gộp vào tin thật không tạo bong bóng tạm thứ hai', () => {
  const s = scratch();
  try {
    insertPending(s.db, { ...msg({ msgId: null, clientId: 'c-1', from: 'me' }) } as never);
    upsertMessages(s.db, 'u-1', [msg({ msgId: '500', clientId: 'c-1', from: 'me' })]);
    // Bấm "Gửi lại" trên một dòng đã có id server (UI cũ, hoặc gọi hai lần).
    insertPending(s.db, { ...msg({ msgId: null, clientId: 'c-1', from: 'me' }) } as never);
    assert.equal(countMessages(s.db, 'u-1'), 1, 'unique index (thread_id, client_id) không bị đụng');
    const page = pageMessages(s.db, 'u-1', 'user', 10);
    assert.deepEqual(page.messages.map(m => m.msgId), ['500']);
  } finally { s.done(); }
});

test('bong bóng chưa gửi không chiếm suất của trang lịch sử', () => {
  const s = scratch();
  try {
    upsertMessages(s.db, 'u-1', [1, 2, 3].map(n => msg({ msgId: String(n), ts: n * 1000 })));
    insertPending(s.db, { ...msg({ msgId: null, clientId: 'c-x', from: 'me', ts: 9000 }) } as never);
    const page = pageMessages(s.db, 'u-1', 'user', 2);
    // Lọc `pending:` sau khi lấy thì trang chỉ còn một tin và `hasMore` sai.
    assert.deepEqual(page.messages.map(m => m.msgId), ['2', '3']);
    assert.equal(page.hasMore, true);
    const all = pageMessages(s.db, 'u-1', 'user', 5);
    assert.deepEqual(all.messages.map(m => m.msgId), ['1', '2', '3'], 'tin tạm không lọt vào trang lịch sử');
    assert.equal(all.hasMore, false);
  } finally { s.done(); }
});

test('tin đã thu hồi giữ dòng nhưng mất nội dung, và trang cũ không hồi sinh nó', () => {
  const s = scratch();
  try {
    upsertMessages(s.db, 'u-1', [msg({ msgId: '1', text: 'nội dung gốc' })]);
    assert.equal(markRecalled(s.db, 'u-1', '1').found, true);
    // Một trang lịch sử cũ vẫn còn nội dung trước khi thu hồi.
    const result = upsertMessages(s.db, 'u-1', [msg({ msgId: '1', text: 'nội dung gốc' })]);
    assert.equal(result.unchanged, 1);
    const page = pageMessages(s.db, 'u-1', 'user', 10);
    assert.equal(page.messages.length, 1, 'dòng được giữ, không xoá');
    assert.equal(page.messages[0].text, '', 'nội dung không được hồi sinh');
    assert.equal(page.messages[0].recalled, true, 'UI cần cờ này để hiện "đã thu hồi"');
  } finally { s.done(); }
});

test('thu hồi một tin chưa có trong cache: không tạo dòng, báo found=false', () => {
  const s = scratch();
  try {
    const result = markRecalled(s.db, 'u-1', '999');
    assert.equal(result.found, false);
    // Tạo một dòng chỉ có `msg_id` sẽ đặt bong bóng "đã thu hồi" vào chỗ không có
    // tin nào, và id đó chưa từng được máy chủ xác nhận.
    assert.equal(countMessages(s.db, 'u-1'), 0);
  } finally { s.done(); }
});

test('thu hồi lần hai vẫn báo found=true, không phải "mất dòng"', () => {
  const s = scratch();
  try {
    upsertMessages(s.db, 'u-1', [msg({ msgId: '7', text: 'xin chào' })]);
    assert.equal(markRecalled(s.db, 'u-1', '7').found, true);
    // Câu UPDATE vẫn khớp nhưng không đổi gì (`changes = 0`); dựa vào `changes`
    // sẽ biến lần thu hồi lặp lại thành "không thấy tin" và ghi nhầm vào bộ nhớ.
    const again = markRecalled(s.db, 'u-1', '7');
    assert.equal(again.found, true);
    assert.equal(again.ts, 1_700_000_000_000, 'giữ nguyên ts gốc để bong bóng không nhảy chỗ');
  } finally { s.done(); }
});

test('thu hồi gộp đúng bong bóng tạm đã gửi, không để lại hai dòng', () => {
  const s = scratch();
  try {
    insertPending(s.db, { ...msg({ msgId: null, clientId: 'c-1', from: 'me', text: 'tạm' }), clientId: 'c-1' });
    upsertMessages(s.db, 'u-1', [msg({ msgId: '42', clientId: 'c-1', from: 'me', text: 'tạm' })]);
    assert.equal(markRecalled(s.db, 'u-1', '42').found, true);
    const page = pageMessages(s.db, 'u-1', 'user', 10);
    assert.equal(page.messages.length, 1);
    assert.equal(page.messages[0].clientId, 'c-1', 'vẫn là tin của mình');
    assert.equal(page.messages[0].recalled, true);
    assert.equal(page.messages[0].text, '');
  } finally { s.done(); }
});

const photo = (over: Partial<StoredAttachment> = {}): StoredAttachment => ({
  kind: 'photo', remote: 'https://s120-talk.zadn.vn/a.jpg', src: null, thumb: null, ...over,
});

const media = (attachments: StoredAttachment[], over: Partial<LiveMessage> = {}): StoreMessage =>
  ({ ...msg(over), attachments }) as StoreMessage;

test('tin chỉ có tệp vẫn ghi được và đọc lại đúng — cột `attachments`, không phải `text`', () => {
  const s = scratch();
  try {
    // Đo 2026-11-11: 0/211 283 hàng có `attachments` vì đường ghi bỏ qua cột này
    // hoặc coi tin "không đổi" vì `text` rỗng ở cả hai lần.
    const written = upsertMessages(s.db, 'u-1', [media([photo()], { msgId: '5', text: '' })]);
    assert.equal(written.written, 1);
    const page = pageMessages(s.db, 'u-1', 'user', 10);
    assert.equal(page.messages[0].text, '');
    assert.equal(page.messages[0].attachments?.[0].kind, 'photo');
    assert.equal(page.messages[0].attachments?.[0].remote, 'https://s120-talk.zadn.vn/a.jpg');
  } finally { s.done(); }
});

test('lần ghi thứ hai cùng tệp là "không đổi", không đánh dấu lại', () => {
  const s = scratch();
  try {
    upsertMessages(s.db, 'u-1', [media([photo()], { msgId: '5', text: '' })]);
    const again = upsertMessages(s.db, 'u-1', [media([photo()], { msgId: '5', text: '' })]);
    assert.equal(again.unchanged, 1);
    assert.equal(again.written, 0);
  } finally { s.done(); }
});

test('đồng bộ lại không xoá đường dẫn đã tải, nhưng URL khác thì bỏ đường dẫn cũ', () => {
  const s = scratch();
  try {
    upsertMessages(s.db, 'u-1', [media([photo()], { msgId: '5', text: '' })]);
    assert.ok(setMessageMedia(s.db, 'u-1', '5', new Map([[0, { src: 'glass://app/media/m1.jpg', thumb: null }]])));

    // Cùng tệp quay lại từ một lần đồng bộ: mapper không biết gì về đĩa nên nó
    // gửi `src: null`, và ghi thẳng xuống là mọi ảnh đã tải biến mất.
    upsertMessages(s.db, 'u-1', [media([photo()], { msgId: '5', text: '' })]);
    assert.equal(messageAttachments(s.db, 'u-1', '5')[0].src, 'glass://app/media/m1.jpg');

    // URL khác ở cùng vị trí: đây không phải cùng một tệp, nên đường dẫn cũ chỉ
    // vào sai nội dung.
    upsertMessages(s.db, 'u-1', [media([photo({ remote: 'https://s120-talk.zadn.vn/b.jpg' })], { msgId: '5' })]);
    assert.equal(messageAttachments(s.db, 'u-1', '5')[0].src, null);
  } finally { s.done(); }
});

test('`setMessageMedia` từ chối tin thu hồi, tin không có tệp, và không ghi lặp', () => {
  const s = scratch();
  const patch = new Map([[0, { src: 'glass://app/media/m1.jpg', thumb: null }]]);
  try {
    upsertMessages(s.db, 'u-1', [media([photo()], { msgId: '5' })]);
    assert.ok(setMessageMedia(s.db, 'u-1', '5', patch));
    assert.equal(setMessageMedia(s.db, 'u-1', '5', patch), undefined, 'cùng đường dẫn thì không có gì mới');
    assert.equal(setMessageMedia(s.db, 'u-1', '999', patch), undefined, 'tin không có trong cache');
    upsertMessages(s.db, 'u-1', [msg({ msgId: '6', text: 'chữ' })]);
    assert.equal(setMessageMedia(s.db, 'u-1', '6', patch), undefined, 'tin chỉ có chữ');
    markRecalled(s.db, 'u-1', '5');
    assert.equal(setMessageMedia(s.db, 'u-1', '5', patch), undefined, 'tin đã thu hồi');
  } finally { s.done(); }
});

test('tệp đi kèm tin tạm rồi gộp vào tin thật vẫn còn tệp', () => {
  const s = scratch();
  try {
    // Tin thật tới sau bong bóng tạm phải mang theo nội dung; bản trước bỏ cột
    // `attachments` ở nhánh gộp nên một ảnh gửi kèm chữ sẽ mất ảnh.
    insertPending(s.db, { ...msg({ msgId: null, clientId: 'c-9', from: 'me', text: '' }), clientId: 'c-9' });
    upsertMessages(s.db, 'u-1', [media([photo()], { msgId: '77', clientId: 'c-9', from: 'me', text: '' })]);
    assert.equal(countMessages(s.db, 'u-1'), 1);
    assert.equal(messageAttachments(s.db, 'u-1', '77')[0].kind, 'photo');
  } finally { s.done(); }
});
