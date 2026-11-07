import type { Chat, Filter } from '../renderer/adapters/types.ts';
export function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd').toLocaleLowerCase('vi').trim();
}
export function selectChats<T extends Pick<Chat, 'name' | 'preview' | 'unread' | 'isGroup' | 'isWork' | 'pinned'>>(
  chats: T[], query: string, filter: Filter,
): T[] {
  const term = normalizeText(query);
  return chats.filter(c => !(filter === 'unread' && !c.unread)
    && !(filter === 'groups' && !c.isGroup) && !(filter === 'work' && !c.isWork)
    && (!term || normalizeText(c.name).includes(term) || normalizeText(c.preview).includes(term)))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned));
}
export const formatClock = (date: Date) => new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit', minute: '2-digit', hour12: false,
}).format(date);
export const safeFileName = (name: string) => (name || 'Tệp không tên')
  .split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 90);
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Không rõ';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
