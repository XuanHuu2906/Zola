import type { Chat, DeliveryStatus, Message, MessageAttachment, MessageQuote, MessageReaction } from '../types.ts';
import type { LiveMessage, LiveThread } from '../../shared/ipc-contract.ts';
import { ATTACHMENT_LABELS, formatClock, formatListTime } from '../../shared/logic.ts';

/**
 * Chuyển dữ liệu live (đã map ở main) sang mô hình UI. Hàm thuần, không đọc
 * `window` hay store, nên `tests/live.test.ts` kiểm được mà không cần renderer.
 *
 * Id số vẫn là khoá React/`aria-label` của UI, nên tin thật được cấp id số tại
 * đây; `msgId`/`clientId` của server đi kèm trên hàng để lần "Gửi lại" và tin
 * dội về có thể nối đúng bong bóng.
 */

export const nextMessageId = (chats: Chat[]): number =>
  Math.max(0, ...chats.flatMap(chat => chat.messages.map(message => message.id))) + 1;

const clock = (ts: number): string => (Number.isFinite(ts) && ts > 0 ? formatClock(new Date(ts)) : '');

/**
 * Mốc thời gian cho **danh sách hội thoại** — "Hôm qua", "Thứ Ba", "08/10".
 *
 * Khác `clock` (luôn `HH:mm`) ở chỗ: một hội thoại im lặng từ tháng trước mà
 * hiện "14:06" thì đọc ra là "mới nhắn vài phút trước". Đó là phần "mốc thời
 * gian cũng sai" trong báo cáo. Bong bóng tin trong khung chat vẫn dùng `clock`
 * vì ở đó đã có dải ngày ngăn cách.
 */
const listTime = (ts: number): string => formatListTime(ts);

const previewOf = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, 90);

/**
 * Preview của một tin có thể **chỉ** có tệp. Trả chuỗi rỗng khi không có gì để
 * nói, để chỗ gọi còn dùng được `|| chat.preview` như trước.
 *
 * Nhãn loại nằm ở `shared/logic.ts` — mũi trích dẫn trong bong bóng cũng dùng
 * đúng bảng đó, nên một loại tệp không thể có hai tên.
 */
export function previewOfMessage(live: Pick<LiveMessage, 'text' | 'attachments'>): string {
  const text = previewOf(live.text);
  if (text) return text;
  const first = live.attachments?.[0];
  if (!first) return '';
  // Tên tệp cụ thể hơn nhãn loại khi có: "Báo cáo Q3.pdf" đọc hữu ích hơn
  // "Tệp đính kèm".
  return (first.title || ATTACHMENT_LABELS[first.kind]).slice(0, 90);
}

/** Chép tệp đính kèm từ payload IPC sang model UI; `undefined` khi không có. */
const attachmentsOf = (live: LiveMessage): MessageAttachment[] | undefined => {
  if (!live.attachments?.length) return undefined;
  return live.attachments.map(item => ({ ...item }));
};

/** Chép trích dẫn sang model UI; `undefined` khi tin không trả lời ai. */
const quoteOf = (live: LiveMessage): MessageQuote | undefined =>
  live.quote ? { ...live.quote } : undefined;

/**
 * Cảm xúc đã gộp sang model UI. Mảng **mới** mỗi lần (không dùng lại mảng của
 * payload): main phát lại cùng một tin khi tệp đính kèm về, và hai lần phát phải
 * không chia sẻ object với nhau.
 */
const reactionsOf = (live: LiveMessage): MessageReaction[] | undefined =>
  live.reactions?.length ? live.reactions.map(item => ({ ...item })) : undefined;

/**
 * Các trường của bong bóng mà **mọi** đường dựng tin đều phải chép — tin mới,
 * tin lịch sử, và trang lịch sử cũ.
 *
 * Gộp vào một chỗ vì đây đúng là chỗ đã hỏng ba lần theo ba cách khác nhau: mỗi
 * trường mới (tệp đính kèm, trích dẫn, cảm xúc) ban đầu được thêm vào một nhánh
 * rồi quên hai nhánh còn lại, và triệu chứng luôn giống nhau — "tính năng chỉ
 * chạy với tin vừa tới".
 */
