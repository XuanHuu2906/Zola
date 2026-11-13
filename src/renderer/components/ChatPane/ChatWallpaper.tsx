import type { Chat } from '../../types.ts';
import { wallpaperFor } from '../../../design-system/wallpaper.ts';

export function ChatWallpaper({ chat }: { chat: Chat }) {
  const source = wallpaperFor(chat);
  return <div className="chat-wallpaper" data-tone={source.tone} style={{ backgroundImage: source.gradient }} aria-hidden="true" />;
}
