/**
 * Giải phóng một phiên Sync V2 phía máy chủ: `cmd 591`
 * (`SYNC_MESSAGE.ACK_DELETE_SYNC_SESSION`).
 *
 * **Vì sao phải gửi.** Zalo PC không bao giờ để một phiên tự chết. Sau khi
 * `sync-full` kết thúc — thành công hay hỏng — máy trạng thái luôn đi qua
 * `disposeSync`:
 *
 * ```js
 * handleSuccess: async a => { ... await n.disposeSync({ reason: m.a.SyncSuccess }); }
 * handleFailure: async r => { ... await n.disposeSync({ reason: ... }); }
 * ```
 *
 * (`sync-v2-sub-worker`, `sync-full`). Bên trong, `SyncSession.release(reason)`
 * gọi `syncChanel.disposeSession({syncId, toDevice, reason})`, và
 * `SyncSessionManager.cleanOldSyncSession` dội thêm `reason: OutDated` cho mọi
 * phiên còn lưu trong state cũ khi khởi động.
 *
 * Repo này trước đây **không** gửi gì. Hệ quả không nằm ở phía ta mà ở phía
 * máy chủ: mỗi lần bấm đồng bộ lại để lại một phiên mở cho cùng cặp thiết bị.
 * Đó cũng là lời giải thích khớp với quan sát "vừa đồng bộ bằng Zalo PC thật
 * rồi thì lần sau không có gì để đẩy": máy chủ đang giữ trạng thái phiên của
 * một client khác, nên yêu cầu của ta không được xếp vào hàng đợi chuyển nào.
 *
 * **Hình dạng**, y như `requestSyncMessage` và khác `requestMobileWakeUp`:
 *
 * ```js
 * ackDeleteSyncSession(e, t = 3e3) {
 *   return this.requestAsyncV2({ cmd: 591, subCmd: 0, data: { data: e } }, t);
 * }
 * ```
 *
 * nên `data` bọc **hai tầng** (`{ data: payload, reqId }`), đúng như `590` —
 * `addCommonParams` đặt `reqId` ở tầng ngoài của `data`. Hạn chờ là `3e3`, không
 * phải `1e4` của `590`.
 *
 * Hàm thuần, không chạm mạng.
 */
import { SyncDeviceType } from './sync-v2-request.js';

/** `SYNC_MESSAGE.ACK_DELETE_SYNC_SESSION` (`compact-app-pc`, bảng `SYNC_MESSAGE`). */
export const DisposeSessionCmd = { ACK_DELETE: 591 } as const;

/** Hạn chờ phản hồi `591`. Zalo PC dùng `t = 3e3`. */
export const DISPOSE_REPLY_TIMEOUT_MS = 3_000;

/**
 * `Xde.a` — lý do giải phóng (`SCpg` module, xuất `a`).
 *
 * `SyncSuccess` và `Error` là hai lý do đường đồng bộ của ta dùng. `UserCancel`
 * và `OutDated` có ở đây để log và để sau này gọi từ UI đọc được đúng tên.
 */
export const SyncReleaseReason = {
  USER_CANCEL: 0,
  SYNC_SUCCESS: 1,
  ERROR: 2,
  OUT_DATED: 3,
} as const;

export type SyncReleaseReasonValue = typeof SyncReleaseReason[keyof typeof SyncReleaseReason];

/** `data` bên trong của `cmd 591` — ba trường, **không** mang `reqId`. */
export interface DisposeSessionPayload {
  syncId: string;
  toDevice: number;
  reason: number;
}

/** `data` của frame: payload lồng trong `data`, `reqId` ở ngoài. */
export interface DisposeSessionFrameData {
  data: DisposeSessionPayload;
  reqId: string;
}

/** Dựng `data` cho `cmd 591`. */
export function buildDisposeSessionPayload(
  syncId: string, reason: number, toDevice: number = SyncDeviceType.MOBILE,
): DisposeSessionPayload {
  return { syncId, toDevice, reason };
}

/** Khung WS hoàn chỉnh để gửi qua `listener.sendWs`. */
export function buildDisposeSessionFrame(
  syncId: string, reason: number, reqId: string, toDevice: number = SyncDeviceType.MOBILE,
): { version: number; cmd: number; subCmd: number; data: DisposeSessionFrameData } {
  return {
    version: 1,
    cmd: DisposeSessionCmd.ACK_DELETE,
    subCmd: 0,
    data: { data: buildDisposeSessionPayload(syncId, reason, toDevice), reqId },
  };
}

/** Kết quả đọc phản hồi `591` từ payload đã giải. */
export interface DisposeSessionReply {
  matched: boolean;
  code: number | null;
  message: string | null;
}

/**
 * Đọc phản hồi `591`.
 *
 * Khớp `reqId` giống `parseRequestSyncReply`: vắng `reqId` **không** phải "không
 * khớp" — máy chủ không dội lại nó trong phần lớn phản hồi, và chỉ một yêu cầu
 * giải phóng chạy tại một thời điểm.
 */
export function parseDisposeSessionReply(payload: unknown, reqId: string): DisposeSessionReply {
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
    : typeof record.code === 'number' ? record.code : null;
  const message = typeof record.error_message === 'string' ? record.error_message.slice(0, 160)
    : typeof record.message === 'string' ? record.message.slice(0, 160) : null;
  return { matched, code, message };
}
