import { BriefcaseBusiness, Users } from 'lucide-react';
import type { Chat } from '../adapters/types.ts';
import { avatarVariant, type AvatarSize } from '../../design-system/variants.ts';
export function Avatar({ chat, size = 'regular' }: { chat: Chat; size?: AvatarSize }) {
  return <span className={avatarVariant(chat.id, size, Boolean(chat.avatar))}>
    {chat.avatar ? <img src={chat.avatar} alt="" /> : chat.id === 'zalo' ? <span className="za-mark">Zalo</span>
      : chat.isWork ? <BriefcaseBusiness size={25} /> : <Users size={25} />}
    {chat.online && <i className="presence" />}
  </span>;
}
