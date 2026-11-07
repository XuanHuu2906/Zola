import type { Chat, ConnectionState } from '../renderer/adapters/types.ts';

/** Long enough to read the syncing label, short enough not to stall a demo run. */
export const SYNC_MS = 900;

export function canSend(state: ConnectionState): boolean {
  return state !== 'offline';
}

export function connectionLabel(state: ConnectionState): string {
  if (state === 'offline') return 'Ngoại tuyến · dùng dữ liệu mẫu';
  if (state === 'syncing') return 'Đang đồng bộ tin nhắn đang chờ…';
  return '';
}

/** Only a real connection can be lost; syncing already resolves on its own timer. */
export function nextConnection(state: ConnectionState, event: 'loss' | 'reconnect'): ConnectionState {
  if (event === 'loss') return state === 'syncing' ? 'syncing' : 'offline';
  return state === 'offline' ? 'syncing' : state;
}

/**
 * Recovery flushes messages that were still waiting, but leaves failed ones alone:
 * those were rejected on purpose and must go through the reader's own "Gửi lại".
 */
export function markPendingSent(chats: Chat[]): Chat[] {
  let touched = false;
  const next = chats.map(chat => {
    if (!chat.messages.some(m => m.status === 'pending')) return chat;
    touched = true;
    return { ...chat, messages: chat.messages.map(m => m.status === 'pending' ? { ...m, status: 'sent' as const } : m) };
  });
  return touched ? next : chats;
}
