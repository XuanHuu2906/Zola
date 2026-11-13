import { Pin, Search, ShieldCheck } from 'lucide-react';
import { useZaloStore } from '../../store/useZaloStore.ts';
import { selectChats } from '../../../shared/logic.ts';
import { Avatar } from '../Avatar.tsx';
import { conversationVariant } from '../../../design-system/variants.ts';
export function ConversationList() {
  const { chats, activeId, query, setQuery, selectThread } = useZaloStore();
  const matches = selectChats(chats, query, 'all');
  return <section className="list-panel" aria-label="Danh sách hội thoại">
    <div className="list-top"><div className="search-wrap"><Search size={20} className="shrink-0" />
      <input type="search" placeholder="Tìm tin nhắn, bạn bè..." aria-label="Tìm hội thoại" value={query} onChange={e => setQuery(e.target.value)} />
    </div></div>
    <div className="list-scroll">
      {matches.map(chat => <button key={chat.id} className={conversationVariant[activeId === chat.id ? 'selected' : 'idle']}
        aria-current={activeId === chat.id ? 'true' : undefined} onClick={() => selectThread(chat.id)}>
        <Avatar chat={chat} /><span className="conversation-body"><span className="conversation-top">
          <strong>{chat.name}</strong><time>{chat.time}</time>
        </span><span className="conversation-bottom"><span>{chat.preview}</span>
          {chat.unread > 0 ? <b className="unread-count" aria-label={`${chat.unread} chưa đọc`}>{chat.unread}</b> : chat.pinned && <Pin size={14} />}
        </span></span>
      </button>)}
      {!matches.length && <div className="empty-list"><Search size={28} className="mx-auto" /><p>Không tìm thấy hội thoại</p><small>Thử tìm bằng tên người hoặc nhóm.</small></div>}
    </div>
    <div className="list-foot"><ShieldCheck size={14} className="shrink-0" /><span>zca-js không chính thức · Tài khoản phụ</span></div>
  </section>;
}
