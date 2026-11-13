/**
 * Avatar hội thoại: tải **một lần** về đĩa, rồi phục vụ qua chính `glass://app`.
 *
 * Vì sao không cho renderer trỏ thẳng vào URL của Zalo: CSP của app là
 * `default-src 'none'; img-src 'self' data:`. Nới `img-src` ra một host từ xa là
 * mở một kênh ảnh http(s) ra ngoài cho một cửa sổ vốn không có `connect-src`
 * nào — và mỗi avatar trở thành một lời gọi mạng do **renderer** khởi phát, tức
 * là thứ ta không kiểm được đích. Thay vào đó main tải ảnh, kiểm nó đúng là ảnh,
 * ghi xuống `<dataRoot>/avatars/<id>.<ext>`, và renderer chỉ thấy đường dẫn tương
 * đối cùng origin `glass://app`. Không host mới nào đi vào CSP (ADR-002).
 *
 * File này không import `electron`: mọi thứ chạy được bằng node, nên
 * `tests/avatars.test.ts` kiểm được cả kiểm tra URL lẫn phần ghi đĩa với một
 * `fetch` giả.
 */
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Trần kích thước một avatar. Ảnh đại diện Zalo là ~10–60 KB; 1 MB là chỗ dư rộng
 * rãi cho ảnh nhóm lớn, và là ranh giới để một URL trả về luồng vô hạn không
 * làm đầy đĩa của người dùng.
 */
export const AVATAR_MAX_BYTES = 1_000_000;

/** Trần thời gian một lần tải: avatar không đáng để giữ tiến trình chờ. */
export const AVATAR_TIMEOUT_MS = 10_000;

/**
 * Host được phép. Chỉ đuôi `zadn.vn` — CDN ảnh của Zalo (`s120-ava-talk`,
 * `res-zalo`, `cover-talk`…). So theo **nhãn tên miền**, không theo `includes`:
 * `zadn.vn.evil.com` và `evil-zadn.vn` đều phải trượt, nên chuỗi phải bằng
 * `zadn.vn` hoặc kết thúc bằng `.zadn.vn`.
 */
export function isAvatarHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'zadn.vn' || host.endsWith('.zadn.vn');
}

/**
 * URL avatar dùng được, hoặc `null`.
 *
 * Từ chối: scheme khác https, host ngoài CDN Zalo, có credential trong URL, có
 * cổng lạ. `zca-js` trả về URL đầy đủ; một chuỗi rỗng hay một đường dẫn tương
 * đối (bản cache cũ, dữ liệu hỏng) cũng trả `null` thay vì đoán.
 */
export function parseAvatarUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    if (url.port) return null;
    if (!isAvatarHost(url.hostname)) return null;
    return url;
  } catch { return null; }
}

/**
 * Tên file cho một hội thoại: `<id>.<ext>`.
 *
 * `id` là uid số hoặc `globalId` base62 (hội thoại còn mang id nhiễu). Chỉ nhận
 * chữ, số, `_`, `-` và tối đa 64 ký tự — đủ cho cả hai dạng id, và không cho
 * `.`, `/`, `\` hay byte NUL nào đi vào tên file.
 */
export function avatarFileName(threadId: string, ext: 'png' | 'jpg'): string | null {
  if (typeof threadId !== 'string' || !/^[0-9A-Za-z_-]{1,64}$/.test(threadId)) return null;
  return `${threadId}.${ext}`;
}

/**
 * Đoán loại ảnh từ magic bytes thay vì tin `Content-Type` hay đuôi URL.
 *
 * Máy chủ CDN có thể trả `text/html` cho một URL ảnh đã hết hạn; ghi file đó vào
 * `avatars/` rồi để `<img>` đọc nó là cách chắc chắn nhất để có một ô ảnh hỏng
 * vĩnh viễn trong cache. Chỉ hai định dạng được nhận, vì đó là hai định dạng
 * trình duyệt chắc chắn vẽ được với `img-src 'self'`.
 */
export function avatarExtension(bytes: Uint8Array): 'png' | 'jpg' | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  return null;
}

/** Đường dẫn phục vụ cho renderer; `null` khi chưa có ảnh trên đĩa. */
export const avatarUrl = (fileName: string | null): string | null =>
  fileName ? `glass://app/avatars/${fileName}` : null;

/**
 * Một mục cần tải. `current` là tên file đã ghi trước đó (nếu có) để biết ảnh đã
 * nằm trên đĩa hay chưa — DB là nguồn đúng, không phải việc dò thư mục.
 */
export interface AvatarJob {
  threadId: string;
  remote: string;
  current: string | null;
}

export interface AvatarStats {
  downloaded: number;
  skipped: number;
  failed: number;
}

export interface AvatarOptions {
  dir: string;
  jobs: AvatarJob[];
  fetch: typeof globalThis.fetch;
  /** Trả `false` khi tiến trình đang đóng: vòng lặp dừng ở mục kế tiếp. */
  alive?: () => boolean;
  /** Được gọi sau mỗi ảnh ghi xong, để main cập nhật DB và phát sự kiện. */
  onStored?: (threadId: string, fileName: string) => void;
  log?: (event: string, data: Record<string, unknown>) => void;
}

/** Đọc cả body nhưng dừng ngay khi vượt trần — không tin `Content-Length`. */
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

