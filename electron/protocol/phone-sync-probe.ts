/**
 * Phép đo **một lần** cho đường đồng bộ điện thoại (`pull_mobile_msg`).
 *
 * Câu hỏi sống còn trước khi viết bất cứ thứ gì khác: **máy chủ có chấp nhận
 * client này không?** Nếu nó trả `604` (`Common.SESSION`) như `/api/cm/getoldv2`
 * thì cả hướng này chết ở tầng giao thức và không đáng dựng libsignal.
 *
 * **Sửa lại ngày 2026-11-09:** lần chạy đầu gửi `public_key` là 32 byte X25519
 * và nhận `114 INVALID_PARAMS`. Đọc lại `lazy/main-startup` mới thấy
 * `currentSession.publicKey` **không** phải khoá X25519 — nó là RSA-2048,
 * `spki`/`der` mã base64 (294 byte), sinh bằng
 * `$znode.crypto.generateKeyPairSync('rsa', {modulusLength: 2048, publicKeyEncoding: {type:'spki', format:'der'}})`
 * với `{publicKey:'base64'}`. Máy chủ mã hoá `encrypted_key` của gói tin bằng
 * khoá này và Zalo PC giải bằng `privateDecrypt(..., RSA_PKCS1_PADDING)`. Một
 * khoá X25519 không thể giải được gói đó, nên `114` cũ **không** nói gì về
 * máy chủ — nó chỉ nói khoá sai định dạng.
 *
 * Vì sao gửi khoá đúng định dạng nhưng dùng-một-lần là đủ: máy chủ phải xác
 * thực **phiên** trước khi đọc `params`. Phiên hỏng → `604` ngay. Phiên tốt →
 * nó mới đi tiếp và trả lời về `temp_key`/`from_seq_id`. Hai câu trả lời đó
 * phân biệt được, và đó chính là thứ phép đo cần. Nó **không** chứng minh được
 * đồng bộ chạy — chỉ chứng minh được cửa có mở hay không.
 *
 * Đây là GET thuần, không ghi gì, không đụng tài khoản. Cùng loại với phép đo
 * `getoldv2` ngày 2026-11-08.
 *
 * Ranh giới ADR-004 vẫn giữ: file này không import zca-js.
 *
 * Ranh giới ADR-004: file này nằm trong `electron/protocol/` nhưng **không**
 * import zca-js — nó nhận đúng ba thứ cần cho một request và trả một kết quả.
 */
import { generateKeyPairSync } from 'node:crypto';
import { encryptAes, decryptAes } from './cloud-crypto.js';

export interface PhoneSyncProbeRequest {
  /** `zpw_service_map_v3.file[0]` — domain của `/api/message/*`. */
  baseUrl: string;
  /** `$znode.os.hostname()` bên Zalo PC; máy chủ không kiểm tra nội dung. */
  pcName: string;
  /**
   * Khoá công khai của phiên: **RSA-2048 `spki`/`der` mã base64** — không phải
   * X25519. Sinh bằng `generateSyncPublicKey()` trong file này.
   */
  publicKey: string;
  /** `from_seq_id`: `-1` khi chưa có mốc nào (`maxSeq < 0`), giữ nguyên âm. */
  fromSeqId: number;
  tempKey: string;
  imei: string;
  secretKey: string;
  cookie: string;
  userAgent: string;
  apiVersion: number;
  apiType: number;
}

export interface PhoneSyncProbeResult {
  /** Mã lỗi máy chủ, hoặc `'network'`/`'crypto'`/`'decode'` khi lỗi phía ta. */
  code: number | string;
  message: string;
  /** URL đã gọi, đã bỏ `params` — để đọc lại được mà không lộ khoá. */
  url: string;
  /** Số byte của `public_key` — `604` có thể do khoá sai hình dạng. */
  publicKeyBytes: number;
  /**
   * Hình dạng của `data` bên trong — **không** phải nội dung.
   *
   * Lần đo `code: 0` đầu tiên vứt bỏ trường này, nên nó chỉ trả lời được "máy
   * chủ nhận request", không trả lời được "máy chủ có gì để đưa". Chỉ ghi tên
   * khoá con và độ dài, không ghi giá trị: `data` có thể chứa tin nhắn.
   */
  payload: PayloadShape;
}

export interface PayloadShape {
  /** Tên các khoá con của `data`, đã sắp xếp. Rỗng nghĩa là `data` không phải object. */
  keys: string[];
  /** Độ dài chuỗi gốc của `data` sau khi giải — 0 nếu không giải được. */
  chars: number;
  /** Tổng số byte của mọi chuỗi base64 tìm thấy một cấp dưới `data`. */
  nestedBytes: number;
}

const EMPTY_SHAPE: PayloadShape = { keys: [], chars: 0, nestedBytes: 0 };

/**
 * Đo hình dạng `data` mà **không** đọc nội dung.
 *
 * Chỉ ba con số: tên khoá, độ dài chuỗi, tổng byte của các giá trị base64 một
 * cấp dưới. Đủ để trả lời "có payload thật không, lớn cỡ nào, khoá gì" mà không
 * đưa nội dung tin nhắn vào log hay báo cáo.
 */
