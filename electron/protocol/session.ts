import { readFile, rm, mkdir, open, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { safeStorage } from 'electron';
import type { Credentials } from 'zca-js';

/**
 * Phiên zca-js là bí mật: cookie + imei + userAgent đủ để giả lập đăng nhập.
 * Chỉ main giữ, chỉ ghi bằng `safeStorage` (DPAPI trên Windows), và chỉ ghi
 * *sau* khi đăng nhập thành công. Renderer không bao giờ thấy bất kỳ trường nào.
 */
export interface SavedSession {
  /** `loginQR` trả `SerializedCookie[]`, còn `login()` nhận cả hai dạng. */
  cookie: Credentials['cookie'];
  imei: string;
  userAgent: string;
  language: string;
}

const FILE = 'zca-session.bin';

function isSavedSession(value: unknown): value is SavedSession {
  if (typeof value !== 'object' || value === null) return false;
  const { cookie, imei, userAgent, language } = value as Record<string, unknown>;
  return Array.isArray(cookie) && cookie.length > 0
    && typeof imei === 'string' && imei.length > 0 && imei.length <= 200
    && typeof userAgent === 'string' && userAgent.length > 0 && userAgent.length <= 1000
    && typeof language === 'string' && language.length <= 10;
}

export interface SessionStore {
  load(): Promise<SavedSession | null>;
  save(session: SavedSession): Promise<void>;
  clear(): Promise<void>;
}

export function createSessionStore(dataRoot: string): SessionStore {
  const file = path.join(dataRoot, FILE);
  const encryption = () => {
    try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
  };
  return {
    async load() {
      let bytes: Buffer;
      try { bytes = await readFile(file); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw new Error('Không đọc được phiên đã lưu. Phiên vẫn được giữ trên máy.');
      }
      if (!encryption()) throw new Error('Chưa mở được kho khóa của hệ điều hành. Hãy mở khóa và thử lại phiên đã lưu.');
      try {
        const parsed: unknown = JSON.parse(safeStorage.decryptString(bytes));
        if (!isSavedSession(parsed)) throw new Error('Invalid session');
        return parsed;
      } catch { throw new Error('Chưa giải mã được phiên đã lưu trên máy này. Hãy mở khóa kho khóa hệ điều hành và thử lại.'); }
    },
    async save(session) {
      if (!encryption()) throw new Error('Không lưu được phiên đăng nhập vì kho khóa hệ điều hành chưa sẵn sàng.');
      const plain = JSON.stringify({ cookie: session.cookie, imei: session.imei,
        userAgent: session.userAgent, language: session.language });
      const encrypted = safeStorage.encryptString(plain);
      await mkdir(dataRoot, { recursive: true });
      const temp = `${file}.${randomUUID()}.tmp`;
      try {
        const handle = await open(temp, 'wx', 0o600);
        try { await handle.writeFile(encrypted); await handle.sync(); }
        finally { await handle.close(); }
        await rename(temp, file);
      } finally { await rm(temp, { force: true }).catch(() => {}); }
    },
    async clear() {
      try { await rm(file, { force: true }); } catch { /* absent is fine */ }
    },
  };
}