/**
 * Ghi ảnh xuống đĩa theo cách không để lại file nửa vời.
 *
 * Ghi ra `<name>.part` rồi `rename`: một lần tải bị cắt giữa chừng (đóng app, mất
 * mạng) không bao giờ để lại một `avatars/<id>.png` hỏng mà lần sau được coi là
 * "đã có" và không tải lại. `rename` trong cùng thư mục là thao tác nguyên tử.
 */
async function storeAtomically(dir: string, name: string, bytes: Uint8Array): Promise<void> {
  const target = path.join(dir, name);
  const temp = `${target}.part`;
  await writeFile(temp, bytes);
  await rename(temp, target);
}

/** Ảnh đã nằm trên đĩa chưa. Chỉ dùng để dọn `current` trỏ vào file đã mất. */
async function exists(file: string): Promise<boolean> {
  try { return (await stat(file)).isFile(); } catch { return false; }
}

/**
 * Tải những avatar còn thiếu. Idempotent: mục đã có file thì bỏ qua, nên lần mở
 * app thứ hai chỉ tải phần còn lại.
 *
 * Chạy tuần tự có chủ đích. 238 avatar là 238 lời gọi tới CDN của Zalo ngay sau
 * khi đăng nhập — bắn song song hết là cách nhanh nhất để bị chặn theo lưu lượng,
 * và mỗi lời gọi đã có trần 10 s riêng nên hỏng một cái không kéo dài cả mẻ.
 */
export async function syncAvatars(options: AvatarOptions): Promise<AvatarStats> {
  const { dir, jobs, fetch: doFetch, alive = () => true, onStored, log = () => {} } = options;
  const stats: AvatarStats = { downloaded: 0, skipped: 0, failed: 0 };
  try { await mkdir(dir, { recursive: true }); } catch (error) {
    log('avatar-dir', { ok: false, message: error instanceof Error ? error.message.slice(0, 120) : 'unknown' });
    return stats;
  }
  for (const job of jobs) {
    if (!alive()) break;
    let existingName = job.current;
    if (!existingName) {
      for (const ext of ['png', 'jpg'] as const) {
        const candidate = avatarFileName(job.threadId, ext);
        if (candidate && await exists(path.join(dir, candidate))) {
          existingName = candidate;
          break;
        }
      }
    }
    if (existingName) {
      if (await exists(path.join(dir, existingName))) {
        stats.skipped += 1;
        if (!job.current) onStored?.(job.threadId, existingName);
        continue;
      }
      // File đã mất (người dùng dọn thư mục, đĩa đổi máy): xoá dấu trong DB bằng
      // cách tải lại, không để lại một đường dẫn trỏ vào hư không.
    }
    const url = parseAvatarUrl(job.remote);
    if (!url) { stats.failed += 1; log('avatar', { ok: false, reason: 'url' }); continue; }
    try {
      const response = await doFetch(url, { signal: AbortSignal.timeout(AVATAR_TIMEOUT_MS), redirect: 'error' });
      if (!response.ok) { stats.failed += 1; log('avatar', { ok: false, reason: 'status', status: response.status }); continue; }
      const bytes = await readCapped(response, AVATAR_MAX_BYTES);
      const ext = bytes ? avatarExtension(bytes) : null;
      const name = ext ? avatarFileName(job.threadId, ext) : null;
      if (!bytes || !ext || !name) { stats.failed += 1; log('avatar', { ok: false, reason: 'content' }); continue; }
      await storeAtomically(dir, name, bytes);
      stats.downloaded += 1;
      onStored?.(job.threadId, name);
      log('avatar', { ok: true, bytes: bytes.byteLength, ext });
    } catch (error) {
      stats.failed += 1;
      log('avatar', { ok: false, reason: 'fetch', message: error instanceof Error ? error.message.slice(0, 120) : 'unknown' });
    }
  }
  return stats;
}

/**
 * Đường dẫn file cho một URL `glass://app/avatars/<name>`; `null` nếu không hợp lệ.
 *
 * Bản sao của phần kiểm tra trong `security.ts` nhưng trỏ vào thư mục avatar nằm
 * **ngoài** `rendererRoot`. Chỉ `<id>.<png|jpg>` được phục vụ: không thư mục con,
 * không `..`, không đuôi khác, không byte NUL.
 */
export function avatarFilePath(dir: string, urlPath: string): string | null {
  const name = urlPath.replace(/^\/avatars\//, '');
  if (!/^[0-9A-Za-z_-]{1,64}\.(png|jpg)$/.test(name)) return null;
  const absolute = path.resolve(dir, name);
  return path.dirname(absolute) === path.resolve(dir) ? absolute : null;
}

/** Đọc ảnh để phục vụ; `null` khi không có (ô ảnh rơi về biểu tượng mặc định). */
export async function readAvatar(dir: string, urlPath: string): Promise<Uint8Array | null> {
  const file = avatarFilePath(dir, urlPath);
  if (!file) return null;
  try { return await readFile(file); } catch { return null; }
}

/** Xoá phần dư của một lần ghi hỏng; gọi lúc khởi động, không phải trong vòng tải. */
export async function pruneTemp(dir: string): Promise<void> {
  try {
    for (const name of await readdir(dir)) {
      if (name.endsWith('.part')) await unlink(path.join(dir, name)).catch(() => {});
    }
  } catch { /* thư mục chưa có: không có gì để dọn */ }
}
