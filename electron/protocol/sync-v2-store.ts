/**
 * Trạng thái Sync V2 sống **qua các lần mở app**: danh sách hội thoại và các
 * phiên còn mở.
 *
 * Hai thứ này có cùng lý do tồn tại: chúng nằm **giữa** hai lần chạy, và cả hai
 * đều từng bị bỏ quên với hậu quả đọc được trên dây.
 *
 * 1. **Danh sách hội thoại là chỉ mục, không phải dữ liệu người dùng.** Bước
 *    `sync_conversations` trả `convId` cho từng hội thoại, và đó chính là
 *    `globalNoisedId` dùng trong `partition` `oneone/<id>` / `group/<id>`
 *    (R16 §3). Không có nó thì không xin được tin; có nó rồi thì một lần đồng
 *    bộ sau không phải chạy lại bước hội thoại chỉ để lấy đúng danh sách ấy.
 * 2. **Mỗi phiên chưa giải phóng là một phiên mở bên máy chủ.** Zalo PC dội
 *    `reason: OutDated` cho mọi phiên lưu từ lần chạy trước
 *    (`SessionManager.cleanOldSyncSession`). Không có bước này thì app thoát
 *    giữa lúc đồng bộ để lại một phiên mở, và phiên mở chặn lần đồng bộ sau —
 *    đúng vòng lặp mà R13/R15/R17 mỗi lần lại gặp.
 *
 * Nơi lưu là bảng `kv` của `cache-<ownId>.db`: mỗi tài khoản một file, cùng chỗ
 * với khoá định danh. Không có gì ở đây là bí mật — `syncId` là chuỗi ngẫu
 * nhiên do chính app sinh, `convId` là id máy chủ của hội thoại. Không nội dung
 * tin, không khoá, không cookie.
 *
 * Không import `zca-js`, không import `electron`: test được bằng DB tạm.
 */
import type { Db } from '../db/schema.js';
import type { SyncConversation } from './sync-v2-proto.js';

/** Tiền tố `kv` của danh sách hội thoại. */
export const CONVERSATIONS_KV_KEY = 'sync_v2_conversations';

/** Tiền tố `kv` của một phiên đang mở; hậu tố là `syncId`. */
export const OPEN_SESSION_KV_PREFIX = 'sync_v2_open_session:';

const PHONE_SYNC_COMPLETE_KEY = 'phone_sync_complete_v1';
const PHONE_SYNC_SETUP_REQUIRED_KEY = 'phone_sync_setup_required_v1';

/** Decide once, before initial cache hydration. Legacy installs skip onboarding;
 * this is not evidence that a previous phone sync completed successfully. */
export function isPhoneSyncSetupRequired(db: Db | null): boolean {
  if (!db || hasCompletedPhoneSync(db)) return false;
  try {
    const row = db.handle.prepare('SELECT value FROM kv WHERE key = ?').get(PHONE_SYNC_SETUP_REQUIRED_KEY) as { value?: string } | undefined;
    if (row?.value === '1' || row?.value === '0') return row.value === '1';
    // Check presence only: never read chat text to migrate setup state.
    const established = db.handle.prepare('SELECT 1 FROM messages LIMIT 1').get()
      || db.handle.prepare('SELECT 1 FROM threads LIMIT 1').get();
    const required = !established;
    db.handle.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(PHONE_SYNC_SETUP_REQUIRED_KEY, required ? '1' : '0');
    return required;
  } catch { return false; }
}

/** The cache DB is per account and survives app restarts/upgrades. */
export function hasCompletedPhoneSync(db: Db | null): boolean {
  if (!db) return false;
  try {
    const row = db.handle.prepare('SELECT value FROM kv WHERE key = ?').get(PHONE_SYNC_COMPLETE_KEY) as { value?: string } | undefined;
    return row?.value === '1';
  } catch { return false; }
}

export function markPhoneSyncComplete(db: Db | null): boolean {
  if (!db) return false;
  try {
    db.handle.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(PHONE_SYNC_COMPLETE_KEY, '1');
    return true;
  } catch { return false; }
}

/** Trần số hội thoại lưu lại — chặn một danh sách hỏng làm phình `kv`. */
const MAX_STORED_CONVERSATIONS = 20_000;

