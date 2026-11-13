/**
 * Đọc lịch sử nhóm bằng HTTP cloud của Zalo (`/api/cm/getoldv2`).
 *
 * Đây đúng là đường Zalo PC dùng để **lùi trang trong nhóm**: đọc mã Zalo 26.11.10
 * trên máy (ngày 2026-11-08) cho thấy `getCM(id, lastVisible, isOld=1, count)` →
 * `GET {group_cloud_message}/api/cm/getoldv2`. Với 1-1 thì Zalo PC **không** gọi
 * endpoint này: nó đọc SQLite cục bộ rồi trả về trước khi chạm cloud. Ứng dụng này
 * theo đúng chia đôi đó — `zalo-client` chỉ đi đường cloud cho `kind === 'group'`
 * (`GLASS_CLOUD_HISTORY=all`), còn 1-1 lùi trong cache.
 *
 * Zalo PC còn một chốt phía client (`apiEnable`: id phải bắt đầu bằng `g`), nên
 * phần 1-1 ở đây chỉ còn là phép đo đối chứng, không phải đường chạy thật.
 *
 * Ranh giới ADR-004 vẫn giữ: file này **không** nhận cookie/IMEI/secretKey, chỉ
 * nhận đúng ba thứ cần cho một request và trả về tin đã map.
 */
import { encryptAes, decryptAes } from './cloud-crypto.js';
import { toLiveMessage, type RawMessage } from './mapper.js';
import type { StoreMessage } from './attachment.js';
import type { ThreadKind } from '../ipc-contract.js';

export interface CloudHistoryRequest {
  /** Domain cloud của nhóm, lấy từ `zpw_service_map_v3.group_cloud_message`. */
  baseUrl: string;
  /** `groupId` gửi lên server: conversation id **đã bỏ** tiền tố `g`, nếu có. */
  groupId: string;
  /**
   * Loại hội thoại, chỉ để dựng `LiveMessage` đúng `kind`. Endpoint này Zalo PC
   * chỉ gọi cho nhóm; `'user'` chỉ dùng cho phép đo đối chứng.
   */
  kind: ThreadKind;
  /** Mốc: `msgId` toàn cục của tin cũ nhất đang hiển thị. `"0"` = mới nhất. */
  globalMsgId: string;
  count: number;
  imei: string;
  /** `ctx.secretKey` — khoá AES mà zca-js dùng cho mọi request có `params`. */
  secretKey: string;
  cookie: string;
  userAgent: string;
  /** `zpw_ver` / `zpw_type`, zca-js lấy từ context. */
  apiVersion: number;
  apiType: number;
  /** Tên liên hệ tra theo uid người gửi, như `getDName` của Zalo PC. */
  resolveName?: (uid: string) => string | undefined;
}

export interface CloudHistoryPage {
  messages: StoreMessage[];
  hasMore: boolean;
  /** `lastMsgId` máy chủ trả — mốc cho lần xin tiếp, và là bằng chứng của phép đo. */
  lastMsgId: string | null;
  isOld: boolean;
  /** Mã lỗi máy chủ trả, nếu có. Rỗng nghĩa là request đã tới nơi. */
  error?: { code: number | string; message: string };
}

/** AES-CBC IV = 0, khoá base64 — đúng như `encodeAES`/`decodeAES` của zca-js. */

/**
 * Gửi một yêu cầu `getoldv2`. Không ném cho lỗi mạng: trả `error` để người gọi
 * ghi lại **đúng** thứ máy chủ nói thay vì đoán.
 */
export async function fetchCloudHistory(request: CloudHistoryRequest): Promise<CloudHistoryPage> {
  const params = {
    groupId: request.groupId,
    globalMsgId: request.globalMsgId,
    count: request.count,
    msgIds: [] as string[],
    imei: request.imei,
    src: -1,
  };
  const url = new URL(`${request.baseUrl}/api/cm/getoldv2`);
  url.searchParams.set('zpw_ver', String(request.apiVersion));
  url.searchParams.set('zpw_type', String(request.apiType));
  // `_getCommonParams` của Zalo PC là `zpw_ver` + `zpw_type`; `params` thì mã hoá
  // AES rồi URL-encode. Làm đúng thứ tự đó — sai thứ tự là lỗi giải mã bên server.
  try {
    url.searchParams.set('params', encryptAes(request.secretKey, JSON.stringify(params)));
  } catch (error) {
    // Mã hoá hỏng là lỗi phía ta, không phải máy chủ từ chối. Ghi riêng mã
    // `crypto` để phép đo không bị đọc nhầm thành "server không cho 1-1".
    return {
      messages: [], hasMore: false, lastMsgId: null, isOld: false,
      error: { code: 'crypto', message: error instanceof Error ? error.message : 'unknown' },
    };
  }

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
      messages: [], hasMore: false, lastMsgId: null, isOld: false,
      error: { code: 'network', message: error instanceof Error ? error.message : 'unknown' },
    };
  }

  const outer = payload as { error_code?: number; error_message?: string; data?: unknown };
  if (outer && typeof outer.error_code === 'number' && outer.error_code !== 0) {
    return {
      messages: [], hasMore: false, lastMsgId: null, isOld: false,
      error: { code: outer.error_code, message: outer.error_message ?? '' },
    };
  }
  // Hai lớp: `data` là chuỗi AES, giải ra `{error_code, error_message, data}`.
  let inner: { error_code?: number; error_message?: string; data?: CloudBody } = {};
  try {
    const decoded = typeof outer?.data === 'string'
      ? decryptAes(request.secretKey, outer.data)
      : JSON.stringify(outer?.data ?? {});
    inner = JSON.parse(decoded) as typeof inner;
  } catch (error) {
    return {
      messages: [], hasMore: false, lastMsgId: null, isOld: false,
      error: { code: 'decode', message: error instanceof Error ? error.message : 'unknown' },
    };
  }
  if (inner.error_code !== undefined && inner.error_code !== 0) {
    return {
      messages: [], hasMore: false, lastMsgId: null, isOld: false,
      error: { code: inner.error_code, message: inner.error_message ?? '' },
    };
  }

  const body = inner.data ?? {};
  const rows = Array.isArray(body.groupMsgs) ? body.groupMsgs : [];
  const messages = rows
    .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    .map(row => toLiveMessage(row as unknown as RawMessage, request.groupId, request.kind,
      isSelf(row), request.resolveName))
    .filter((message): message is StoreMessage => message !== null);
  return {
    messages,
    hasMore: Boolean(body.hasMore),
    lastMsgId: body.lastMsgId != null ? String(body.lastMsgId) : null,
    isOld: Boolean(body.isOld),
  };
}

interface CloudBody {
  groupMsgs?: unknown[];
  hasMore?: boolean;
  isOld?: boolean;
  lastMsgId?: string | number;
}

/** `uidFrom: "0"` là chính mình — cùng quy ước `toLiveMessage` của listener. */
const isSelf = (row: Record<string, unknown>): boolean => String(row?.uidFrom ?? '') === '0';
