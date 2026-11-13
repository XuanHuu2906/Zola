/**
 * Gộp những hội thoại còn mang **id nhiễu** về hội thoại uid tương ứng.
 *
 * Tồn tại vì một lỗi đã sửa, không phải vì một tính năng. Trước bản sửa ngày
 * 2026-11-11, `chunkToMessages` không nối được `partition` (`oneone/<id nhiễu>`,
 * `group/<id nhiễu>`) về uid, nên mọi tin lịch sử được ghi dưới id nhiễu. Đo
 * trên máy thật: 82 525 tin và 195 hội thoại mang id nhiễu, trong đó 79 139 tin
 * là **bản sao** của hàng đã có dưới uid.
 *
 * Đường ghi mới đã đúng, nhưng hàng cũ thì không tự biến mất: `messages` khoá
 * bằng `(thread_id, msg_id)`, nên một tin ghi dưới id nhiễu và tin cùng `msg_id`
 * ghi dưới uid là **hai hàng khác khoá**. Hàm này dọn chúng.
 *
 * Ba điều kiện an toàn, và lý do từng điều:
 *
 * 1. **Chỉ đụng vào id có trong `globalIds`.** Bảng đó đến từ `getAllFriends` +
 *    `getGroupInfo`, tức là từ chính máy chủ. Một id nhiễu không có trong bảng
 *    là người lạ, OA hoặc nhóm đã rời — không biết nó thuộc về ai thì gộp là
 *    đoán, và đoán sai là gán tin của người này sang hội thoại người kia.
 * 2. **Tin chưa có bản dưới uid thì `UPDATE`, không `DELETE`.** Đo được 3 386
 *    tin chỉ tồn tại dưới id nhiễu; xoá chúng là mất lịch sử thật, trong khi
 *    đổi khoá thì chúng về đúng chỗ.
 * 3. **Chạy sau khi bảng đã có nhóm.** Nếu bảng chỉ có bạn bè, `group/<id nhiễu>`
 *    không gộp được và 81 619 tin nhóm ở lại hội thoại ma. Xem
 *    §4h `reports/R18_SYNC_V2_R17_FIXES_LIVE.md`.
 */
import type { Db } from './schema.js';

export interface ConsolidateResult {
  /** Số hội thoại id nhiễu đã gộp (chỉ những id có trong bảng). */
  threadsMerged: number;
  /** Số tin đổi `thread_id` sang uid — lịch sử chỉ có dưới id nhiễu. */
  messagesMoved: number;
  /** Số tin trùng bị bỏ — bản sao của hàng đã có dưới uid. */
  duplicatesDropped: number;
  /** Hội thoại id nhiễu để nguyên vì bảng không có id đó. */
  threadsLeftAlone: number;
}

/** Id nhiễu là base62 không có `/`; uid và groupId là chuỗi số. */
export function isNoisedId(id: string): boolean {
  return id.length > 0 && !/^[0-9]+$/.test(id);
}

/**
 * Gộp các hội thoại id nhiễu về uid. Nguyên tử: hỏng giữa đường thì hoàn tác.
 *
 * `globalIds` là `Map<globalId, uid>` — cùng bảng mà `IdResolver` dùng để giải
 * `partition`. Truyền vào từ ngoài vì hàm này không được phép đoán.
 */
export function consolidateNoisedThreads(
  db: Db, globalIds: ReadonlyMap<string, string>,
): ConsolidateResult {
  const result: ConsolidateResult = {
    threadsMerged: 0, messagesMoved: 0, duplicatesDropped: 0, threadsLeftAlone: 0,
  };
  // Chỉ id **đang thực sự có** trong `threads`: bảng `globalIds` có hàng trăm
  // mục, quét hết là vô ích và làm chậm lúc khởi động.
  const existing = db.handle
    .prepare('SELECT id FROM threads')
    .all() as unknown as Array<{ id: string }>;
  const candidates = existing.map(row => row.id).filter(isNoisedId);
  result.threadsLeftAlone = candidates.filter(id => !globalIds.has(id)).length;

  const pairs: Array<{ noised: string; uid: string }> = [];
  for (const noised of candidates) {
    const uid = globalIds.get(noised);
    // `uid === noised` không xảy ra (khác không gian id), nhưng chặn cho chắc:
    // gộp một hội thoại vào chính nó là xoá nó.
    if (uid && uid !== noised) pairs.push({ noised, uid });
  }
  if (pairs.length === 0) return result;

  const dropDuplicates = db.handle.prepare(
    `DELETE FROM messages
      WHERE thread_id = ?
        AND msg_id IN (SELECT msg_id FROM messages WHERE thread_id = ?)`);
  const moveMessages = db.handle.prepare(
    'UPDATE messages SET thread_id = ? WHERE thread_id = ?');
  const moveSyncState = db.handle.prepare(
    `INSERT INTO sync_state (thread_id, last_synced_msg_id, oldest_loaded_msg_id,
                             has_more_older, last_full_sync_at)
     SELECT ?, last_synced_msg_id, oldest_loaded_msg_id, has_more_older, last_full_sync_at
       FROM sync_state WHERE thread_id = ?
     ON CONFLICT(thread_id) DO NOTHING`);
  const dropSyncState = db.handle.prepare('DELETE FROM sync_state WHERE thread_id = ?');
  const dropThread = db.handle.prepare('DELETE FROM threads WHERE id = ?');
  const retagSender = db.handle.prepare(
    'UPDATE messages SET sender_id = ? WHERE sender_id = ?');

  db.handle.exec('BEGIN');
  try {
    for (const { noised, uid } of pairs) {
      // Thứ tự quan trọng: `.changes` đọc ngay sau mỗi lệnh.
      //
      // Bản sao trước, chuyển sau. Ngược lại thì mọi tin **chỉ** có dưới id
      // nhiễu sẽ thành bản sao của chính nó vừa chuyển, và bị xoá sạch.
      const dropped = dropDuplicates.run(noised, uid);
      result.duplicatesDropped += Number(dropped.changes ?? 0);
      const moved = moveMessages.run(uid, noised);
      result.messagesMoved += Number(moved.changes ?? 0);
      moveSyncState.run(uid, noised);
      dropSyncState.run(noised);
      const removed = dropThread.run(noised);
      if (Number(removed.changes ?? 0) > 0) result.threadsMerged += 1;
    }
    // `sender_id` ánh xạ theo **cả bảng**, không theo cặp hội thoại. Trong hội
    // thoại nhóm, `partition` mang id nhiễu của **nhóm** còn `senderId` của
    // từng tin mang id nhiễu của **thành viên** — hai id khác nhau, nên tra
    // theo cặp sẽ không bao giờ khớp và `from_me` của tin nhóm vẫn sai.
    for (const [noised, uid] of globalIds) {
      if (noised !== uid) retagSender.run(uid, noised);
    }
    db.handle.exec('COMMIT');
  } catch (error) {
    db.handle.exec('ROLLBACK');
    throw error;
  }
  return result;
}
