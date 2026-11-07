import { useEffect, useState } from 'react';
import { Bell, Image as ImageIcon, Mic, MicOff, PhoneOff, Pin, ShieldCheck, Users, Video, VideoOff, Volume2 } from 'lucide-react';
import { useDemoStore } from '../../store/useDemoStore.ts';
import { Avatar } from '../Avatar.tsx';
import { GlassDialog } from '../../../components/glass/index.ts';
import { CALL_RING_MS, CALL_TICK_MS, callStatusLabel, connectCall, createCall, endCall, tickCall, toggleCallFlag } from '../../../shared/call.ts';

/**
 * Secondary glass surfaces that share one store slot. Every screen states its
 * demo-only nature in text: these are layouts, not connections.
 */

const demoNotice = 'Bố cục demo · Không kết nối Zalo';

function InfoScreen({ chatId }: { chatId: string }) {
  const { chats, closeOverlay, notify, togglePin } = useDemoStore();
  const chat = chats.find(c => c.id === chatId)!;
  const mediaCount = chat.messages.filter(m => m.attachment).length;
  return <GlassDialog labelledBy="info-title" className="info-modal" onClose={closeOverlay}>
    <header className="overlay-head"><span className="eyebrow">{chat.isGroup ? 'THÔNG TIN NHÓM' : 'HỒ SƠ HỘI THOẠI'}</span>
      <h2 id="info-title">{chat.name}</h2><p>{demoNotice}</p></header>
    <div className="info-hero"><Avatar chat={chat} size="large" /><dl className="info-facts">
      <div><dt>Loại</dt><dd>{chat.isGroup ? 'Nhóm hư cấu' : 'Liên hệ hư cấu'}</dd></div>
      <div><dt>Tin nhắn</dt><dd>{chat.messages.length}</dd></div>
      <div><dt>Tệp</dt><dd>{mediaCount}</dd></div>
      <div><dt>Trạng thái</dt><dd>{chat.online ? 'Đang hoạt động · mẫu' : 'Ngoại tuyến · mẫu'}</dd></div>
    </dl></div>
    {chat.isGroup && <div className="info-members">
      <span className="eyebrow">THÀNH VIÊN MẪU · {chat.members?.length ?? 0}</span>
      {chat.members?.length ? <ul className="member-list" aria-label="Thành viên mẫu">{chat.members.map(member => <li key={member.name}>
        <span className="member-initial" aria-hidden="true">{member.name.trim().charAt(0) || '?'}</span>
        <span className="member-body"><strong>{member.name}</strong><small>{member.role}</small></span>
      </li>)}</ul>
        : <p><Users size={16} />Thành viên không có trong dữ liệu mẫu của bản demo.</p>}</div>}
    <footer className="overlay-footer">
      <button className="subtle-btn" onClick={() => { togglePin(); notify(chat.pinned ? 'Đã bỏ ghim hội thoại.' : 'Đã ghim hội thoại.'); }}><Pin size={16} />{chat.pinned ? 'Bỏ ghim' : 'Ghim'}</button>
      <button className="primary-btn" data-autofocus onClick={closeOverlay}>Đóng thông tin</button>
    </footer>
  </GlassDialog>;
}

function MediaScreen({ chatId, selected }: { chatId: string; selected: number }) {
  const { chats, closeOverlay } = useDemoStore();
  const chat = chats.find(c => c.id === chatId)!;
  const files = chat.messages.filter(m => m.attachment);
  return <GlassDialog labelledBy="media-title" className="media-modal" onClose={closeOverlay}>
    <header className="overlay-head"><span className="eyebrow">TRÌNH XEM PHƯƠNG TIỆN</span>
      <h2 id="media-title">Tệp đính kèm mẫu</h2><p>{demoNotice} · Nội dung tệp không được đọc.</p></header>
    <div className="media-stage" aria-label="Khung xem mẫu"><ImageIcon size={44} /><span>Không có ảnh — trình xem dựng bằng CSS</span></div>
    {files.length ? <ul className="media-list">{files.map(message => <li key={message.id} aria-current={message.id === selected ? 'true' : undefined}>
      <strong>{message.attachment}</strong><small>{message.size}</small></li>)}</ul>
      : <p className="overlay-empty">Hội thoại này chưa có tệp trong dữ liệu mẫu.</p>}
    <footer className="overlay-footer"><button className="primary-btn" data-autofocus onClick={closeOverlay}>Đóng trình xem</button></footer>
  </GlassDialog>;
}

