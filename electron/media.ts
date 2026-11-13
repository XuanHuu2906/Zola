/**
 * Tệp đính kèm trong tin nhắn: tải **một lần** về đĩa, rồi phục vụ qua chính
 * `glass://app/media/…`.
 *
 * Cùng lý do và cùng khuôn với `electron/avatars.ts` (đọc phần đầu file đó trước
 * khi sửa file này): CSP của app là `img-src 'self' data:`, nên renderer không vẽ
 * được URL của Zalo, và một URL như vậy trong payload IPC là một đích mạng do
 * renderer khởi phát. `attachment.ts` đã bóc URL ở ranh giới IPC; file này là chỗ
 * duy nhất được dùng URL đó, và chỉ để gọi `fetch`.
 *
 * Khác avatar ở ba điểm, và mỗi điểm là một quyết định:
 *
 * 1. **Host rộng hơn.** Ảnh đại diện chỉ đến từ `*.zadn.vn`; nội dung tin nhắn
 *    (ảnh, ghi âm, tệp, video) nằm trên cả `*.zdn.vn` — `f1-voice-talk`,
 *    `f6-group-zf`, `f12-zpcloud`… Danh sách host lấy từ bundle Zalo PC, xem
 *    `isMediaHost`.
 * 2. **Trần lớn hơn và theo loại.** Một avatar là 10–60 KB; một tệp người dùng
 *    gửi có thể là vài chục MB. Trần riêng từng loại để một liên kết hỏng trỏ
 *    vào file khổng lồ không kéo hết đĩa.
 * 3. **Kiểm nội dung theo loại.** Với ảnh, magic bytes phải là PNG/JPEG/WEBP/GIF
 *    — nếu không, CDN đã trả một trang lỗi HTML và ghi nó vào cache là tạo một ô
 *    ảnh hỏng vĩnh viễn. Với các loại khác thì không suy được gì từ bytes, nên
 *    chỉ giữ trần dung lượng.
 *
 * File này không import `electron`: chạy và test được bằng node thật.
 */
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AttachmentKind, StoredAttachment } from './protocol/attachment.js';

/** Trần theo loại, tính bằng byte. */
export const MEDIA_MAX_BYTES: Record<AttachmentKind, number> = {
  photo: 12_000_000,
  gif: 12_000_000,
  sticker: 2_000_000,
  video: 120_000_000,
  voice: 20_000_000,
  doodle: 4_000_000,
  file: 120_000_000,
  // Liên kết chỉ tải ảnh xem trước; trang đích không bao giờ được mở.
  link: 4_000_000,
  // Ba loại dưới không có nội dung tải được: vị trí và danh thiếp là dữ liệu
  // trong `params`, `other` là loại chưa hiểu nên không đoán kích thước.
  location: 0,
  contact: 0,
  other: 8_000_000,
};

/** Một tệp lớn không đáng giữ tiến trình chờ; tệp nhỏ cũng không. */
export const MEDIA_TIMEOUT_MS = 25_000;

/**
 * Host được phép tải nội dung.
 *
 * Đo từ bundle Zalo PC (2026-11-11): `*.zadn.vn` (`s120-ava-talk`, `res-zalo`,
 * `res-zaloapp`, `res-download-pc`, `zinst-stc`) và `*.zdn.vn` (`talk`,
 * `stc-chat`, `f1-voice-talk`, `f2-voice-aac-dl`, `f6-group-zf`, `f12-zpcloud`,
 * `f14-zpcloud`). So theo **nhãn** tên miền như `isAvatarHost`, không `includes`:
 * `zadn.vn.evil.com` phải trượt.
 *
 * Một host lạ trả `false` và tệp đó bị đánh dấu hỏng — không mở rộng danh sách
 * theo dữ liệu đến từ server, vì làm vậy là để máy chủ chọn nơi app gọi ra.
 */
export function isMediaHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  const allowed = ['zadn.vn', 'zdn.vn'];
  // File CDN observed in synced document attachments; keep this host family explicit.
  if (/^file-stal-[0-9]+(?:-[a-z0-9]+)*\.(dlfl|flchat)\.vn$/.test(host)) return true;
  return allowed.some(domain => host === domain || host.endsWith(`.${domain}`));
}

