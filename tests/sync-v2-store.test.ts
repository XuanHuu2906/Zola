import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

const {
  loadConversations, mergeConversations, rememberOpenSession, forgetOpenSession,
  listOpenSessions, CONVERSATIONS_KV_KEY, OPEN_SESSION_KV_PREFIX,
  hasCompletedPhoneSync, isPhoneSyncSetupRequired, markPhoneSyncComplete,
} = await import('../electron/protocol/sync-v2-store.ts');
const { openDb } = await import('../electron/db/schema.ts');

test('legacy cache skips setup without pretending a previous sync completed', () => {
  withDb(db => {
    db.handle.prepare("INSERT INTO threads (id, kind, updated_at) VALUES (?, 'group', ?)").run('old-group', 1);
    assert.equal(isPhoneSyncSetupRequired(db), false);
    assert.equal(hasCompletedPhoneSync(db), false);
    db.handle.prepare('DELETE FROM threads').run();
    assert.equal(isPhoneSyncSetupRequired(db), false, 'the legacy decision must be persisted');
  });
});

test('fresh account keeps setup after cache population until full sync succeeds', () => {
  withDb(db => {
    assert.equal(isPhoneSyncSetupRequired(db), true);
    db.handle.prepare("INSERT INTO threads (id, kind, updated_at) VALUES (?, 'group', ?)").run('new-group', 1);
    assert.equal(isPhoneSyncSetupRequired(db), true, 'ordinary cached chats are not a completed sync');
    assert.equal(markPhoneSyncComplete(db), true);
    assert.equal(isPhoneSyncSetupRequired(db), false);
  });
});

