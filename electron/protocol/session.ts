import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
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
      if (!encryption()) return null;
      try {
        const plain = safeStorage.decryptString(await readFile(file));
        const parsed: unknown = JSON.parse(plain);
        return isSavedSession(parsed) ? parsed : null;
      } catch { return null; }
    },
    async save(session) {
      if (!encryption()) return;
      const plain = JSON.stringify({ cookie: session.cookie, imei: session.imei,
        userAgent: session.userAgent, language: session.language });
      await writeFile(file, safeStorage.encryptString(plain), { mode: 0o600 });
    },
    async clear() {
      try { await rm(file, { force: true }); } catch { /* absent is fine */ }
    },
  };
}
