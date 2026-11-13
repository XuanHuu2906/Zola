import path from 'node:path';
export const APP_ORIGIN = 'glass://app';
export const DEV_ORIGIN = 'http://127.0.0.1:5173';
/**
 * `img-src 'self' data:` là ngoại lệ duy nhất và có chủ đích: ảnh QR đăng nhập
 * được zca-js trả về dạng base64 và chỉ tồn tại dưới dạng data URL dựng ở main.
 *
 * Avatar hội thoại **không** làm CSP rộng thêm. Main tải ảnh về
 * `<dataRoot>/avatars/` và phục vụ nó qua chính `glass://app/avatars/<id>.png`,
 * nên trong CSP nó là `'self'` như mọi asset khác. Xem `electron/avatars.ts`.
 *
 * Tệp đính kèm trong tin nhắn đi đúng đường đó (`glass://app/media/<key>.<ext>`,
 * xem `electron/media.ts`) và **không** cần `media-src` riêng: `'self'` của
 * `img-src` đã bao trùm origin này.
 */
export const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'";
export function isTrustedDocument(value: string, development: boolean): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    return development ? url.origin === DEV_ORIGIN && url.pathname === '/'
      : url.protocol === 'glass:' && url.hostname === 'app' && !url.port && (url.pathname === '/' || url.pathname === '/index.html');
  } catch { return false; }
}
export function isAllowedRequest(value: string, development: boolean): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    return development ? url.origin === DEV_ORIGIN || url.origin === 'ws://127.0.0.1:5173'
      : url.protocol === 'glass:' && url.hostname === 'app' && !url.port;
  } catch { return false; }
}
/**
 * Có phải một đường dẫn avatar trong `glass://app`? Chỉ `<id>.<png|jpg>`, không
 * thư mục con, không `..`, không đuôi khác — phần còn lại do
 * `avatars.avatarFilePath` kiểm lần nữa trên đường dẫn đã giải mã.
 */
export const isAvatarPath = (pathname: string): boolean => /^\/avatars\/[0-9A-Za-z_-]{1,64}\.(png|jpg)$/.test(pathname);
/**
 * Có phải một đường dẫn tệp đính kèm trong `glass://app/media/`? Cùng khuôn với
 * `isAvatarPath`; phần kiểm thứ hai nằm ở `media.mediaFilePath`.
 *
 * Đuôi rộng hơn avatar vì đây là tệp người dùng gửi (pdf, mp4, mp3…), nhưng vẫn
 * chỉ chữ-số: `media/x.html` hay `media/../../etc` không bao giờ khớp.
 */
export const isMediaPath = (pathname: string): boolean =>
  /^\/media\/[0-9A-Za-z_-]{1,100}\.[a-z0-9]{1,5}$/.test(pathname);
export function resourcePath(root: string, value: string): string | null {
  try {
    const url = new URL(value);
    if (!isAllowedRequest(value, false)) return null;
    const name = decodeURIComponent(url.pathname).replace(/^\//, '') || 'index.html';
    if (name.includes('\\') || name.includes('\0') || name.split('/').includes('..')) return null;
    // Avatar nằm ngoài `dist/` (main tải về lúc chạy) nên nó **không** được giải
    // vào `root`. Trả `null` ở đây là đúng: handler trong main kiểm
    // `isAvatarPath` trước và phục vụ từ thư mục avatar riêng. Để nguyên tắc này
    // ở một chỗ — `root` chỉ chứa asset đóng gói.
    if (isAvatarPath(url.pathname)) return null;
    if (isMediaPath(url.pathname)) return null;
    if (name !== 'index.html' && !/^assets\/[a-zA-Z0-9_.-]+\.(js|css|png|jpg|woff2)$/.test(name)) return null;
    const absolute = path.resolve(root, name);
    const relative = path.relative(path.resolve(root), absolute);
    return relative.startsWith('..') || path.isAbsolute(relative) ? null : absolute;
  } catch { return null; }
}
