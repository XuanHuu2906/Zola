import { useLayoutEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Phone, Video, Search, MoreHorizontal, Pin, Bell, Info, X, CheckCheck, Clock3, CircleAlert, RotateCw, FlaskConical, FileText, Heart, History, Inbox, Download, WifiOff, UserRound, LogOut } from 'lucide-react';
import { useDemoStore } from '../../store/useDemoStore.ts';
import { normalizeText } from '../../../shared/logic.ts';
import { Avatar } from '../Avatar.tsx';
import { MessageComposer } from '../MessageComposer/index.tsx';
import { ChatWallpaper } from './ChatWallpaper.tsx';
import { bubbleVariant, deliveryLabel, deliveryVariant, directionToClass, matchVariant, messageRowVariant, reactionVariant } from '../../../design-system/variants.ts';
import { clampProgress, isTransferActive, transferLabel } from '../../../shared/transfer.ts';

const deliveryIcon = { pending: Clock3, sent: CheckCheck, failed: CircleAlert } as const;
import { GlassPopover } from '../../../components/glass/index.ts';

function isSearchMatch(text: string | undefined, search: boolean, query: string): boolean {
  return Boolean(search && query.trim() && normalizeText(text || '').includes(normalizeText(query)));
}

export function ChatPane() {
  const { chats, activeId, togglePin, markUnread, react, prefs, openOverlay, loadOlder, retry, retryLive, simulateFailure, setSimulateFailure, simulateIncoming, download, cancelTransfer, connection, goOffline, reconnect } = useDemoStore();
  const liveMode = useDemoStore(s => s.liveMode);
  const openLiveOverlay = useDemoStore(s => s.openLiveOverlay);
  const requestReconnect = useDemoStore(s => s.requestReconnect);
  const requestLogout = useDemoStore(s => s.requestLogout);
  const login = useDemoStore(s => s.login);
  const live = liveMode === 'live';
  const chat = chats.find(c => c.id === activeId)!;
  const label = login.status === 'logged-in' ? login.label : 'Tài khoản Zalo';
  const [menu, setMenu] = useState(false);
  const [lab, setLab] = useState(false);
  const [search, setSearch] = useState(false);
  const [query, setQuery] = useState('');
  const menuButton = useRef<HTMLButtonElement>(null);
  const labButton = useRef<HTMLButtonElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const scroll = useRef<HTMLElement>(null);
  const osReduced = useReducedMotion();
  // A prepended page must not move what the reader is looking at, so remember the
  // previous height and offset it; only an append or a chat switch jumps to the end.
  const view = useRef<{ activeId: string; count: number; first?: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const before = view.current;
    const first = chat.messages[0]?.id;
    if (!before || before.activeId !== activeId) el.scrollTop = el.scrollHeight;
    else if (chat.messages.length > before.count && first !== before.first)
      el.scrollTop += el.scrollHeight - before.height;
    else if (chat.messages.length > before.count) el.scrollTop = el.scrollHeight;
    view.current = { activeId, count: chat.messages.length, first, height: el.scrollHeight };
  }, [activeId, chat]);
  return <main className="chat-panel" aria-label="Nội dung hội thoại" onKeyDown={e => {
    if (e.key === 'Escape') {
      if (menu) { setMenu(false); menuButton.current?.focus(); }
      else if (lab) { setLab(false); labButton.current?.focus(); }
      else if (search) { setSearch(false); searchButton.current?.focus(); }
    }
  }}>
    <header className="chat-header"><button className="chat-identity" aria-label="Mở thông tin hội thoại"
      onClick={() => (live ? openLiveOverlay({ kind: 'info', chatId: chat.id }) : openOverlay({ kind: 'info', chatId: chat.id }))}><Avatar chat={chat} size="large" />
      <span className="identity-label"><strong>{chat.name}</strong><small>{!live && chat.online && <i className="tiny-dot" />}
        {live ? (chat.isGroup ? 'Nhóm Zalo · zca-js' : 'Cá nhân · zca-js')
          : chat.online ? 'Đang hoạt động · Mẫu' : chat.isGroup ? 'Hội thoại nhóm · Demo' : 'Hội thoại mẫu'}</small></span>
    </button><div className="chat-actions">
      <div className="menu-anchor"><button ref={labButton} className="icon-button" aria-label={live ? 'Tài khoản Zalo' : 'Phòng thử demo'} aria-expanded={lab}
        onClick={() => setLab(!lab)}>{live ? <UserRound size={22} /> : <FlaskConical size={22} />}</button>
        {live ? <GlassPopover open={lab} onClose={() => setLab(false)} label="Tài khoản Zalo">
          <div className="lab-account" aria-label="Tài khoản đang đăng nhập">{label}</div>
          <button onClick={() => { requestReconnect(); setLab(false); labButton.current?.focus(); }}>
            <RotateCw size={16} />Kết nối lại listener</button>
          <button onClick={() => { setLab(false); openLiveOverlay({ kind: 'profile' }); }}>
            <Info size={16} />Hồ sơ đăng nhập</button>
          <button onClick={() => { requestLogout(); setLab(false); }}>
            <LogOut size={16} />Đăng xuất khỏi Zalo</button>
        </GlassPopover> : <GlassPopover open={lab} onClose={() => setLab(false)} label="Phòng thử demo">
          <button role="switch" aria-label="Giả lập gửi thất bại" aria-checked={simulateFailure}
            onClick={() => { setSimulateFailure(!simulateFailure); setLab(false); labButton.current?.focus(); }}>
            <CircleAlert size={16} />Tin nhắn kế tiếp gửi thất bại<b className="lab-flag">{simulateFailure ? 'Bật' : 'Tắt'}</b></button>
          <button onClick={() => { simulateIncoming(); setLab(false); labButton.current?.focus(); }}>
            <Inbox size={16} />Mô phỏng tin nhắn đến</button>
          <button role="switch" aria-label="Giả lập mất mạng" aria-checked={connection !== 'online'}
            onClick={() => { if (connection === 'offline') reconnect(); else goOffline(); }}>
            <WifiOff size={16} />Mất mạng giả lập<b className="lab-flag">{connection === 'offline' ? 'Đang mất' : 'Đang kết nối'}</b></button>
        </GlassPopover>}
      </div>
      <button className="icon-button" aria-label="Gọi thoại demo" onClick={() => openOverlay({ kind: 'call', mode: 'voice' })}><Phone size={22} /></button>
      <button className="icon-button" aria-label="Gọi video demo" onClick={() => openOverlay({ kind: 'call', mode: 'video' })}><Video size={24} /></button>
      <button ref={searchButton} className="icon-button" aria-label="Tìm trong hội thoại" aria-expanded={search} onClick={() => setSearch(!search)}><Search size={23} /></button>
      <div className="menu-anchor"><button ref={menuButton} className="icon-button" aria-label="Tùy chọn hội thoại" aria-expanded={menu} onClick={() => setMenu(!menu)}><MoreHorizontal size={24} /></button>
        <GlassPopover open={menu} onClose={() => setMenu(false)} label="Tùy chọn hội thoại">
          {live ? <button onClick={() => { openLiveOverlay({ kind: 'info', chatId: chat.id }); setMenu(false); }}><Info size={16} />Thông tin hội thoại</button>
            : <>
          <button onClick={() => { togglePin(); setMenu(false); menuButton.current?.focus(); }}><Pin size={16} />{chat.pinned ? 'Bỏ ghim hội thoại' : 'Ghim hội thoại'}</button>
          <button onClick={() => { markUnread(); setMenu(false); menuButton.current?.focus(); }}><Bell size={16} />Đánh dấu chưa đọc</button>
          <button onClick={() => { openOverlay({ kind: 'info', chatId: chat.id }); setMenu(false); }}><Info size={16} />Thông tin hội thoại</button>
            </>}
        </GlassPopover>
      </div>
    </div></header>
    {search && <div className="in-chat-search"><Search size={17} /><input autoFocus type="search" aria-label="Tìm nội dung hội thoại" value={query} onChange={e => setQuery(e.target.value)} placeholder="Tìm nội dung mẫu..." />
      <button aria-label="Đóng tìm kiếm" onClick={() => { setSearch(false); searchButton.current?.focus(); }}><X size={16} /></button></div>}
    <div className="chat-body">
      <ChatWallpaper chat={chat} />
      <section className="messages" ref={scroll} aria-label="Các tin nhắn mẫu">
        {live ? <button className="history-more" aria-label="Lịch sử Zalo" disabled><History size={13} />Lịch sử chỉ tải khi mở app</button>
          : <button className="history-more" aria-label="Tải tin nhắn cũ hơn" disabled={chat.historyRemaining <= 0}
            onClick={() => loadOlder(chat.id)}><History size={13} />
            {chat.historyRemaining > 0 ? `Tải tin nhắn cũ hơn · còn ${chat.historyRemaining}` : 'Đã hết lịch sử mẫu'}
          </button>}
        <div className="day-label">Hôm nay</div>
        {chat.messages.map(message => <motion.div key={message.id} initial={prefs.motion && !osReduced ? { opacity: 0, y: 6 } : false}
          animate={{ opacity: 1, y: 0 }} transition={{ duration: prefs.motion && !osReduced ? 0.16 : 0 }}
          className={messageRowVariant[directionToClass(message.from)]}>
          {message.from !== 'me' && <div className="message-mini-avatar"><Avatar chat={chat} size="tiny" /></div>}
          <div className="bubble-wrap"><div className={bubbleVariant[message.attachment ? 'file' : 'text']}>
            {message.attachment ? <div className="file-block">
              <button className="file-card" aria-label={`Mở tệp mẫu ${message.attachment}`}
                onClick={() => openOverlay({ kind: 'media', chatId: chat.id, index: message.id })}>
                <div className="file-icon"><FileText size={23} /></div><div className="file-meta"><strong title={message.attachment}>{message.attachment}</strong><small>{message.size}</small></div></button>
              {typeof message.progress === 'number' ? <div className="transfer" role="group" aria-label={transferLabel(message.transfer || 'upload', message.progress)}>
                <div className="transfer-track" role="progressbar" aria-valuemin={0} aria-valuemax={100}
                  aria-valuenow={clampProgress(message.progress)} aria-label={transferLabel(message.transfer || 'upload', message.progress)}>
                  <i className={message.progress >= 100 ? 'transfer-fill done' : 'transfer-fill'} data-transfer={message.transfer || 'upload'}
                    style={{ width: `${clampProgress(message.progress)}%` }} />
                </div>
                <small className="transfer-label">{transferLabel(message.transfer || 'upload', message.progress)}</small>
                {isTransferActive(message.progress) && <button className="transfer-cancel" aria-label={`Hủy tải ${message.attachment}`}
                  onClick={() => cancelTransfer(message.id)}><X size={12} /></button>}
              </div> : message.from === 'them' &&
                <button className="transfer-start" aria-label={`Tải xuống mẫu ${message.attachment}`}
                  onClick={() => download(message.id)}><Download size={13} />Tải xuống mẫu</button>}
            </div>
              : <span className={matchVariant[isSearchMatch(message.text, search, query) ? 'match' : 'plain']}>{message.text}</span>}
            <div className="bubble-time">{message.time}{message.from === 'me' && message.status && <span
              className={deliveryVariant[message.status]} role="img" aria-label={deliveryLabel[message.status]}
              data-status={message.status}>{(() => { const Icon = deliveryIcon[message.status]; return <Icon size={13} />; })()}</span>}</div>
          </div>
            <button className={reactionVariant[message.reaction ? 'reacted' : 'empty']} aria-label={`Thả cảm xúc demo tin ${message.id}`} aria-pressed={!!message.reaction} onClick={() => react(message.id)}>
              {message.reaction || <Heart size={12} />}
            </button>
            {message.status === 'failed' && <button className="retry-send" aria-label={`Gửi lại tin ${message.id}`}
              onClick={() => (live ? retryLive(message.id) : retry(message.id))}><RotateCw size={12} />Gửi lại</button>}
          </div>
        </motion.div>)}
      </section>
      <MessageComposer />
    </div>
  </main>;
}
