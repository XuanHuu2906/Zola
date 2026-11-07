/**
 * `crypto.randomUUID` chỉ có trong secure context (file:// của app Electron). Nơi
 * khác (ví dụ `npm run dev` mở bằng http trên LAN) vẫn cần id để nối tin tạm với
 * kết quả gửi, nên có đường lùi dùng `getRandomValues`.
 */
export function newClientId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
