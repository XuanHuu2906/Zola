import type { Chat, Filter, MessageAttachment } from '../renderer/types.ts';

/**
 * Nhãn của một loại tệp đính kèm.
 *
 * Ở `shared` chứ không ở `live/map.ts` vì hai chỗ cần nó: preview danh sách hội
 * thoại và mũi trích dẫn trong bong bóng. Một bảng, hai chỗ đọc — nhãn của một
 * loại không được lệch nhau giữa hai chỗ hiển thị.
 */
export const ATTACHMENT_LABELS: Record<MessageAttachment['kind'], string> = {
  photo: 'Hình ảnh', video: 'Video', voice: 'Tin nhắn thoại', sticker: 'Nhãn dán',
  doodle: 'Hình vẽ tay', file: 'Tệp đính kèm', link: 'Liên kết',
  location: 'Vị trí', contact: 'Danh thiếp', gif: 'Ảnh động', other: 'Tệp đính kèm',
};

export function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd').toLocaleLowerCase('vi').trim();
}
export function selectChats<T extends Pick<Chat, 'name' | 'preview' | 'unread' | 'isGroup' | 'pinned' | 'lastTs'>>(
  chats: T[], query: string, filter: Filter,
): T[] {
  const term = normalizeText(query);
  return chats.filter(c => !(filter === 'unread' && !c.unread)
    && !(filter === 'groups' && !c.isGroup)
    && (!term || normalizeText(c.name).includes(term) || normalizeText(c.preview).includes(term)))
    // Ghim trước, rồi **mới nhất lên đầu**. Bản trước chỉ so `pinned`, nên mọi
    // hội thoại không ghim giữ nguyên thứ tự chúng tình cờ đến — đó chính là
    // "đang sắp xếp rất lộn xộn". `lastTs` là mili-giây của tin cuối.
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.lastTs || 0) - (a.lastTs || 0));
}
export const formatClock = (date: Date) => new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit', minute: '2-digit', hour12: false,
}).format(date);

/** Số giờ lệch của hai mốc khi cùng ngày theo lịch máy; `null` nếu khác ngày. */
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/** `HH:mm` — giờ trong ngày, dùng cho cả bong bóng tin và danh sách hội thoại. */
export const formatHour = formatClock;

/** `Thứ Ba` … `Chủ nhật`, để gom tin theo ngày trong khung chat. */
const WEEKDAY = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

/**
 * Mốc thời gian kiểu danh sách hội thoại của Zalo.
 *
 * Bản trước dùng `formatClock` cho mọi thứ, nên một hội thoại im lặng từ tháng
 * trước vẫn hiện `"14:06"` — đọc ra là "mới nhắn cách đây vài phút". Ở đây
 * khoảng cách quyết định hình dạng:
 *
 * - hôm nay → giờ
 * - hôm qua → "Hôm qua"
 * - trong 7 ngày → thứ
 * - cùng năm → ngày/tháng
 * - khác năm → ngày/tháng/năm
 *
 * `now` là tham số chứ không đọc `Date.now()` bên trong: hàm thuần thì test
 * được, và cùng một mốc hiển thị ổn định trong suốt một lần render.
 */
export function formatListTime(ts: number, now: number = Date.now()): string {
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date(now);
  if (sameDay(date, today)) return formatClock(date);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (sameDay(date, yesterday)) return 'Hôm qua';
  // Trong tuần: so theo **ngày lịch** đã trôi, không theo 7×24 giờ — một tin từ
  // 23:50 thứ Hai đọc lúc 00:10 thứ Ba phải là "Thứ Hai", không phải "hôm qua".
  // `Math.round` chứ không `floor`: ngày đổi giờ mùa hè lệch 23 hoặc 25 giờ.
  // Dựng ngày mới thay vì `today.setHours()` — hàm này không được sửa tham số.
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((startOfToday.getTime() - startOfDate.getTime()) / 86_400_000);
  if (days > 0 && days < 7) return WEEKDAY[date.getDay()] ?? '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return date.getFullYear() === today.getFullYear()
    ? `${day}/${month}`
    : `${day}/${month}/${date.getFullYear()}`;
}
/**
 * Nhãn ngăn cách ngày trong khung chat — "Hôm nay", "Hôm qua", "Thứ Ba", "08/10/2023".
 *
 * Khác `formatListTime`: hôm nay ở đây **không** phải giờ. Trong một khung chat,
 * giờ đã nằm trên từng bong bóng; dải ngăn cách mà cũng là giờ thì không nói
 * được hôm đó là ngày nào, và đó chính là lý do một khung chat trải ba năm vẫn
 * hiện một dải "Hôm nay" duy nhất ở trên cùng.
 */
export function formatDayLabel(ts: number, now: number = Date.now()): string {
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date(now);
  if (sameDay(date, today)) return 'Hôm nay';
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (sameDay(date, yesterday)) return 'Hôm qua';
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((startOfToday.getTime() - startOfDate.getTime()) / 86_400_000);
  if (days > 0 && days < 7) return WEEKDAY[date.getDay()] ?? '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return date.getFullYear() === today.getFullYear()
    ? `${day}/${month}`
    : `${day}/${month}/${date.getFullYear()}`;
}

/**
 * `rIcon` của Zalo → emoji để vẽ.
 *
 * Zalo gửi cảm xúc dưới dạng **tên biểu tượng** (`"/-heart"`, `":>"`), không
 * phải emoji; bảng dưới đây là bản dịch duy nhất, và khoá của nó là giá trị
 * `rType → rIcon` lấy từ chính bundle Zalo PC (xem `electron/protocol/reactions.ts`).
 *
 * Biểu tượng không có trong bảng thì hiện **nguyên `rIcon`**: Zalo thêm biểu
 * tượng mới theo thời gian, và một ô trống còn tệ hơn một chuỗi lạ — người dùng
 * ít nhất còn thấy là có người đã thả gì đó.
 */
export const REACTION_EMOJI: Record<string, string> = {
  '/-heart': '❤️', '/-strong': '👍', ':>': '😆', ':o': '😮', ':-((': '😢',
  ':-h': '😠', ':-*': '😘', ":')": '😂', '/-shit': '💩', '/-rose': '🌹',
  '/-break': '💔', '/-weak': '👎', ';xx': '😍', ';-/': '😕', ';-)': '😉',
  '/-fade': '🥀', '/-li': '☀️', '/-bd': '🎂', '/-bome': '💣', '/-ok': '👌',
  '/-v': '✌️', '/-thanks': '🙏', '/-punch': '👊', '/-share': '🤝', '_()_': '🙏',
  '/-no': '🚫', '/-bad': '🤢', '/-loveu': '💘', '--b': '😞', ':((': '😭',
  'x-)': '😎', '8-)': '🤓', ';-d': '😄', 'b-)': '😎', ':--|': '😐',
  'p-(': '😔', ':-bye': '👋', '|-)': '😴', ':wipe': '😅', ':-dig': '⛏️',
  '&-(': '😖', ':handclap': '👏', '>-|': '😡', ':-f': '🖕', ':-l': '🖕',
  ':-r': '🖕', ';-x': '🤐', ':-o': '😯', ';-s': '😳', ';-a': '😨',
  ':-<': '☹️', ':))': '😁', '$-)': '🤑', '/-beer': '🍺',
  '🎄': '🎄', '⛄️': '⛄', '🎁': '🎁',
};

/** Emoji để vẽ một cảm xúc; không nhận ra thì trả lại chính `rIcon`. */
export const reactionEmoji = (icon: string): string => REACTION_EMOJI[icon] ?? icon;