function rowOf(live: LiveMessage, id: number): Message {
  const attachments = attachmentsOf(live);
  const quote = quoteOf(live);
  const reactions = reactionsOf(live);
  return {
    id, from: live.from, time: clock(live.ts) || formatClock(new Date()),
    text: live.text,
    ...(live.fromName ? { fromName: live.fromName } : {}),
    ...(live.senderAvatar ? { senderAvatar: live.senderAvatar } : {}),
    // `ts` đi kèm **mọi** tin, không chỉ tin lịch sử: dải ngăn cách ngày trong
    // khung chat đọc nó để biết hôm đó là ngày nào.
    ...(live.ts > 0 ? { ts: live.ts } : {}),
    ...(attachments ? { attachments } : {}),
    ...(live.mentions?.length ? { mentions: live.mentions } : {}),
    ...(live.msgId ? { msgId: live.msgId } : {}),
    ...(live.cliMsgId ? { cliMsgId: live.cliMsgId } : {}),
    ...(live.recalled ? { recalled: true } : {}),
    ...(quote ? { quote } : {}),
    ...(reactions ? { reactions } : {}),
    ...(live.from === 'me' ? { status: 'sent' as DeliveryStatus } : {}),
  };
}

/**
 * Ghim trước, rồi mới nhất lên đầu — cùng quy tắc với `selectChats`.
 *
 * Bản trước chỉ so `pinned`, nên các hội thoại không ghim giữ nguyên thứ tự
 * chúng tình cờ được nạp; đó là lý do danh sách "lộn xộn" dù `last_ts` trong DB
 * đúng. Sắp ở đây chứ không chỉ ở chỗ lọc, để state cũng đúng thứ tự — nếu chỉ
 * sắp lúc render thì mỗi lần thêm hội thoại lại phải sắp lại từ đầu.
 */
const pinnedFirst = (chats: Chat[]): Chat[] =>
  [...chats].sort((a, b) =>
    Number(b.pinned) - Number(a.pinned) || (b.lastTs || 0) - (a.lastTs || 0));

export function threadToChat(thread: LiveThread): Chat {
  return {
    id: thread.id, name: thread.name, avatar: thread.avatar,
    pinned: thread.pinned, unread: thread.unread,
    isGroup: thread.kind === 'group',
    time: listTime(thread.lastTs), preview: previewOf(thread.lastText),
    lastTs: Number.isFinite(thread.lastTs) ? thread.lastTs : 0,
    messages: [], historyRemaining: 0,
  };
}

/** Cập nhật metadata hội thoại, giữ nguyên tin đã có; không bao giờ xoá preview cũ bằng chuỗi rỗng. */
export function upsertThread(chats: Chat[], thread: LiveThread, activeId: string): Chat[] {
  const unread = thread.id === activeId ? 0 : thread.unread;
  const index = chats.findIndex(chat => chat.id === thread.id);
  if (index < 0) return pinnedFirst([threadToChat({ ...thread, unread }), ...chats]);
  return pinnedFirst(chats.map(chat => chat.id === thread.id ? {
    ...chat, name: thread.name, pinned: thread.pinned, unread,
    // Avatar về **sau** danh sách hội thoại (main tải ảnh rồi mới phát sự kiện
    // thứ hai cho cùng hội thoại), nên nó phải được chép ở đây. Không chép thì
    // mọi avatar tải xong đều nằm trên đĩa mà UI vẫn vẽ biểu tượng mặc định.
    // `null` từ server không được xoá ảnh đã có: danh sách từ `getAllFriends`
    // luôn mang `avatar: null` và nó không phải một lần "gỡ ảnh".
    avatar: thread.avatar ?? chat.avatar,
    time: listTime(thread.lastTs) || chat.time,
    preview: previewOf(thread.lastText) || chat.preview,
    lastTs: thread.lastTs > 0 ? thread.lastTs : chat.lastTs,
  } : chat));
}

