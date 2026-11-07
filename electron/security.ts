import path from 'node:path';
export const APP_ORIGIN = 'glass://app';
export const DEV_ORIGIN = 'http://127.0.0.1:5173';
/**
 * `img-src 'self' data:` là ngoại lệ duy nhất và có chủ đích: ảnh QR đăng nhập
 * được zca-js trả về dạng base64 và chỉ tồn tại dưới dạng data URL dựng ở main.
 * Không có host từ xa nào được phép, nên avatar Zalo vẫn không tải được — đó là
 * lý do `LiveThread.avatar` luôn `null`. Xem ADR-002 (sửa đổi CSP).
 */
export const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'";
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
export function resourcePath(root: string, value: string): string | null {
  try {
    const url = new URL(value);
    if (!isAllowedRequest(value, false)) return null;
    const name = decodeURIComponent(url.pathname).replace(/^\//, '') || 'index.html';
    if (name.includes('\\') || name.includes('\0') || name.split('/').includes('..')) return null;
    if (name !== 'index.html' && !/^assets\/[a-zA-Z0-9_.-]+\.(js|css|png|jpg|woff2)$/.test(name)) return null;
    const absolute = path.resolve(root, name);
    const relative = path.relative(path.resolve(root), absolute);
    return relative.startsWith('..') || path.isAbsolute(relative) ? null : absolute;
  } catch { return null; }
}
