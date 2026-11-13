import { useCalls } from '../../store/useCalls.ts';
import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Phone, Video, Search, MoreHorizontal, Pin, Bell, Info, X, CheckCheck, Clock3, CircleAlert, RotateCw, Heart, History, UserRound, LogOut, CloudDownload, Images, ChevronUp, ChevronDown, Forward, Undo2 } from 'lucide-react';
import { useZaloStore } from '../../store/useZaloStore.ts';
import { normalizeText, formatDayLabel } from '../../../shared/logic.ts';
import { Avatar } from '../Avatar.tsx';
import { MessageComposer } from '../MessageComposer/index.tsx';
import { ChatWallpaper } from './ChatWallpaper.tsx';
import { RECALLED_LABEL } from '../../live/map.ts';
import { AttachmentView, hasInlineMedia } from './AttachmentView.tsx';
import { bubbleVariant, deliveryLabel, deliveryVariant, directionToClass, matchVariant, messageRowVariant, reactionChipVariant, reactionVariant, recalledVariant } from '../../../design-system/variants.ts';
import { ATTACHMENT_LABELS, reactionEmoji } from '../../../shared/logic.ts';
import { GlassDialog, GlassPopover } from '../../../components/glass/index.ts';

/**
 * Sáu cảm xúc trong bảng chọn nhanh. Đây là sáu biểu tượng Zalo PC đặt ở hàng
 * đầu; cả bộ còn lại dài hơn ba chục và không vừa một hàng trên khung chat.
 * Giá trị là `rIcon` — thứ gửi thẳng cho máy chủ, không phải emoji.
 */
const PICKER_ICONS = ['/-heart', '/-strong', ':>', ':o', ':-((', ':-h'];

const deliveryIcon = { pending: Clock3, sent: CheckCheck, failed: CircleAlert } as const;

function mentionText(text: string, mentions?: Array<{ pos: number; len: number }>): ReactNode {
  if (!mentions?.length) return text;
  const ranges = [...mentions].filter(range => Number.isSafeInteger(range.pos)
    && Number.isSafeInteger(range.len) && range.pos >= 0 && range.len > 0
    && range.pos + range.len <= text.length).sort((a, b) => a.pos - b.pos);
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.pos < cursor) continue;
    if (range.pos > cursor) nodes.push(text.slice(cursor, range.pos));
    nodes.push(<span className="bubble-mention" key={`${range.pos}:${range.len}`}>
      {text.slice(range.pos, range.pos + range.len)}
    </span>);
    cursor = range.pos + range.len;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes.length ? nodes : text;
}

function isSearchMatch(text: string | undefined, search: boolean, query: string): boolean {
  return Boolean(search && query.trim() && normalizeText(text || '').includes(normalizeText(query)));
}

/**
 * Chỉ số của các tin khớp, theo **đúng thứ tự đang hiển thị**.
 *
 * Trả `number[]` chứ không trả số lượng: người dùng cần nhảy giữa các kết quả
 * ("2/7"), và thứ tự trong hội thoại là thứ tự họ đọc được — sắp lại theo độ
 * liên quan sẽ làm mũi "kết quả sau" đi ngược lên trên.
 */
function matchIndices(messages: { text?: string }[], search: boolean, query: string): number[] {
  if (!search || !query.trim()) return [];
  return messages.flatMap((message, index) => (isSearchMatch(message.text, search, query) ? [index] : []));
}

