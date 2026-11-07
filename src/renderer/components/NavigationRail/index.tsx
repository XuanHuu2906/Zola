import { Bell, MessageCircle, Users, Contact, Clock, Cloud, LayoutGrid, Settings, CircleHelp } from 'lucide-react';
import type { View } from '../../adapters/types.ts';
import { useDemoStore } from '../../store/useDemoStore.ts';
import { railButtonVariant } from '../../../design-system/variants.ts';
export const navigation = [
  { id: 'chats', title: 'Tin nhắn', icon: MessageCircle },
  { id: 'contacts', title: 'Danh bạ', icon: Contact },
  { id: 'groups', title: 'Nhóm', icon: Users },
  { id: 'journal', title: 'Nhật ký', icon: Clock },
  { id: 'cloud', title: 'Cloud', icon: Cloud },
  { id: 'tools', title: 'Công cụ', icon: LayoutGrid },
] satisfies { id: View; title: string; icon: typeof MessageCircle }[];
export function NavigationRail({ openSettings }: { openSettings(): void }) {
  const view = useDemoStore(s => s.view);
  const setView = useDemoStore(s => s.setView);
  const notify = useDemoStore(s => s.notify);
  const openOverlay = useDemoStore(s => s.openOverlay);
  return <aside className="rail" aria-label="Điều hướng">
    <div className="brand"><span className="brand-logo">Z</span><span>Zalo<span className="brand-dot">.</span></span></div>
    <button className="rail-profile" aria-label="Mở hồ sơ demo" onClick={() => openOverlay({ kind: 'profile' })}>
      <img src="assets/avatar-profile.png" alt="Ảnh đại diện demo" /><i className="presence" /></button>
    <nav className="rail-nav" aria-label="Mục chính">
      {navigation.map(({ id, title, icon: Icon }) => <button key={id} aria-label={title}
        className={railButtonVariant[view === id ? 'selected' : 'idle']} aria-current={view === id ? 'page' : undefined}
        onClick={() => setView(id)}><Icon size={23} /><span>{title}</span></button>)}
    </nav>
    <div className="rail-foot">
      <button className="rail-button" aria-label="Thông báo demo" onClick={() => openOverlay({ kind: 'notifications' })}><Bell size={23} /><span>Thông báo</span></button>
      <button className="rail-button" onClick={openSettings} aria-label="Cài đặt"><Settings size={23} /><span>Cài đặt</span></button>
      <button className="rail-button" aria-label="Trợ giúp" onClick={() => notify('Demo độc lập. Enter gửi bản mẫu, Shift+Enter xuống dòng. Không kết nối Zalo.')}><CircleHelp size={23} /><span>Trợ giúp</span></button>
    </div>
  </aside>;
}
