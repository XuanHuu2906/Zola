/**
 * Mã hoá tham số `params` của Zalo: AES-CBC, IV = 16 byte 0, khoá là base64
 * (`zpw_enk`), ra base64 — đúng hình dạng `encodeAES`/`decodeAES` của zca-js
 * (`node_modules/zca-js/dist/utils.js`). Tách riêng để test được mà không phải
 * dựng một phiên Zalo thật.
 *
 * **Kích thước khoá không cố định.** CryptoJS — thứ zca-js dùng — chọn biến thể
 * AES theo độ dài khoá đã giải: 16 byte → AES-128, 24 → AES-192, 32 → AES-256.
 * Ép cứng `aes-256-cbc` làm request đầu tiên của một phiên thật ném
 * `RangeError: Invalid key length` (đo 2026-11-08: `zpw_enk` của phiên phụ không
 * phải 32 byte). Vì vậy chọn theo độ dài, và từ chối độ dài lạ thay vì đoán.
 */
import { createCipheriv, createDecipheriv } from 'node:crypto';

/** Biến thể AES mà CryptoJS sẽ chọn cho một khoá dài `bytes`. */
function algorithm(bytes: number): string {
  if (bytes === 16) return 'aes-128-cbc';
  if (bytes === 24) return 'aes-192-cbc';
  if (bytes === 32) return 'aes-256-cbc';
  throw new Error(`Khoá AES dài ${bytes} byte; CryptoJS chỉ nhận 16, 24 hoặc 32.`);
}

const IV = Buffer.alloc(16);

/** Khoá base64 (`zpw_enk`); dữ liệu vào là chuỗi UTF-8, ra base64. */
export function encryptAes(secretKey: string, plain: string): string {
  const key = Buffer.from(secretKey, 'base64');
  const cipher = createCipheriv(algorithm(key.length), key, IV);
  return Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]).toString('base64');
}

/**
 * Giải một chuỗi base64 (hoặc đã URL-encode) về UTF-8. Ném nếu khoá sai độ dài
 * hoặc bản mã hỏng — người gọi quyết định đó là lỗi `decode` hay `network`.
 */
export function decryptAes(secretKey: string, cipherText: string): string {
  const key = Buffer.from(secretKey, 'base64');
  const decipher = createDecipheriv(algorithm(key.length), key, IV);
  return Buffer.concat([
    decipher.update(Buffer.from(decodeURIComponent(cipherText), 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Độ dài khoá tính bằng byte — để ghi log chẩn đoán mà không lộ khoá. */
export function keyBytes(secretKey: string): number {
  return Buffer.from(secretKey, 'base64').length;
}