test('phone sync completion survives reopening and is isolated per account', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'phone-sync-complete-'));
  let db = openDb(dir, 'account-one');
  try {
    assert.equal(hasCompletedPhoneSync(db), false);
    assert.equal(markPhoneSyncComplete(db), true);
    db.close(); db = openDb(dir, 'account-one');
    assert.equal(hasCompletedPhoneSync(db), true);
    db.close(); db = openDb(dir, 'account-two');
    assert.equal(hasCompletedPhoneSync(db), false);
    assert.equal(hasCompletedPhoneSync(null), false);
    assert.equal(markPhoneSyncComplete(null), false);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

/**
 * Hai thứ sống **qua các lần chạy**, và cả hai đều từng bị bỏ quên với hậu quả
 * đọc được trên dây:
 *
 * 1. Danh sách hội thoại là chỉ mục cho `partition` — mất nó chỉ có nghĩa là
 *    chạy lại bước hội thoại, không phải mất dữ liệu.
 * 2. Dấu phiên còn mở là thứ duy nhất cho lần chạy sau biết phải dội `OutDated`
 *    cho phiên nào (`cleanOldSyncSession` của Zalo PC).
 *
 * Vì vậy mọi hàm ở đây phải **không ném**: một DB hỏng, một bản lưu rác, hay một
 * `kv` bị xoá đều không được biến thành lỗi đồng bộ.
 */

function withDb(run: (db: ReturnType<typeof openDb>) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'sync-store-'));
  const db = openDb(dir, '1234567890');
  try {
    run(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

// ------------------------------------------------------ danh sách hội thoại

test('hội thoại: chưa lưu gì thì trả mảng rỗng', () => {
  withDb((db) => {
    assert.deepEqual(loadConversations(db), []);
  });
});

test('hội thoại: gộp lần đầu rồi đọc lại được từ DB', () => {
  withDb((db) => {
    const merged = mergeConversations(db, [
      { convId: 'c-1', convType: 1 },
      { convId: 'g-2', convType: 2 },
    ] as never);

    assert.deepEqual(merged, [{ convId: 'c-1', convType: 1 }, { convId: 'g-2', convType: 2 }]);
    // Đọc lại từ `kv` — đúng thứ lần chạy sau thấy.
    assert.deepEqual(loadConversations(db), merged);
  });
});

test('hội thoại: gộp lần hai giữ cả cũ lẫn mới, không xoá hội thoại đã biết', () => {
  withDb((db) => {
    mergeConversations(db, [{ convId: 'c-1', convType: 1 }] as never);
    const merged = mergeConversations(db, [{ convId: 'g-9', convType: 2 }] as never);

    assert.deepEqual(merged, [{ convId: 'c-1', convType: 1 }, { convId: 'g-9', convType: 2 }]);
  });
});

test('hội thoại: bản mới thắng khi cùng id — một nhóm đổi loại phải theo dữ liệu mới', () => {
  withDb((db) => {
    mergeConversations(db, [{ convId: 'x', convType: 1 }] as never);

    const merged = mergeConversations(db, [{ convId: 'x', convType: 2 }] as never);

    assert.deepEqual(merged, [{ convId: 'x', convType: 2 }], 'convType cũ không được ở lại');
  });
});

test('hội thoại: bản ghi không có convId bị bỏ, không ghi một partition rỗng', () => {
  withDb((db) => {
    const merged = mergeConversations(db, [
      { convId: '', convType: 1 },
      { convId: 'c-1', convType: 1 },
    ] as never);

    // `convId` rỗng sẽ thành `partition` `oneone/` — một yêu cầu vô nghĩa gửi
    // lên máy chủ cho mỗi tin. Lọc ở đây, không phải ở chỗ dựng query.
    assert.deepEqual(merged, [{ convId: 'c-1', convType: 1 }]);
  });
});

test('hội thoại: bản lưu rác không ném, chỉ coi như chưa có', () => {
  withDb((db) => {
    db.handle.prepare('INSERT INTO kv (key, value) VALUES (?, ?)').run(CONVERSATIONS_KV_KEY, '{{{');

    assert.deepEqual(loadConversations(db), []);
    // Ghi đè được: bản rác bị thay, không chặn lần lưu sau.
    assert.deepEqual(mergeConversations(db, [{ convId: 'c-1', convType: 1 }] as never),
      [{ convId: 'c-1', convType: 1 }]);
  });
});

test('hội thoại: phần tử sai hình dạng trong mảng bị bỏ, phần đúng được giữ', () => {
  withDb((db) => {
    db.handle.prepare('INSERT INTO kv (key, value) VALUES (?, ?)').run(
      CONVERSATIONS_KV_KEY,
      JSON.stringify([
        null, 'chuỗi', { convId: 5 }, { convId: '' }, { convId: 'c-1', convType: 2 },
      ]),
    );

    assert.deepEqual(loadConversations(db), [{ convId: 'c-1', convType: 2 }]);
  });
});

test('hội thoại: thiếu convType thì coi là one-one, không phải nhóm', () => {
  withDb((db) => {
    db.handle.prepare('INSERT INTO kv (key, value) VALUES (?, ?)').run(
      CONVERSATIONS_KV_KEY, JSON.stringify([{ convId: 'c-1' }]),
    );

    assert.deepEqual(loadConversations(db), [{ convId: 'c-1', convType: 1 }]);
  });
});

test('hội thoại: không có DB thì chỉ trả trong RAM, không ném', () => {
  const merged = mergeConversations(null, [{ convId: 'c-1', convType: 1 }] as never);

  assert.deepEqual(merged, [{ convId: 'c-1', convType: 1 }]);
  assert.deepEqual(loadConversations(null), []);
});

// ------------------------------------------------------------ dấu phiên mở

test('phiên: nhớ rồi liệt kê được, có mốc thời gian', () => {
  withDb((db) => {
    const before = Date.now();
    rememberOpenSession(db, 'sync-a');

    const [item] = listOpenSessions(db);

    assert.equal(item.syncId, 'sync-a');
    assert.ok(item.since >= before, 'mốc phải là lúc ghi, để log được tuổi phiên');
  });
});

test('phiên: quên thì không còn trong danh sách', () => {
  withDb((db) => {
    rememberOpenSession(db, 'sync-a');
    rememberOpenSession(db, 'sync-b');

    forgetOpenSession(db, 'sync-a');

    assert.deepEqual(listOpenSessions(db).map(item => item.syncId), ['sync-b']);
  });
});

test('phiên: danh sách xếp cũ trước — log tuổi phiên đọc theo thứ tự', () => {
  withDb((db) => {
    rememberOpenSession(db, 'moi-nhat');
    rememberOpenSession(db, 'cu-nhat');
    // Ghi đè mốc để hai dấu cách nhau chắc chắn, không phụ thuộc độ phân giải ms.
    db.handle.prepare('UPDATE kv SET value = ? WHERE key = ?')
      .run(String(Date.now() - 60_000), `${OPEN_SESSION_KV_PREFIX}cu-nhat`);
    db.handle.prepare('UPDATE kv SET value = ? WHERE key = ?')
      .run(String(Date.now()), `${OPEN_SESSION_KV_PREFIX}moi-nhat`);

    assert.deepEqual(listOpenSessions(db).map(item => item.syncId), ['cu-nhat', 'moi-nhat']);
  });
});

test('phiên: nhớ cùng một syncId hai lần không sinh hai dòng', () => {
  withDb((db) => {
    rememberOpenSession(db, 'sync-a');
    rememberOpenSession(db, 'sync-a');

    assert.equal(listOpenSessions(db).length, 1);
  });
});

test('phiên: quên một syncId chưa từng nhớ không ném', () => {
  withDb((db) => {
    assert.doesNotThrow(() => forgetOpenSession(db, 'chua-tung-co'));
    assert.deepEqual(listOpenSessions(db), []);
  });
});

test('phiên: syncId rỗng bị bỏ — không ghi dấu cho một phiên không tên', () => {
  withDb((db) => {
    rememberOpenSession(db, '');

    assert.deepEqual(listOpenSessions(db), []);
  });
});

test('phiên: danh sách chỉ đọc khoá của mình, không lẫn khoá khác trong kv', () => {
  withDb((db) => {
    // Khoá định danh và danh sách hội thoại nằm cùng bảng — chúng không được lọt
    // vào danh sách phiên, nếu không lần khởi động sau sẽ dội `591` với một
    // `syncId` là tên khoá.
    db.handle.prepare('INSERT INTO kv (key, value) VALUES (?, ?)').run('identity', 'x');
    db.handle.prepare('INSERT INTO kv (key, value) VALUES (?, ?)').run(CONVERSATIONS_KV_KEY, '[]');
    rememberOpenSession(db, 'sync-a');

    assert.deepEqual(listOpenSessions(db).map(item => item.syncId), ['sync-a']);
  });
});

test('phiên: không có DB thì mọi hàm là no-op', () => {
  assert.doesNotThrow(() => rememberOpenSession(null, 'sync-a'));
  assert.doesNotThrow(() => forgetOpenSession(null, 'sync-a'));
  assert.deepEqual(listOpenSessions(null), []);
});
