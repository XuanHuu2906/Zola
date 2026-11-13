import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Schema và migration của cache cục bộ (plan §6.2).
 *
 * Dùng `node:sqlite` có sẵn trong Node 22+ / Electron 45 thay vì
 * `better-sqlite3`. Lý do đã đo: Electron 45 nhúng Node 24.22.2 và
 * `node:sqlite` chạy được ngay, nên không cần module native, không cần
 * `electron-rebuild`, và file này test được bằng node thật.
 *
 * Module này **không** import `electron`, nên `tests/db.test.ts` mở được DB
 * thật trong thư mục tạm.
 */

/** Phiên bản schema hiện tại. Tăng khi thêm migration vào `MIGRATIONS`. */
export const SCHEMA_VERSION = 5;

/**
 * Mỗi phần tử là một bước từ phiên bản `index` lên `index + 1`. Chạy tuần tự
 * trong một transaction, nên app tắt giữa chừng không để lại schema nửa vời.
 */
const MIGRATIONS: readonly string[] = [
  // 0 → 1
  `
  CREATE TABLE threads (
    id            TEXT PRIMARY KEY,
    kind          TEXT NOT NULL CHECK (kind IN ('user','group')),
    title         TEXT,
    avatar_url    TEXT,
    last_msg_id   TEXT,
    last_ts       INTEGER,
    last_preview  TEXT,
    unread        INTEGER NOT NULL DEFAULT 0,
    muted         INTEGER NOT NULL DEFAULT 0,
    pinned        INTEGER NOT NULL DEFAULT 0,
    updated_at    INTEGER NOT NULL
  );

  CREATE TABLE messages (
    thread_id     TEXT NOT NULL,
    msg_id        TEXT NOT NULL,
    client_id     TEXT,
    sender_id     TEXT NOT NULL,
    from_me       INTEGER NOT NULL,
    ts            INTEGER NOT NULL,
    text          TEXT,
    attachments   TEXT,
    quote_json    TEXT,
    status        TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sending','sent','failed')),
    recalled      INTEGER NOT NULL DEFAULT 0,
    edited_at     INTEGER,
    PRIMARY KEY (thread_id, msg_id)
  );
  CREATE INDEX idx_messages_thread_ts ON messages(thread_id, ts DESC);
  CREATE UNIQUE INDEX idx_messages_client ON messages(thread_id, client_id)
    WHERE client_id IS NOT NULL;

  CREATE TABLE sync_state (
    thread_id          TEXT PRIMARY KEY,
    last_synced_msg_id TEXT,
    oldest_loaded_msg_id TEXT,
    has_more_older     INTEGER NOT NULL DEFAULT 1,
    last_full_sync_at  INTEGER
  );

  CREATE TABLE contacts (
    id TEXT PRIMARY KEY, name TEXT, avatar_url TEXT, updated_at INTEGER NOT NULL
  );
  `,
  // 1 → 2: cảm xúc trên tin nhắn.
  //
  // `reactions` là **một người một mục** (`{"<uid>": "/-heart"}`), không phải
  // bảng đếm sẵn. Sự kiện `reaction` của Zalo là một hành động của một người —
  // thả, đổi, hoặc bỏ — và sự kiện bỏ (`rType < 0`) **không nói** đã bỏ biểu
  // tượng nào. Giữ ai thả cái gì là cách duy nhất tính đúng mà không phải đoán;
  // bảng đếm sẵn sẽ trôi dần mỗi lần ai đó bỏ cảm xúc. Con số hiện trên bong
  // bóng được cộng ra lúc đọc, không lưu.
  //
  // `cli_msg_id` là id phía máy khách của tin. Zalo bắt buộc phải có nó khi thả
  // cảm xúc (`addReaction` gửi cả `gMsgID` lẫn `cMsgID`), và nó không suy ra
  // được từ `msg_id`.
  `ALTER TABLE messages ADD COLUMN reactions TEXT;`,
  `ALTER TABLE messages ADD COLUMN cli_msg_id TEXT;`,
  `ALTER TABLE messages ADD COLUMN sender_name TEXT;`,
  `ALTER TABLE messages ADD COLUMN mentions_json TEXT;`,
];

