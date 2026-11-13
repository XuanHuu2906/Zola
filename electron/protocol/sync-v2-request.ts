/**
 * Hình dạng yêu cầu Sync V2 và các enum số của nó.
 *
 * **Đường gửi không ở đây.** Bản trước của file này gửi qua HTTP
 * `/api/transfer-sync-v2/request-sync` (commandId `12888`), và đường đó không
 * tồn tại trên máy chủ: `404 text/html` từ nginx trên toàn bộ 46 origin của
 * `zpw_service_map_v3` (đo 2026-11-10), trong khi các endpoint cùng bảng sống
 * cùng host trả JSON `error_code: 600`. Đường thật là **WS `cmd 590`**, và nó
 * nằm ở `request-sync-ws.ts`.
 *
 * Payload lấy nguyên văn từ `SyncSession.requestSync` của Zalo PC
 * (`shared-worker`, `syncChanel.requestSync`):
 *
 * ```json
 * {
 *   "syncId": "<32 ký tự ngẫu nhiên>",
 *   "syncType": 0,             // SyncFull
 *   "ek":  "<b64 khoá công khai tạm>",
 *   "ik":  "<b64 khoá công khai định danh>",
 *   "toDevice": 0,             // Mobile
 *   "tempKey": "<chuỗi>",      // "" là hợp lệ ở đường đồng bộ tay
 *   "deviceName": "<tên máy>",
 *   "req": { "type": "message", "priority": 1,
 *            "queries": [{ "partition": "oneone/<globalNoisedId>",
 *                          "from": 0, "to": 9007199254740991, "limit": 2147483647 }],
 *            "batchSize": 2000 },
 *   "ver": 1,
 *   "ussidx": 0
 * }
 * ```
 *
 * `syncType`/`toDevice`/`priority` là enum **số**; `req.type` thì **không** —
 * xem `SyncDatabaseType`. Giữ nguyên giá trị thay vì đặt tên ở đây để không tạo
 * một bản sao enum sai lệch dần theo phiên bản Zalo.
 */

/**
 * `req.type` — **tên database**, không phải mã số.
 *
 * Đây từng là lỗi chặn cả đường đồng bộ: bản trước gửi `3`/`4`, trong khi Zalo
 * PC gửi chuỗi. Ba chỗ trong bundle chứng minh kiểu:
 *
 * 1. Module `m+Kp` của `shared-worker` là
 *    `e.Conversation="conversation", e.Message="message", e.UnSpecific="UnSpecific"`.
 * 2. `RemoteDatabaseService.createMessageDatabase()` / `createConversationDatabase()`
 *    dựng database với tên đúng hai chuỗi đó (`new Oo(..., "message", ...)`).
 * 3. `SessionManager.useSession(query)` lấy `type: e.database` — mà `database`
 *    là `databaseName` của remote database, tức cùng chuỗi này — rồi đưa thẳng
 *    vào `req.type` của `requestSync`.
 *
 * Máy chủ trả `code: 0` cho `3` vì nó chỉ kiểm phong bì; nó không có database
 * nào tên `3` nên không có gì để đẩy. Vì vậy "được nhận" mà không có gói không
 * phải mâu thuẫn — nó là triệu chứng của đúng lỗi này.
 */
export const SyncDatabaseType = {
  MESSAGE: 'message',
  CONVERSATION: 'conversation',
} as const;

/** Kiểu của `req.type`. */
export type SyncDatabaseName = typeof SyncDatabaseType[keyof typeof SyncDatabaseType];

/** `Sync2.Shared.SyncType` — chỉ dùng `SyncFull` trong app này. */
export const SyncType = { SYNC_FULL: 0 } as const;

/** `Sync2.Shared.DeviceType`. */
export const SyncDeviceType = { MOBILE: 0, WEB: 1, PC: 2 } as const;

/** `TaskPriority`: HIGH/NORMAL/LOW = 0/1/2. Xin toàn bộ lịch sử là việc nền. */
export const SyncPriority = { HIGH: 0, NORMAL: 1, LOW: 2 } as const;

/**
 * `limit` của "không giới hạn": `yo.a` = `2147483647` (`/sYZ` trong
 * `shared-worker`). Dùng `0` không phải "không giới hạn" — nó là "xin 0 dòng",
 * và máy chủ trả về đúng thế.
 */
export const SYNC_UNLIMITED_LIMIT = 2147483647;

/** `to` mặc định của `Zo` — `Number.MAX_SAFE_INTEGER`. */
export const SYNC_MAX_TO = Number.MAX_SAFE_INTEGER;

