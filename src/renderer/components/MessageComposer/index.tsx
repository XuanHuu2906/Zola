import { useRef } from 'react';
import { Smile, Paperclip, Image, Mic, Send } from 'lucide-react';
import { useDemoStore } from '../../store/useDemoStore.ts';
export function MessageComposer() {
  const { activeId, drafts, setDraft, send, sendLive, attach, notify, connection, liveMode, liveConnection } = useDemoStore();
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const draft = drafts[activeId] || '';
  const live = liveMode === 'live';
  // Chế độ thật chỉ chặn gửi khi listener đã hỏng hẳn; `connecting` vẫn cho gõ.
  const offline = live ? liveConnection === 'replaced' : connection === 'offline';
  const dispatch = () => (live ? sendLive() : send());
  function choose(accept: string) {
    if (picker.current) { picker.current.accept = accept; picker.current.click(); }
  }
  return <footer className="composer-zone" data-connection={live ? liveConnection : connection}>
    <div className="composer">
      <button className="composer-button" aria-label="Thêm emoji" disabled={offline} onClick={() => { setDraft(activeId, draft + ' 😊'); input.current?.focus(); }}><Smile size={23} /></button>
      <textarea ref={input} rows={1} maxLength={2000} value={draft}
        placeholder={offline ? (live ? 'Đã dừng kết nối — bấm "Kết nối lại" trước khi gửi' : 'Đang ngoại tuyến — không gửi được tin mẫu') : live ? 'Nhập tin nhắn Zalo...' : 'Nhập tin nhắn mẫu...'}
        aria-label="Nội dung tin nhắn demo" disabled={offline} onChange={e => setDraft(activeId, e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); dispatch(); } }} />
      <button className="composer-button" aria-label="Chọn tệp demo" disabled={offline} onClick={() => choose('')}><Paperclip size={23} /></button>
      <button className="composer-button" aria-label="Chọn hình ảnh demo" disabled={offline} onClick={() => choose('image/*')}><Image size={23} /></button>
      <button className="composer-button" aria-label="Giọng nói demo" onClick={() => notify('Giọng nói: chỉ minh họa, không thu âm.')}><Mic size={22} /></button>
      <button className="send-button" aria-label={live ? 'Gửi tin nhắn Zalo' : 'Gửi tin nhắn demo'} disabled={offline || !draft.trim()} onClick={() => { dispatch(); input.current?.focus(); }}><Send size={20} /></button>
    </div>
    <input ref={picker} type="file" hidden multiple aria-label="Tệp demo" onChange={e => {
      attach(Array.from(e.target.files || []).map(({ name, size }) => ({ name, size }))); e.target.value = '';
    }} />
    <div className="composer-hint">{offline
      ? (live ? 'Đã dừng kết nối: bấm "Kết nối lại" ở banner để chạy tiếp.' : 'Ngoại tuyến: tin nhắn mẫu sẽ gửi được sau khi kết nối lại.')
      : live ? 'zca-js không chính thức · chỉ dùng tài khoản phụ' : 'Gửi mẫu trên máy · Enter để gửi · Shift + Enter để xuống dòng'}</div>
  </footer>;
}