/**
 * URL nội dung dùng được, hoặc `null`.
 *
 * Từ chối https khác, host ngoài CDN, credential trong URL, cổng lạ — y như
 * `parseAvatarUrl`, và vì cùng lý do: URL này đi thẳng vào `fetch`.
 */
export function parseMediaUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    if (url.port) return null;
    if (!isMediaHost(url.hostname)) return null;
    return url;
  } catch { return null; }
}

/** Zalo photo CDN exposes JPEG beside JXL; Chromium cannot decode JXL. */
export function compatibleImageUrl(url: URL): URL {
  const result = new URL(url.href);
  if (/^photo-[a-z0-9-]+\.zdn\.vn$/.test(result.hostname)
    && result.pathname.includes('/jxl/') && result.pathname.endsWith('.jxl')) {
    result.pathname = result.pathname.replace('/jxl/', '/jpg/').replace(/\.jxl$/, '.jpg');
  }
  return result;
}

/** Đuôi nào được ghi xuống đĩa; mọi thứ khác thành `.bin`. */
const KNOWN_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp',
  'mp4', 'mov', 'm4v', 'webm', '3gp',
  'mp3', 'm4a', 'aac', 'ogg', 'opus', 'amr', 'wav',
  'json', 'xml', 'md', 'rtf', 'odt', 'ods', 'odp', 'tar', 'gz', 'heic', 'avif', 'svg',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'zip', 'rar', '7z',
]);

/**
 * Đuôi tệp để ghi xuống đĩa.
 *
 * Không tin `ext` một cách mù quáng: nó đến từ tên tệp người dùng đặt, và
 * `attachment.ts` đã cắt còn 12 ký tự chữ-số nhưng chưa lọc theo danh sách. Đuôi
 * lạ thành `bin` — file vẫn mở được từ đĩa, chỉ là không có biểu tượng riêng.
 */
export function mediaExtension(kind: AttachmentKind, ext?: string): string {
  const lower = ext?.toLowerCase();
  if (lower && KNOWN_EXTENSIONS.has(lower)) return lower === 'jpeg' ? 'jpg' : lower;
  if (kind === 'photo' || kind === 'gif' || kind === 'sticker') return 'jpg';
  if (kind === 'voice') return 'mp3';
  if (kind === 'video') return 'mp4';
  return 'bin';
}

/**
 * Tên file cục bộ. Khoá bằng **nội dung**, không bằng tên hiển thị.
 *
 * `hash` là một chuỗi đã băm ở chỗ gọi (xem `mediaKey`) gồm `threadId`, `msgId`
 * và chỉ số tệp. Nhờ vậy cùng một URL xuất hiện ở hai tin khác nhau vẫn là hai
 * file — đúng, vì `src` gắn với một tin cụ thể, và xoá tin này không được làm
 * hỏng ảnh của tin kia.
 *
 * Chỉ `[0-9a-zA-Z_-]`: không `.`, `/`, `\`, không byte NUL.
 */
export function mediaFileName(key: string, ext: string): string | null {
  if (!/^[0-9A-Za-z_-]{1,96}$/.test(key)) return null;
  if (!/^[a-z0-9]{1,5}$/.test(ext)) return null;
  return `${key}.${ext}`;
}

/**
 * Magic bytes của ảnh. Chỉ nhận bốn định dạng trình duyệt vẽ được với
 * `img-src 'self'`; HEIC/AVIF không được nhận, và một tệp như vậy rơi về trạng
 * thái "không tải được" thay vì một ô ảnh vỡ.
 */
export function imageExtension(bytes: Uint8Array): 'png' | 'jpg' | 'gif' | 'webp' | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46
    && bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return 'gif';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'webp';
  return null;
}

/** Đường dẫn phục vụ cho renderer. */
export const mediaUrl = (fileName: string | null): string | null =>
  fileName ? `glass://app/media/${fileName}` : null;

/**
 * Một mục cần tải.
 *
 * `thumb` có mặt khi tin mang ảnh thu nhỏ riêng: tải nó **trước** để bong bóng có
 * gì đó hiện ngay, rồi mới tới bản đầy đủ. Hai lần tải cho một mục là chủ đích —
 * chờ bản đầy đủ xong mới hiện gì đó là cảm giác "ảnh không về".
 */
