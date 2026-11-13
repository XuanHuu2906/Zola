import { useState } from 'react';
import { Download, FileText, ExternalLink, MapPin, UserRound } from 'lucide-react';
import type { MessageAttachment } from '../../types.ts';

const LABELS: Record<MessageAttachment['kind'], string> = {
  photo: 'Hình ảnh', video: 'Video', voice: 'Tin nhắn thoại', sticker: 'Nhãn dán',
  doodle: 'Hình vẽ tay', file: 'Tệp đính kèm', link: 'Liên kết',
  location: 'Vị trí', contact: 'Danh thiếp', gif: 'Ảnh động', other: 'Tệp đính kèm',
};

/** Kích thước người đọc được. `null` khi Zalo không gửi kèm (thường gặp với ảnh). */
export function formatSize(bytes?: number): string | null {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** Thời lượng ghi âm/video: `m:ss`, hoặc `h:mm:ss` khi dài hơn một giờ. */
export function formatDuration(ms?: number): string | null {
  if (!ms || ms <= 0) return null;
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

const isImage = (item: MessageAttachment): boolean =>
  item.kind === 'photo' || item.kind === 'gif' || item.kind === 'sticker' || item.kind === 'doodle';

/**
 * Một ô ảnh: dùng `thumb` nếu đã có (về trước), rơi về `src`, và hiện ô chờ khi
 * chưa có gì. Ảnh hỏng (tệp bị xoá khỏi đĩa) cũng rơi về ô chờ thay vì biểu
 * tượng ảnh vỡ của trình duyệt.
 */
function ImageAttachment({ item }: { item: MessageAttachment }) {
  const [brokenSource, setBrokenSource] = useState<string | null>(null);
  const source = item.src ?? item.thumb;
  const broken = source === brokenSource;
  if (!source || broken) {
    return <div className="media-pending" role="img" aria-label={`${LABELS[item.kind]} ${item.failed || broken ? 'không tải được' : 'đang tải'}`}>
      <span>{LABELS[item.kind]}</span>
      <small>{item.failed || broken ? 'Không tải được ảnh. Mở lại hội thoại để thử lại.' : 'Đang tải…'}</small>
    </div>;
  }
  return <figure className="media-image">
    <img src={source} alt={item.title || LABELS[item.kind]} loading="lazy" decoding="async"
      onError={() => setBrokenSource(source)} />
    {item.kind === 'video' && <span className="media-badge">{formatDuration(item.duration) || 'Video'}</span>}
  </figure>;
}

export function attachmentFormat(item: MessageAttachment): string {
  return (item.ext || item.title?.match(/\.([a-z0-9]{1,12})$/i)?.[1]
    || item.src?.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
}

export function attachmentName(item: MessageAttachment): string {
  const ext = attachmentFormat(item);
  const title = item.title || LABELS[item.kind];
  return ext && !title.toLowerCase().endsWith(`.${ext}`) ? `${title}.${ext}` : title;
}

export function FileActions({ item }: { item: MessageAttachment }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const run = async (action: 'open' | 'save') => {
    if (!item.src || !window.desktop?.mediaAction) return;
    setBusy(true); setMessage('');
    try {
      const result = await window.desktop.mediaAction(item.src, attachmentName(item), action);
      if (!result.ok) setMessage(result.message || 'Không xử lý được tệp.');
      else if (action === 'save' && !result.canceled) setMessage('Đã lưu tệp.');
    } catch { setMessage('Không xử lý được tệp. Vui lòng thử lại.'); }
    finally { setBusy(false); }
  };
  return <div className="attachment-actions">
    <button className="subtle-btn" disabled={busy || !item.src || !window.desktop?.mediaAction} onClick={() => void run('open')}>Mở tệp</button>
    <button className="subtle-btn" disabled={busy || !item.src || !window.desktop?.mediaAction} onClick={() => void run('save')}><Download size={15} />Tải xuống</button>
    <small role="status">{message || (busy ? 'Đang xử lý…' : !item.src ? item.failed ? 'Không tải được tệp. Mở lại hội thoại để thử lại.' : 'Đang tải tệp…' : '')}</small>
  </div>;
}

function FileAttachment({ item }: { item: MessageAttachment }) {
  const name = attachmentName(item);
  const size = formatSize(item.size);
  const meta = [attachmentFormat(item).toUpperCase() || 'Chưa rõ định dạng', size, item.duration ? formatDuration(item.duration) : null].filter(Boolean).join(' · ');
  return <div className="file-block">
    <div className="file-card static" role="group" aria-label={`Tệp ${name}`}>
      <div className="file-icon">{item.kind === 'voice'
        ? <Download size={23} />
        : <FileText size={23} />}</div>
      <div className="file-meta"><strong title={name}>{name}</strong>{meta && <small>{meta}</small>}</div>
    </div>
    <FileActions item={item} />
  </div>;
}

/** Ảnh xem trước của một thẻ liên kết, cộng tiêu đề và mô tả. */
function LinkAttachment({ item }: { item: MessageAttachment }) {
  return <a className="link-card" href={item.url} target="_blank" rel="noreferrer noopener"
    aria-label={`Mở liên kết ${item.title || item.url || ''}`}>
    {item.thumb && <img className="link-thumb" src={item.thumb} alt="" loading="lazy" />}
    <span className="link-meta">
      <strong>{item.title || 'Liên kết'}</strong>
      {item.description && <small>{item.description}</small>}
      <small className="link-url"><ExternalLink size={11} />{item.url}</small>
    </span>
  </a>;
}

function LocationAttachment({ item }: { item: MessageAttachment }) {
  return <div className="file-block"><div className="file-card static">
    <div className="file-icon"><MapPin size={23} /></div>
    <div className="file-meta"><strong>{item.title || LABELS.location}</strong>
      {item.description && <small>{item.description}</small>}</div>
  </div></div>;
}

function ContactAttachment({ item }: { item: MessageAttachment }) {
  return <div className="file-block"><div className="file-card static">
    <div className="file-icon"><UserRound size={23} /></div>
    <div className="file-meta"><strong>{item.title || LABELS.contact}</strong>
      {item.description && <small>{item.description}</small>}</div>
  </div></div>;
}

export function AttachmentView({ item }: { item: MessageAttachment }) {
  if (isImage(item)) return <ImageAttachment item={item} />;
  if (item.kind === 'link') return <LinkAttachment item={item} />;
  if (item.kind === 'location') return <LocationAttachment item={item} />;
  if (item.kind === 'contact') return <ContactAttachment item={item} />;
  return <FileAttachment item={item} />;
}

/** Tin này có ít nhất một tệp **vẽ được thành ảnh** (để chọn kiểu bong bóng). */
export const hasInlineMedia = (items?: MessageAttachment[]): boolean =>
  !!items?.some(isImage);
