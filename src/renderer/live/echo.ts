import type { Chat } from '../adapters/types.ts';
import type { LiveMessage } from '../../shared/ipc-contract.ts';

export type EchoAdoption = { chats: Chat[]; adopted: true } | null;

/**
 * Server có thể dội lại chính tin mình vừa gửi *trước khi* `sendMessage` trả về
 * `msgId`. Lúc đó bong bóng tạm chưa có `msgId` để `appendIncoming` bỏ qua, nên
 * nếu cứ thêm thì UI hiện hai bong bóng cho một tin.
 *
 * Hàm này nhận diện đúng trường hợp đó và gắn `msgId` của bản dội vào bong bóng
 * đang chờ. Chỉ nhận tin `from: 'me'`; nếu có nhiều bong bóng chờ cùng nội dung
 * thì lấy bong bóng cũ nhất, vì server dội theo thứ tự gửi.
 */
export function adoptEcho(chats: Chat[], live: LiveMessage): EchoAdoption {
  if (live.from !== 'me' || !live.msgId || !live.text) return null;
  const chat = chats.find(item => item.id === live.threadId);
  if (!chat) return null;
  if (chat.messages.some(message => message.msgId === live.msgId)) return null;
  const ready = live.text.replace(/\s+/g, ' ').trim();
  const candidates = chat.messages.filter(message =>
    message.from === 'me' && message.status === 'pending'
    && !message.msgId && !!message.clientId
    && (message.text || '').replace(/\s+/g, ' ').trim() === ready);
  if (!candidates.length) return null;
  const oldest = candidates.reduce((a, b) => (b.id < a.id ? b : a));
  return {
    adopted: true,
    chats: chats.map(item => item.id !== live.threadId ? item : {
      ...item, messages: item.messages.map(message => message.id === oldest.id
        ? { ...message, msgId: live.msgId as string, status: 'sent' as const }
        : message),
    }),
  };
}