/**
 * Số query **tối đa** trong một yêu cầu — 30, đọc từ bundle của Zalo PC.
 *
 * ```js
 * async buildPrepareQuery(e){
 *   e.params.queries.forEach(e=>{ … const i=r.find(e=>e.getQueryCount()<30);
 *     if(i) i.addQuery(e), … else { tạo PrepareAllQuery mới; i.addQuery(e) } })
 *   …
 *   for(let t=0;t<i.length;t++){ … await this.sessionManager.prepareSession(s) }
 * }
 * ```
 *
 * Mỗi nhóm 30 query là **một `590`** (`prepareSession` gọi một lần mỗi nhóm),
 * và các nhóm chạy **tuần tự**, không song song.
 *
 * Vượt con số này không bị từ chối bằng mã lỗi — máy chủ đóng thẳng kết nối.
 * Đo 2026-11-10 13:49:50: gửi 363 `partition` trong một `590`, nhận lại
 * `disconnected {"code":1009}` (WebSocket "message too big") trước cả khi có
 * phản hồi, rồi mọi lần thử sau rơi vào `no-reply` cho tới khi hết hạn.
 *
 * **Một hội thoại = một query, không phải nhiều.** `Zo` (`GetAll`) mang phân
 * vùng ở `meta.partition` và khoảng ở `params.range`, nên `getQueryCount()`
 * đếm đúng số hội thoại. Vì vậy giới hạn 30 ở đây cũng chính là 30 hội thoại
 * một lượt. Kiểm lại điều này trong bundle trước khi đổi con số: một lần tôi
 * tưởng mỗi hội thoại sinh nhiều query và đã định "sửa" một thứ vốn đúng.
 */
export const SYNC_MAX_QUERIES_PER_REQUEST = 30;

/** Một khoảng dữ liệu trong một phân vùng. */
export interface SyncQuery {
  /** `oneone/<globalNoisedId>`, `group/<globalNoisedId>`, hoặc `""` cho hội thoại. */
  partition: string;
  from: number;
  to: number;
  limit: number;
}

/**
 * Phân vùng của một hội thoại — `${isGroup ? "group" : "oneone"}/${id}`
 * (module `aSMs`), với `id` là **global noised id**, không phải id hiển thị.
 */
export function partitionOf(isGroup: boolean, globalNoisedId: string): string {
  return `${isGroup ? 'group' : 'oneone'}/${globalNoisedId}`;
}

/** Payload gửi lên máy chủ. */
export interface SyncRequestPayload {
  syncId: string;
  syncType: number;
  /** Khoá công khai tạm, base64. */
  ek: string;
  /** Khoá công khai định danh, base64. */
  ik: string;
  toDevice: number;
  tempKey: string;
  deviceName: string;
  req: {
    /** Tên database (`"message"` / `"conversation"`), không phải mã số. */
    type: SyncDatabaseName;
    priority: number;
    queries: SyncQuery[];
    batchSize: number;
  };
  ver: number;
  ussidx: number;
}

/** Kết quả một lần gửi: thành công, hoặc lỗi có mã. */
export type SyncRequestResult =
  | { ok: true }
  | { ok: false; code: number | string; message: string };

/**
 * `syncId`: 32 ký tự ngẫu nhiên, đúng như `Ot.i.generateRandomString(32)` của
 * Zalo PC. Dùng bảng chữ-số để chuỗi an toàn trong mọi chỗ (URL, log, tên tệp).
 */
export function generateSyncId(random: (size: number) => Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = random(32);
  let id = '';
  for (let index = 0; index < 32; index += 1) {
    id += alphabet[bytes[index] % alphabet.length];
  }
  return id;
}

/**
 * `userSyncSessionId`: 16 ký tự, sinh **một lần cho mỗi lần đăng nhập**.
 *
 * Không nhầm với `ussidx`: `ussidx` là **số thứ tự** trong phiên đăng nhập đó,
 * không phải chuỗi này. Zalo PC giữ một `nextIndex(userSyncSessionId)` trả
 * 0, 1, 2… cho từng phiên đồng bộ (`Ao.nextIndex`, `CdmT.js:8273-8276`), nên
 * hai phiên song song — tin nhắn và hội thoại — mang `ussidx` khác nhau nhưng
 * cùng `userSyncSessionId`.
 */
export function generateUserSyncSessionId(random: (size: number) => Uint8Array): string {
  return generateSyncId(random).slice(0, 16);
}
