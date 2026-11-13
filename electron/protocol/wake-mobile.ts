/**
 * Đánh thức điện thoại: `cmd 592` (`SYNC_MESSAGE.REQUEST_MOBILE_WAKE_UP`).
 *
 * Vì sao cần: `temp_key` chỉ đến trên kênh điều khiển khi điện thoại đã mở một
 * phiên chuyển. Gửi `590` (request-sync) trước khi đánh thức thì máy chủ nhận,
 * trả `errorCode: 0`, và trả **rỗng** — đúng như đo được ngày 2026-11-09:
 * `innerDataChars: 0` cho cả `590` và `603`. Không có lỗi nào để đọc, vì không
 * có lỗi: đơn giản là chưa ai bảo điện thoại làm gì.
 *
 * Hình dạng lấy từ `SyncSession.wakeup()` của Zalo PC
 * (`shared-worker.cfeba43a9a8e4e40dda3.js:10284-10288`):
 *
 * ```js
 * wakeup() {
 *   return this.syncChanel.requestWakeUp({
 *     syncId: this.syncId,
 *     toDevice: this.toDevice
 *   }).then(e => 0 == e.code && ... this.startTimeoutReceiveBatch(...))
 * }
 * ```
 *
 * và từ đường đi thật của nó trong app (`compact-app-pc:630619`):
 *
 * ```js
 * requestMobileWakeUp(e, t = 3e3) {
 *   return this.requestAsyncV2({ cmd: 592, subCmd: 0, data: e }, t);
 * }
 * ```
 *
 * Bốn điểm khác `590` mà dễ làm sai:
 *
 * 1. **Không bọc `{ data: payload }`.** `requestSyncMessage` của Zalo PC bọc
 *    (`data: { data: e }`), còn `requestMobileWakeUp` truyền thẳng
 *    (`data: e`, `compact-app-pc:630619-630625`). Hai hàm cạnh nhau trong cùng
 *    một lớp mà khác nhau — chép nhầm là im lặng.
 * 2. **`reqId` nằm *trong* `data`.** `requestAsyncV2` gọi `addCommonParams`,
 *    trả về `{ ...e, data: { ...e.data, reqId } }` — một tầng, không phải hai
 *    như `590`. Thiếu nó thì `onData` của Zalo PC không tìm được người chờ
 *    (`n.data.reqId` rỗng → chỉ một dòng log) và không bao giờ trả lời được.
 * 3. **Phải chờ phản hồi khớp `reqId`, rồi mới đọc `code`.** `wakeup()` chỉ
 *    bắt đầu hẹn giờ nhận gói khi `code === 0`. Gửi rồi bỏ đi là đọc "đã gửi"
 *    thành "đã đánh thức" — đúng cái bẫy đã làm hỏng các lần đo trước.
 * 4. **`toDevice` là enum số** (0 = Mobile), cùng nguồn với `590`.
 *
 * Hàm thuần, không chạm mạng: `tests/wake-mobile.test.ts` khoá hình dạng.
 */
import { SyncDeviceType } from './sync-v2-request.js';

/** Mã `SYNC_MESSAGE` dùng ở đây — tách khỏi enum lớn để không kéo cả bảng vào. */
export const WakeMobileCmd = { REQUEST_MOBILE_WAKE_UP: 592 } as const;

/** Hạn chờ phản hồi `592`. Zalo PC dùng đúng con số này (`t = 3e3`). */
export const WAKE_REPLY_TIMEOUT_MS = 3_000;

/**
 * Hạn đánh thức ở **tầng phiên**: `SessionManager.options.wakeupTimeout: 18e4`
 * (180 s) của Zalo PC.
 *
 * Đây là hạn Zalo PC chờ *phiên* có tiến triển, **không phải** hạn chờ phản hồi
 * `592` — và đó là chỗ repo từng đọc sai. Đo 2026-11-10 (R17): `592` im lặng
 * suốt 3 s, nhưng điện thoại vẫn thức và bấm xác nhận sau **104 s**. Vì vậy
 * không có đường nào ở đây được phép biến "không có phản hồi `592`" thành lỗi
 * phiên; số 180 s được ghi lại để bản đọc sau thấy đúng mốc của Zalo.
 */
