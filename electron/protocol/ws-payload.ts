import { createDecipheriv, type DecipherGCM } from 'node:crypto';
import { unzipSync } from 'node:zlib';

/**
 * Giải phong bì đã mã hoá của một frame Zalo, **và chỉ mô tả hình dạng**.
 *
 * Vì sao cần: phản hồi `cmd 590` nhận được có `encrypt: 2` — `data` là AES-GCM
 * trên nội dung đã nén. Mọi thứ đọc được ở tầng ngoài (`error_code: 0`, không có
 * `reqId`) nói về **phong bì vận chuyển**, không nói về việc máy chủ có nhận hay
 * từ chối request đồng bộ. Chỉ mở được `data` mới trả lời được câu hỏi đang hỏi.
 *
 * Vì sao **không** trả nội dung: `data` của đường đồng bộ có thể chứa tin nhắn
 * của người dùng. Hàm này chỉ trả tên khoá, độ dài và mã lỗi — cùng quy tắc với
 * `describeWsFrameBody`. Giải mã mà ghi ra nội dung là biến một phép đo thành một
 * bản sao dữ liệu người dùng trong log.
 *
 * Thuật toán lấy từ `decodeEventData` của zca-js (`dist/utils.js:337-374`), mà
 * bản thân nó dựng lại đúng đường nhận của Zalo PC:
 *
 * - `encrypt: 0` — văn bản thuần, không giải gì.
 * - `encrypt: 1` — base64 thuần, **không** `decodeURIComponent` trước.
 * - `encrypt: 2` — `decodeURIComponent`, base64, AES-GCM, rồi `inflate`.
 * - `encrypt: 3` — như 2 nhưng nội dung đã phẳng, không `inflate`.
 *
 * Bố cục AES-GCM: `[iv 16][additionalData 16][ciphertext…][tag 16]`.
 */

/** Kết quả mô tả — không chứa một byte nội dung nào. */
export interface DecodedPayloadShape {
  /** `true` khi giải và phân tích được. */
  ok: boolean;
  /** Lý do khi `ok: false`: `'bad-type' | 'cipher-key-missing' | 'short' | 'decrypt' | 'inflate' | 'json'`. */
  reason?: string;
  /** Tên khoá ở tầng ngoài của payload đã giải. */
  keys: string[] | null;
  /** `error_code` bên trong payload — mã máy chủ trả cho chính request này. */
  errorCode: number | null;
  /**
   * `error_message` do máy chủ viết, cắt ngắn. Đây **không** phải dữ liệu người
   * dùng: nó là câu chẩn đoán của máy chủ, và là nguồn duy nhất nói được *trường
   * nào* bị từ chối khi `error_code` chỉ là một con số chung.
   */
  errorMessage?: string;
  /** Độ dài `reqId` bên trong, nếu có; khớp với `reqId` ta gửi là bằng chứng định danh. */
  reqIdChars: number;
  /** Độ dài chuỗi `data.data` nếu payload mang một chuỗi ở đó. */
  innerDataChars: number;
  /**
   * Khi giải mã **thành công** nhưng không đọc ra JSON: bản rõ trông như thế nào.
   *
   * Có trường này vì `reason: 'inflate'` gộp ba khả năng rất khác nhau: bản rõ
   * không nén gì (JSON thẳng), nén bằng thuật toán khác (gzip/raw deflate), hoặc
   * khoá sai nhưng GCM vẫn qua. Ba khả năng dẫn tới ba cách sửa khác nhau, và
   * đoán sai một lần là mất một vòng chạy thật. Chỉ mô tả vài byte đầu — đủ để
   * phân loại, không đủ để dựng lại nội dung.
   */
  plainKind?: string;
  /** Độ dài bản rõ sau khi giải AES (trước khi thử nén). */
  plainChars?: number;
}

const shape = (over: Partial<DecodedPayloadShape>): DecodedPayloadShape =>
  ({ ok: false, keys: null, errorCode: null, reqIdChars: 0, innerDataChars: 0, ...over });

