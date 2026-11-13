import type { LiveReaction } from '../ipc-contract.js';

/**
 * Trạng thái cảm xúc của một tin, đúng như Zalo gửi: **uid người thả → `rIcon`**.
 *
 * Vì sao là bản đồ người→biểu tượng chứ không phải bảng đếm sẵn: sự kiện `reaction`
 * của Zalo là hành động của **một người** — thả, đổi, hoặc bỏ — và sự kiện bỏ
 * (`rType < 0`) không nói đã bỏ biểu tượng nào (`rIcon` đi kèm là `""`). Giữ ai
 * thả cái gì thì "bỏ" chỉ là xoá một khoá, không cần đoán; còn bảng đếm sẵn sẽ
 * trôi dần mỗi lần ai đó bỏ cảm xúc. Con số hiện trên bong bóng được cộng ra lúc
 * đọc (`aggregateReactions`).
 *
 * Một người chỉ thả được **một** biểu tượng lên một tin, nên khoá là uid chứ
 * không phải (uid, icon): đổi cảm xúc là ghi đè, không phải thêm.
 */
export type ReactionMap = Record<string, string>;

/** Một hành động cảm xúc, đã bóc khỏi payload của zca-js. */
export interface ReactionAction {
  /** uid của người thả. Rỗng thì không áp được — xem `applyReaction`. */
  uid: string;
  /** `rIcon` (`"/-heart"`, `":>"`, …). */
  icon: string;
  /** `true` = gỡ cảm xúc (Zalo gửi `rType < 0`). */
  remove: boolean;
}

/**
 * `rType < 0` là **gỡ** cảm xúc, không phải một biểu tượng thứ n.
 *
 * Đọc từ chính bundle Zalo PC: `_pushToResultData` làm `a.rType<0 ? … : {"-1":1}`
 * và dùng `{rType:-1, rIcon:""}` làm giá trị "không có cảm xúc". `rIcon` rỗng đi
 * kèm, nên kiểm nó là đủ khi `rType` không có trong payload.
 */
export function isRemoval(rType: number, icon: string): boolean {
  return rType < 0 || !icon;
}

/**
 * Áp một hành động lên bản đồ. Trả **nguyên** `current` khi hành động không đổi
 * gì (gỡ một cảm xúc vốn không có, hoặc thả lại đúng biểu tượng cũ): chỗ gọi dùng
 * so sánh tham chiếu để bỏ qua một lần ghi DB và một lần phát IPC.
 *
 * uid rỗng bị bỏ qua thay vì ghi dưới khoá `""`: một khoá rỗng là một người
 * không tồn tại, và nó sẽ cộng vào số đếm của biểu tượng đó mãi mãi.
 */
export function applyReaction(current: ReactionMap | undefined, action: ReactionAction): ReactionMap {
  const map = current ?? {};
  if (!action.uid) return map;
  if (action.remove) {
    if (!(action.uid in map)) return map;
    const next = { ...map };
    delete next[action.uid];
    return next;
  }
  if (!action.icon) return map;
  if (map[action.uid] === action.icon) return map;
  return { ...map, [action.uid]: action.icon };
}

/**
 * Cộng bản đồ thành danh sách hiển thị: một phần tử cho mỗi **loại** biểu tượng.
 *
 * Sắp theo số người giảm dần rồi tới `icon` để thứ tự không nhảy khi một người
 * đổi cảm xúc; Zalo PC cũng hiện biểu tượng nhiều nhất trước.
 *
 * `ownUid` quyết định `mine`. Không biết uid của mình (`null`) thì `mine` là
 * `false` cho mọi mục — thà thiếu một đường viền hơn là tô đậm phản ứng của
 * người khác thành của mình.
 */
export function aggregateReactions(map: ReactionMap | undefined, ownUid: string | null): LiveReaction[] {
  if (!map) return [];
  const counts = new Map<string, { count: number; mine: boolean }>();
  for (const [uid, icon] of Object.entries(map)) {
    if (!icon) continue;
    const entry = counts.get(icon) ?? { count: 0, mine: false };
    entry.count += 1;
    if (ownUid !== null && uid === ownUid) entry.mine = true;
    counts.set(icon, entry);
  }
  return [...counts.entries()]
    .map(([icon, entry]) => ({ icon, count: entry.count, mine: entry.mine }))
    .sort((a, b) => b.count - a.count || (a.icon < b.icon ? -1 : a.icon > b.icon ? 1 : 0));
}

/**
 * Đọc cột `reactions`. JSON hỏng trả bản đồ rỗng chứ không ném: một hàng ghi dở
 * không được làm hỏng cả trang tin. Chỉ nhận cặp chuỗi→chuỗi.
 */
export function parseReactionMap(raw: string | null | undefined): ReactionMap {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const map: ReactionMap = {};
    for (const [uid, icon] of Object.entries(parsed as Record<string, unknown>)) {
      if (uid && typeof icon === 'string' && icon) map[uid] = icon;
    }
    return map;
  } catch { return {}; }
}
