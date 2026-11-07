import { ChevronRight, Info } from 'lucide-react';
import { useDemoStore } from '../store/useDemoStore.ts';
import { navigation } from './NavigationRail/index.tsx';
import { Avatar } from './Avatar.tsx';

/** Contacts and groups are the two seeded categories that carry real rows. */
export function FeaturePage() {
  const { view, chats, selectChat, setView, openOverlay } = useDemoStore();
  const item = navigation.find(n => n.id === view)!;
  const rows = view === 'contacts' ? chats.filter(c => !c.isGroup && c.id !== 'zalo') : view === 'groups' ? chats.filter(c => c.isGroup) : [];
  const Icon = item.icon;
  const detail = (chat: (typeof chats)[number]) => chat.isGroup
    ? `${chat.members?.length ?? 0} thành viên · Nhóm demo`
    : chat.online ? 'Đang hoạt động · Liên hệ demo' : 'Ngoại tuyến · Liên hệ demo';
  return <main className="chat-panel feature-panel"><div className="feature-head"><div className="feature-emblem"><Icon size={28} /></div>
    <div><h1>{item.title}</h1><p>Dữ liệu mẫu · Không kết nối Zalo</p></div></div>
    {rows.length ? <div className="feature-grid">{rows.map(chat => <div className="feature-row" key={chat.id}>
      <button className="feature-card" onClick={() => selectChat(chat.id)}><Avatar chat={chat} size="large" />
        <span><strong>{chat.name}</strong><small>{detail(chat)}</small></span><ChevronRight size={18} /></button>
      <button className="feature-info" aria-label={`Thông tin ${chat.name}`}
        onClick={() => openOverlay({ kind: 'info', chatId: chat.id })}><Info size={16} /></button>
    </div>)}</div>
      : <div className="feature-placeholder"><Icon className="mx-auto" size={45} /><h3>{item.title} Glass</h3><p>Bố cục thử nghiệm. Tính năng này chưa kết nối với dịch vụ thật.</p><button className="primary-btn" onClick={() => setView('chats')}>Về màn hình chat</button></div>}
  </main>;
}
