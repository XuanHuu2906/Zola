import type { LiveMessage, LiveThread, ThreadKind } from '../ipc-contract.js';
import type { StoreMessage, StoredAttachment } from '../protocol/attachment.js';
import { keepLocalPaths } from '../protocol/attachment.js';
import { mentionRangesOf } from '../protocol/mentions.js';
import { aggregateReactions, parseReactionMap, type ReactionMap } from '../protocol/reactions.js';
import type { Db } from './schema.js';

/**
 * Truy vấn cho cache tin nhắn và hội thoại (plan §6.3, §6.4, §6.9).
 *
 * Không import `electron`, nên test được bằng node thật trên DB tạm. Không nơi
 * nào ở đây biết zca-js: đầu vào là `LiveMessage`/`LiveThread` đã map.
 *
 * Bốn quy tắc của §6.3 nằm ở file này:
 * - upsert idempotent theo `(thread_id, msg_id)`;
 * - sắp xếp theo `ts` server, hoà thì theo `msg_id` số;
 * - gộp tin lạc quan qua `client_id`;
 * - server thắng khi cùng `msg_id` mà nội dung khác.
 */

/** Keep an internal sender key when available; `0` is reserved for self. */
const senderOf = (message: StoreMessage): string =>
  message.from === 'me' ? '0' : (message.senderId && message.senderId !== '0' ? message.senderId : '');

/**
 * So sánh hai `msgId`. Chuỗi số phải so bằng `BigInt`: `Number` làm tròn mất chữ
 * số cuối, còn so chuỗi thì `"9" > "10"`. Id không phải số thì so chuỗi.
 */
export function compareMsgId(a: string, b: string): number {
  try {
    const delta = BigInt(a) - BigInt(b);
    return delta === 0n ? 0 : delta < 0n ? -1 : 1;
  } catch {
    return a < b ? -1 : a > b ? 1 : 0;
  }
}

const CATCH_UP_CURSOR_KEYS = {
  user: 'catchup_user_msg_id',
  group: 'catchup_group_msg_id',
} as const;
const isServerMessageId = (msgId: string): boolean => /^\d+$/.test(msgId);

/** Đọc mốc mới nhất đã lưu cho luồng bắt kịp của một loại hội thoại. */
export function readCatchUpCursor(db: Db, kind: ThreadKind = 'user'): string | null {
  const key = CATCH_UP_CURSOR_KEYS[kind];
  const row = db.handle.prepare('SELECT value FROM kv WHERE key = ?').get(key) as
    { value?: string } | undefined;
  if (row?.value && isServerMessageId(row.value)) return row.value;
  const rows = db.handle.prepare(
    `SELECT m.msg_id FROM messages m
      JOIN threads t ON t.id = m.thread_id
     WHERE t.kind = ? AND m.msg_id <> '' AND m.msg_id NOT GLOB '*[^0-9]*'`)
    .all(kind) as unknown as Array<{ msg_id: string }>;
  return rows.reduce<string | null>((latest, item) =>
    !latest || compareMsgId(item.msg_id, latest) > 0 ? item.msg_id : latest, null);
}

/**
 * Ghi checkpoint chỉ tiến lên. Tin đã được upsert trước khi gọi hàm này, vì vậy
 * nếu app dừng giữa hai thao tác thì lần kế tiếp chỉ phát lại tin (idempotent).
 */