/** Một hội thoại đủ để dựng `partition`; không lưu trường nào khác. */
export interface StoredConversation {
  convId: string;
  /** `Sync2.Conversation.ConvType`: 1 = one-one, 2 = group. */
  convType: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Đọc danh sách hội thoại đã lưu. `[]` khi chưa có, DB hỏng, hoặc bản lưu sai
 * hình dạng — không ném: đây là chỉ mục, mất nó chỉ có nghĩa là chạy lại bước
 * hội thoại.
 */
export function loadConversations(db: Db | null): StoredConversation[] {
  if (!db) return [];
  try {
    const row = db.handle.prepare('SELECT value FROM kv WHERE key = ?').get(CONVERSATIONS_KV_KEY) as
      { value?: string } | undefined;
    if (!row?.value) return [];
    const parsed: unknown = JSON.parse(row.value);
    if (!Array.isArray(parsed)) return [];
    const out: StoredConversation[] = [];
    for (const item of parsed) {
      if (!isRecord(item)) continue;
      const convId = item.convId;
      const convType = item.convType;
      if (typeof convId !== 'string' || convId.length === 0) continue;
      out.push({ convId, convType: typeof convType === 'number' ? convType : 1 });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Gộp hội thoại vừa nhận vào danh sách đã lưu.
 *
 * Hội thoại mới **thắng**: lần đồng bộ sau trả `convType` đúng hơn (một nhóm
 * được chuyển thành nhóm, hoặc ngược lại, phải theo dữ liệu mới). Trả về toàn
 * bộ danh sách sau khi gộp — phía gọi dùng luôn giá trị này thay vì đọc lại.
 */
export function mergeConversations(
  db: Db | null,
  incoming: readonly SyncConversation[],
): StoredConversation[] {
  const merged = new Map<string, StoredConversation>();
  for (const item of loadConversations(db)) merged.set(item.convId, item);
  for (const item of incoming) {
    if (!item.convId) continue;
    merged.set(item.convId, { convId: item.convId, convType: item.convType });
  }
  const out = [...merged.values()].slice(0, MAX_STORED_CONVERSATIONS);
  if (db) {
    try {
      db.handle.prepare(
        `INSERT INTO kv (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ).run(CONVERSATIONS_KV_KEY, JSON.stringify(out));
    } catch {
      // Không ghi được thì phiên này vẫn dùng được danh sách trong RAM; lần sau
      // chạy lại bước hội thoại. Không có gì để báo hỏng.
    }
  }
  return out;
}

/** Ghi lại một phiên đang mở để lần chạy sau dọn được nếu app tắt đột ngột. */
export function rememberOpenSession(db: Db | null, syncId: string): void {
  if (!db || !syncId) return;
  try {
    db.handle.prepare(
      `INSERT INTO kv (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(`${OPEN_SESSION_KV_PREFIX}${syncId}`, String(Date.now()));
  } catch {
    // Không nhớ được thì chỉ mất bước dọn của lần chạy sau.
  }
}

/** Xoá dấu một phiên đã giải phóng (`591` đã gửi, hoặc phiên tự xong). */
export function forgetOpenSession(db: Db | null, syncId: string): void {
  if (!db || !syncId) return;
  try {
    db.handle.prepare('DELETE FROM kv WHERE key = ?').run(`${OPEN_SESSION_KV_PREFIX}${syncId}`);
  } catch {
    // Bỏ qua: dấu còn lại sẽ được dọn ở lần khởi động sau với `OutDated`.
  }
}

/**
 * Các phiên còn mở từ lần chạy trước, cũ nhất trước.
 *
 * Trả cả mốc thời gian để phía gọi ghi log được tuổi phiên; một phiên "mở" từ
 * ba tuần trước chắc chắn đã chết, còn một phiên từ hai phút trước có thể là
 * lần chạy song song.
 */
export function listOpenSessions(db: Db | null): Array<{ syncId: string; since: number }> {
  if (!db) return [];
  try {
    const rows = db.handle.prepare(
      'SELECT key, value FROM kv WHERE key LIKE ?',
    ).all(`${OPEN_SESSION_KV_PREFIX}%`) as Array<{ key: string; value?: string }>;
    return rows
      .map(row => ({
        syncId: row.key.slice(OPEN_SESSION_KV_PREFIX.length),
        since: Number(row.value) || 0,
      }))
      .filter(item => item.syncId.length > 0)
      .sort((left, right) => left.since - right.since);
  } catch {
    return [];
  }
}