export interface Db {
  readonly path: string;
  /**
   * uid của tài khoản sở hữu DB này.
   *
   * Cần vì cảm xúc được lưu theo **người thả** (`{"<uid>": "/-heart"}`), và chỉ
   * biết uid của mình mới nói được một cảm xúc có phải của mình hay không. Không
   * suy ra được từ dữ liệu: uid của chính mình không nằm trong bất kỳ hàng nào.
   */
  readonly ownId: string;
  /** Dùng cho test và cho các module khác cần truy vấn một lần. */
  handle: DatabaseSync;
  close(): void;
}

/**
 * Khoá ngoài bị tắt có chủ ý: `messages.thread_id` và `sync_state.thread_id`
 * trỏ tới `threads.id`, nhưng thứ tự đến không đảm bảo — tin nhắn có thể tới
 * trước khi metadata hội thoại được backfill xong. Bật FK sẽ làm rơi đúng
 * những tin đó. Plan §6.2 bật FK, nhưng plan giả định backfill danh sách hội
 * thoại chạy trước; thực tế realtime có thể tới trước.
 */
export const PRAGMAS = ['PRAGMA journal_mode = WAL;', 'PRAGMA synchronous = NORMAL;',
  'PRAGMA foreign_keys = OFF;', 'PRAGMA busy_timeout = 5000;'];

function versionOf(db: DatabaseSync): number {
  const row = db.prepare("SELECT value FROM kv WHERE key = 'schema_version'").get() as { value?: string } | undefined;
  const parsed = Number(row?.value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Chạy mọi migration còn thiếu. Idempotent: mở lại DB đã ở phiên bản mới nhất
 * không làm gì. Không bao giờ hạ cấp — DB mới hơn sẽ được dùng nguyên trạng,
 * vì bản app cũ không biết cách đọc cột mới và ghi đè sẽ hỏng dữ liệu.
 */
export function migrate(handle: DatabaseSync): { from: number; to: number } {
  for (const pragma of PRAGMAS) handle.exec(pragma);
  // `kv` được tạo ngoài danh sách migration vì chính nó chứa số phiên bản —
  // migration đầu tiên không thể tự đếm chính mình. Mọi migration sau đó được
  // phép giả định `kv` đã tồn tại.
  handle.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)');
  const from = versionOf(handle);
  if (from >= MIGRATIONS.length) return { from, to: from };
  handle.exec('BEGIN');
  try {
    for (let step = from; step < MIGRATIONS.length; step += 1) handle.exec(MIGRATIONS[step]);
    handle.prepare("INSERT INTO kv (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(String(MIGRATIONS.length));
    handle.exec('COMMIT');
  } catch (error) {
    handle.exec('ROLLBACK');
    throw error;
  }
  return { from, to: MIGRATIONS.length };
}

/**
 * Mở (và tạo nếu cần) DB của **một** tài khoản. Tên file chứa id tài khoản để
 * hai tài khoản không trộn dữ liệu (plan §6.10, "Đổi tài khoản").
 *
 * `ownId` được làm sạch trước khi ghép vào tên file: nó đến từ server Zalo, và
 * một id chứa `/` hay `..` sẽ ghi ra ngoài thư mục dữ liệu.
 */
export function openDb(dataRoot: string, ownId: string): Db {
  mkdirSync(dataRoot, { recursive: true });
  const safe = String(ownId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'unknown';
  const file = path.join(dataRoot, `cache-${safe}.db`);
  const handle = new DatabaseSync(file);
  migrate(handle);
  return { path: file, ownId: String(ownId), handle, close: () => handle.close() };
}
