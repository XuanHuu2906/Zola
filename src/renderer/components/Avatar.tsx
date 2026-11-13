import { Users } from 'lucide-react';
import type { Chat } from '../types.ts';
import { avatarVariant, type AvatarSize } from '../../design-system/variants.ts';
export function Avatar({ chat, size = 'regular', src, label }: {
  chat: Chat; size?: AvatarSize; src?: string | null; label?: string;
}) {
  const image = src === undefined ? chat.avatar : src;
  const initial = label?.trim().charAt(0).toLocaleUpperCase();
  return <span className={avatarVariant(chat.id, size, Boolean(image))}>
    {image ? <img src={image} alt="" />
      : initial ? <span className="avatar-initial" aria-hidden="true">{initial}</span>
        : <Users size={25} />}
  </span>;
}
