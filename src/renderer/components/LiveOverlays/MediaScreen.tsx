import { ExternalLink, FileText, ImageIcon, Link2, Users } from 'lucide-react';
import { useZaloStore } from '../../store/useZaloStore.ts';
import { GlassDialog } from '../../../components/glass/index.ts';
import { LIVE_NOTICE } from '../../../shared/live.ts';
import { FileActions, attachmentName, attachmentFormat, formatDuration, formatSize } from '../ChatPane/AttachmentView.tsx';
import type { MessageAttachment } from '../../types.ts';

/**
 * Thư viện phương tiện của một hội thoại: mọi ảnh, tệp và liên kết đã gửi.
 *
 * Dựng từ `chat.messages` chứ không đọc đĩa: tin trong store **là** dữ liệu đã
 * đồng bộ, còn thư mục `media/` chỉ là bản tải về của nó — đọc đĩa sẽ hiện những
 * tệp của tin chưa được nạp vào hội thoại này.
 *
 * Ba tab thay vì một danh sách: "ảnh" và "tệp" là hai việc người dùng làm khác
 * nhau ("xem lại ảnh cũ" so với "tìm lại cái PDF"), và gộp chúng làm cả hai khó.
 */

type Tab = 'photo' | 'file' | 'link';

interface Entry {
  key: string;
  messageId: number;
  time: string;
  from: 'me' | 'them';
  item: MessageAttachment;
}

const isPhoto = (item: MessageAttachment): boolean =>
  item.kind === 'photo' || item.kind === 'gif' || item.kind === 'sticker' || item.kind === 'doodle';

function entriesOf(messages: { id: number; time: string; from: 'me' | 'them'; attachments?: MessageAttachment[] }[],
  tab: Tab): Entry[] {
  const out: Entry[] = [];
  for (const message of messages) {
    for (const [index, item] of (message.attachments ?? []).entries()) {
      const matches = tab === 'photo' ? isPhoto(item)
        : tab === 'link' ? item.kind === 'link'
          : !isPhoto(item) && item.kind !== 'link' && item.kind !== 'location' && item.kind !== 'contact';
      if (matches) out.push({ key: `${message.id}-${index}`, messageId: message.id, time: message.time, from: message.from, item });
    }
  }
  return out;
}

function PhotoGrid({ entries, onSelect }: { entries: Entry[]; onSelect: (entry: Entry) => void }) {
  return <div className="media-grid">
    {entries.map(entry => {
      const source = entry.item.src ?? entry.item.thumb;
      // Chưa tải xong: vẫn hiện một ô, vì ảnh **có** trong hội thoại — chỉ là
      // chưa có trên đĩa. Bỏ nó đi là nói dối về lịch sử.
      return <button key={entry.key} className="media-tile" onClick={() => onSelect(entry)}
        aria-label={`Xem ${entry.item.title || 'ảnh'} gửi ${entry.time}`}>
        {source ? <img src={source} alt={entry.item.title || 'Ảnh trong hội thoại'} loading="lazy" />
          : <span className="media-tile-empty"><ImageIcon size={20} />Đang tải…</span>}
      </button>;
    })}
  </div>;
}

function FileList({ entries, onSelect }: { entries: Entry[]; onSelect: (entry: Entry) => void }) {
  return <ul className="media-list">{entries.map(entry => {
    const name = attachmentName(entry.item);
    const size = formatSize(entry.item.size);
    const duration = formatDuration(entry.item.duration);
    return <li key={entry.key}>
      <button className="media-row" onClick={() => onSelect(entry)} aria-label={`Xem ${name}`}>
        <span className="file-icon"><FileText size={20} /></span>
        <span className="media-row-meta"><strong>{name}</strong>
          <small>{[attachmentFormat(entry.item).toUpperCase(), size, duration, entry.time].filter(Boolean).join(' · ')}</small></span>
      </button>
    </li>;
  })}</ul>;
}

function LinkList({ entries, onSelect }: { entries: Entry[]; onSelect: (entry: Entry) => void }) {
  return <ul className="media-list">{entries.map(entry => (
    <li key={entry.key}>
      <button className="media-row" onClick={() => onSelect(entry)}
        aria-label={`Xem liên kết ${entry.item.title || entry.item.url || ''}`}>
        {entry.item.thumb ? <img className="media-row-thumb" src={entry.item.thumb} alt="" loading="lazy" />
          : <span className="link-badge"><Link2 size={18} /></span>}
        <span className="media-row-meta"><strong>{entry.item.title || 'Liên kết'}</strong>
          <small className="link-url"><ExternalLink size={11} />{entry.item.url || entry.time}</small></span>
      </button>
    </li>))}</ul>;
}