export function ChatPane() {
  const callAvailable = useCalls(s => s.available);
  const callBusy = useCalls(s => !!s.state && s.state.phase !== 'ended');
  const { chats, activeId, togglePin, markUnread, reactLive, recallLive, prefs, retryLive, liveHistory, loadLiveHistory } = useZaloStore();
  const openLiveOverlay = useZaloStore(s => s.openLiveOverlay);
  const requestReconnect = useZaloStore(s => s.requestReconnect);
  const syncFromPhone = useZaloStore(s => s.syncFromPhone);
  const liveSync = useZaloStore(s => s.liveSync);
  // Ẩn hẳn khi preload không có kênh: một nút bấm ra lỗi còn tệ hơn không có nút.
  const canSync = useZaloStore(s => s.liveCanSync);
  const syncRunning = liveSync?.phase === 'requested' || liveSync?.phase === 'receiving';
  const requestLogout = useZaloStore(s => s.requestLogout);
  const login = useZaloStore(s => s.login);
  const chat = chats.find(c => c.id === activeId)!;
  // Chưa xin lần nào thì coi như còn trang: nút phải bấm được ngay từ đầu.
  const historyState = liveHistory[chat.id] ?? { loading: false, hasMore: true };
  const label = login.status === 'logged-in' ? login.label : 'Tài khoản Zalo';
  const [menu, setMenu] = useState(false);
  const [accountMenu, setAccountMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const [query, setQuery] = useState('');
  // Vị trí trong danh sách kết quả, không phải chỉ số tin: `0` là kết quả đầu.
  const [hit, setHit] = useState(0);
  // Tin đang mở bảng chọn cảm xúc. Một id chứ không phải tập hợp: hai bảng chọn
  // cùng mở là trạng thái không có nghĩa, và người dùng chỉ bấm được một nút.
  const [picker, setPicker] = useState<number | null>(null);
  const [recalling, setRecalling] = useState<number | null>(null);
  const [confirmRecall, setConfirmRecall] = useState<number | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
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
    // Hội thoại thật mở ra rỗng rồi mới có trang lịch sử đầu tiên: đó là lần nạp
    // đầu, người đọc muốn thấy tin mới nhất, không phải giữ vị trí ở đầu danh sách.
    else if (before.count === 0) el.scrollTop = el.scrollHeight;
    else if (chat.messages.length > before.count && first !== before.first)
      el.scrollTop += el.scrollHeight - before.height;
    else if (chat.messages.length > before.count) el.scrollTop = el.scrollHeight;
    view.current = { activeId, count: chat.messages.length, first, height: el.scrollHeight };
  }, [activeId, chat]);
  const hits = matchIndices(chat.messages, search, query);
  // `hit` được giữ qua các lần gõ, nên một câu mới ngắn hơn danh sách cũ có thể
  // để nó trỏ ra ngoài. Kẹp lại thay vì reset: người dùng đang ở kết quả thứ 3
  // của "họp" và gõ thêm một chữ vẫn muốn ở gần đó, không nhảy về đầu.
  const current = hits.length ? Math.min(hit, hits.length - 1) : 0;
  const jumpTo = (next: number) => {
    if (!hits.length) return;
    const wrapped = (next + hits.length) % hits.length;
    setHit(wrapped);
    const target = chat.messages[hits[wrapped]];
    if (!target) return;
    const node = target.msgId
      ? scroll.current?.querySelector(`[data-msg-id="${CSS.escape(target.msgId)}"]`)
      // The numeric renderer id is also a stable fallback for older messages.
      : scroll.current?.querySelector(`[data-row-id="${target.id}"]`);
    node?.scrollIntoView({ block: 'center', behavior: osReduced ? 'auto' : 'smooth' });
  };
  // Gõ tới đâu nhảy tới đó: kết quả đầu tiên phải hiện ra mà không phải bấm
  // thêm, vì người dùng đang gõ để tìm nó. Chạy trên `query` chứ không trên
  // `hits`: `hits` là mảng mới mỗi lần render, và một hiệu ứng theo nó sẽ cuộn
  // lại mỗi khi có tin đến.
  const firstHit = hits[0];
  useLayoutEffect(() => {
    if (!search || !query.trim() || firstHit === undefined) return;
    const target = chat.messages[firstHit];
    const node = target?.msgId
      ? scroll.current?.querySelector(`[data-msg-id="${CSS.escape(target.msgId)}"]`)
      : target ? scroll.current?.querySelector(`[data-row-id="${target.id}"]`) : null;
    node?.scrollIntoView({ block: 'center', behavior: 'auto' });
  }, [search, query]);
  return <main className="chat-panel" aria-label="Nội dung hội thoại" onKeyDown={e => {
    if (e.key === 'Escape') {
      if (menu) { setMenu(false); menuButton.current?.focus(); }
      else if (accountMenu) { setAccountMenu(false); accountButton.current?.focus(); }
      else if (search) { setSearch(false); searchButton.current?.focus(); }
    }
  }}>
    <header className="chat-header"><button className="chat-identity" aria-label="Mở thông tin hội thoại"
      onClick={() => openLiveOverlay({ kind: 'info', chatId: chat.id })}><Avatar chat={chat} size="large" />
      <span className="identity-label"><strong>{chat.name}</strong><small>
        {chat.isGroup ? 'Nhóm Zalo' : 'Cá nhân'}</small></span>
    </button><div className="chat-actions">
      {callAvailable && !chat.isGroup && <>
        <button className="icon-button" aria-label="Gọi thoại" disabled={callBusy}
          onClick={() => void useCalls.getState().start(chat.id, false)}><Phone size={22} /></button>
        <button className="icon-button" aria-label="Gọi video" disabled={callBusy}
          onClick={() => void useCalls.getState().start(chat.id, true)}><Video size={22} /></button>
      </>}
      <div className="menu-anchor"><button ref={accountButton} className="icon-button" aria-label="Tài khoản Zalo" aria-expanded={accountMenu}
        onClick={() => setAccountMenu(!accountMenu)}><UserRound size={22} /></button>
        <GlassPopover open={accountMenu} onClose={() => setAccountMenu(false)} label="Tài khoản Zalo">
          <div className="lab-account" aria-label="Tài khoản đang đăng nhập">{label}</div>
          <button onClick={() => { requestReconnect(); setAccountMenu(false); accountButton.current?.focus(); }}>
            <RotateCw size={16} />Kết nối lại</button>
          {canSync && <button disabled={syncRunning}
            onClick={() => { syncFromPhone(); setAccountMenu(false); accountButton.current?.focus(); }}>
            <CloudDownload size={16} />
            {syncRunning ? 'Đang đồng bộ lịch sử…' : 'Đồng bộ lịch sử từ điện thoại'}</button>}
          <button onClick={() => { setAccountMenu(false); openLiveOverlay({ kind: 'profile' }); }}>
            <Info size={16} />Hồ sơ đăng nhập</button>
          <button onClick={() => { requestLogout(); setAccountMenu(false); }}>
            <LogOut size={16} />Đăng xuất khỏi Zalo</button>
        </GlassPopover>
      </div>
      <button ref={searchButton} className="icon-button" aria-label="Tìm trong hội thoại" aria-expanded={search} onClick={() => setSearch(!search)}><Search size={23} /></button>
      <div className="menu-anchor"><button ref={menuButton} className="icon-button" aria-label="Tùy chọn hội thoại" aria-expanded={menu} onClick={() => setMenu(!menu)}><MoreHorizontal size={24} /></button>
        <GlassPopover open={menu} onClose={() => setMenu(false)} label="Tùy chọn hội thoại">
          {/* These are server-backed changes, so other Zalo clients see them. */}
          <button onClick={() => { togglePin(); setMenu(false); menuButton.current?.focus(); }}><Pin size={16} />{chat.pinned ? 'Bỏ ghim hội thoại' : 'Ghim hội thoại'}</button>
          <button onClick={() => { markUnread(); setMenu(false); menuButton.current?.focus(); }}><Bell size={16} />Đánh dấu chưa đọc</button>
          <button onClick={() => { openLiveOverlay({ kind: 'media', chatId: chat.id }); setMenu(false); }}><Images size={16} />Ảnh, tệp và liên kết</button>
          <button onClick={() => { openLiveOverlay({ kind: 'info', chatId: chat.id }); setMenu(false); }}><Info size={16} />Thông tin hội thoại</button>
        </GlassPopover>
      </div>
    </div></header>
    {search && <div className="in-chat-search"><Search size={17} />
      <input autoFocus type="search" aria-label="Tìm nội dung hội thoại" value={query}
        placeholder="Tìm nội dung tin nhắn…"
        onChange={e => { setQuery(e.target.value); setHit(0); }}
        onKeyDown={e => {
          // Enter xuống kết quả sau, Shift+Enter lên kết quả trước — cùng phím
          // như trình duyệt và như Zalo PC.
          if (e.key !== 'Enter') return;
          e.preventDefault();
          jumpTo(current + (e.shiftKey ? -1 : 1));
        }} />
      <span className="search-count" role="status" aria-live="polite">
        {!query.trim() ? '' : hits.length ? `${current + 1}/${hits.length}` : 'Không có kết quả'}
      </span>
      <button aria-label="Kết quả trước" disabled={!hits.length} onClick={() => jumpTo(current - 1)}>
        <ChevronUp size={16} /></button>
      <button aria-label="Kết quả sau" disabled={!hits.length} onClick={() => jumpTo(current + 1)}>
        <ChevronDown size={16} /></button>
      <button aria-label="Đóng tìm kiếm" onClick={() => { setSearch(false); searchButton.current?.focus(); }}><X size={16} /></button></div>}
    <div className="chat-body">
      <ChatWallpaper chat={chat} />
      <section className="messages" ref={scroll} aria-label="Các tin nhắn">
        <button className="history-more" aria-label="Tải tin nhắn cũ hơn từ Zalo"
          disabled={historyState.loading || historyState.hasMore === false} onClick={() => loadLiveHistory(chat.id)}>
          <History size={13} />{historyState.loading ? 'Đang tải tin cũ…'
            // Với 1-1, hết cache **không** có nghĩa hết tin: Zalo PC lấy lịch sử
            // 1-1 bằng cách đồng bộ từ điện thoại, và app này chưa làm việc đó.
            // Nên không được nói "đã hết lịch sử", cũng không được nói "đã tải hết
            // phần đã đồng bộ" — chưa có lần đồng bộ nào để mà hết. Chỉ nói đúng
            // thứ đang biết: phần đã có trên máy này đã hiện hết.
            : historyState.hasMore === false
              ? (chat.isGroup ? 'Đã hết lịch sử Zalo' : 'Đã hiện hết tin có trên máy')
              : 'Tải tin nhắn cũ hơn từ Zalo'}
        </button>
        {chat.messages.map((message, index) => <Fragment key={message.id}>
          {message.ts && (index === 0
            || formatDayLabel(message.ts) !== formatDayLabel(chat.messages[index - 1].ts ?? 0))
            && <div className="day-label">{formatDayLabel(message.ts)}</div>}
          <motion.div initial={prefs.motion && !osReduced ? { opacity: 0, y: 6 } : false}
            animate={{ opacity: 1, y: 0 }} transition={{ duration: prefs.motion && !osReduced ? 0.16 : 0 }}
            className={messageRowVariant[directionToClass(message.from)]}
            data-msg-id={message.msgId || undefined}
            data-row-id={message.id}>
          {message.from !== 'me' && <div className="message-mini-avatar">
            <Avatar chat={chat} size="tiny"
              src={chat.isGroup ? message.senderAvatar ?? null : undefined}
              label={chat.isGroup ? message.fromName : undefined} />
          </div>}
          <div className="bubble-wrap">
            {chat.isGroup && message.from !== 'me' && message.fromName
              && (index === 0 || chat.messages[index - 1].from !== 'them'
                || chat.messages[index - 1].fromName !== message.fromName
                || (message.ts && formatDayLabel(message.ts)
                  !== formatDayLabel(chat.messages[index - 1].ts ?? 0)))
              && <span className="bubble-sender-name">{message.fromName}</span>}
            <div className={bubbleVariant[hasInlineMedia(message.attachments) ? 'media'
            : message.attachments?.length ? 'file' : 'text']}>
            {message.quote && <button className="bubble-quote" type="button"
              aria-label={`Tin được trả lời${message.quote.fromName ? ` từ ${message.quote.fromName}` : ''}`}
              title="Nhảy tới tin được trả lời"
              onClick={() => {
                // Tin gốc có thể đã bị thu hồi hoặc nằm ngoài phần đã đồng bộ:
                // `scrollIntoView` im lặng khi không tìm thấy, đúng ý — mũi trích
                // dẫn vẫn hiện bản chụp của nó.
                const target = message.quote?.msgId
                  ? document.querySelector(`[data-msg-id="${CSS.escape(message.quote.msgId)}"]`)
                  : null;
                target?.scrollIntoView({ block: 'center', behavior: osReduced ? 'auto' : 'smooth' });
              }}>
              <span className="bubble-quote-author">{message.quote.from === 'me' ? 'Bạn' : (message.quote.fromName || chat.name)}</span>
              <span className="bubble-quote-text">{message.quote.text
                || ATTACHMENT_LABELS[message.quote.attachmentKind || 'other']}</span>
            </button>}
            {message.attachments?.length
              ? <div className="attach-stack">
                {message.attachments.map((item, attachmentIndex) => (
                  <AttachmentView key={`${message.id}-${attachmentIndex}`} item={item} />))}
              </div>
              : <span className={message.recalled
                ? recalledVariant
                : matchVariant[hits.includes(index) ? 'match' : 'plain']}>
                {message.recalled ? RECALLED_LABEL : mentionText(message.text || '', message.mentions)}</span>}
            <div className="bubble-time">{message.time}{message.from === 'me' && message.status && <span
              className={deliveryVariant[message.status]} role="img" aria-label={deliveryLabel[message.status]}
              data-status={message.status}>{(() => { const Icon = deliveryIcon[message.status]; return <Icon size={13} />; })()}</span>}</div>
          </div>
            <div className="bubble-actions">
              {message.reactions?.length
                ? <div className="reaction-row">{message.reactions.map(item => (
                  <button key={item.icon}
                    className={reactionChipVariant[item.mine ? 'mine' : 'other']}
                    aria-label={`${reactionEmoji(item.icon)} ${item.count} người${item.mine ? ', có bạn' : ''}`}
                    aria-pressed={item.mine}
                    onClick={() => reactLive(message.id, item.icon)}>
                    <span aria-hidden="true">{reactionEmoji(item.icon)}</span>{item.count > 1 && <small>{item.count}</small>}
                  </button>
                ))}</div>
                : null}
              {message.msgId && message.cliMsgId && <button
                className={reactionVariant.empty}
                aria-label={`Thả cảm xúc lên tin ${message.id}`}
                aria-haspopup="menu" aria-expanded={picker === message.id}
                onClick={() => setPicker(current => (current === message.id ? null : message.id))}
                onBlur={e => {
                  // Đóng khi focus rời cả nút lẫn picker; `currentTarget.contains`
                  // giữ nó mở khi bấm vào một biểu tượng bên trong.
                  if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null)) {
                    setPicker(current => (current === message.id ? null : current));
                  }
                }}>
                <Heart size={12} />
              </button>}
              {/* Nút chuyển tiếp tin nhắn */}
              {!message.recalled && message.status !== 'pending' && message.status !== 'failed' && (
                <button
                  type="button"
                  className="bubble-action-btn forward-btn"
                  title="Chuyển tiếp tin nhắn"
                  aria-label={`Chuyển tiếp tin ${message.id}`}
                  onClick={() => openLiveOverlay({ kind: 'forward', message })}>
                  <Forward size={12} />
                </button>
              )}
              {message.from === 'me' && message.msgId && !message.recalled
                && message.status !== 'pending' && message.status !== 'failed' && (
                <button
                  type="button"
                  className="bubble-action-btn recall-btn"
                  title="Thu hồi tin nhắn"
                  aria-label={`Thu hồi tin ${message.id}`}
                  disabled={recalling === message.id}
                  onClick={() => setConfirmRecall(message.id)}>
                  <Undo2 size={12} />
                </button>
              )}
            </div>
            {picker === message.id && message.msgId && <div className="reaction-picker" role="menu"
              aria-label="Chọn cảm xúc">
              {PICKER_ICONS.map(icon => <button key={icon} role="menuitem" aria-label={icon}
                className="reaction-choice"
                onClick={() => { setPicker(null); reactLive(message.id, icon); }}>
                <span aria-hidden="true">{reactionEmoji(icon)}</span>
              </button>)}
            </div>}
            {message.status === 'failed' && <button className="retry-send" aria-label={`Gửi lại tin ${message.id}`}
              onClick={() => retryLive(message.id)}><RotateCw size={12} />Gửi lại</button>}
          </div>
        </motion.div>
        </Fragment>)}
      </section>
      <MessageComposer />
    </div>
    {confirmRecall !== null && <GlassDialog
      labelledBy="recall-dialog-title"
      className="recall-modal"
      onClose={() => setConfirmRecall(null)}>
      <header className="overlay-head">
        <span className="eyebrow">THU HỒI TIN NHẮN</span>
        <h2 id="recall-dialog-title">Bạn muốn thu hồi tin nhắn này?</h2>
        <p>Tin nhắn sẽ được thu hồi trong cuộc trò chuyện nếu Zalo chấp nhận yêu cầu.</p>
      </header>
      <footer className="overlay-footer">
        <button type="button" className="subtle-btn" onClick={() => setConfirmRecall(null)}>
          Hủy
        </button>
        <button type="button" className="primary-btn recall-confirm" data-autofocus
          disabled={recalling === confirmRecall}
          onClick={() => {
            const messageId = confirmRecall;
            setConfirmRecall(null);
            setRecalling(messageId);
            void recallLive(messageId).finally(() => {
              setRecalling(current => current === messageId ? null : current);
            });
          }}>
          <Undo2 size={15} /> Thu hồi
        </button>
      </footer>
    </GlassDialog>}
  </main>;
}
