import { Pin, Search, ShieldCheck } from 'lucide-react';
import type { Filter } from '../../adapters/types.ts';
import { demoAdapter } from '../../adapters/demo.ts';
import { useDemoStore } from '../../store/useDemoStore.ts';
import { selectChats } from '../../../shared/logic.ts';
import { Avatar } from '../Avatar.tsx';
import { conversationVariant, filterChipVariant } from '../../../design-system/variants.ts';
const filters: [Filter, string][] = [['all', 'Tất cả'], ['unread', 'Chưa đọc'], ['groups', 'Nhóm'], ['work', 'Công việc']];
export function ConversationList() {
  const { chats, activeId, query, filter, setQuery, setFilter, selectChat, selectThread, liveMode } = useDemoStore();
  const live = liveMode === 'live';
  // Chế độ thật không có `isWork`; lọc "Công việc" của bản demo sẽ luôn rỗng, nên
  // chỉ tìm theo từ khoá và bỏ hẳn nhóm nút lọc.
  const matches = live ? selectChats(chats, query, 'all') : demoAdapter.search(chats, query, filter);
  return <section className="list-panel" aria-label="Danh sách hội thoại">
    <div className="list-top"><div className="search-wrap"><Search size={20} className="shrink-0" />
      <input type="search" placeholder="Tìm tin nhắn, bạn bè..." aria-label="Tìm hội thoại" value={query} onChange={e => setQuery(e.target.value)} />
    </div>{!live && <div className="filters" role="group" aria-label="Lọc hội thoại">
      {filters.map(([id, label]) => <button key={id} className={filterChipVariant[filter === id ? 'selected' : 'idle']}
        aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
    </div>}</div>
    <div className="list-scroll">
      {matches.map(chat => <button key={chat.id} className={conversationVariant[activeId === chat.id ? 'selected' : 'idle']}
        aria-current={activeId === chat.id ? 'true' : undefined} onClick={() => (live ? selectThread(chat.id) : selectChat(chat.id))}>
        <Avatar chat={chat} /><span className="conversation-body"><span className="conversation-top">
          <strong>{chat.name}{chat.verified && <span className="verified">✓</span>}</strong><time>{chat.time}</time>
        </span><span className="conversation-bottom"><span>{chat.preview}</span>
          {chat.unread > 0 ? <b className="unread-count" aria-label={`${chat.unread} chưa đọc`}>{chat.unread}</b> : chat.pinned && <Pin size={14} />}
        </span></span>
      </button>)}
      {!matches.length && <div className="empty-list"><Search size={28} className="mx-auto" /><p>Không tìm thấy hội thoại</p><small>Thử từ khóa hoặc bộ lọc khác.</small></div>}
    </div>
    <div className="list-foot"><ShieldCheck size={14} className="shrink-0" /><span>{live ? 'zca-js không chính thức · Tài khoản phụ' : 'Demo độc lập · Không kết nối Zalo'}</span></div>
  </section>;
}
