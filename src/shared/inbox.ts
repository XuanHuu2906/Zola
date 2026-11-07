import type { Chat } from '../renderer/adapters/types.ts';

export const INCOMING_LINES = [
  'Tin nhắn mẫu vừa đến, không đi qua mạng.',
  'Mình vừa gửi thêm một tin để thử thông báo.',
  'Bạn xem giúp mình mục này khi rảnh nhé.',
  'Có tin mới trong cuộc trò chuyện mẫu.',
];

/**
 * Incoming mail must land on a chat the reader is not looking at, otherwise the
 * unread badge would clear on arrival and the workflow could never be observed.
 */
export function pickIncomingTarget(chats: Chat[], activeId: string, seq: number): Chat | null {
  const candidates = chats.filter(chat => chat.id !== activeId);
  if (!candidates.length) return null;
  return candidates[Math.abs(Math.floor(seq)) % candidates.length];
}

export function incomingLine(seq: number): string {
  return INCOMING_LINES[Math.abs(Math.floor(seq)) % INCOMING_LINES.length];
}
