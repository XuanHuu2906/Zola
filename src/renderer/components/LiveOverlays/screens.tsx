import { MessageSquare, ShieldCheck, Users } from 'lucide-react';
import { useZaloStore } from '../../store/useZaloStore.ts';
import { Avatar } from '../Avatar.tsx';
import { GlassDialog } from '../../../components/glass/index.ts';
import { LIVE_NOTICE } from '../../../shared/live.ts';

/**
 * Hộp thông tin hội thoại thật, luôn giữ câu cảnh báo bắt buộc.
 */

export function LiveInfoScreen({ chatId }: { chatId: string }) {
  const chat = useZaloStore(s => s.chats.find(item => item.id === chatId));
  const close = useZaloStore(s => s.closeLiveOverlay);
  if (!chat) return null;
  // Đếm mọi tệp của mọi tin, không đếm số tin: một album mười ảnh là mười tệp.
  const mediaCount = chat.messages.reduce((sum, message) => sum + (message.attachments?.length ?? 0), 0);
  return <GlassDialog labelledBy="live-info-title" className="info-modal" onClose={close}>
    <header className="overlay-head"><span className="eyebrow">{chat.isGroup ? 'THÔNG TIN NHÓM ZALO' : 'HỒ SƠ HỘI THOẠI ZALO'}</span>
      <h2 id="live-info-title">{chat.name}</h2><p>Dữ liệu từ tài khoản Zalo đang đăng nhập.</p></header>
    <div className="info-hero"><Avatar chat={chat} size="large" /><dl className="info-facts">
      <div><dt>Loại</dt><dd>{chat.isGroup ? 'Nhóm Zalo' : 'Cá nhân'}</dd></div>
      <div><dt>Tin nhắn</dt><dd>{chat.messages.length}</dd></div>
      <div><dt>Tệp</dt><dd>{mediaCount}</dd></div>
      <div><dt>Kết nối</dt><dd>zca-js · thử nghiệm</dd></div>
    </dl></div>
    {chat.isGroup && <div className="info-members">
      <span className="eyebrow">THÀNH VIÊN</span>
      <p><Users size={16} />Danh sách thành viên chưa được tải ở giai đoạn này.</p></div>}
    <footer className="overlay-footer"><span className="overlay-note"><ShieldCheck size={15} />Tin nhắn từ server Zalo</span>
      <button className="primary-btn" data-autofocus onClick={close}>Đóng thông tin</button></footer>
  </GlassDialog>;
}

export function LiveProfileScreen() {
  const login = useZaloStore(s => s.login);
  const close = useZaloStore(s => s.closeLiveOverlay);
  const requestLogout = useZaloStore(s => s.requestLogout);
  const label = login.status === 'logged-in' ? login.label : 'Tài khoản Zalo';
  return <GlassDialog labelledBy="live-profile-title" className="profile-modal" onClose={close}>
    <header className="overlay-head"><span className="eyebrow">HỒ SƠ CỦA BẠN</span>
      <h2 id="live-profile-title">{label}</h2><p>Phiên đăng nhập thật, lưu bằng safeStorage trong main.</p></header>
    <div className="profile-hero"><span className="member-initial" aria-hidden="true">{label.trim().charAt(0).toUpperCase() || 'Z'}</span>
      <div><strong>{label}</strong><small>Tài khoản phụ · zca-js</small></div></div>
    <dl className="info-facts"><div><dt>Phiên</dt><dd>Lưu trong main, không qua IPC</dd></div>
      <div><dt>Dữ liệu</dt><dd>Tin nhắn thật, chỉ trong bộ nhớ</dd></div>
      <div><dt>Mạng</dt><dd>Server Zalo</dd></div></dl>
    <p className="live-notice"><MessageSquare size={15} />{LIVE_NOTICE}</p>
    <footer className="overlay-footer"><button className="subtle-btn" onClick={requestLogout}>Đăng xuất</button>
      <button className="primary-btn" data-autofocus onClick={close}>Đóng hồ sơ</button></footer>
  </GlassDialog>;
}
