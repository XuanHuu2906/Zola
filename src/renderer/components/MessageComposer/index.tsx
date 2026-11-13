import { useRef } from 'react';
import { Smile, Send } from 'lucide-react';
import { useZaloStore } from '../../store/useZaloStore.ts';
export function MessageComposer() {
  const { activeId, drafts, setDraft, sendLive, liveConnection } = useZaloStore();
  const input = useRef<HTMLTextAreaElement>(null);
  const draft = drafts[activeId] || '';
  const stopped = liveConnection === 'replaced';
  return <footer className="composer-zone">
    <div className="composer">
      <button className="composer-button" aria-label="Thêm emoji" disabled={stopped} onClick={() => { setDraft(activeId, draft + ' 😊'); input.current?.focus(); }}><Smile size={23} /></button>
      <textarea ref={input} rows={1} maxLength={2000} value={draft}
        placeholder={stopped ? 'Đã dừng kết nối — bấm "Kết nối lại" trước khi gửi' : 'Nhập tin nhắn Zalo...'}
        aria-label="Nội dung tin nhắn" disabled={stopped} onChange={e => setDraft(activeId, e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); sendLive(); } }} />
      <button className="send-button" aria-label="Gửi tin nhắn Zalo" disabled={stopped || !draft.trim()} onClick={() => { sendLive(); input.current?.focus(); }}><Send size={20} /></button>
    </div>
    <div className="composer-hint">{stopped
      ? 'Đã dừng kết nối: bấm "Kết nối lại" ở banner để chạy tiếp.'
      : 'zca-js không chính thức · chỉ dùng tài khoản phụ'}</div>
  </footer>;
}
