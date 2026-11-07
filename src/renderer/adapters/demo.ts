import type { Chat, DemoAdapter, Message } from './types.ts';
import { seed } from './seed.ts';
import { formatClock, formatFileSize, safeFileName, selectChats } from '../../shared/logic.ts';
import { buildOlderPage } from '../../shared/history.ts';
import { clampProgress } from '../../shared/transfer.ts';

function append(chats: Chat[], id: string, messages: Omit<Message, 'id'>[], bumpUnread = false): Chat[] {
  let nextId = Math.max(0, ...chats.flatMap(c => c.messages.map(m => m.id))) + 1;
  return chats.map(chat => {
    if (chat.id !== id || !messages.length) return chat;
    const last = messages[messages.length - 1];
    return { ...chat, messages: [...chat.messages, ...messages.map(m => ({ ...m, id: nextId++ }))],
      preview: last.text || `[Tệp demo] ${last.attachment}`, time: last.time,
      unread: bumpUnread ? chat.unread + messages.filter(m => m.from === 'them').length : 0 };
  });
}
export const demoAdapter: DemoAdapter = {
  mode: 'offline-demo',
  list: () => structuredClone(seed),
  search: selectChats,
  send(chats, chatId, text, now = new Date(), status = 'sent') {
    const content = text.trim().slice(0, 2000);
    return content
      ? append(chats, chatId, [{ from: 'me', text: content, time: formatClock(now), status }])
      : chats;
  },
  settle(chats, chatId, messageId, status) {
    return chats.map(chat => chat.id !== chatId ? chat : {
      ...chat, messages: chat.messages.map(m => m.id === messageId ? { ...m, status } : m),
    });
  },
  attach(chats, chatId, files, now = new Date()) {
    return append(chats, chatId, files.slice(0, 10).map(file => ({
      from: 'me', attachment: safeFileName(file.name),
      size: `${formatFileSize(file.size)} · Chỉ metadata`, time: formatClock(now),
      transfer: 'upload', progress: 0,
    })));
  },
  setTransfer(chats, chatId, messageId, patch) {
    return chats.map(chat => chat.id !== chatId ? chat : {
      ...chat, messages: chat.messages.map(message => message.id !== messageId ? message : {
        ...message,
        ...(patch.transfer ? { transfer: patch.transfer } : {}),
        ...(typeof patch.progress === 'number' ? { progress: clampProgress(patch.progress) } : {}),
      }),
    });
  },
  receive(chats, chatId, text, now = new Date()) {
    const content = text.trim().slice(0, 2000);
    return content ? append(chats, chatId, [{ from: 'them', text: content, time: formatClock(now) }], true) : chats;
  },
  loadOlder(chats, chatId, pageSize = 10) {
    return chats.map(chat => {
      if (chat.id !== chatId || chat.historyRemaining <= 0) return chat;
      const { messages, remaining } = buildOlderPage(chat, chats, pageSize);
      if (!messages.length) return chat;
      return { ...chat, messages: [...messages, ...chat.messages], historyRemaining: remaining };
    });
  },
};