export function appendOutgoing(chats: Chat[], chatId: string, text: string, clientId: string, now: Date): Chat[] {
  const id = nextMessageId(chats);
  return chats.map(chat => chat.id === chatId ? {
    ...chat,
    messages: [...chat.messages, { id, from: 'me', time: formatClock(now), text, status: 'pending', clientId }],
    preview: previewOf(text), time: formatClock(now),
  } : chat);
}

/** Gắn kết quả gửi vào đúng bong bóng tạm; `clientId` là chìa khoá duy nhất. */
export function settleOutgoing(chats: Chat[], clientId: string, patch: { status: DeliveryStatus; msgId?: string }): Chat[] {
  return chats.map(chat => {
    const index = chat.messages.findIndex(message => message.clientId === clientId);
    if (index < 0) return chat;
    const row: Message = {
      ...chat.messages[index], status: patch.status,
      ...(patch.msgId ? { msgId: patch.msgId } : {}),
    };
    return { ...chat, messages: chat.messages.map((message, at) => (at === index ? row : message)) };
  });
}

function enrichKnownSender(chats: Chat[], live: LiveMessage): Chat[] {
  if (!live.msgId || (!live.fromName && !live.senderAvatar && !live.mentions?.length)) return chats;
  const chat = chats.find(item => item.id === live.threadId);
  const index = chat?.messages.findIndex(message => message.msgId === live.msgId) ?? -1;
  if (!chat || index < 0) return chats;
  const existing = chat.messages[index];
  if ((!live.fromName || existing.fromName === live.fromName)
    && (!live.senderAvatar || existing.senderAvatar === live.senderAvatar)
    && (!live.mentions?.length || JSON.stringify(existing.mentions ?? []) === JSON.stringify(live.mentions))) return chats;
  return chats.map(item => item.id === live.threadId ? {
    ...item,
    messages: item.messages.map((message, at) =>
      at === index ? {
        ...message,
        ...(live.fromName ? { fromName: live.fromName } : {}),
        ...(live.senderAvatar ? { senderAvatar: live.senderAvatar } : {}),
        ...(live.mentions?.length ? { mentions: live.mentions } : {}),
      } : message),
  } : item);
}

/**
 * Tin đến từ server. Bỏ qua tin đã có cùng `msgId` — server dội lại chính tin
 * mình vừa gửi, và bản sao đó không được thành bong bóng thứ hai.
 */
export function appendIncoming(chats: Chat[], live: LiveMessage, activeId: string): Chat[] {
  const known = chats.find(chat => chat.id === live.threadId);
  if (known && live.msgId && known.messages.some(message => message.msgId === live.msgId)) {
    return enrichKnownSender(chats, live);
  }

  const row = rowOf(live, nextMessageId(chats));

  if (!known) {
    // Main luôn phát thread trước message; nhánh này chỉ để không mất tin nếu
    // thứ tự đó đổi. Tên hội thoại sẽ được thread event kế tiếp sửa lại.
    const placeholder = threadToChat({
      id: live.threadId, kind: live.kind,
      name: live.kind === 'group' ? 'Nhóm Zalo' : 'Người dùng Zalo',
      avatar: null, pinned: false, unread: 0, lastText: live.text, lastTs: live.ts,
    });
    return pinnedFirst([{ ...placeholder, messages: [row] }, ...chats]);
  }

  return chats.map(chat => chat.id === live.threadId ? {
    ...chat, messages: [...chat.messages, row],
    unread: live.threadId === activeId ? 0 : chat.unread,
    preview: previewOfMessage(live) || chat.preview,
    time: clock(live.ts) || chat.time,
  } : chat);
}

