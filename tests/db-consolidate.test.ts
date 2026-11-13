import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb, type Db } from '../electron/db/schema.ts';
import { consolidateNoisedThreads, isNoisedId } from '../electron/db/consolidate.ts';

/**
 * Dọn hội thoại còn mang id nhiễu — di sản của lỗi hai không gian id (xem
 * `electron/db/consolidate.ts`). Đây là thao tác **xoá dữ liệu thật**, nên các
 * test dưới đây không kiểm "có chạy không" mà kiểm đúng ba điều kiện an toàn:
 * chỉ động vào id có trong bảng, tin chưa có bản sao thì chuyển chứ không xoá,
 * và cặp tin của nhóm vẫn được ánh xạ đúng.
 */

const UID = '188436612101457701';
const NOISED = 'zNoisedUser0000000000000000000000';
const GROUP_UID = '5566778899';
const GROUP_NOISED = 'zNoisedGroup000000000000000000000';
const STRANGER_NOISED = 'zNguoiLa0000000000000000000000000';

const withDb = (fn: (db: Db) => void) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'consolidate-'));
  const db = openDb(path.join(dir, 'cache.db'));
  try {
    fn(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
};

const addThread = (db: Db, id: string, kind: 'user' | 'group', title: string | null) => {
  db.handle.prepare(
    `INSERT INTO threads (id, kind, title, avatar_url, last_ts, last_preview, unread, muted, pinned, updated_at)
     VALUES (?, ?, ?, NULL, 0, '', 0, 0, 0, 0)`).run(id, kind, title);
};

const addMessage = (db: Db, threadId: string, msgId: string, senderId: string, fromMe = 0) => {
  db.handle.prepare(
    `INSERT INTO messages (thread_id, msg_id, sender_id, from_me, ts, text)
     VALUES (?, ?, ?, ?, 1700000000000, 'x')`).run(threadId, msgId, senderId, fromMe);
};

const countMessagesIn = (db: Db, threadId: string): number =>
  Number((db.handle.prepare('SELECT count(*) n FROM messages WHERE thread_id = ?')
    .get(threadId) as unknown as { n: number }).n);

const hasThread = (db: Db, id: string): boolean =>
  db.handle.prepare('SELECT 1 FROM threads WHERE id = ?').get(id) !== undefined;

test('id nhiễu là base62; uid và groupId là chuỗi số', () => {
  assert.equal(isNoisedId(NOISED), true);
  assert.equal(isNoisedId(UID), false);
  assert.equal(isNoisedId(GROUP_UID), false);
  assert.equal(isNoisedId(''), false);
});

test('tin trùng bị bỏ, tin chỉ có dưới id nhiễu được chuyển về uid', () => {
  withDb(db => {
    addThread(db, UID, 'user', 'An');
    addThread(db, NOISED, 'user', null);
    addMessage(db, UID, 'm-1', UID);
    addMessage(db, NOISED, 'm-1', NOISED);   // bản sao — phải bỏ
    addMessage(db, NOISED, 'm-2', NOISED);   // chỉ có ở đây — phải chuyển

    const result = consolidateNoisedThreads(db, new Map([[NOISED, UID]]));

    assert.equal(result.duplicatesDropped, 1);
    assert.equal(result.messagesMoved, 1);
    assert.equal(result.threadsMerged, 1);
    assert.equal(countMessagesIn(db, NOISED), 0);
    assert.equal(countMessagesIn(db, UID), 2, 'm-1 còn một bản, m-2 đã về đúng chỗ');
    assert.equal(hasThread(db, NOISED), false);
    assert.equal(hasThread(db, UID), true);
  });
});

/**
 * Thứ tự xoá-trước-chuyển-sau là điều kiện sống còn. Bản đầu của hàm này chuyển
 * trước rồi mới xoá trùng, và như vậy mọi tin **chỉ** có dưới id nhiễu vừa
 * chuyển xong lại khớp chính nó ở bước xoá → xoá sạch lịch sử. Test giữ đúng
 * thứ tự đó.
 */
test('không xoá mất tin chỉ tồn tại dưới id nhiễu', () => {
  withDb(db => {
    addThread(db, UID, 'user', 'An');
    addThread(db, NOISED, 'user', null);
    addMessage(db, NOISED, 'm-1', NOISED);
    addMessage(db, NOISED, 'm-2', NOISED);
    addMessage(db, NOISED, 'm-3', NOISED);

    const result = consolidateNoisedThreads(db, new Map([[NOISED, UID]]));

    assert.equal(result.duplicatesDropped, 0);
    assert.equal(result.messagesMoved, 3);
    assert.equal(countMessagesIn(db, UID), 3);
  });
});

test('id nhiễu không có trong bảng thì để nguyên — đó là người lạ, không phải ta đoán', () => {
  withDb(db => {
    addThread(db, STRANGER_NOISED, 'user', null);
    addMessage(db, STRANGER_NOISED, 'm-9', STRANGER_NOISED);

    const result = consolidateNoisedThreads(db, new Map([[NOISED, UID]]));

    assert.equal(result.threadsLeftAlone, 1);
    assert.equal(result.threadsMerged, 0);
    assert.equal(countMessagesIn(db, STRANGER_NOISED), 1);
    assert.equal(hasThread(db, STRANGER_NOISED), true);
  });
});

/**
 * `sender_id` của tin nhóm là id nhiễu của **thành viên**, không phải của nhóm —
 * `partition` mang id nhóm, còn từng tin mang id người gửi. Vì vậy việc đổi
 * `sender_id` phải tra theo **cả bảng**, không theo cặp hội thoại đang gộp.
 */
test('sender_id của thành viên trong nhóm cũng được ánh xạ', () => {
  withDb(db => {
    addThread(db, GROUP_UID, 'group', 'Nhóm kín');
    addThread(db, GROUP_NOISED, 'group', null);
    // Tin của thành viên: sender là id nhiễu của **người**, hội thoại là nhóm.
    addMessage(db, GROUP_NOISED, 'g-1', NOISED);

    const result = consolidateNoisedThreads(db, new Map([
      [GROUP_NOISED, GROUP_UID], [NOISED, UID],
    ]));

    assert.equal(result.messagesMoved, 1);
    const row = db.handle.prepare('SELECT thread_id, sender_id FROM messages WHERE msg_id = ?')
      .get('g-1') as unknown as { thread_id: string; sender_id: string };
    assert.equal(row.thread_id, GROUP_UID);
    assert.equal(row.sender_id, UID, 'id nhiễu của người gửi phải thành uid của họ');
  });
});

test('sync_state được dồn, không để lại hàng mồ côi', () => {
  withDb(db => {
    addThread(db, UID, 'user', 'An');
    addThread(db, NOISED, 'user', null);
    db.handle.prepare('INSERT INTO sync_state (thread_id, has_more_older) VALUES (?, 1)').run(NOISED);

    consolidateNoisedThreads(db, new Map([[NOISED, UID]]));

    const rows = db.handle.prepare('SELECT thread_id FROM sync_state').all() as unknown as Array<{ thread_id: string }>;
    assert.deepEqual(rows.map(r => r.thread_id), [UID]);
  });
});

test('chạy hai lần không đổi gì thêm — dọn phải idempotent', () => {
  withDb(db => {
    addThread(db, UID, 'user', 'An');
    addThread(db, NOISED, 'user', null);
    addMessage(db, UID, 'm-1', UID);
    addMessage(db, NOISED, 'm-1', NOISED);
    addMessage(db, NOISED, 'm-2', NOISED);
    const ids = new Map([[NOISED, UID]]);

    consolidateNoisedThreads(db, ids);
    const second = consolidateNoisedThreads(db, ids);

    assert.deepEqual(second, { threadsMerged: 0, messagesMoved: 0, duplicatesDropped: 0, threadsLeftAlone: 0 });
    assert.equal(countMessagesIn(db, UID), 2);
  });
});