export function writeCatchUpCursor(db: Db, msgId: string, kind: ThreadKind = 'user'): void {
  if (!isServerMessageId(msgId)) return;
  const key = CATCH_UP_CURSOR_KEYS[kind];
  const row = db.handle.prepare('SELECT value FROM kv WHERE key = ?').get(key) as
    { value?: string } | undefined;
  const current = row?.value && isServerMessageId(row.value) ? row.value : null;
  if (current && compareMsgId(msgId, current) <= 0) return;
  db.handle.prepare(
    `INSERT INTO kv (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(key, msgId);
}

/** Hàng thô từ `messages`; `node:sqlite` trả object null-prototype với số là number. */
interface MessageRow {
  thread_id: string;
  msg_id: string;
  client_id: string | null;
  sender_id: string;
  from_me: number;
  ts: number;
  text: string | null;
  attachments: string | null;
  status: string;
  recalled: number;
  quote_json: string | null;
  reactions: string | null;
  cli_msg_id: string | null;
  sender_name: string | null;
  mentions_json: string | null;
}

/**
 * Đọc cột `quote_json`. Cùng luật với `attachmentsOfRow`: JSON hỏng trả
 * `undefined` chứ không ném, và chỉ nhận object có đủ hình dạng tối thiểu.
 *
 * `quote` ở đây là **bản chụp** của tin được trả lời, không phải một tham chiếu
 * sống: tin gốc có thể đã bị thu hồi hoặc nằm ngoài phần đã đồng bộ, và mũi
 * trích dẫn vẫn phải đọc được khi đó.
 */
function quoteOfRow(raw: string | null): StoreMessage['quote'] {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const quote = parsed as Record<string, unknown>;
    if (typeof quote.text !== 'string') return undefined;
    if (quote.from !== 'me' && quote.from !== 'them') return undefined;
    return parsed as StoreMessage['quote'];
  } catch { return undefined; }
}

/**
 * Đọc cột `attachments`. JSON hỏng thì trả `undefined` chứ không ném: một hàng
 * ghi dở (app tắt giữa transaction) không được làm hỏng cả trang tin.
 *
 * Chỉ nhận mảng; mỗi phần tử phải có `kind` là chuỗi. Phần còn lại để nguyên vì
 * `StoredAttachment` do chính mapper sinh ra — kiểm từng trường ở đây là dựng
 * lại bộ phân loại ở sai chỗ.
 */
function attachmentsOfRow(raw: string | null): StoredAttachment[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    const items = parsed.filter((item): item is StoredAttachment =>
      !!item && typeof item === 'object' && typeof (item as StoredAttachment).kind === 'string');
    return items.length ? items : undefined;
  } catch { return undefined; }
}

function mentionsOfRow(raw: string | null, text: string): StoreMessage['mentions'] {
  if (!raw) return undefined;
  try { return mentionRangesOf(JSON.parse(raw), text); } catch { return undefined; }
}

/**
 * Đọc cột `reactions`. Cùng luật với `quoteOfRow`: JSON hỏng trả `{}` chứ không
 * ném. Cột lưu **người thả → biểu tượng** (xem `protocol/reactions.ts`), không
 * lưu bảng đếm: con số là thứ suy ra được, còn ai đã thả thì không.
 */
const reactionsOfRow = (raw: string | null): ReactionMap => parseReactionMap(raw);

const toLive = (row: MessageRow, kind: ThreadKind, ownId: string): StoreMessage => {
  const attachments = attachmentsOfRow(row.attachments);
  const quote = row.recalled ? undefined : quoteOfRow(row.quote_json);
  const mentions = row.recalled ? undefined : mentionsOfRow(row.mentions_json, row.text ?? '');
  // Cảm xúc của một tin đã thu hồi cũng không còn nghĩa: không ai thả tim lên
  // "Tin nhắn đã thu hồi", và giữ chúng lại là giữ dấu vết của nội dung đã rút.
  const reactions = row.recalled ? [] : aggregateReactions(reactionsOfRow(row.reactions), ownId || null);
  return {
    threadId: row.thread_id,
    kind,
    // Id tạm của bong bóng chưa gửi không phải id server: trả `null` để renderer
    // không bao giờ coi nó là tin thật (nếu coi, nó sẽ không hiện nút "Gửi lại").
    msgId: row.msg_id.startsWith('pending:') ? null : row.msg_id,
    clientId: row.client_id,
    from: row.from_me ? 'me' : 'them',
    ...(!row.from_me && row.sender_id && row.sender_id !== '0' ? { senderId: row.sender_id } : {}),
    ...(row.sender_name ? { fromName: row.sender_name } : {}),
    // Tin đã thu hồi vẫn giữ dòng (plan §6.3 quy tắc 4) nhưng không giữ nội dung.
    ...(row.recalled ? { recalled: true } : {}),
    text: row.recalled ? '' : (row.text ?? ''),
    ...(mentions ? { mentions } : {}),
    ts: Number(row.ts),
    // Tin đã thu hồi thì tệp cũng đi theo: người dùng rút tin là rút cả ảnh.
    ...(row.recalled || !attachments ? {} : { attachments }),
    ...(quote ? { quote } : {}),
    ...(reactions.length ? { reactions } : {}),
    // Id phía máy khách của tin — Zalo bắt buộc có nó để thả cảm xúc. Chỉ trả khi
    // thật sự có: chuỗi rỗng ở đây sẽ thành `parseInt('')` = NaN trong
    // `addReaction`, tức một lời gọi máy chủ chắc chắn hỏng.
    ...(row.cli_msg_id ? { cliMsgId: row.cli_msg_id } : {}),
  };
};

/** `LiveMessage` đã mang cờ thu hồi; tên giữ lại cho chỗ gọi đọc dễ hiểu. */
export type { StoreMessage };

export interface UpsertResult {
  /** Số hàng thực sự được ghi (chèn mới hoặc cập nhật). */
  written: number;
  /** Tin đã có trong DB mà nội dung giống hệt — không ghi lại. */
  unchanged: number;
  /** Số tin tạm (`client_id`, `status='sending'`) được gộp vào tin thật. */
  merged: number;
}

/**
 * Ghi một lô tin trong **một** transaction (plan §6.3 quy tắc 7).
 *
 * Không cần `kind`: bảng `messages` khoá theo `thread_id`, còn loại hội thoại
 * nằm ở `threads.kind` và chỉ được tra lúc **đọc**. Nhờ vậy tin realtime tới
 * trước khi danh sách hội thoại backfill xong vẫn ghi được.
 */
export function upsertMessages(db: Db, threadId: string, batch: StoreMessage[]): UpsertResult {
  const result: UpsertResult = { written: 0, unchanged: 0, merged: 0 };
  const findById = db.handle.prepare(
    'SELECT text, recalled, status, attachments, quote_json, sender_name, sender_id, mentions_json FROM messages WHERE thread_id = ? AND msg_id = ?');
  const mergeClient = db.handle.prepare(
    `INSERT INTO messages (thread_id, msg_id, client_id, sender_id, from_me, ts, text, attachments, status, recalled, quote_json, cli_msg_id, sender_name, mentions_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?, ?, ?, ?)
     ON CONFLICT(thread_id, msg_id) DO UPDATE SET
       client_id = excluded.client_id, status = 'sent', ts = excluded.ts, recalled = excluded.recalled,
       sender_id = CASE WHEN excluded.from_me = 1 THEN '0'
         WHEN excluded.sender_id IN ('', '0') THEN messages.sender_id ELSE excluded.sender_id END,
       -- Cùng lý do với câu dưới: tin thật tới sau bong bóng tạm phải mang theo
       -- nội dung và tệp của nó. Bản trước bỏ hai cột này, nên một tin trùng
       -- mã tin nhưng khác nội dung (ảnh về sau, tin sửa) bị giữ bản cũ.
       text = excluded.text, attachments = excluded.attachments, quote_json = excluded.quote_json,
       mentions_json = excluded.mentions_json,
       -- Id máy khách chỉ được **điền**, không bao giờ bị xoá bằng NULL: một
       -- đường phát tin không mang nó (một số gói Sync V2 để clientId rỗng)
       -- không phải bằng chứng là tin không có id đó, và mất nó là mất khả năng
       -- thả cảm xúc lên chính tin vừa gửi.
       cli_msg_id = COALESCE(excluded.cli_msg_id, messages.cli_msg_id),
       sender_name = COALESCE(excluded.sender_name, messages.sender_name)`);
  // Xoá mọi dòng tạm của `client_id` này, kể cả dòng đã `failed` (người dùng bấm
  // "Gửi lại" sau khi lần trước hỏng). Chỉ lọc theo `client_id`: dòng `sent` cùng
  // `client_id` thì `findById` đã chặn ở trên rồi, nên tới đây không còn dòng thật
  // nào để xoá nhầm.
  const delPending = db.handle.prepare(
    'DELETE FROM messages WHERE thread_id = ? AND client_id = ?');
  const upsert = db.handle.prepare(
    `INSERT INTO messages (thread_id, msg_id, client_id, sender_id, from_me, ts, text, attachments, status, recalled, quote_json, cli_msg_id, sender_name, mentions_json)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'sent', ?, ?, ?, ?, ?)
     ON CONFLICT(thread_id, msg_id) DO UPDATE SET
       text = excluded.text,
       sender_id = CASE WHEN excluded.from_me = 1 THEN '0'
         WHEN excluded.sender_id IN ('', '0') THEN messages.sender_id ELSE excluded.sender_id END,
       from_me = excluded.from_me,
       ts = excluded.ts, status = 'sent', recalled = excluded.recalled,
       -- Đường dẫn tệp đã tải **không** bị lần đồng bộ sau xoá: xem keepLocalPaths.
       attachments = excluded.attachments, quote_json = excluded.quote_json,
       mentions_json = excluded.mentions_json,
       -- Chỉ điền, không xoá — cùng lý do với câu trên.
       cli_msg_id = COALESCE(excluded.cli_msg_id, messages.cli_msg_id),
       sender_name = COALESCE(excluded.sender_name, messages.sender_name)`);

  db.handle.exec('BEGIN');
  try {
    for (const message of batch) {
      if (!message.msgId) continue; // tin chưa có id server không thuộc về DB này
      const text = message.recalled ? '' : message.text;
      const existing = findById.get(threadId, message.msgId) as
        { text: string | null; recalled: number; attachments: string | null;
          quote_json: string | null; sender_name: string | null; sender_id: string;
          mentions_json: string | null } | undefined;
      if (existing && existing.recalled === 1) {
        // Quy tắc 5: không xoá dòng vì "lần này không thấy nó". Một tin đã thu
        // hồi không được hồi sinh bởi một trang lịch sử cũ còn giữ nội dung.
        result.unchanged += 1;
        continue;
      }
      // Giữ `src`/`thumb` của lần tải trước. Mapper luôn trả `null` ở hai trường
      // này (nó không biết gì về đĩa), nên ghi thẳng xuống là xoá đường dẫn của
      // mọi ảnh đã tải mỗi khi đồng bộ lại.
      const stored = message.attachments?.length
        ? keepLocalPaths(message.attachments, attachmentsOfRow(existing?.attachments ?? null))
        : undefined;
      const attachmentsJson = stored?.length ? JSON.stringify(stored) : null;
      // Trích dẫn cũng là nội dung: một lần đồng bộ lại không được xoá mũi trả
      // lời của một tin đã có, và một trang lịch sử cũ trả `quote` rỗng cũng
      // không được làm mất nó. `null` khi tin không trả lời ai.
      const quoteJson = message.recalled ? null
        : message.quote ? JSON.stringify(message.quote) : null;
      const incomingMentions = message.recalled ? undefined : mentionRangesOf(message.mentions, text);
      const mentionsJson = message.recalled ? null
        : incomingMentions ? JSON.stringify(incomingMentions)
          : existing?.text === text ? existing.mentions_json : null;
      const senderName = message.fromName?.trim().slice(0, 120) || null;
      const senderId = senderOf(message);
      // "Không đổi" phải xét **cả** tệp: một tin ảnh có `text` rỗng ở cả hai lần,
      // nên so mỗi `text` sẽ coi nó là trùng và không bao giờ ghi cột
      // `attachments` — đúng lý do 0/211 283 hàng có tệp trước 2026-11-11. Cùng
      // lý do, trích dẫn phải nằm trong phép so: nếu không, một tin trả lời ghi
      // trước bản sửa này sẽ không bao giờ có `quote_json`.
      const quoteSame = (existing?.quote_json ?? null) === quoteJson;
      const mentionsSame = (existing?.mentions_json ?? null) === mentionsJson;
      const senderNameSame = senderName === null || existing?.sender_name === senderName;
      if (existing && (existing.text ?? '') === text
        && (existing.attachments ?? null) === attachmentsJson && quoteSame && mentionsSame && senderNameSame) {
        result.unchanged += 1;
        if ((message.from === 'me' && existing.sender_id !== '0')
          || (senderId && senderId !== '0' && senderId !== existing.sender_id)) {
          db.handle.prepare(
            'UPDATE messages SET sender_id = ? WHERE thread_id = ? AND msg_id = ?')
            .run(message.from === 'me' ? '0' : senderId, threadId, message.msgId);
        }
        // Nội dung không đổi, nhưng id máy khách thì vẫn phải vào: một tin đã có
        // từ đường Sync V2 (không mang `clientId`) có thể về lại qua realtime
        // (mang `cliMsgId`). Bỏ qua ở đây là mãi mãi không thả được cảm xúc lên
        // tin đó. Chỉ ghi đúng một cột, và không tính là "đã đổi" để lần đồng bộ
        // lại vẫn báo nguyên trạng.
        if (message.cliMsgId) {
          db.handle.prepare(
            'UPDATE messages SET cli_msg_id = ? WHERE thread_id = ? AND msg_id = ? AND cli_msg_id IS NULL')
            .run(message.cliMsgId, threadId, message.msgId);
        }
        continue;
      }
      // Quy tắc 3: tin thật khớp `client_id` với một bong bóng tạm thì thay
      // bong bóng đó, không để lại hai dòng cho cùng một tin.
      if (message.clientId) {
        const removed = delPending.run(threadId, message.clientId);
        if (Number(removed.changes) > 0) result.merged += 1;
        mergeClient.run(threadId, message.msgId, message.clientId, senderId,
          message.from === 'me' ? 1 : 0, message.ts, text, attachmentsJson,
          message.recalled ? 1 : 0, quoteJson, message.cliMsgId ?? null, senderName, mentionsJson);
      } else {
        upsert.run(threadId, message.msgId, senderId, message.from === 'me' ? 1 : 0, message.ts, text,
          attachmentsJson, message.recalled ? 1 : 0, quoteJson, message.cliMsgId ?? null, senderName, mentionsJson);
      }
      result.written += 1;
    }
    db.handle.exec('COMMIT');
  } catch (error) {
    db.handle.exec('ROLLBACK');
    throw error;
  }
  return result;
}

/** Backfill cached group messages once Sync V2 sender globalIds are resolved. */
export function updateMessageSenderNames(db: Db, threadId: string, names: Map<string, string>): number {
  if (!names.size) return 0;
  const rows = db.handle.prepare(
    `SELECT msg_id, sender_id FROM messages
     WHERE thread_id = ? AND from_me = 0 AND sender_id NOT IN ('', '0')
       AND COALESCE(sender_name, '') = ''`).all(threadId) as
    { msg_id: string; sender_id: string }[];
  const update = db.handle.prepare(
    `UPDATE messages SET sender_name = ?
     WHERE thread_id = ? AND msg_id = ? AND COALESCE(sender_name, '') = ''`);
  let updated = 0;
  for (const row of rows) {
    const name = names.get(row.sender_id)?.trim().slice(0, 120);
    if (!name) continue;
    updated += Number(update.run(name, threadId, row.msg_id).changes);
  }
  return updated;
}

/**
 * Đặt trọn bộ cảm xúc của một tin. Ghi **đè** chứ không cộng dồn: bản đồ đầu vào
 * là trạng thái đầy đủ sau một hành động (xem `protocol/reactions.ts`), nên phát
 * lại cùng một sự kiện không đếm hai lần.
 *
 * Trả `undefined` khi không có hàng để ghi — tin của một hội thoại chưa tải, hoặc
 * hàng đã bị thu hồi. Chỗ gọi dùng nó để biết có phát lại tin hay không: phát một
 * `LiveMessage` cho hàng không tồn tại sẽ dựng bong bóng rỗng ở sai chỗ.
 *
 * Không tạo dòng mới: cảm xúc của một tin chưa có trong cache sẽ về cùng tin đó ở
 * lần mở hội thoại sau.
 */
export function setMessageReactions(db: Db, threadId: string, msgId: string,
  reactions: ReactionMap): StoreMessage | undefined {
  if (!msgId) return undefined;
  const json = Object.keys(reactions).length ? JSON.stringify(reactions) : null;
  const changed = db.handle.prepare(
    'UPDATE messages SET reactions = ? WHERE thread_id = ? AND msg_id = ? AND recalled = 0')
    .run(json, threadId, msgId);
  if (Number(changed.changes) === 0) return undefined;
  const row = db.handle.prepare(
    'SELECT * FROM messages WHERE thread_id = ? AND msg_id = ?').get(threadId, msgId) as
    unknown as MessageRow | undefined;
  if (!row) return undefined;
  const kindRow = db.handle.prepare('SELECT kind FROM threads WHERE id = ?').get(threadId) as
    { kind?: ThreadKind } | undefined;
  return toLive(row, kindRow?.kind ?? 'user', db.ownId);
}

/** Bản đồ cảm xúc **thô** của một tin (người thả → `rIcon`), để áp hành động kế tiếp. */
export function messageReactions(db: Db, threadId: string, msgId: string): ReactionMap {
  const row = db.handle.prepare(
    'SELECT reactions, recalled FROM messages WHERE thread_id = ? AND msg_id = ?').get(threadId, msgId) as
    { reactions: string | null; recalled: number } | undefined;
  if (!row || row.recalled === 1) return {};
  return reactionsOfRow(row.reactions);
}

/** Id máy khách của một tin, hoặc `null` khi chưa biết — cần để thả cảm xúc. */
export function messageCliId(db: Db, threadId: string, msgId: string): string | null {
  const row = db.handle.prepare(
    'SELECT cli_msg_id FROM messages WHERE thread_id = ? AND msg_id = ?').get(threadId, msgId) as
    { cli_msg_id: string | null } | undefined;
  return row?.cli_msg_id ?? null;
}

/** Xoá cảm xúc của một dòng — đường dùng khi tin gốc bị thu hồi. */
export function clearMessageReactions(db: Db, threadId: string, msgId: string): void {
  db.handle.prepare('UPDATE messages SET reactions = NULL WHERE thread_id = ? AND msg_id = ?')
    .run(threadId, msgId);
}

/**
 * Tin đã gửi nhưng chưa có `msg_id` server: chỉ tồn tại để bong bóng tạm sống sót
 * qua reload. Bấm "Gửi lại" dùng lại đúng `clientId`, nên hàng cũ phải quay về
 * `sending` (nếu không nó kẹt ở `failed` cho tới khi gửi xong). Dòng đã `sent`
 * thì không đụng: id server đã về, không còn là tin tạm.
 */
export function insertPending(db: Db, message: LiveMessage & { clientId: string }): void {
  // Đã có dòng `sent` mang `client_id` này thì tin thật đã về: chèn thêm một
  // bong bóng tạm sẽ vừa sai vừa phạm unique index `(thread_id, client_id)`.
  const settled = db.handle.prepare(
    "SELECT 1 AS hit FROM messages WHERE thread_id = ? AND client_id = ? AND status = 'sent'")
    .get(message.threadId, message.clientId) as { hit?: number } | undefined;
  if (settled) return;
  db.handle.prepare(
    `INSERT INTO messages (thread_id, msg_id, client_id, sender_id, from_me, ts, text, status, recalled)
     VALUES (?, ?, ?, '0', 1, ?, ?, 'sending', 0)
     ON CONFLICT(thread_id, msg_id) DO UPDATE SET
       ts = excluded.ts, text = excluded.text, status = 'sending'`)
    .run(message.threadId, `pending:${message.clientId}`, message.clientId, message.ts, message.text);
}

/** `ts` lớn nhất đã cache của một hội thoại (0 khi chưa có gì). */
export function newestTs(db: Db, threadId: string): number {
  const row = db.handle.prepare('SELECT MAX(ts) AS ts FROM messages WHERE thread_id = ?').get(threadId) as
    { ts: number | null } | undefined;
  return Number(row?.ts ?? 0);
}

/**
 * Tin tạm **nằm cuối** danh sách, khi chưa có `msg_id` server.
 *
 * `msg_id` là khoá chính nên bong bóng chưa gửi phải mượn một id tạm dạng
 * `pending:<clientId>`; `toLive` dịch ngược lại thành `msgId: null` + `clientId`.
 *
 * Hiện **chưa** đường nào trả các hàng này lên UI. Renderer chèn trang lịch sử
 * lên đầu hội thoại (`prependHistory`), mà bong bóng chưa gửi phải ở cuối — đưa
 * nó vào trang sẽ làm nó nhảy lên trên tin cũ. Khôi phục bong bóng tạm sau khi
 * mở lại app cần sửa renderer, nên để lại đây như đầu mối đã có sẵn.
 */
export function pendingMessages(db: Db, threadId: string, kind: ThreadKind): StoreMessage[] {
  const rows = db.handle.prepare(
    `SELECT * FROM messages WHERE thread_id = ? AND msg_id LIKE 'pending:%'
     ORDER BY ts ASC`).all(threadId) as unknown as MessageRow[];
  return rows.map(row => ({ ...toLive(row, kind, db.ownId), msgId: null, clientId: row.client_id }));
}

/** Đánh dấu bong bóng tạm là hỏng, để UI hiện "Gửi lại" sau khi mở lại app. */
export function markFailed(db: Db, threadId: string, clientId: string): void {
  db.handle.prepare("UPDATE messages SET status = 'failed' WHERE thread_id = ? AND client_id = ?")
    .run(threadId, clientId);
}

export interface RecallResult {
  /** `false` = chưa có dòng nào mang `msgId` này (lịch sử hội thoại chưa tải). */
  found: boolean;
  /** `ts`/người gửi của dòng sau khi thu hồi; chỉ dùng được khi `found`. */
  ts: number;
  fromMe: boolean;
}

/**
 * Tin đã bị thu hồi (plan §6.10, quy tắc 5 của §6.3): **giữ dòng**, đặt
 * `recalled = 1` và xoá nội dung.
 *
 * Xoá nội dung là chủ ý: người dùng đã thu hồi tin, giữ lại chữ trong DB nghĩa là
 * đọc lại được thứ họ đã rút.
 *
 * Không tìm thấy dòng thì **không** tạo dòng mới. Sự kiện thu hồi mang id của
 * tin gốc, nhưng ta chưa từng thấy tin đó; ghi một dòng chỉ có `msg_id` là đặt
 * một bong bóng "đã thu hồi" vào chỗ không có tin nào, và ngay cả id cũng là
 * thứ chưa được xác nhận với máy chủ thật. Lớp protocol giữ id đó trong bộ nhớ
 * và áp lại khi tin thật về.
 */
export function markRecalled(db: Db, threadId: string, msgId: string): RecallResult {
  if (!threadId || !msgId) return { found: false, ts: 0, fromMe: false };
  db.handle.prepare(
    "UPDATE messages SET recalled = 1, text = '', mentions_json = NULL WHERE thread_id = ? AND msg_id = ?")
    .run(threadId, msgId);
  const row = db.handle.prepare(
    'SELECT ts, from_me, recalled FROM messages WHERE thread_id = ? AND msg_id = ?')
    .get(threadId, msgId) as { ts: number; from_me: number; recalled: number } | undefined;
  // `changes` không nói được "đã có dòng": dòng đã `recalled` từ trước thì câu
  // UPDATE vẫn khớp nhưng không đổi gì. Tra lại hàng là cách duy nhất phân biệt.
  if (!row) return { found: false, ts: 0, fromMe: false };
  return { found: true, ts: Number(row.ts), fromMe: row.from_me === 1 };
}

/**
 * Một trang tin mới nhất, cũ nhất trước. `before` là `msgId` cũ nhất mà UI đã
 * có; trang trả về nằm **trước** nó.
 *
 * Trả `StoreMessage`: tệp đính kèm còn URL gốc của Zalo. Chỗ gọi phải đi qua
 * `toIpcMessage` trước khi phát qua IPC — xem `attachment.ts` về lý do.
 */
export function pageMessages(db: Db, threadId: string, kind: ThreadKind, limit: number,
  before?: string | null): { messages: StoreMessage[]; hasMore: boolean } {
  // Xin `limit + 1` để biết còn tin cũ hơn hay không mà không phải COUNT toàn bảng.
  const take = limit + 1;
  // Tin tạm (`pending:`) bị loại **trong SQL**, không lọc sau khi lấy: lọc sau thì
  // một bong bóng chưa gửi chiếm mất một suất của `take` và làm `hasMore` sai.
  let rows: MessageRow[];
  if (before) {
    // Mốc `before` được tra ra `ts` của nó rồi so trong SQL, vì cột `ts` có
    // index còn `msg_id` thì không. Trong cùng một `ts` (rất hiếm) mới phải so
    // `msg_id` bằng chuỗi — sai số ở đó không ảnh hưởng thứ tự hiển thị vì
    // `pageMessages` sắp lại bằng `compareMsgId` trước khi trả về.
    const anchor = db.handle.prepare(
      'SELECT ts FROM messages WHERE thread_id = ? AND msg_id = ?').get(threadId, before) as
      { ts: number } | undefined;
    if (!anchor) return { messages: [], hasMore: false };
    rows = db.handle.prepare(
      `SELECT * FROM messages
       WHERE thread_id = ? AND msg_id NOT LIKE 'pending:%'
         AND (ts < ? OR (ts = ? AND msg_id < ?))
       ORDER BY ts DESC, msg_id DESC LIMIT ?`).all(threadId, anchor.ts, anchor.ts, before, take) as unknown as MessageRow[];
  } else {
    rows = db.handle.prepare(
      `SELECT * FROM messages WHERE thread_id = ? AND msg_id NOT LIKE 'pending:%'
       ORDER BY ts DESC, msg_id DESC LIMIT ?`)
      .all(threadId, take) as unknown as MessageRow[];
  }
  const hasMore = rows.length > limit;
  // Tin tạm không xen vào giữa trang lịch sử; chúng được nối ở cuối bởi
  // `pageWithPending`.
  const page = rows.slice(0, limit)
    .map(row => toLive(row, kind, db.ownId))
    .sort((a, b) => (a.ts - b.ts) || compareMsgId(a.msgId ?? '', b.msgId ?? ''));
  return { messages: page, hasMore };
}

/**
 * Điền `src`/`thumb` cho tệp đính kèm của **một** tin đã có trong cache.
 *
 * Tách khỏi `upsertMessages` có chủ đích. `upsertMessages` cần cả tin (text, ts,
 * người gửi); ở đây chỉ có đường dẫn vừa tải xong, và tổng hợp một tin giả để
 * đi qua nó sẽ ghi `text: ''` lên một tin có chữ. Hàm này chỉ sửa đúng một cột.
 *
 * `patches` khoá theo **chỉ số** trong mảng `attachments`, không theo URL: thứ tự
 * `attaches` của một tin là cố định, còn URL CDN có thể được ký lại mỗi phiên.
 *
 * Trả `undefined` khi không có hàng, hàng đã thu hồi, hoặc không có tệp — chỗ gọi
 * dùng nó để biết có phải phát lại tin hay không.
 */
export function setMessageMedia(db: Db, threadId: string, msgId: string,
  patches: ReadonlyMap<number, { src: string | null; thumb: string | null; failed?: boolean }>): StoreMessage | undefined {
  if (!msgId || !patches.size) return undefined;
  const row = db.handle.prepare(
    'SELECT * FROM messages WHERE thread_id = ? AND msg_id = ?').get(threadId, msgId) as
    unknown as MessageRow | undefined;
  if (!row || row.recalled === 1) return undefined;
  const items = attachmentsOfRow(row.attachments);
  if (!items?.length) return undefined;
  let changed = false;
  const next = items.map((item, index) => {
    const patch = patches.get(index);
    // Đã có đường dẫn thì không ghi lại: một lần tải lặp không được làm UI vẽ
    // lại ảnh đã hiện (mỗi lần đổi `src` là một lần trình duyệt tải lại ảnh).
    if (!patch || (patch.failed && item.src)
      || (item.src === patch.src && Boolean(item.failed) === Boolean(patch.failed))) return item;
    changed = true;
    return { ...item, src: patch.src, thumb: patch.thumb, failed: patch.failed ?? false };
  });
  if (!changed) return undefined;
  db.handle.prepare('UPDATE messages SET attachments = ? WHERE thread_id = ? AND msg_id = ?')
    .run(JSON.stringify(next), threadId, msgId);
  // `kind` chỉ dùng để dựng `LiveMessage`; chỗ gọi truyền lại loại thật của nó
  // qua `withKind` nếu cần. Ở đây lấy từ hàng `threads` nếu có, mặc định `user`.
  const kindRow = db.handle.prepare('SELECT kind FROM threads WHERE id = ?').get(threadId) as
    { kind?: ThreadKind } | undefined;
  return toLive({ ...row, attachments: JSON.stringify(next) }, kindRow?.kind ?? 'user', db.ownId);
}

/**
 * Tệp đính kèm còn URL gốc của **một** tin, đọc từ cache.
 *
 * Trả `[]` khi không có hàng, hàng đã thu hồi, hoặc tin chỉ có chữ. Dùng bởi
 * `client.mediaJobs`: payload IPC không còn URL, nên danh sách việc tải phải
 * đọc lại từ đây.
 */
export function messageAttachments(db: Db, threadId: string, msgId: string): StoredAttachment[] {
  if (!msgId) return [];
  const row = db.handle.prepare(
    'SELECT attachments, recalled FROM messages WHERE thread_id = ? AND msg_id = ?').get(threadId, msgId) as
    { attachments: string | null; recalled: number } | undefined;
  if (!row || row.recalled === 1) return [];
  return attachmentsOfRow(row.attachments) ?? [];
}

/** Tổng số tin đã cache của một hội thoại — dùng để test và cho chẩn đoán. */
export function countMessages(db: Db, threadId: string): number {
  const row = db.handle.prepare('SELECT COUNT(*) AS c FROM messages WHERE thread_id = ?').get(threadId) as { c: number };
  return Number(row.c);
}

export interface ThreadRow {
  id: string; kind: ThreadKind; title: string | null; avatar_url: string | null; last_msg_id: string | null;
  last_ts: number | null; last_preview: string | null; unread: number; muted: number; pinned: number;
}

/**
 * Tên rỗng hoặc toàn khoảng trắng cũng phải có nhãn: một hàng không tên là hàng không bấm được.
 *
 * `avatar` là đường dẫn **cục bộ** trong `glass://app/avatars/`, không phải URL
 * của Zalo — xem `electron/avatars.ts`. `NULL` là chưa tải về, và UI rơi về biểu
 * tượng mặc định như trước.
 */
export const toLiveThread = (row: ThreadRow): LiveThread => ({
  id: row.id, kind: row.kind,
  name: row.title?.trim() || (row.kind === 'group' ? 'Nhóm Zalo' : 'Người dùng Zalo'),
  avatar: row.avatar_url ?? null, pinned: Boolean(row.pinned), unread: Number(row.unread),
  lastText: row.last_preview ?? '', lastTs: Number(row.last_ts ?? 0),
});

/**
 * Ghi đường dẫn avatar cục bộ cho một hội thoại.
 *
 * Tách khỏi `upsertThreads` có chủ đích: avatar được tải **sau** khi danh sách
 * hội thoại đã hiện, nên nếu nó đi qua `upsertThreads` thì mỗi ảnh về là một lần
 * ghi đè toàn bộ metadata của hội thoại đó bằng bản sao trong RAM — bản có thể
 * đã cũ hơn `last_ts`/`last_preview` vừa được tin nhắn mới cập nhật.
 */
export function setThreadAvatar(db: Db, threadId: string, avatarUrl: string | null): void {
  db.handle.prepare('UPDATE threads SET avatar_url = ? WHERE id = ?').run(avatarUrl, threadId);
}

/** `threadId → avatar_url` đã có, để biết ảnh nào còn phải tải. */
export function threadAvatars(db: Db): Map<string, string> {
  const rows = db.handle.prepare('SELECT id, avatar_url FROM threads WHERE avatar_url IS NOT NULL')
    .all() as unknown as { id: string; avatar_url: string }[];
  return new Map(rows.map(row => [row.id, row.avatar_url]));
}

/**
 * Upsert metadata hội thoại. `last_preview`/`last_ts` chỉ được đẩy **lên**:
 * một trang lịch sử cũ không được làm lùi "tin cuối" về quá khứ.
 */
export function upsertThreads(db: Db, threads: LiveThread[], now = Date.now()): number {
  // Nhãn mặc định **không phải tên**. Đo 2026-11-10: 81/250 hội thoại mang
  // "Người dùng Zalo"/"Nhóm Zalo" dù tên thật đã có trong `threads`. Đồng bộ
  // lịch sử tạo thread trước khi danh sách bạn bè về, rồi mỗi lần ghi sau lại
  // đưa nhãn mặc định vào `excluded.title` và đè ngược lên tên thật. Vì vậy
  // câu `ON CONFLICT` dưới đây chỉ cho tên thay tên.
  const stmt = db.handle.prepare(
    `INSERT INTO threads (id, kind, title, avatar_url, last_msg_id, last_ts, last_preview,
                          unread, muted, pinned, updated_at)
     VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, 0, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       kind = excluded.kind,
       -- Tên chỉ được thay bằng tên, không bao giờ bị thay bằng nhãn mặc định.
       title = CASE
         WHEN excluded.title IS NULL OR excluded.title = ''
           OR excluded.title IN ('Người dùng Zalo', 'Nhóm Zalo')
         THEN COALESCE(threads.title, excluded.title)
         ELSE excluded.title
       END,
       last_ts = MAX(COALESCE(threads.last_ts, 0), COALESCE(excluded.last_ts, 0)),
       last_preview = CASE WHEN COALESCE(excluded.last_ts, 0) >= COALESCE(threads.last_ts, 0)
                           THEN excluded.last_preview ELSE threads.last_preview END,
       unread = excluded.unread, pinned = excluded.pinned, updated_at = excluded.updated_at`);
  let written = 0;
  db.handle.exec('BEGIN');
  try {
    for (const thread of threads) {
      stmt.run(thread.id, thread.kind, thread.name, thread.lastTs || null, thread.lastText,
        Math.max(0, thread.unread), thread.pinned ? 1 : 0, now);
      written += 1;
    }
    db.handle.exec('COMMIT');
  } catch (error) {
    db.handle.exec('ROLLBACK');
    throw error;
  }
  return written;
}

/** Danh sách hội thoại đọc từ cache: mới nhất trước, ghim trước (như UI). */
export function listThreads(db: Db): LiveThread[] {
  const rows = db.handle.prepare(
    'SELECT * FROM threads ORDER BY pinned DESC, COALESCE(last_ts, 0) DESC').all() as unknown as ThreadRow[];
  return rows.map(toLiveThread);
}

export interface SyncState {
  lastSyncedMsgId: string | null;
  oldestLoadedMsgId: string | null;
  hasMoreOlder: boolean;
  lastFullSyncAt: number | null;
}

export function readSyncState(db: Db, threadId: string): SyncState {
  const row = db.handle.prepare('SELECT * FROM sync_state WHERE thread_id = ?').get(threadId) as
    { last_synced_msg_id: string | null; oldest_loaded_msg_id: string | null; has_more_older: number; last_full_sync_at: number | null } | undefined;
  return {
    lastSyncedMsgId: row?.last_synced_msg_id ?? null,
    oldestLoadedMsgId: row?.oldest_loaded_msg_id ?? null,
    hasMoreOlder: row ? Boolean(row.has_more_older) : true,
    lastFullSyncAt: row?.last_full_sync_at ?? null,
  };
}

/**
 * Cập nhật mốc đồng bộ. `oldest`/`last` chỉ tiến hoặc lùi theo đúng chiều của
 * chúng: mốc cũ nhất chỉ được **lùi** (tải thêm tin cũ), mốc mới nhất chỉ được
 * **tiến**. Nếu không, một trang lịch sử cũ sẽ kéo lùi mốc catch-up và lần sau
 * app sẽ xin lại đúng phần đã có.
 */
export function writeSyncState(db: Db, threadId: string, patch: Partial<SyncState>): void {
  const current = readSyncState(db, threadId);
  const older = (next: string | null | undefined, prev: string | null): string | null => {
    if (!next) return prev;
    if (!prev) return next;
    return compareMsgId(next, prev) < 0 ? next : prev;
  };
  const latest = (next: string | null | undefined, prev: string | null): string | null => {
    if (!next) return prev;
    if (!prev) return next;
    return compareMsgId(next, prev) > 0 ? next : prev;
  };
  db.handle.prepare(
    `INSERT INTO sync_state (thread_id, last_synced_msg_id, oldest_loaded_msg_id, has_more_older, last_full_sync_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(thread_id) DO UPDATE SET
       last_synced_msg_id = excluded.last_synced_msg_id,
       oldest_loaded_msg_id = excluded.oldest_loaded_msg_id,
       has_more_older = excluded.has_more_older,
       last_full_sync_at = excluded.last_full_sync_at`)
    .run(threadId,
      latest(patch.lastSyncedMsgId, current.lastSyncedMsgId),
      older(patch.oldestLoadedMsgId, current.oldestLoadedMsgId),
      (patch.hasMoreOlder ?? current.hasMoreOlder) ? 1 : 0,
      patch.lastFullSyncAt === undefined ? current.lastFullSyncAt : patch.lastFullSyncAt);
}