export interface MediaJob {
  threadId: string;
  msgId: string;
  index: number;
  kind: AttachmentKind;
  remote: string;
  remoteThumb?: string;
  /** Đuôi suy từ tên/URL, dùng khi bytes không nói được gì (tệp, video, ghi âm). */
  ext?: string;
}

export interface MediaResult {
  key: string;
  index: number;
  src: string;
  thumb: string | null;
}

export interface MediaStats {
  downloaded: number;
  skipped: number;
  failed: number;
}

export interface MediaOptions {
  dir: string;
  jobs: MediaJob[];
  fetch: typeof globalThis.fetch;
  alive?: () => boolean;
  onStored?: (result: MediaResult & { threadId: string; msgId: string }) => void;
  onFailed?: (job: MediaJob) => void;
  log?: (event: string, data: Record<string, unknown>) => void;
}

/**
 * Khoá nội dung của một mục: `threadId`, `msgId`, chỉ số.
 *
 * Băm bằng FNV-1a 64-bit (hai vòng 32-bit) chứ không dùng `crypto.createHash`:
 * hàm băm này phải chạy được cả trong test node lẫn trong main, và nó **không**
 * phải thứ bảo mật — nó chỉ cần phân biệt được và không đụng chạm gì tới tên
 * người dùng (tên tệp là nội dung tin nhắn, không được nằm trong tên file).
 */
export function mediaKey(threadId: string, msgId: string, index: number): string {
  const input = `${threadId}\u0000${msgId}\u0000${index}`;
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ (code + i), 0x85ebca6b) >>> 0;
  }
  return `m${a.toString(36)}${b.toString(36)}`;
}

async function readCapped(response: Response, cap: number): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > cap) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) { joined.set(chunk, at); at += chunk.byteLength; }
  return joined;
}

async function storeAtomically(dir: string, name: string, bytes: Uint8Array): Promise<void> {
  const target = path.join(dir, name);
  const temp = `${target}.part`;
  await writeFile(temp, bytes);
  await rename(temp, target);
}