export function measurePayload(data: unknown): PayloadShape {
  if (typeof data === 'string') return { keys: [], chars: data.length, nestedBytes: 0 };
  if (!data || typeof data !== 'object') return EMPTY_SHAPE;
  const record = data as Record<string, unknown>;
  let chars = 0;
  let nestedBytes = 0;
  for (const value of Object.values(record)) {
    if (typeof value === 'string') {
      chars += value.length;
      // Base64 thuần: đủ dài để là dữ liệu thật, không phải tên hay mã trạng thái.
      if (value.length >= 64 && /^[A-Za-z0-9+/]+={0,2}$/.test(value)) nestedBytes += value.length;
    }
  }
  return { keys: Object.keys(record).sort(), chars, nestedBytes };
}

/**
 * Gọi `pull_mobile_msg` một lần và trả đúng những gì máy chủ nói.
 *
 * Không ném cho lỗi mạng: báo cáo phải ghi được **đúng** câu trả lời, và một
 * ngoại lệ bị nuốt thành "thất bại" sẽ xoá mất khác biệt giữa `604` và mất mạng.
 */
export async function probePullMobileMsg(request: PhoneSyncProbeRequest): Promise<PhoneSyncProbeResult> {
  // `pullMobileMsg` của Zalo PC lật dấu: `t ? t += 1 : t = 0`. Nghĩa là `-1`
  // thành `0`, còn mọi giá trị khác cộng một. Bỏ bước này là gửi một con số
  // khác hẳn con số Zalo gửi cho cùng một trạng thái.
  const fromSeqId = request.fromSeqId < 0 ? 0 : request.fromSeqId ? request.fromSeqId + 1 : 0;
  const params = {
    pc_name: request.pcName,
    public_key: request.publicKey,
    from_seq_id: fromSeqId,
    is_retry: 0,
    min_seq_id: 0,
    temp_key: request.tempKey,
    imei: request.imei,
  };
  const url = new URL(`${request.baseUrl}/api/message/pull_mobile_msg`);
  url.searchParams.set('zpw_ver', String(request.apiVersion));
  url.searchParams.set('zpw_type', String(request.apiType));
  try {
    url.searchParams.set('params', encryptAes(request.secretKey, JSON.stringify(params)));
  } catch (error) {
    return {
      code: 'crypto', message: error instanceof Error ? error.message : 'unknown',
      url: redact(url), publicKeyBytes: byteLength(request.publicKey), payload: EMPTY_SHAPE,
    };
  }
  // URL ghi vào log **không** được mang `params`: nó là bản mã hoá của IMEI,
  // PC name và khoá. Đây là chỗ dễ rò nhất trong cả file.
  const safeUrl = redact(url);

  let payload: unknown;
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json, text/plain, */*',
        Cookie: request.cookie,
        Origin: 'https://chat.zalo.me',
        Referer: 'https://chat.zalo.me/',
        'User-Agent': request.userAgent,
      },
    });
    payload = await response.json();
  } catch (error) {
    return {
      code: 'network', message: error instanceof Error ? error.message : 'unknown',
      url: safeUrl, publicKeyBytes: byteLength(request.publicKey), payload: EMPTY_SHAPE,
    };
  }

  const outer = payload as { error_code?: number; error_message?: string; data?: unknown };
  if (typeof outer?.error_code === 'number' && outer.error_code !== 0) {
    return {
      code: outer.error_code, message: outer.error_message ?? '',
      url: safeUrl, publicKeyBytes: byteLength(request.publicKey), payload: EMPTY_SHAPE,
    };
  }
  // Hai lớp như mọi API có `params`: `data` là chuỗi AES giải ra
  // `{error_code, error_message, data}`.
  let inner: { error_code?: number; error_message?: string; data?: unknown } = {};
  try {
    const decoded = typeof outer?.data === 'string'
      ? decryptAes(request.secretKey, outer.data)
      : JSON.stringify(outer?.data ?? {});
    inner = JSON.parse(decoded) as typeof inner;
  } catch (error) {
    return {
      code: 'decode', message: error instanceof Error ? error.message : 'unknown',
      url: safeUrl, publicKeyBytes: byteLength(request.publicKey), payload: EMPTY_SHAPE,
    };
  }
  return {
    code: inner.error_code ?? 0,
    message: inner.error_message ?? '',
    url: safeUrl,
    publicKeyBytes: byteLength(request.publicKey),
    // Chỉ hình dạng. `data` của endpoint này là gói tin đồng bộ — nội dung của
    // nó không được đi vào log, và cũng không cần cho câu hỏi đang hỏi.
    payload: measurePayload(inner.data),
  };
}

/**
 * Sinh `public_key` đúng định dạng Zalo PC gửi: RSA-2048, `spki`/`der`, base64.
 *
 * Ba thuộc tính phải cùng đúng một lúc, và sai cái nào cũng ra `114` giống hệt
 * nhau — đó là lý do lần đo đầu không phân biệt được. `modulusLength: 2048`
 * quyết định độ dài (294 byte base64), `spki`+`der` quyết định tiền tố
 * `30 82 01 22 30 0d 06 09 2a 86 48 86 f7 0d 01 01 01`, và `base64` là thứ
 * `NodeRSA`/`$znode.crypto` xuất ra. Test khoá cả ba.
 */
export function generateSyncPublicKey(): string {
  const { publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  // `spki`/`der` cho ra `Buffer`; Zalo PC gửi chuỗi base64 của đúng số byte đó.
  return publicKey.toString('base64');
}

/** Bỏ `params` khỏi URL trước khi URL đi vào log hay báo cáo. */
function redact(url: URL): string {
  const copy = new URL(url.toString());
  if (copy.searchParams.has('params')) copy.searchParams.set('params', '<redacted>');
  return copy.toString();
}

const byteLength = (base64: string): number => {
  try { return Buffer.from(base64, 'base64').length; } catch { return -1; }
};