/** Chèn một tin lịch sử vào đúng chỗ theo thời điểm, không vào cuối danh sách. */
export function insertBackfill(chats: Chat[], live: LiveMessage, activeId: string): Chat[] {
  const known = chats.find(chat => chat.id === live.threadId);
  if (known && live.msgId && known.messages.some(message => message.msgId === live.msgId)) {
    return enrichKnownSender(chats, live);
  }

  const row = rowOf(live, nextMessageId(chats));

  if (!known) {
    // Hội thoại chưa có trên máy: nó vẫn là một hội thoại thật, và tin lịch sử
    // là thứ duy nhất ta biết về nó. Xếp cuối danh sách, không ghim lên đầu —
    // một hội thoại từ ba năm trước không phải hoạt động gần đây.
    const placeholder = threadToChat({
      id: live.threadId, kind: live.kind,
      name: live.kind === 'group' ? 'Nhóm Zalo' : 'Người dùng Zalo',
      avatar: null, pinned: false, unread: 0, lastText: live.text, lastTs: live.ts,
    });
    return [...chats, { ...placeholder, messages: [row] }];
  }

  return chats.map(chat => {
    if (chat.id !== live.threadId) return chat;
    // Tìm vị trí đầu tiên **mới hơn** tin này; không tìm thấy nghĩa là tin mới
    // nhất và được nối vào cuối. So với `ts` chứ không `msgId`: id của Zalo
    // không đảm bảo tăng theo thời gian giữa các nguồn khác nhau.
    const at = chat.messages.findIndex(message =>
      typeof message.ts === 'number' && live.ts > 0 && message.ts > live.ts);
    const messages = at < 0
      ? [...chat.messages, row]
      : [...chat.messages.slice(0, at), row, ...chat.messages.slice(at)];
    // Preview chỉ đổi khi tin này **mới hơn** tin cuối: một gói lịch sử cũ không
    // được đẩy hội thoại về một dòng tin của nhiều năm trước.
    const newest = chat.messages[chat.messages.length - 1];
    const latest = at < 0 || !newest || live.ts >= (newest.ts ?? 0);
    return {
      ...chat, messages,
      unread: chat.id === activeId ? 0 : chat.unread,
      ...(latest ? { preview: previewOfMessage(live) || chat.preview, time: clock(live.ts) || chat.time } : {}),
    };
  });
}

/**
 * Cảm xúc của một tin vừa đổi: sửa **tại chỗ**, không thêm bong bóng và không
 * đụng `preview`/`time`.
 *
 * Cùng hình dạng sự kiện với tin mới (`evMessageUpsert`), nên phải rẽ nhánh trước
 * `appendIncoming`: một tin cũ vừa được thả tim không phải tin mới đến, và nối nó
 * xuống cuối hội thoại là đặt lại một tin của năm ngoái ở chỗ sai.
 *
 * Dùng `reactions` vắng mặt để nhận ra "không phải sự kiện cảm xúc": main luôn
 * gửi trường này khi phát lại sau một thay đổi cảm xúc, kể cả khi kết quả là rỗng
 * (mục cuối cùng bị gỡ).
 */
export function applyReactions(chats: Chat[], live: LiveMessage): Chat[] | null {
  // Cờ `reacted` là thứ duy nhất phân biệt được "người cuối cùng gỡ cảm xúc"
  // (`reactions` rỗng) với "tin thường" (không có `reactions`). Suy từ sự có
  // mặt của trường là cách cũ và nó bỏ sót đúng trường hợp gỡ hết.
  if (!live.reacted || !live.msgId) return null;
  const chat = chats.find(item => item.id === live.threadId);
  if (!chat) return null;
  const index = chat.messages.findIndex(message => message.msgId === live.msgId);
  // Bong bóng chưa tải về (tin cũ chưa cuộn tới): không có gì để sửa, và phải
  // nói **đã xử lý** chứ không trả `null` — trả `null` là để sự kiện rơi tiếp
  // xuống `appendIncoming`, tức là thêm một bong bóng rỗng vào cuối hội thoại.
  if (index < 0) return chats;
  const next = reactionsOf(live);
  const current = chat.messages[index];
  // Cùng tập cảm xúc thì trả nguyên: máy chủ phát lại một sự kiện đã áp không
  // được làm React vẽ lại cả dải tin.
  if (sameReactions(current.reactions, next)) return chats;
  const messages = chat.messages.map((message, at) => (at === index
    ? { ...message, ...(next ? { reactions: next } : { reactions: undefined }) }
    : message));
  return chats.map(item => (item.id === chat.id ? { ...item, messages } : item));
}

const sameReactions = (a: MessageReaction[] | undefined, b: MessageReaction[] | undefined): boolean => {
  if ((a?.length ?? 0) !== (b?.length ?? 0)) return false;
  return (a ?? []).every((item, at) => {
    const other = b?.[at];
    return !!other && other.icon === item.icon && other.count === item.count && other.mine === item.mine;
  });
};

