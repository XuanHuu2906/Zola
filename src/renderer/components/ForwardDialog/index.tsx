import { useState, useMemo } from 'react';
import { Search, Send, Check, X, Forward } from 'lucide-react';
import { useZaloStore } from '../../store/useZaloStore.ts';
import { GlassDialog } from '../../../components/glass/index.ts';
import { Avatar } from '../Avatar.tsx';
import type { Message } from '../../types.ts';
import { normalizeText } from '../../../shared/logic.ts';

export function ForwardDialog({ message }: { message: Message }) {
  const { chats, closeLiveOverlay, forwardMessageLive } = useZaloStore();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [sending, setSending] = useState(false);

  const close = closeLiveOverlay;

  const filteredChats = useMemo(() => {
    const q = normalizeText(query.trim());
    if (!q) return chats;
    return chats.filter(c => normalizeText(c.name).includes(q));
  }, [chats, query]);

  const toggleSelect = (chatId: string) => {
    setSelectedIds(prev =>
      prev.includes(chatId) ? prev.filter(id => id !== chatId) : [...prev, chatId]
    );
  };

  const handleSend = async () => {
    if (!selectedIds.length || sending) return;
    setSending(true);
    try {
      await forwardMessageLive(selectedIds, message);
      close();
    } finally {
      setSending(false);
    }
  };

  const previewText = message.text || (message.attachments?.[0]?.title ?? 'Tin nhắn');

  return (
    <GlassDialog labelledBy="forward-dialog-title" className="forward-modal" onClose={close}>
      <header className="overlay-head">
        <span className="eyebrow">CHUYỂN TIẾP TIN NHẮN</span>
        <h2 id="forward-dialog-title">Chọn người nhận</h2>
        <p>Chuyển tiếp đến cuộc trò chuyện Zalo.</p>
      </header>

      <div className="forward-preview">
        <span className="forward-preview-label"><Forward size={14} /> Nội dung tin nhắn:</span>
        <div className="forward-preview-bubble">
          <p className="forward-preview-text">{previewText}</p>
        </div>
      </div>

      <div className="forward-search">
        <Search size={15} className="forward-search-icon" />
        <input
          data-autofocus
          type="search"
          placeholder="Tìm tên người nhận hoặc nhóm..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="forward-search-input"
          aria-label="Tìm kiếm người nhận để chuyển tiếp"
        />
        {query && (
          <button type="button" className="forward-search-clear" onClick={() => setQuery('')} aria-label="Xoá tìm kiếm">
            <X size={13} />
          </button>
        )}
      </div>

      <div className="forward-target-list" role="listbox" aria-label="Danh sách người nhận" aria-multiselectable="true">
        {filteredChats.length === 0 ? (
          <p className="overlay-empty">Không tìm thấy cuộc trò chuyện nào.</p>
        ) : (
          filteredChats.map(chat => {
            const isSelected = selectedIds.includes(chat.id);
            return (
              <button
                key={chat.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`forward-target-item ${isSelected ? 'selected' : ''}`}
                onClick={() => toggleSelect(chat.id)}>
                <Avatar chat={chat} size="regular" />
                <div className="forward-target-info">
                  <strong>{chat.name}</strong>
                  <small>{chat.isGroup ? 'Nhóm' : 'Cá nhân'}</small>
                </div>
                <div className={`forward-checkbox ${isSelected ? 'checked' : ''}`} aria-hidden="true">
                  {isSelected && <Check size={14} />}
                </div>
              </button>
            );
          })
        )}
      </div>

      <footer className="overlay-footer">
        <button type="button" className="subtle-btn" onClick={close} disabled={sending}>
          Hủy
        </button>
        <button
          type="button"
          className="primary-btn"
          onClick={handleSend}
          disabled={selectedIds.length === 0 || sending}>
          <Send size={15} />
          {sending ? 'Đang gửi...' : `Gửi${selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}`}
        </button>
      </footer>
    </GlassDialog>
  );
}
