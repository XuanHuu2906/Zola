/**
 * Khoá **định danh** của PC cho Sync V2: cặp ed25519 sống qua các lần mở app.
 *
 * Zalo PC giữ cặp này (`genSyncKeyPair`, `CdmT.js:7038`) và dùng lại ở mọi
 * phiên: điện thoại niêm phong gói metadata cho khoá công khai này, và gói tin
 * của cùng phiên mở được bằng bản ghi phiên mà nó sinh ra. Khoá tạm (`ek`) thì
 * ngược lại — **mới mỗi phiên**, nên nó không nằm ở đây.
 *
 * Nơi lưu là bảng `kv` của `cache-<ownId>.db`: mỗi tài khoản một file, đúng chỗ
 * của mọi thứ thuộc tài khoản đó. Đây **không** phải thông tin đăng nhập — mất
 * nó chỉ có nghĩa là lần đồng bộ sau dùng một khoá mới, điều hoàn toàn hợp lệ
 * với máy chủ. Cookie/IMEI không bao giờ được ghi xuống đây.
 *
 * Không import `zca-js`, không import `electron`: test được bằng DB tạm.
 */
import type { Db } from '../db/schema.js';
import type { Ed25519KeyPair, SyncV2Crypto } from './sync-v2-crypto.js';

/** Khoá `kv` — mang tiền tố để không đụng `schema_version` và khoá của sau này. */
export const IDENTITY_KV_KEY = 'sync_v2_identity_private';

/**
 * Đọc khoá định danh, sinh mới nếu chưa có hoặc bản lưu hỏng.
 *
 * Chỉ lưu **nửa riêng**: khoá công khai suy lại được từ nó (`derivePublicKey`),
 * và lưu cả hai thì hai bản có thể lệch nhau sau một lần ghi hỏng — một cặp
 * lệch nhau không giải được gói nào và không có triệu chứng nào ngoài "đồng bộ
 * hỏng".
 */
export function loadIdentity(db: Db | null, crypto: SyncV2Crypto): Ed25519KeyPair {
  if (db) {
    try {
      const row = db.handle.prepare('SELECT value FROM kv WHERE key = ?').get(IDENTITY_KV_KEY) as
        { value?: string } | undefined;
      if (row?.value) {
        const privateKey = new Uint8Array(Buffer.from(row.value, 'base64'));
        // 32 byte là độ dài khoá riêng ed25519. Bản lưu cụt (ghi dở, sửa tay)
        // không phải khoá, và đưa nó vào wasm chỉ đổi "không có khoá" thành
        // "wasm ném lỗi khó đọc".
        if (privateKey.length === 32) {
          return { privateKey, publicKey: crypto.derivePublicKey(privateKey) };
        }
      }
    } catch {
      // DB hỏng hoặc chưa có bảng `kv`: rơi xuống sinh mới. Khoá định danh không
      // phải dữ liệu người dùng — sinh lại không mất gì.
    }
  }

  const pair = crypto.generateKeyPair();
  if (db) {
    try {
      db.handle.prepare(
        `INSERT INTO kv (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ).run(IDENTITY_KV_KEY, Buffer.from(pair.privateKey).toString('base64'));
    } catch {
      // Không lưu được thì phiên này vẫn chạy: khoá chỉ cần sống đủ lâu cho một
      // lần đồng bộ, và lần sau sinh cặp mới.
    }
  }
  return pair;
}