/** Tên thuật toán theo độ dài khoá — GCM nhận 16/24/32 byte. */
function gcmAlgorithm(key: Buffer): string | null {
  return key.length === 16 ? 'aes-128-gcm'
    : key.length === 24 ? 'aes-192-gcm'
      : key.length === 32 ? 'aes-256-gcm' : null;
}

/**
 * Gỡ lớp mã hoá và nén, trả về bản rõ. Ném lỗi có mã khi không gỡ được — lý do
 * được giữ lại vì "không giải được" và "giải ra rỗng" là hai chuyện rất khác nhau.
 */
export function unwrapPayload(encrypt: number, raw: string, cipherKey: string | null | undefined): unknown {
  if (!Number.isInteger(encrypt) || encrypt < 0 || encrypt > 3) throw new PayloadError('bad-type');
  if (encrypt === 0) return JSON.parse(raw);
  const b64 = encrypt === 1 ? raw : decodeURIComponent(raw);
  const bytes = Buffer.from(b64, 'base64');
  if (encrypt === 1) return JSON.parse(bytes.toString('utf8'));

  if (!cipherKey) throw new PayloadError('cipher-key-missing');
  // 16 iv + 16 aad + ít nhất 1 byte ciphertext + 16 tag.
  if (bytes.length < 49) throw new PayloadError('short');
  const key = Buffer.from(cipherKey, 'base64');
  const algorithm = gcmAlgorithm(key);
  if (!algorithm) throw new PayloadError('cipher-key-missing');
  let plain: Buffer;
  try {
    // Tag của GCM nằm ở **cuối**, không phải sau additionalData — zca-js đưa cả
    // phần đuôi vào `crypto.subtle.decrypt`, và WebCrypto đọc 16 byte cuối làm tag.
    // `createDecipheriv` trả một union; chỉ nhánh GCM mới có `setAAD`/`setAuthTag`,
    // mà `algorithm` ở trên đã bảo đảm đúng nhánh đó.
    const decipher = createDecipheriv(algorithm, key, bytes.subarray(0, 16)) as DecipherGCM;
    decipher.setAAD(bytes.subarray(16, 32));
    decipher.setAuthTag(bytes.subarray(bytes.length - 16));
    plain = Buffer.concat([decipher.update(bytes.subarray(32, bytes.length - 16)), decipher.final()]);
  } catch { throw new PayloadError('decrypt'); }

  let inflated: Buffer = plain;
  if (encrypt !== 3) {
    // `encrypt: 2` **không** hứa là zlib. Đo được ngày 2026-11-09: thân `590` và
    // `603` là **gzip** (`plainKind: 'gzip'`, 98 và 193 byte) — `inflateSync` chỉ
    // nhận zlib/deflate nên ném trên mọi phản hồi, và ta tưởng là "không giải được"
    // trong khi thật ra là chọn sai bộ giải. `unzipSync` của Node tự nhận cả hai,
    // nên không cần đoán theo magic byte.
    try {
      inflated = unzipSync(plain);
    } catch {
      // Ném kèm hình dạng của bản rõ, để bộ quan sát ghi được nó (xem
      // `DecodedPayloadShape.plainKind`). Không kèm nội dung.
      throw new PayloadError('inflate', plain);
    }
  }
  return JSON.parse(inflated.toString('utf8'));
}

/**
 * Phân loại vài byte đầu của một bản rõ mà bước nén không đọc ra.
 *
 * Chỉ trả nhãn. `zlib` có magic `78 01/9c/da`; gzip có `1f 8b`; một `{` hoặc `[`
 * nghĩa là JSON chưa nén; còn lại là "không nhận ra". Trường hợp cuối vẫn hữu ích:
 * nó nói rằng giả thuyết "quên inflate" là sai.
 */
