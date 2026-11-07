import type { Chat, Message } from '../renderer/adapters/types.ts';

export const HISTORY_LINES = [
  'Chào bạn, mình gửi lại nội dung cũ để bạn xem nhé.',
  'Đoạn này nằm trong lịch sử mẫu của cuộc trò chuyện.',
  'Mốc thời gian cũ được dựng cục bộ, không gọi máy chủ.',
  'Tin nhắn cũ chỉ để thử cuộn và tải trang tiếp theo.',
];

export const MAX_HISTORY_PAGE = 50;

export function clampPageSize(pageSize: number): number {
  if (!Number.isFinite(pageSize)) return 1;
  return Math.max(1, Math.min(MAX_HISTORY_PAGE, Math.floor(pageSize)));
}

/**
 * Materialise one page of older history. Older rows are new records, so they take
 * ids above every loaded id: ids stay positive and unique, and display order comes
 * from array order, never from the id.
 */
export function buildOlderPage(
  chat: Chat, allChats: Chat[], pageSize = 10,
): { messages: Message[]; remaining: number } {
  const remaining = Math.max(0, chat.historyRemaining);
  const count = Math.min(clampPageSize(pageSize), remaining);
  if (count === 0) return { messages: [], remaining };
  let nextId = Math.max(0, ...allChats.flatMap(c => c.messages.map(m => m.id))) + 1;
  const loaded = chat.messages.length;
  const messages: Message[] = Array.from({ length: count }, (_, i) => {
    const from = i % 2 === 0 ? 'them' : 'me';
    const hour = String(8 + ((loaded + i) % 3)).padStart(2, '0');
    const minute = String(((loaded + i) * 11) % 60).padStart(2, '0');
    return {
      id: nextId++, from, time: `${hour}:${minute}`,
      text: HISTORY_LINES[(loaded + i) % HISTORY_LINES.length],
      ...(from === 'me' ? { status: 'sent' as const } : {}),
    };
  });
  return { messages, remaining: remaining - count };
}
