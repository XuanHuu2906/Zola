/**
 * Gửi yêu cầu Sync V2 bằng **WebSocket** — `cmd 590` (`SYNC_MESSAGE.REQUEST`).
 *
 * Vì sao không phải HTTP: endpoint `/api/transfer-sync-v2/request-sync` mà bảng
 * `commandId 12888` của Zalo PC khai báo **không tồn tại trên máy chủ**. Đo lại
 * ngày 2026-11-10: `404 text/html` từ nginx trên toàn bộ 46 origin của
 * `zpw_service_map_v3`, trong khi các endpoint cùng bảng cùng host trả JSON
 * `error_code: 600` (`/api/message/pull_mobile_msg`, `/api/message/photo`,
 * `/api/message/delete_snapshot_mobile_msg`…). Nghĩa là routing sống, chỉ riêng
 * đường dẫn đó là không có — hằng số đó là di sản của một endpoint đã gỡ.
 *
 * Đường thật nằm ngay cạnh nó trong cùng file và **không phải HTTP**:
 *
 * ```js
 * requestSyncMessage(e, t = 1e4) {
 *   return this.requestAsyncV2({ cmd: 590, subCmd: 0, data: { data: e } }, t);
 * }
 * ```
 *
 * Đó là hàm mà `RequestSyncToServerHandler` gọi thật
 * (`lazy/main-startup.89bb530b91927fd5dd28.js`: `tue.requestSyncMessage(e)` →
 * `op.a.instance().requestSyncMessage(e)`).
 *
 * Ba chi tiết hình dạng, mỗi cái đều đã từng làm hỏng một lần đo:
 *
 * 1. **`data` bọc hai tầng.** `requestSyncMessage` bọc `{ data: e }`, rồi
 *    `addCommonParams` chèn `reqId` vào **tầng ngoài** của `data`:
 *    `data: { data: <payload>, reqId }`. Đo 2026-11-09 (R12): gửi thiếu tầng
 *    trong thì máy chủ **im 15 s**; gửi đúng hai tầng thì trả lời trong 5–6 ms.
 *    Khác `592` ở đúng điểm này — `requestMobileWakeUp` truyền thẳng `data: e`.
 * 2. **Payload là object, không phải chuỗi JSON.** `JSON.stringify` chỉ dùng cho
 *    đường HTTP (đóng vào `params`). Trên socket, `ek`/`ik`/`req` đi dưới dạng
 *    object — `shared-worker` gọi `this.syncChanel.requestSync(a)` với `a` là
 *    object dựng sẵn.
 * 3. **`tempKey` rỗng là hợp lệ.** `manualSync` của Zalo PC không truyền khoá;
 *    `initNewMachineInfo` biến thiếu thành `""`. Khoá chỉ bắt buộc ở
 *    `autoSyncWhenLogin`.
 *
 * Hàm thuần, không chạm mạng: `ZaloClient` gửi frame và bắt phản hồi.
 */
import type { SyncDatabaseName, SyncRequestPayload } from './sync-v2-request.js';
import { SyncDeviceType } from './sync-v2-request.js';

/** `SYNC_MESSAGE.REQUEST` (`Lo.k` trong bảng enum của Zalo PC). */
export const RequestSyncCmd = { REQUEST: 590 } as const;

/** Hạn chờ phản hồi. Zalo PC dùng đúng con số này (`t = 1e4`). */
export const REQUEST_SYNC_REPLY_TIMEOUT_MS = 10_000;

/** `data` của `cmd 590`: payload lồng trong `data`, `reqId` ở ngoài. */
export interface RequestSyncFrameData {
  data: SyncRequestPayload;
  reqId: string;
}

/** Khung WS hoàn chỉnh để gửi qua `listener.sendWs`. */
export function buildRequestSyncFrame(payload: SyncRequestPayload, reqId: string): {
  version: number; cmd: number; subCmd: number; data: RequestSyncFrameData;
} {
  return {
    version: 1,
    cmd: RequestSyncCmd.REQUEST,
    subCmd: 0,
    data: { data: payload, reqId },
  };
}

/**
 * Dựng payload từ các mảnh rời — cùng thứ tự trường mà `SyncSession.requestSync`
 * của Zalo PC dùng (`shared-worker`), để một bản ghi log của hai bên đọc được
 * cạnh nhau.
 */
export function buildRequestSyncPayload(input: {
  syncId: string;
  ek: string;
  ik: string;
  tempKey: string;
  deviceName: string;
  type: SyncDatabaseName;
  priority: number;
  queries: SyncRequestPayload['req']['queries'];
  batchSize: number;
  ussidx: number;
  toDevice?: number;
}): SyncRequestPayload {
  return {
    syncId: input.syncId,
    syncType: 0,
    ek: input.ek,
    ik: input.ik,
    toDevice: input.toDevice ?? SyncDeviceType.MOBILE,
    tempKey: input.tempKey,
    deviceName: input.deviceName,
    req: {
      type: input.type,
      priority: input.priority,
      queries: input.queries,
      batchSize: input.batchSize,
    },
    ver: 1,
    ussidx: input.ussidx,
  };
}

/** Kết quả đọc một phong bì đã giải. */
export interface RequestSyncReply {
  /** `reqId` có khớp không. Máy chủ không phải lúc nào cũng dội lại nó. */
  matched: boolean;
  /** `error_code`; `null` khi phong bì không mang mã. */
  code: number | null;
  /** `error_message` — văn bản của máy chủ, để chẩn đoán trường nào bị từ chối. */
  message: string | null;
}

/**
 * Đọc phản hồi `590` từ payload **đã giải**.
 *
 * `reqId` có thể nằm ở `data.reqId` (đường `addCommonParams`) hoặc ở
 * `data.data.reqId`. Đo 2026-11-09 cho thấy phản hồi của một `590` tối thiểu
 * **không** mang `reqId` nào — `innerDataChars: 0` — nên vắng mặt không phải lỗi
 * và không phải "không khớp": nó chỉ là máy chủ không dội lại. Vì
 * `SyncV2Controller` đã chặn hai yêu cầu song song (`opening`), một phản hồi
 * `590` xuất hiện trong lúc chờ là câu trả lời cho yêu cầu đó.
 */
export function parseRequestSyncReply(payload: unknown, reqId: string): RequestSyncReply {
  if (!payload || typeof payload !== 'object') return { matched: false, code: null, message: null };
  const record = payload as Record<string, unknown>;
  const data = record.data && typeof record.data === 'object'
    ? record.data as Record<string, unknown> : null;
  const nested = data?.data && typeof data.data === 'object'
    ? data.data as Record<string, unknown> : null;
  const found = typeof data?.reqId === 'string' ? data.reqId
    : typeof nested?.reqId === 'string' ? nested.reqId : null;
  const matched = found === null ? true : found === reqId;
  const code = typeof record.error_code === 'number' ? record.error_code
    : typeof record.errorCode === 'number' ? record.errorCode : null;
  const message = typeof record.error_message === 'string' ? record.error_message.slice(0, 160)
    : typeof record.message === 'string' ? record.message.slice(0, 160) : null;
  return { matched, code, message };
}
