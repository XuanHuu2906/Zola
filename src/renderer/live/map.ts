import type { Chat, DeliveryStatus, Message } from '../adapters/types.ts';
import type { LiveMessage, LiveThread } from '../../shared/ipc-contract.ts';
import { formatClock } from '../../shared/logic.ts';

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

const previewOf = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, 90);

const pinnedFirst = (chats: Chat[]): Chat[] =>
  [...chats].sort((a, b) => Number(b.pinned) - Number(a.pinned));

export function threadToChat(thread: LiveThread): Chat {
  return {
    id: thread.id, name: thread.name, avatar: null,
    pinned: thread.pinned, unread: thread.unread,
    isGroup: thread.kind === 'group', isWork: false,
    time: clock(thread.lastTs), preview: previewOf(thread.lastText),
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
    time: clock(thread.lastTs) || chat.time,
    preview: previewOf(thread.lastText) || chat.preview,
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

/**
 * Tin đến từ server. Bỏ qua tin đã có cùng `msgId` — server dội lại chính tin
 * mình vừa gửi, và bản sao đó không được thành bong bóng thứ hai.
 */
export function appendIncoming(chats: Chat[], live: LiveMessage, activeId: string): Chat[] {
  const known = chats.find(chat => chat.id === live.threadId);
  if (known && live.msgId && known.messages.some(message => message.msgId === live.msgId)) return chats;

  const row: Message = {
    id: nextMessageId(chats), from: live.from, time: clock(live.ts) || formatClock(new Date()),
    text: live.text,
    ...(live.msgId ? { msgId: live.msgId } : {}),
    ...(live.from === 'me' ? { status: 'sent' as DeliveryStatus } : {}),
  };

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
    preview: previewOf(live.text) || chat.preview,
    time: clock(live.ts) || chat.time,
  } : chat);
}

/** Một hàng tin nhắn live còn thiếu dữ liệu gửi lại thì không thể "Gửi lại". */
export function retryTarget(chats: Chat[], chatId: string, messageId: number): { kind: 'user' | 'group'; text: string; clientId: string } | null {
  const chat = chats.find(item => item.id === chatId);
  const row = chat?.messages.find(message => message.id === messageId);
  if (!chat || !row || row.status !== 'failed' || !row.clientId || !row.text) return null;
  return { kind: chat.isGroup ? 'group' : 'user', text: row.text, clientId: row.clientId };
}