/** Kết quả một lần tải một URL, đã qua kiểm loại. */
async function fetchOne(dir: string, kind: AttachmentKind, url: URL, ext: string,
  key: string, doFetch: typeof globalThis.fetch): Promise<string | null> {
  const cap = MEDIA_MAX_BYTES[kind];
  if (cap <= 0) return null;
  const compatible = ['photo', 'gif', 'sticker', 'doodle'].includes(kind) ? compatibleImageUrl(url) : url;
  const signal = AbortSignal.timeout(MEDIA_TIMEOUT_MS);
  let current = compatible;
  let response: Response;
  for (let hop = 0; ; hop += 1) {
    response = await doFetch(current, { signal, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location || hop >= 4) return null;
    const next = parseMediaUrl(new URL(location, current).href);
    if (!next) return null;
    current = next;
  }
  if (!response.ok) return null;
  const bytes = await readCapped(response, cap);
  if (!bytes || !bytes.byteLength) return null;
  // Chỉ ảnh mới kiểm được bằng bytes. Với tệp/ghi âm/video, `fetchOne` không có
  // cách nào biết đúng sai — giữ trần dung lượng là hết mức kiểm được mà không
  // phải đoán theo `Content-Type` (máy chủ có thể trả `text/html` cho một tệp
  // PDF, và ngược lại).
  const isImage = kind === 'photo' || kind === 'gif' || kind === 'sticker' || kind === 'doodle';
  const signature = Buffer.from(bytes.subarray(0, 8));
  const detected = imageExtension(bytes) || (signature.subarray(0, 5).toString() === '%PDF-' ? 'pdf'
    : signature.subarray(0, 4).toString('hex') === '504b0304' ? 'zip'
      : signature.subarray(0, 4).toString() === 'Rar!' ? 'rar' : null);
  const resolved = isImage ? imageExtension(bytes) : ext === 'bin' ? detected || ext : ext;
  if (!resolved) return null;
  const name = mediaFileName(key, resolved);
  if (!name) return null;
  await storeAtomically(dir, name, bytes);
  return name;
}

/**
 * Tải những tệp còn thiếu. Idempotent: mục đã có file thì bỏ qua.
 *
 * Chạy tuần tự như `syncAvatars`, và vì cùng lý do: đây là một hàng đợi sau khi
 * đồng bộ, có thể là hàng nghìn lời gọi tới CDN. Bắn song song là cách nhanh nhất
 * để bị chặn theo lưu lượng.
 */
export async function syncMedia(options: MediaOptions): Promise<MediaStats> {
  const { dir, jobs, fetch: doFetch, alive = () => true, onStored, onFailed, log = () => {} } = options;
  const stats: MediaStats = { downloaded: 0, skipped: 0, failed: 0 };
  try { await mkdir(dir, { recursive: true }); } catch (error) {
    log('media-dir', { ok: false, message: error instanceof Error ? error.message.slice(0, 120) : 'unknown' });
    return stats;
  }
  // Danh sách tên file đọc **một lần** cho cả lô, và tra theo **tiền tố khoá**
  // thay vì tên đầy đủ: đuôi của ảnh do magic bytes quyết định lúc ghi
  // (`png`/`webp`/`gif`), không phải đuôi đoán từ `kind`. Đoán `jpg` rồi hỏi
  // file `…jpg` làm mọi ảnh PNG bị tải lại ở mỗi lần đồng bộ.
  const names = new Set<string>();
  try { for (const name of await readdir(dir)) names.add(name); } catch { /* thư mục vừa tạo */ }
  const stored = (key: string): string | null => {
    const prefix = `${key}.`;
    for (const name of names) if (!name.endsWith('.part') && name.startsWith(prefix)) return name;
    return null;
  };
  for (const job of jobs) {
    if (!alive()) break;
    const ext = mediaExtension(job.kind, job.ext);
    const key = mediaKey(job.threadId, job.msgId, job.index);
    // Ảnh đã có thì cả mục coi như xong, kể cả ảnh thu nhỏ: ảnh thu nhỏ chỉ để
    // hiện sớm, và nếu bản đầy đủ đã nằm trên đĩa thì không còn gì để hiện sớm.
    const existing = stored(key);
    if (existing) {
      stats.skipped += 1;
      onStored?.({ threadId: job.threadId, msgId: job.msgId, index: job.index, key,
        src: mediaUrl(existing) as string, thumb: mediaUrl(stored(`${key}t`)) });
      continue;
    }
    const url = parseMediaUrl(job.remote);
    if (!url) { stats.failed += 1; onFailed?.(job); log('media', { ok: false, reason: 'url', kind: job.kind }); continue; }
    try {
      // Ảnh thu nhỏ trước: nó nhỏ, thường về trước, và cho bong bóng một thứ để
      // vẽ trong lúc bản đầy đủ còn đang tải.
      let thumbName: string | null = null;
      const thumbUrl = job.remoteThumb ? parseMediaUrl(job.remoteThumb) : null;
      if (thumbUrl && thumbUrl.href !== url.href) {
        thumbName = await fetchOne(dir, 'photo', thumbUrl, 'jpg', `${key}t`, doFetch).catch(() => null);
        if (thumbName) onStored?.({ threadId: job.threadId, msgId: job.msgId, index: job.index, key,
          src: mediaUrl(thumbName) as string, thumb: mediaUrl(thumbName) });
      }
      const src = await fetchOne(dir, job.kind, url, ext, key, doFetch);
      if (!src) {
        stats.failed += 1;
        onFailed?.(job);
        log('media', { ok: false, reason: 'content', kind: job.kind });
        continue;
      }
      // Ghi vào bộ nhớ đệm tên để một lô có hai việc cùng khoá không tải lặp,
      // và để lần `stored` kế tiếp thấy file vừa ghi.
      names.add(src);
      if (thumbName) names.add(thumbName);
      stats.downloaded += 1;
      onStored?.({
        threadId: job.threadId, msgId: job.msgId, index: job.index, key,
        src: `glass://app/media/${src}`, thumb: thumbName ? `glass://app/media/${thumbName}` : null,
      });
      log('media', { ok: true, kind: job.kind, bytes: 0 });
    } catch (error) {
      stats.failed += 1;
      onFailed?.(job);
      log('media', { ok: false, reason: 'fetch', kind: job.kind,
        message: error instanceof Error ? error.message.slice(0, 120) : 'unknown' });
    }
  }
  return stats;
}

/**
 * Đường dẫn file cho một URL `glass://app/media/<name>`.
 *
 * Bản sao phần kiểm trong `security.ts` cho thư mục nằm **ngoài** `rendererRoot`.
 * Chỉ `<key>.<ext>` — không thư mục con, không `..`, không byte NUL.
 */
export function mediaFilePath(dir: string, urlPath: string): string | null {
  const name = urlPath.replace(/^\/media\//, '');
  if (!/^[0-9A-Za-z_-]{1,100}\.[a-z0-9]{1,5}$/.test(name)) return null;
  const absolute = path.resolve(dir, name);
  return path.dirname(absolute) === path.resolve(dir) ? absolute : null;
}

export async function readMedia(dir: string, urlPath: string): Promise<Uint8Array | null> {
  const file = mediaFilePath(dir, urlPath);
  if (!file) return null;
  try { return await readFile(file); } catch { return null; }
}

/**
 * Kiểu MIME để phục vụ. Đuôi quyết định, không phải `Content-Type` của CDN.
 *
 * `octet-stream` là mặc định an toàn: một tệp `.bin` không bao giờ được trình
 * duyệt hiểu thành HTML và chạy như một trang.
 */
export function mediaContentType(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'png': return 'image/png';
    case 'jpg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'bmp': return 'image/bmp';
    case 'mp4': case 'm4v': return 'video/mp4';
    case 'webm': return 'video/webm';
    case 'mov': return 'video/quicktime';
    case '3gp': return 'video/3gp';
    case 'mp3': return 'audio/mpeg';
    case 'm4a': return 'audio/mp4';
    case 'aac': return 'audio/aac';
    case 'ogg': case 'opus': return 'audio/ogg';
    case 'amr': return 'audio/amr';
    case 'wav': return 'audio/wav';
    case 'pdf': return 'application/pdf';
    default: return 'application/octet-stream';
  }
}

/** Số liệu để quyết định có nên tải một mục hay không. */
export function needsDownload(item: StoredAttachment): boolean {
  return !!item.remote && !item.src && MEDIA_MAX_BYTES[item.kind] > 0;
}

/**
 * Biến `StoredAttachment` của một tin thành danh sách việc tải.
 *
 * Bỏ qua mục đã có `src` và mục không có nội dung tải được (vị trí, danh thiếp,
 * liên kết không có ảnh xem trước). Liên kết có ảnh xem trước thì tải ảnh đó —
 * và chỉ nó: trang đích không bao giờ được mở.
 */
export function mediaJobsOf(threadId: string, msgId: string,
  items: readonly StoredAttachment[] | undefined): MediaJob[] {
  if (!items?.length || !msgId) return [];
  const jobs: MediaJob[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.src) continue;
    if (MEDIA_MAX_BYTES[item.kind] <= 0) continue;
    // Với liên kết, ảnh xem trước là toàn bộ nội dung tải được: `remote` của nó
    // là URL trang đích, và tải nó về là tải một trang HTML.
    const remote = item.kind === 'link' ? item.remoteThumb : (item.remote ?? item.remoteThumb);
    if (!remote) continue;
    jobs.push({
      threadId, msgId, index, kind: item.kind, remote,
      ...(item.remoteThumb && item.kind !== 'link' ? { remoteThumb: item.remoteThumb } : {}),
      ...(item.ext ? { ext: item.ext } : {}),
    });
  }
  return jobs;
}

/** Xoá phần dư của một lần ghi hỏng; gọi lúc khởi động. */
export async function pruneMediaTemp(dir: string): Promise<void> {
  try {
    for (const name of await readdir(dir)) {
      if (name.endsWith('.part')) await unlink(path.join(dir, name)).catch(() => {});
    }
  } catch { /* thư mục chưa có: không có gì để dọn */ }
}