export const WAKE_SESSION_TIMEOUT_MS = 180_000;

/**
 * Hạn **giữa hai gói** một khi dòng đã chảy — `batchTimeout` của Zalo PC,
 * `SessionManager.options.batchTimeout = 1e4`.
 *
 * Vì sao không dùng 180 s cho cả hai: 180 s là để chờ **điện thoại thức và
 * người dùng bấm thông báo** (R17 đo 104 s chỉ để hiện thông báo). Khi gói đầu
 * đã tới thì câu hỏi đổi hẳn — "gói kế tiếp có về không" — và câu trả lời của
 * Zalo PC là 10 s. Đo 2026-11-10 14:03: một nhóm 30 hội thoại đẩy 39 gói trong
 * **6 s** rồi im; với hạn 180 s, 13 nhóm thành ~39 phút chờ vô ích.
 */
export const BATCH_TIMEOUT_MS = 10_000;

/** `data` của `cmd 592` — ba trường, không bọc. */
export interface WakeMobilePayload {
  syncId: string;
  toDevice: number;
  reqId: string;
}

/**
 * Dựng `data` cho `cmd 592`.
 *
 * `syncId` phải là **cùng** chuỗi mà `590` sẽ gửi sau đó — Zalo PC ràng buộc
 * hai bước bằng chính nó (`this.syncId` trong cả `wakeup()` và request). Một
 * `syncId` khác ở `590` làm phiên đã đánh thức trở thành mồ côi: điện thoại mở
 * phiên A, ta xin phiên B, và không gói nào khớp.
 *
 * `reqId` là **của riêng lần gọi này**, không phải của phiên: hai lần đánh thức
 * liên tiếp phải phân biệt được với nhau, nếu không phản hồi của lần trước sẽ
 * được đọc thành phản hồi của lần sau.
 */
export function buildWakeMobilePayload(
  syncId: string, reqId: string, toDevice: number = SyncDeviceType.MOBILE,
): WakeMobilePayload {
  return { syncId, toDevice, reqId };
}

/** Khung WS hoàn chỉnh để gửi qua `listener.sendWs`. */
export function buildWakeMobileFrame(syncId: string, reqId: string, toDevice: number = SyncDeviceType.MOBILE): {
  version: number; cmd: number; subCmd: number; data: WakeMobilePayload;
} {
  return {
    version: 1,
    cmd: WakeMobileCmd.REQUEST_MOBILE_WAKE_UP,
    subCmd: 0,
    data: buildWakeMobilePayload(syncId, reqId, toDevice),
  };
}

/** Kết quả đọc một phong bì đã giải: có phải câu trả lời cho `reqId` này không. */
export interface WakeReply {
  /** `data.reqId` trùng `reqId` đã gửi. */
  matched: boolean;
  /** `code` của phản hồi; `null` khi phản hồi không mang mã. */
  code: number | null;
}

/**
 * Đọc phản hồi của `592` từ payload **đã giải** (không phải frame thô).
 *
 * Ba nơi có thể mang `reqId` trong thư viện này: `data.reqId` (đường của
 * `addCommonParams`, tức đường của `592`), và với lỗi thì `handleInnerDataError`
 * cũng đọc `t.data.reqId`. Nên chỉ cần một chỗ.
 *
 * `code` là mã nghiệp vụ: `0` mới nghĩa là điện thoại đã nhận lời đánh thức —
 * đúng điều kiện `0 == e.code` trong `wakeup()` của Zalo PC. Vắng `code` thì trả
 * `null` chứ không đoán `0`: một phong bì không có mã không phải là lời xác nhận.
 */
export function parseWakeReply(payload: unknown, reqId: string): WakeReply {
  if (!payload || typeof payload !== 'object') return { matched: false, code: null };
  const record = payload as Record<string, unknown>;
  const data = record.data;
  const dataReqId = data && typeof data === 'object'
    ? (data as Record<string, unknown>).reqId : undefined;
  const matched = dataReqId === reqId;
  const code = typeof record.code === 'number' ? record.code
    : typeof record.error_code === 'number' ? record.error_code : null;
  return { matched, code };
}