/**
 * Bản sao lạc quan của cảm xúc sau khi người dùng bấm: thêm/bớt **một** người
 * (chính mình) khỏi đúng biểu tượng đó.
 *
 * Ghi tại UI ngay chứ không đợi máy chủ: cảm xúc là thao tác một cú bấm, và chờ
 * một vòng mạng thì nút trông như không ăn. Main phát lại trạng thái thật khi
 * sự kiện `reaction` về, nên bản lạc quan chỉ sống trong khoảng đó.
 */
export function toggleReaction(messages: Message[], messageId: number, icon: string): Message[] {
  return messages.map(message => {
    if (message.id !== messageId) return message;
    const list = message.reactions ?? [];
    const existing = list.find(item => item.icon === icon);
    // Bấm lại đúng biểu tượng đã thả là **gỡ** — cùng quy ước với Zalo.
    if (existing?.mine) {
      const next = list
        .map(item => (item.icon === icon ? { ...item, count: item.count - 1, mine: false } : item))
        .filter(item => item.count > 0);
      return { ...message, ...(next.length ? { reactions: next } : { reactions: undefined }) };
    }
    // Người dùng chỉ thả được một biểu tượng mỗi tin: thả biểu tượng khác là
    // **đổi**, nên cái cũ của mình bị bỏ trước.
    const moved = list
      .map(item => (item.mine ? { ...item, count: item.count - 1, mine: false } : item))
      .filter(item => item.count > 0);
    const target = moved.find(item => item.icon === icon);
    const next = target
      ? moved.map(item => (item.icon === icon ? { ...item, count: item.count + 1, mine: true } : item))
      : [...moved, { icon, count: 1, mine: true }].sort((a, b) => b.count - a.count);
    return { ...message, reactions: next };
  });
}

const sameMessage = (a: Pick<Message, 'msgId'>, b: Pick<Message, 'msgId'>): boolean =>
  Boolean(a.msgId && b.msgId && a.msgId === b.msgId);

/** Nhãn hiển thị thay cho nội dung của một tin đã thu hồi (plan §6.10). */
export const RECALLED_LABEL = 'Tin nhắn đã thu hồi';

/**
 * Một tin vừa bị thu hồi. Dòng **ở lại** đúng chỗ cũ, chỉ mất nội dung — đó là
 * hành vi plan §6.10 yêu cầu, và cũng là điều người dùng thấy trên Zalo.
 *
 * Không tìm thấy dòng thì trả nguyên `chats`: thu hồi của một tin chưa tải về
 * không có bong bóng nào để sửa, và thêm một bong bóng "đã thu hồi" ở cuối hội
 * thoại sẽ đặt tin vào sai chỗ. Khi lịch sử về sau, cờ đã nằm trong `LiveMessage`
 * từ cache nên `prependHistory` dựng đúng dòng đã thu hồi.
 */
export function applyRecall(chats: Chat[], live: LiveMessage): Chat[] {
  if (!live.recalled || !live.msgId) return chats;
  const chat = chats.find(item => item.id === live.threadId);
  if (!chat) return chats;
  const index = chat.messages.findIndex(message => message.msgId === live.msgId);
  if (index < 0) return chats;
  const recalledRow = { ...chat.messages[index], text: '', mentions: undefined, recalled: true };
  const messages = chat.messages.map((message, at) => (at === index ? recalledRow : message));
  // Preview của hội thoại lấy từ tin cuối; thu hồi đúng tin cuối thì nó cũng
  // không còn nội dung để hiện.
  const isLast = index === chat.messages.length - 1;
  return chats.map(item => (item.id === chat.id
    ? { ...item, messages, ...(isLast ? { preview: RECALLED_LABEL } : {}) }
    : item));
}

/**
 * Một tệp đính kèm vừa tải xong: sửa **tại chỗ** bong bóng đã có.
 *
 * Không tạo bong bóng mới và không đụng `preview`/`time`: nội dung tệp đến muộn
 * không phải một tin mới, và `msgId` là thứ duy nhất để nhận ra dòng cần sửa.
 * Trả nguyên `chats` khi không tìm thấy — tệp của một tin chưa tải về sẽ được
 * đọc lại từ cache ở lần mở hội thoại sau.
 */