export function LiveMediaScreen({ chatId }: { chatId: string }) {
  const chat = useZaloStore(s => s.chats.find(item => item.id === chatId));
  const tab = useZaloStore(s => s.liveMediaTab);
  const setTab = useZaloStore(s => s.setLiveMediaTab);
  const selection = useZaloStore(s => s.liveMediaSelected);
  const refreshed = selection && chat?.messages.find(message => message.id === selection.messageId)?.attachments
    ?.find(item => item.kind === selection.item.kind && item.title === selection.item.title);
  const selected = selection ? { ...selection, item: refreshed || selection.item } : null;
  const setSelected = useZaloStore(s => s.setLiveMediaSelected);
  const close = useZaloStore(s => s.closeLiveOverlay);
  if (!chat) return null;

  const photos = entriesOf(chat.messages, 'photo');
  const files = entriesOf(chat.messages, 'file');
  const links = entriesOf(chat.messages, 'link');
  const shown = tab === 'photo' ? photos : tab === 'file' ? files : links;
  const pick = (entry: Entry) => setSelected({ messageId: entry.messageId, item: entry.item });

  return <GlassDialog labelledBy="live-media-title" className="info-modal media-modal" onClose={close}>
    <header className="overlay-head">
      <span className="eyebrow">PHƯƠNG TIỆN TRONG HỘI THOẠI</span>
      <h2 id="live-media-title">{chat.name}</h2>
      <div className="media-tabs" role="tablist" aria-label="Lọc phương tiện">
        <button role="tab" aria-selected={tab === 'photo'} className={tab === 'photo' ? 'is-active' : ''}
          onClick={() => { setTab('photo'); setSelected(null); }}>
          <ImageIcon size={14} />Ảnh<span className="media-count">{photos.length}</span></button>
        <button role="tab" aria-selected={tab === 'file'} className={tab === 'file' ? 'is-active' : ''}
          onClick={() => { setTab('file'); setSelected(null); }}>
          <FileText size={14} />Tệp<span className="media-count">{files.length}</span></button>
        <button role="tab" aria-selected={tab === 'link'} className={tab === 'link' ? 'is-active' : ''}
          onClick={() => { setTab('link'); setSelected(null); }}>
          <Link2 size={14} />Liên kết<span className="media-count">{links.length}</span></button>
      </div>
    </header>
    <div className="media-body">
      {selected ? <div className="media-preview">
        <div className="media-preview-head">
          <button className="subtle-btn" onClick={() => setSelected(null)}>‹ Quay lại danh sách</button>
          <span className="media-preview-from">
            {selected.item.title || 'Tệp đính kèm'}
          </span>
        </div>
        {isPhoto(selected.item)
          ? <img className="media-preview-image" alt={selected.item.title || 'Ảnh trong hội thoại'}
            src={selected.item.src ?? selected.item.thumb ?? ''} />
          : <div className="media-preview-facts">
            <strong>{selected.item.title || 'Tệp đính kèm'}</strong>
            {selected.item.description && <p>{selected.item.description}</p>}
            {selected.item.url && <p className="link-url"><ExternalLink size={12} />{selected.item.url}</p>}
            <dl className="info-facts">
              {formatSize(selected.item.size) && <div><dt>Kích thước</dt><dd>{formatSize(selected.item.size)}</dd></div>}
              {selected.item.ext && <div><dt>Định dạng</dt><dd>{selected.item.ext.toUpperCase()}</dd></div>}
              <div><dt>Đã tải</dt><dd>{selected.item.src ? 'Có, trên máy này' : 'Chưa'}</dd></div>
            </dl>
            {selected.item.kind !== 'link' && <FileActions item={selected.item} />}
            {!selected.item.src && selected.item.kind !== 'link'
              && <p className="live-notice">Tệp này chưa được tải về máy nên chưa xem trước được.</p>}
          </div>}
      </div>
      : shown.length === 0
        ? <p className="media-empty">
          {tab === 'photo' ? 'Chưa có ảnh nào trong hội thoại này.'
            : tab === 'file' ? 'Chưa có tệp nào trong hội thoại này.'
              : 'Chưa có liên kết nào trong hội thoại này.'}</p>
        : tab === 'photo' ? <PhotoGrid entries={shown} onSelect={pick} />
          : tab === 'link' ? <LinkList entries={shown} onSelect={pick} />
            : <FileList entries={shown} onSelect={pick} />}
    </div>
    <footer className="overlay-footer">
      <span className="overlay-note"><Users size={15} />{LIVE_NOTICE}</span>
      <button className="primary-btn" data-autofocus onClick={close}>Đóng thư viện</button>
    </footer>
  </GlassDialog>;
}