function describePlain(plain: Buffer): { plainKind: string; plainChars: number } {
  const plainChars = plain.length;
  if (plain.length >= 2 && plain[0] === 0x1f && plain[1] === 0x8b) return { plainKind: 'gzip', plainChars };
  // zlib không chỉ là `0x78` ở byte đầu: `0x78` chính là ký tự `'x'`, nên một
  // chuỗi văn bản bắt đầu bằng "xin chào…" sẽ bị gọi nhầm là zlib. Điều kiện thật
  // là header 2 byte hợp lệ — `(b0·256 + b1) % 31 === 0` — theo RFC 1950. Test
  // "bản rõ là văn bản thường" bắt đúng lỗi này ở bản đầu tiên.
  if (plain.length >= 2 && (plain[0] & 0x0f) === 8
    && ((plain[0] << 8) + plain[1]) % 31 === 0) return { plainKind: 'zlib', plainChars };
  const first = plain.subarray(0, 1).toString('latin1');
  if (first === '{' || first === '[') return { plainKind: 'json', plainChars };
  // Kiểm từng byte thay vì dùng regex: dữ liệu ở đây là byte thô, còn một dải
  // `\u00a0-\uffff` trong regex so khớp theo code point UTF-16 chứ không theo
  // byte — đúng thứ đang cần phân biệt. Byte của văn bản tiếng Việt (UTF-8) đều
  // ≥ 0x80, nên "in được" ở đây nghĩa là mọi byte đều là ASCII in được, ký tự
  // xuống dòng, hoặc ≥ 0x80. Byte điều khiển lạ thì không.
  const printable = plain.subarray(0, 32).every(byte =>
    byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte <= 0x7e) || byte >= 0x80);
  return { plainKind: printable ? 'text' : 'binary', plainChars };
}

export class PayloadError extends Error {
  readonly reason: string;
  /** Xem `DecodedPayloadShape.plainKind` — chỉ có khi lỗi xảy ra **sau** khi giải AES. */
  readonly plainKind?: string;
  readonly plainChars?: number;
  constructor(reason: string, plain?: Buffer) {
    super(`payload: ${reason}`);
    this.reason = reason;
    if (plain) Object.assign(this, describePlain(plain));
  }
}

/**
 * Mô tả payload đã giải. Không bao giờ ném: một phong bì lạ (kiểu mã hoá mới, khoá
 * chưa có, nội dung không phải JSON) trả `ok: false` kèm lý do để bộ quan sát còn
 * ghi lại được — im lặng ở đây là mất đúng thứ đang cần đo.
 */
export function describeDecodedPayload(
  encrypt: unknown, raw: unknown, cipherKey: string | null | undefined,
): DecodedPayloadShape {
  if (typeof encrypt !== 'number' || typeof raw !== 'string') return shape({ reason: 'bad-type' });
  let parsed: unknown;
  try {
    parsed = unwrapPayload(encrypt, raw, cipherKey);
  } catch (error) {
    if (!(error instanceof PayloadError)) return shape({ reason: 'json' });
    return shape({
      reason: error.reason,
      ...(error.plainKind ? { plainKind: error.plainKind, plainChars: error.plainChars } : {}),
    });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return shape({ reason: 'json' });
  const record = parsed as Record<string, unknown>;
  const inner = record.data;
  const innerRecord = inner && typeof inner === 'object' && !Array.isArray(inner)
    ? inner as Record<string, unknown> : null;
  const innerReqId = innerRecord?.reqId ?? record.reqId;
  const errorCode = typeof record.error_code === 'number' ? record.error_code
    : typeof record.errorCode === 'number' ? record.errorCode : null;
  // `data.data` là chỗ `requestSyncMessage` của Zalo PC đặt tham số đồng bộ. Chỉ
  // độ dài, không nội dung: đây là chỗ dữ liệu người dùng có thể nằm.
  const nested = innerRecord?.data;
  // `error_message` là **văn bản do máy chủ viết**, không phải dữ liệu người
  // dùng — nó nói đúng trường nào bị từ chối ("sai zipw_sek", "missing ik").
  // Không có nó thì mọi lần `590` bị chối đều đọc ra như nhau. Cắt 80 ký tự:
  // đủ cho một câu chẩn đoán, không đủ để mang nội dung nào ra ngoài.
  const errorMessage = typeof record.error_message === 'string'
    ? record.error_message.slice(0, 80) : null;
  return shape({
    ok: true,
    keys: Object.keys(record).sort(),
    errorCode,
    ...(errorMessage ? { errorMessage } : {}),
    reqIdChars: typeof innerReqId === 'string' ? innerReqId.length : 0,
    innerDataChars: typeof nested === 'string' ? nested.length : 0,
  });
}