export function applyMedia(chats: Chat[], live: LiveMessage): Chat[] {
  if (!live.msgId || !live.attachments?.length) return chats;
  const chat = chats.find(item => item.id === live.threadId);
  if (!chat) return chats;
  const index = chat.messages.findIndex(message => message.msgId === live.msgId);
  if (index < 0) return chats;
  const next = attachmentsOf(live);
  if (!next) return chats;
  const current = chat.messages[index];
  // Cùng một tập đường dẫn thì không có gì mới: phát lại y nguyên sẽ làm React
  // vẽ lại cả dải tin và mỗi ảnh tải lại một lần.
  const same = current.attachments?.length === next.length
    && current.attachments.every((item, at) => item.src === next[at].src && item.thumb === next[at].thumb
      && Boolean(item.failed) === Boolean(next[at].failed));
  if (same) return chats;
  const messages = chat.messages.map((message, at) =>
    (at === index ? { ...message, attachments: next } : message));
  return chats.map(item => (item.id === chat.id ? { ...item, messages } : item));
}

/** `msgId` là chuỗi số: so sánh chuỗi sẽ xếp "9" sau "10", nên so bằng số nếu được. */
const byMsgId = (a: string | null, b: string | null): number => {
  if (!a || !b) return 0;
  try { return Number(BigInt(a) - BigInt(b)) || 0; }
  catch { return a < b ? -1 : a > b ? 1 : 0; }
};

/**
 * Gộp một trang lịch sử từ server vào hội thoại đang mở.
 *
 * Server trả tin cũ hơn phần đã có, nên chúng phải đứng **trước** trong mảng —
 * UI render theo thứ tự mảng và không sắp xếp lại. Trang lịch sử cũng có thể
 * chồng lấn phần đã có (người dùng bấm tải lại), nên tin trùng `msgId` bị bỏ;
 * không khử trùng thì mỗi lần tải sẽ nhân đôi bong bóng.
 *
 * Id số là khoá React nên tin chèn vào nhận id mới từ `nextMessageId` — **không**
 * cấp lại id của tin cũ. `ChatPane` nhận ra một trang vừa chèn bằng
 * `messages[0].id` đổi trong khi số lượng tăng, và giữ nguyên vị trí đang đọc;
 * nếu id đầu mảng giữ nguyên thì nó tưởng là tin mới và nhảy xuống cuối.
 *
 * Hàm thuần: `tests/live.test.ts` kiểm được mà không cần store.
 */
export function prependHistory(chats: Chat[], chatId: string, older: LiveMessage[]): Chat[] {
  if (!older.length) return chats;
  const target = chats.find(chat => chat.id === chatId);
  if (!target) return chats;
  const rows = [...older]
    // Trang trả về có thể lộn thứ tự; xếp theo thời điểm rồi tới `msgId` để ổn định.
    .sort((a, b) => (a.ts - b.ts) || byMsgId(a.msgId, b.msgId))
    .filter(live => !target.messages.some(existing => sameMessage(existing, { msgId: live.msgId ?? undefined })));
  if (!rows.length) return chats;
  let id = nextMessageId(chats);
  const fresh: Message[] = rows.map(live => rowOf(live, id++));
  return chats.map(chat => (chat.id === chatId
    ? { ...chat, messages: [...fresh, ...chat.messages] }
    : chat));
}

/** Một hàng tin nhắn live còn thiếu dữ liệu gửi lại thì không thể "Gửi lại". */
export function retryTarget(chats: Chat[], chatId: string, messageId: number): { kind: 'user' | 'group'; text: string; clientId: string } | null {
  const chat = chats.find(item => item.id === chatId);
  const row = chat?.messages.find(message => message.id === messageId);
  if (!chat || !row || row.status !== 'failed' || !row.clientId || !row.text) return null;
  return { kind: chat.isGroup ? 'group' : 'user', text: row.text, clientId: row.clientId };
}