function CallScreen({ mode }: { mode: 'voice' | 'video' }) {
  const { closeOverlay } = useDemoStore();
  const [call, setCall] = useState(() => createCall(mode));
  const video = call.mode === 'video';
  // Ring once, then connect. The timers are cancelled on unmount so closing the
  // dialog cannot leak a tick into a call the reader already ended.
  useEffect(() => {
    if (call.phase !== 'ringing') return;
    const timer = setTimeout(() => setCall(connectCall), CALL_RING_MS);
    return () => clearTimeout(timer);
  }, [call.phase]);
  useEffect(() => {
    if (call.phase !== 'connected') return;
    const timer = setInterval(() => setCall(tickCall), CALL_TICK_MS);
    return () => clearInterval(timer);
  }, [call.phase]);
  return <GlassDialog labelledBy="call-title" className="call-modal" onClose={closeOverlay}>
    <span className="eyebrow">CUỘC GỌI MẪU · KHÔNG KẾT NỐI</span>
    <h2 id="call-title">{video ? 'Gọi video' : 'Gọi thoại'}</h2>
    <div className="call-target" data-phase={call.phase} aria-hidden="true">{video ? <Video size={40} /> : <Mic size={40} />}</div>
    <p className="call-status" role="status" data-phase={call.phase}>{callStatusLabel(call)}</p>
    <p className="overlay-sub">{call.phase === 'ringing' ? 'Đang mô phỏng kết nối cục bộ' : 'Phiên giả lập đang chạy'}. Không truy cập micro, camera hay mạng.</p>
    <div className="call-controls">
      <button className="call-key" aria-label="Tắt tiếng" aria-pressed={call.muted}
        data-active={call.muted} onClick={() => setCall(state => toggleCallFlag(state, 'muted'))}>{call.muted ? <MicOff size={20} /> : <Mic size={20} />}</button>
      <button className="call-key" aria-label="Loa ngoài" aria-pressed={call.speaker}
        data-active={call.speaker} onClick={() => setCall(state => toggleCallFlag(state, 'speaker'))}><Volume2 size={20} /></button>
      {video && <button className="call-key" aria-label="Tắt camera" aria-pressed={!call.camera}
        data-active={!call.camera} onClick={() => setCall(state => toggleCallFlag(state, 'camera'))}><VideoOff size={20} /></button>}
    </div>
    <footer className="overlay-footer"><button className="primary-btn call-end" data-autofocus
      onClick={() => { setCall(endCall); closeOverlay(); }}><PhoneOff size={17} />Kết thúc cuộc gọi mẫu</button></footer>
  </GlassDialog>;
}

function NotificationsScreen() {
  const { chats, closeOverlay, selectChat } = useDemoStore();
  const rows = [...chats].filter(chat => chat.unread > 0);
  return <GlassDialog labelledBy="notifications-title" className="notifications-modal" onClose={closeOverlay}>
    <header className="overlay-head"><span className="eyebrow">THÔNG BÁO</span>
      <h2 id="notifications-title">Thông báo mẫu</h2><p>{demoNotice}</p></header>
    {rows.length ? <ul className="notification-list">{rows.map(chat => <li key={chat.id}>
      <button onClick={() => { selectChat(chat.id); closeOverlay(); }}><Avatar chat={chat} />
        <span><strong>{chat.name}</strong><small>{chat.preview}</small></span>
        <b className="unread-count" aria-label={`${chat.unread} chưa đọc`}>{chat.unread}</b></button></li>)}</ul>
      : <p className="overlay-empty"><Bell size={28} />Không có thông báo chưa đọc trong dữ liệu mẫu.</p>}
    <footer className="overlay-footer"><span className="overlay-note"><ShieldCheck size={15} />Thông báo chỉ tồn tại trong phiên demo</span>
      <button className="primary-btn" data-autofocus onClick={closeOverlay}>Đóng thông báo</button></footer>
  </GlassDialog>;
}

function ProfileScreen() {
  const { closeOverlay, session, signOut } = useDemoStore();
  return <GlassDialog labelledBy="profile-title" className="profile-modal" onClose={closeOverlay}>
    <header className="overlay-head"><span className="eyebrow">HỒ SƠ CỦA BẠN</span>
      <h2 id="profile-title">Người dùng demo</h2><p>{demoNotice}</p></header>
    <div className="profile-hero"><img src="assets/avatar-profile.png" alt="Ảnh đại diện demo" />
      <div><strong>{session?.label || 'Người dùng Demo'}</strong><small>Phiên demo cục bộ</small></div></div>
    <dl className="info-facts"><div><dt>Phiên</dt><dd>Cục bộ, trong bộ nhớ</dd></div>
      <div><dt>Dữ liệu</dt><dd>Hư cấu</dd></div>
      <div><dt>Mạng</dt><dd>Không gọi Zalo</dd></div></dl>
    <footer className="overlay-footer"><button className="subtle-btn" onClick={signOut}>Đăng xuất</button>
      <button className="primary-btn" data-autofocus onClick={closeOverlay}>Đóng hồ sơ</button></footer>
  </GlassDialog>;
}

export function Overlays() {
  const overlay = useDemoStore(s => s.overlay);
  if (!overlay) return null;
  if (overlay.kind === 'info') return <InfoScreen chatId={overlay.chatId} />;
  if (overlay.kind === 'media') return <MediaScreen chatId={overlay.chatId} selected={overlay.index} />;
  if (overlay.kind === 'call') return <CallScreen mode={overlay.mode} />;
  if (overlay.kind === 'notifications') return <NotificationsScreen />;
  return <ProfileScreen />;
}
