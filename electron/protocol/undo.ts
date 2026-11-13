/**
 * Đọc id từ một sự kiện thu hồi (`cmd 501` cho 1-1, `521` cho nhóm).
 *
 * Tách ra khỏi `zalo-client.ts` vì đây đúng là chỗ đã hỏng một lần, và kiểu
 * hỏng của nó **không tự lộ ra**: đọc nhầm trường thì không có lỗi nào được
 * ném, không có log nào bất thường — chỉ là `markRecalled` chạy trên một dòng
 * không tồn tại, `found: false`, và bong bóng của tin thật giữ nguyên nội dung.
 * Đo 2026-11-11: thu hồi một tin vừa gửi trả `ok: true` từ máy chủ, sự kiện
 * `undo` về đủ, DB vẫn còn nguyên văn bản.
 *
 * Hai thứ khác nhau nằm trong **cùng một** payload:
 *
 * - `msgId` / `cliMsgId` ở tầng ngoài là id của **bản ghi điều khiển** — bản
 *   ghi mang câu "hãy xoá một tin khác". Nó có id riêng, ts riêng, và không
 *   bao giờ trùng với tin bị xoá.
 * - `content.globalMsgId` / `content.cliMsgId` là id của **tin bị xoá**.
 *   zca-js khai đúng hình dạng này trong `TUndoContent`, và `listen.js` chỉ coi
 *   một sự kiện là thu hồi khi `content` có trường `deleteMsg` — tức là có
 *   `content` thì đó là nguồn duy nhất đáng đọc.
 *
 * `null` khi sự kiện không mang id nào dùng được: chỗ gọi bỏ qua nó thay vì
 * thu hồi một dòng có id rỗng (một `UPDATE` với `msg_id = ''` khớp 0 dòng, nên
 * nó cũng vô hại — nhưng `rememberRecall` sẽ ghi nhớ một id rác).
 */

export interface UndoPayload {
  msgId?: unknown;
  content?: unknown;
}

export interface RecalledTarget {
  /** Id máy chủ của tin bị thu hồi. */
  msgId: string;
  /** Id máy khách của tin bị thu hồi, nếu sự kiện có mang. */
  cliMsgId: string | null;
}

/** Chuỗi thập phân khác rỗng và khác `"0"`; Zalo dùng `"0"` làm chỗ giữ. */
const idOf = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[0-9]+$/.test(trimmed) && trimmed !== '0' ? trimmed : null;
};

export function recalledTarget(payload: UndoPayload | null | undefined): RecalledTarget | null {
  if (!payload) return null;
  const content = (payload.content && typeof payload.content === 'object'
    ? payload.content
    : {}) as Record<string, unknown>;
  // `content.globalMsgId` đứng trước, và đường lùi chỉ dùng khi tầng ngoài thật
  // sự có id: nếu cả hai cùng có thì tin bị xoá là tin trong `content` — dùng
  // đường lùi ở đó sẽ thu hồi nhầm bản ghi điều khiển.
  const msgId = idOf(content.globalMsgId) ?? idOf(payload.msgId);
  if (!msgId) return null;
  return { msgId, cliMsgId: idOf(content.cliMsgId) };
}
