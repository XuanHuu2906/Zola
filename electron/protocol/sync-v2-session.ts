/**
 * Điều phối **một** phiên Sync V2: xin → nhận gói → giải → đưa tin lên.
 *
 * Phần khó của đường này không phải mật mã (đã khoá trong `sync-v2-crypto`) mà
 * là **thứ tự**: sự kiện điều khiển về trên cùng một kênh WS với tin nhắn, các
 * gói có thể về sai thứ tự, và gói tin chỉ giải được **sau** khi gói metadata
 * của cùng `syncId` đã sinh ra bản ghi phiên. Ba điều dưới đây là hợp đồng, đọc
 * từ `shared-worker` của Zalo PC (`CdmT.js`) và `main-startup` (`3OF5.js`):
 *
 * 1. **Chỉ sự kiện `transfer_after_login` với `act_type: 'transfer_msg'` mang
 *    `temp_key` dùng được.** `act_type: 'transfer_sync2'` chở `transfer_status`,
 *    `upload_batch`, `transfer_error` — không có khoá. Lấy nhầm loại thì
 *    `temp_key` là `undefined` và mọi thứ sau đó hỏng ở máy chủ, không ở đây.
 * 2. **`temp_key` cũ quá 600 s là vô giá trị** (`getLatestValidTransferAfterLoginEvent`,
 *    `3OF5.js:84880-84896`). Mốc so là `ts` **của sự kiện điều khiển**, không
 *    phải `data.ts`. Khoá cũ khiến máy chủ coi phiên là hết hạn.
 * 3. **Bản ghi phiên sinh ra một lần, từ bản ghi đầu của gói metadata.** Các
 *    gói tin phải chờ nó; không có hàm nào ở đây tự dựng lại nó từ `ek`.
 *
 * Module này **không** gọi mạng và không import `zca-js`: mọi thứ ra ngoài đi
 * qua `deps`. Nhờ vậy toàn bộ state machine kiểm được mà không cần tài khoản
 * Zalo — và đó là chỗ duy nhất có thể sai một cách âm thầm.
 */
import {
  decodeConversationBatch, decodeConversationMetadataBatch,
  decodeMessageBatch, decodeMetadataBatch, SyncBatchError, SyncBatchType,
} from './sync-v2-batch.js';
import { makeIdResolver, chunkToMessages, type IdResolver, type SyncedMessage } from './sync-v2-map.js';
import type { SyncChunk, SyncConversation, SyncConversationChunk } from './sync-v2-proto.js';
import type { Ed25519KeyPair, SyncV2Crypto } from './sync-v2-crypto.js';
import type {
  SyncDatabaseName, SyncQuery, SyncRequestPayload, SyncRequestResult,
} from './sync-v2-request.js';
import {
  SyncDatabaseType, SyncDeviceType, SyncPriority, SyncType,
  SYNC_MAX_TO, SYNC_UNLIMITED_LIMIT,
} from './sync-v2-request.js';
import { SyncReleaseReason } from './dispose-session-ws.js';

/** `act` của sự kiện điều khiển (`Nme`, `3OF5.js:84784-84786`). */
export const SyncAct = {
  TRANSFER_AFTER_LOGIN: 'transfer_after_login',
  TRANSFER_STATUS: 'transfer_status',
  UPLOAD_BATCH: 'upload_batch',
  TRANSFER_ERROR: 'transfer_error',
} as const;

/** `act_type` của cùng sự kiện (`Fme`, `3OF5.js:84787`). */
export const SyncActType = {
  /** Đường cũ, mang `temp_key`. */
  SYNC_1: 'transfer_msg',
  /** Đường Sync V2, mang trạng thái và gói. */
  SYNC_2: 'transfer_sync2',
} as const;

/** `Xde.b` — trạng thái phía điện thoại (`CdmT.js:8115-8130`). */
export const SyncTransferStatus = {
  ACTIVE: 1,
  IDLE: 2,
  WAITING_CONFIRM: 3,
  CONFIRMED: 4,
  BYPASS_CONFIRMED: 5,
  USER_REJECT: 6,
  USER_CANCEL: 7,
  MASTER_DEVICE_BUSY: 8,
  MASTER_DEVICE_LOW_STORAGE: 9,
  MASTER_DEVICE_LOGOUT: 10,
} as const;

/** `Xde.c` — thiết bị gửi. Chỉ trạng thái từ `MOBILE` mới nói về điện thoại. */
export const SyncTransferDevice = { MOBILE: 0, WEB: 1, PC: 2 } as const;

/**
 * Một sự kiện điều khiển đã chuẩn hoá.
 *
 * `ts` lấy ở **tầng sự kiện**, không phải `data.ts`: mốc hết hạn 600 s của Zalo
 * so với `e.ts` (`3OF5.js:84886`). Dùng nhầm mốc trong `data` sẽ nhận một khoá
 * đã chết hoặc từ chối một khoá còn sống, tuỳ máy chủ đặt gì vào đó.
 */
export interface SyncControlEvent {
  act: string;
  actType: string;
  data: Record<string, unknown>;
  /** Mili-giây; `0` khi sự kiện không mang mốc. */
  ts: number;
}

/** `data` của `transfer_after_login` cần đúng hai trường này. */
export interface SyncTempKey {
  tempKey: string;
  ts: number;
}

/** Trạng thái điện thoại báo về trong phiên. */
export interface SyncMobileStatus {
  status: number;
  fromDevice: number;
}

/** Một gói máy chủ báo sẽ đẩy lên. */
export interface SyncBatchInfo {
  syncId: string;
  /** Số thứ tự gói trong phiên; `isLast` cộng `idx` cho ra tổng số gói. */
  idx: number;
  isLast: boolean;
  /** `0` là gói đẩy được. Khác `0` là gói hỏng, và `msgUrl` thường rỗng. */
  err: number;
  msgUrl: string;
  batchType: number;
  scopes: Array<{ partition: string; from: number; to: number }>;
}

/** Giai đoạn của một phiên. */
export const SyncPhase = {
  IDLE: 'idle',
  REQUESTED: 'requested',
  RECEIVING: 'receiving',
  DONE: 'done',
  FAILED: 'failed',
} as const;

export type SyncPhaseName = typeof SyncPhase[keyof typeof SyncPhase];

/**
 * Tách `controls[]` khỏi payload đã giải của `cmd 601`.
 *
 * Trả `[]` cho mọi hình dạng lạ thay vì ném: frame `601` còn chở hàng chục loại
 * sự kiện không liên quan (`typing`, `group`, `fr`…), và một sự kiện dị dạng
 * không được phép làm chết kênh nhận của cả phiên.
 */
export function parseControlEvents(payload: unknown): SyncControlEvent[] {
  const controls = (payload as { data?: { controls?: unknown } } | null)?.data?.controls;
  if (!Array.isArray(controls)) return [];

  const events: SyncControlEvent[] = [];
  for (const control of controls) {
    // Sự kiện nằm ở `control.content`; `control.controlId` chỉ có nghĩa với
    // `mark_unread`, không dùng ở đây.
    const content = (control as { content?: unknown } | null)?.content;
    if (!content || typeof content !== 'object' || Array.isArray(content)) continue;
    const fields = content as Record<string, unknown>;
    const act = fields.act;
    const actType = fields.act_type;
    if (typeof act !== 'string' || typeof actType !== 'string') continue;
    const ts = fields.ts;
    events.push({
      act,
      actType,
      data: normalizeControlData(fields.data),
      ts: typeof ts === 'number' && Number.isFinite(ts) ? ts : 0,
    });
  }
  return events;
}

/**
 * `data` của sự kiện: thường là object, nhưng vài loại gửi **chuỗi JSON**.
 *
 * Zalo chỉ parse chuỗi khi nó bắt đầu bằng `{` hoặc `[` (`dThN.js:4707-4709`).
 * Parse mọi chuỗi sẽ biến một `data` văn bản thật thành lỗi, và bỏ qua bước
 * parse sẽ khiến `data.temp_key` luôn `undefined`.
 */
function normalizeControlData(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    if (!value.startsWith('{') && !value.startsWith('[')) return {};
    try {
      const parsed: unknown = JSON.parse(value);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return isRecord(value) ? value : {};
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Mặc định của Zalo: khoá chỉ sống 10 phút sau khi điện thoại cấp. */
export const TEMP_KEY_MAX_AGE_MS = 600_000;

/**
 * Chọn `temp_key` dùng được từ một lô sự kiện điều khiển.
 *
 * Giống `getLatestValidTransferAfterLoginEvent` của Zalo, kể cả ba điều dễ sót:
 * `act_type` phải là `transfer_msg` **chứ không phải** `transfer_sync2`, `imei`
 * phải trùng thiết bị này, và khi nhiều sự kiện cùng hợp lệ thì **mới nhất**
 * thắng. Sự kiện không mang `ts` (thành `0`) bị loại bởi phép so hạn — đúng ý
 * đồ: không có mốc thì không chứng minh được khoá còn sống.
 */
export function pickTempKey(
  events: readonly SyncControlEvent[],
  options: { imei: string; now: number; maxAgeMs?: number },
): SyncTempKey | null {
  const maxAge = options.maxAgeMs ?? TEMP_KEY_MAX_AGE_MS;
  const valid = events.filter((event) => {
    if (event.act !== SyncAct.TRANSFER_AFTER_LOGIN) return false;
    if (event.actType !== SyncActType.SYNC_1) return false;
    const tempKey = event.data.temp_key;
    if (typeof tempKey !== 'string' || tempKey.length === 0) return false;
    return event.data.imei === options.imei;
  });
  if (valid.length === 0) return null;

  // `sort` ổn định nên hai sự kiện cùng `ts` giữ thứ tự máy chủ gửi — và bản
  // cuối vẫn là bản sau, đúng như Zalo.
  const latest = [...valid].sort((left, right) => left.ts - right.ts).at(-1) as SyncControlEvent;
  if (!(options.now - latest.ts <= maxAge)) return null;
  return { tempKey: latest.data.temp_key as string, ts: latest.ts };
}

/** Trạng thái ở `transfer_status`, chỉ khi báo từ điện thoại. */
export function readMobileStatus(event: SyncControlEvent): SyncMobileStatus | null {
  if (event.act !== SyncAct.TRANSFER_STATUS) return null;
  const { status, fromDevice } = event.data;
  if (typeof status !== 'number' || typeof fromDevice !== 'number') return null;
  return { status, fromDevice };
}

/**
 * Đọc một `upload_batch` thành thông tin gói, hoặc `null` nếu dị dạng.
 *
 * `err` khác `0` vẫn trả về thông tin: lỗi là **dữ liệu**, không phải ngoại lệ.
 * Nuốt nó thành `null` sẽ khiến phiên treo tới hạn chờ thay vì báo hỏng ngay.
 */
export function readBatchInfo(event: SyncControlEvent): SyncBatchInfo | null {
  if (event.act !== SyncAct.UPLOAD_BATCH) return null;
  const { syncId, idx, isLast, err, msgUrl, batchType, scopes } = event.data;
  if (typeof syncId !== 'string' || syncId.length === 0) return null;
  if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0) return null;
  if (typeof batchType !== 'number') return null;
  return {
    syncId,
    idx,
    isLast: readFlag(isLast),
    err: typeof err === 'number' ? err : 0,
    msgUrl: typeof msgUrl === 'string' ? msgUrl : '',
    batchType,
    scopes: Array.isArray(scopes)
      ? scopes.filter(isRecord).map((scope) => ({
        partition: typeof scope.partition === 'string' ? scope.partition : '',
        from: typeof scope.from === 'number' ? scope.from : 0,
        to: typeof scope.to === 'number' ? scope.to : 0,
      }))
      : [],
  };
}

/**
 * Cờ kiểu protobuf-JSON: `true`, `1`, hay `"true"` đều là bật.
 *
 * Đo 2026-11-10 14:03: không gói nào trong 39 gói của một phiên thật mang
 * `isLast === true`, trong khi `idx` chạy đủ `0..38` và dữ liệu đúng — nên cờ
 * gần như chắc chắn tới dạng số. Zalo PC đọc nó bằng **truthiness**
 * (`checkRequestfulfilled(e){ … e.isLast && (this.totalBatch=e.idx+1) … }`),
 * không bằng `=== true`; bản này thì có, và đó là lý do phiên không bao giờ
 * biết mình đã xong: nó chờ hết watchdog 180 s cho mỗi nhóm.
 */
function readFlag(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

/** I/O mà phiên cần. Tách ra để test được toàn bộ state machine. */
export interface SyncV2SessionDeps {
  crypto: SyncV2Crypto;
  /**
   * Đánh thức điện thoại bằng `cmd 592` với **cùng** `syncId` dùng ở bước xin.
   *
   * Gọi **sau** khi bước xin được nhận, không phải trước: `wakeup()` của Zalo PC
   * lấy phiên trong `syncSessions[0]` (`CdmT.js:8779-8781`), mà phiên chỉ vào
   * danh sách đó trong `create()`. Đo 2026-11-09: `592` gửi trước thì không nhận
   * được phản hồi nào trong 3 s.
   *
   * Hỏng ở bước này **không** làm phiên hỏng: bước xin đã được nhận, và
   * `temp_key` đến trên `601`, không phải như câu trả lời của `592`.
   *
   * Không bắt buộc: thiếu nó thì phiên vẫn chạy như trước (dùng cho test cũ và
   * cho trường hợp gọi qua HTTP, nơi việc đánh thức do phía khác lo).
   */
  wake?: (syncId: string) => Promise<{ ok: true } | { ok: false; code: number | string; message: string }>;
  /** Gửi yêu cầu `request-sync`. */
  request: (payload: SyncRequestPayload, reqId: string) => Promise<SyncRequestResult>;
  /**
   * Giải phóng phiên phía máy chủ (`cmd 591`). Gọi đúng một lần khi phiên
   * chuyển sang `DONE` hoặc `FAILED`, với lý do tương ứng.
   *
   * Không bắt buộc để test cũ chạy được, nhưng thiếu nó là để lại một phiên mở
   * cho mỗi lần bấm đồng bộ — xem `dispose-session-ws.ts`.
   */
  disposeSession?: (
    syncId: string, reason: number,
  ) => Promise<{ ok: true } | { ok: false; code: number | string; message: string }>;
  /** Tải nội dung một gói. URL đã ký sẵn, **không** cần cookie. */
  download: (url: string) => Promise<Uint8Array>;
  /** Nhận tin đã chuẩn hoá, theo lô, đúng thứ tự trong từng gói. */
  onMessages: (messages: SyncedMessage[]) => void;
  /**
   * Nhận hội thoại trong một phiên `database: "conversation"`.
   *
   * Đây là **bước 1** của đồng bộ đầy đủ: `convId` trong danh sách này (đổi tên
   * thành `globalNoisedId`) là thứ dựng `partition` `oneone/<id>` / `group/<id>`
   * cho lần xin tin sau. Không có nó thì không có id để xin — xem R16 §3.
   */
  onConversations?: (conversations: SyncConversation[]) => void;
  /** Trạng thái điện thoại báo về; dùng cho UI "đang chờ xác nhận". */
  onStatus?: (status: SyncMobileStatus) => void;
  onPhase?: (phase: SyncPhaseName) => void;
  /**
   * Số liệu sau mỗi gói. Không có nó thì thanh tiến trình chỉ nhúc nhích ở
   * bốn lần đổi giai đoạn, tức là đứng im suốt phần lớn thời gian đồng bộ.
   */
  onProgress?: (stats: SyncSessionStats) => void;
  /** Chẩn đoán: chỉ số đếm và mã, không nội dung tin. */
  onDebug?: (event: string, data: Record<string, unknown>) => void;
}

/** Số liệu của một phiên; `total` âm nghĩa là chưa biết tổng số gói. */
export interface SyncSessionStats {
  received: number;
  total: number;
  written: number;
  skipped: number;
}

/** Tham số dựng một phiên. Khoá **do phía gọi** sinh và giữ. */
export interface SyncV2SessionOptions {
  /**
   * Uid của tài khoản đang đăng nhập. **Không** dùng để suy `from`: Sync V2 báo
   * người gửi bằng id nhiễu, không phải uid. Xem `resolver`.
   */
  ownId: string;
  /**
   * Nối id nhiễu ↔ uid, để biết tin nào của mình và tin nào thuộc hội thoại
   * nào. `undefined` thì rơi về so thẳng `ownId` — sai không gian id, giữ lại
   * cho đường chưa có danh sách bạn bè.
   */
  resolver?: IdResolver;
  syncId: string;
  tempKey: string;
  deviceName: string;
  /** Khoá định danh của PC: sống qua các phiên. */
  identity: Ed25519KeyPair;
  /** Khoá tạm của **phiên này**: sinh mới mỗi lần. */
  ephemeral: Ed25519KeyPair;
  /** Số thứ tự phiên trong lần đăng nhập (`Ao.nextIndex`). */
  ussidx: number;
  /** `SyncDatabaseType.MESSAGE` hoặc `.CONVERSATION` — **tên** database. */
  database?: SyncDatabaseName;
  priority?: number;
  queries?: SyncQuery[];
  /** Số tin mỗi gói. Zalo dùng 2000. */
  batchSize?: number;
  /** Hạn chờ bản ghi phiên. Zalo dùng 60 s. */
  sessionRecordTimeoutMs?: number;
  /**
   * Hạn chờ **gói đầu tiên** sau khi đánh thức — `SessionManager.options.wakeupTimeout`
   * của Zalo PC, `18e4` = 180 s.
   *
   * Đây **không** phải hạn chờ phản hồi `592` (cái đó là 3 s, và im lặng ở đó
   * không phải lỗi — R17 §2). Nó là hạn cho *phiên*: điện thoại đã thức thì
   * trong 180 s phải đẩy gói đầu tiên, nếu không phiên phải chạm trạng thái cuối
   * để `cmd 591` được gửi. Không có hạn này thì phiên nằm `receiving` mãi và
   * không bao giờ giải phóng — đúng lỗi R17 tìm ra.
   */
  wakeupTimeoutMs?: number;
  /**
   * Hạn **giữa hai gói** một khi dòng đã chảy — `batchTimeout` của Zalo PC,
   * `1e4` = 10 s.
   *
   * Khác `wakeupTimeoutMs` có chủ đích: 180 s là để chờ *điện thoại thức và
   * người dùng bấm*, còn 10 s là để chờ *gói kế tiếp của một phiên đang chạy*.
   * Mặc định bằng `wakeupTimeoutMs` khi không truyền — hành vi cũ, để test cũ
   * không đổi nghĩa.
   */
  batchTimeoutMs?: number;
}

/**
 * Một phiên đồng bộ: xin dữ liệu, nhận gói, giải, đẩy tin lên.
 *
 * Hai hàng đợi **tách rời** là chỗ dễ sai nhất và cũng là lý do class này tồn
 * tại: gói metadata phải chạy ngay khi tới, còn gói tin phải **chờ** bản ghi
 * phiên. Một hàng đợi chung sẽ tự khoá: gói tin xếp trước metadata thì chờ
 * bản ghi phiên, mà bản ghi phiên do chính hàng đợi đó xử lý.
 */
export class SyncV2Session {
  private readonly deps: SyncV2SessionDeps;
  private readonly options: SyncV2SessionOptions;
  private phase: SyncPhaseName = SyncPhase.IDLE;
  /**
   * Database của phiên. `conversation` chở danh sách hội thoại — cùng phong bì,
   * cùng khoá, chỉ khác schema của thân bản ghi.
   */
  private readonly database: SyncDatabaseName;

  /** Bản ghi phiên; `null` cho tới khi gói metadata đầu tiên được giải. */
  private sessionRecord: Uint8Array | null = null;
  private resolveRecord: ((record: Uint8Array | null) => void) | null = null;
  private readonly recordReady: Promise<Uint8Array | null>;
  private recordTimer: NodeJS.Timeout | null = null;
  /**
   * Hạn chờ gói đầu tiên của phiên (`wakeupTimeout` của Zalo PC).
   *
   * Lý do tồn tại: `setPhase` chỉ gửi `591` khi phiên chạm `DONE`/`FAILED`. Một
   * phiên nằm `receiving` mãi — đúng thứ R17 đo được, `session-disposed` = 0
   * trên toàn log — thì không có lần `setPhase` nào để giải phóng, và mỗi lần
   * bấm đồng bộ lại để lại một phiên mở. Hạn này chuyển "không có gì tới" từ
   * một trạng thái vĩnh viễn thành một trạng thái cuối đọc được.
   */
  private wakeTimer: NodeJS.Timeout | null = null;

  private metaChain: Promise<void> = Promise.resolve();
  private msgChain: Promise<void> = Promise.resolve();

  /** Gói đã nhận theo `idx` — chống xử lý hai lần cùng một gói. */
  private readonly seen = new Set<number>();
  private readonly failed = new Set<number>();
  /** Tổng số gói, chỉ biết khi gói `isLast` tới. */
  private totalBatches = -1;
  private receivedBatches = 0;
  private messagesWritten = 0;
  private messagesSkipped = 0;
  private conversationsSeen = 0;
  /** `cmd 591` chỉ được gửi một lần cho một phiên. */
  private released = false;
  /** Hoàn tất khi phiên chạm trạng thái cuối; xem `settled`. */
  private settledResolver: ((phase: SyncPhaseName) => void) | null = null;
  private readonly settledPromise: Promise<SyncPhaseName>;
  /** Hoàn tất khi lần `591` cuối cùng đã có câu trả lời; xem `closed`. */
  private releaseResolver: (() => void) | null = null;
  private readonly releasePromise: Promise<void>;

  constructor(deps: SyncV2SessionDeps, options: SyncV2SessionOptions) {
    this.deps = deps;
    this.options = options;
    this.database = options.database ?? SyncDatabaseType.MESSAGE;
    this.settledPromise = new Promise<SyncPhaseName>((resolve) => {
      this.settledResolver = resolve;
    });
    this.releasePromise = new Promise<void>((resolve) => {
      this.releaseResolver = resolve;
    });
    this.recordReady = new Promise<Uint8Array | null>((resolve) => {
      this.resolveRecord = resolve;
    });
  }

  /**
   * Hạn chờ **bản ghi phiên**, bật lười ở gói đầu tiên.
   *
   * Không neo vào lúc mở phiên và không neo vào constructor. Đo trên app thật
   * (lượt 13:28:41 ngày 2026-11-10, `syncId vf6DnY1U…`):
   *
   * ```
   * 13:28:41.244  start → 590                ← mốc cũ: hạn 60 s bắt đầu ở đây
   * 13:29:41.244  recordReady tự trả null    ← hết hạn khi chưa có GÓI NÀO
   * 13:30:27.609  {"status":5}               ← điện thoại bấm xác nhận, +106 s
   * 13:30:29.659  FAILED "thiếu bản ghi phiên", idx 1
   * 13:30:29.692  conversation-batch idx 0   ← bản ghi giải xong sau 33 ms nữa
   * ```
   *
   * Hạn cũ đo sai thứ: nó đo "bao lâu kể từ lúc mở phiên" trong khi điều cần đo
   * là "bao lâu kể từ lúc có thứ cần bản ghi". Điện thoại cần >104 s mới đẩy
   * được gói đầu tiên (R17 §1), nên mốc cũ **luôn** hết trước khi dòng dữ liệu
   * bắt đầu. Triệu chứng người dùng thấy: *"ấn vào thì hiện đang đồng bộ luôn…
   * chạy 1s thì mất"*.
   *
   * Bật **một lần** và không đặt lại: đây là hạn cho "gói đã tới mà khoá thì
   * chưa". Đặt lại theo từng gói thì một dòng gói tin không bao giờ có metadata
   * đi kèm sẽ được chờ vô hạn, và cả hàng đợi tin kẹt theo.
   */
  private ensureRecordTimer(): void {
    if (!this.resolveRecord || this.recordTimer) return;
    const timeoutMs = this.options.sessionRecordTimeoutMs ?? 60_000;
    this.recordTimer = setTimeout(() => {
      this.recordTimer = null;
      this.releaseRecord(null);
    }, timeoutMs);
    // **Không** `unref`: hẹn giờ này là thứ duy nhất làm `recordReady` kết thúc.
    // Bỏ nó khỏi vòng lặp sự kiện thì `drain()` treo vĩnh viễn khi không còn gì
    // khác chạy — đúng lỗi mà test "thiếu gói metadata" bắt được.
  }

  get syncId(): string {
    return this.options.syncId;
  }

  get currentPhase(): SyncPhaseName {
    return this.phase;
  }

  /** Số tin đã đưa lên và số tin bị bỏ — đối chiếu với gói máy chủ báo. */
  get stats(): SyncSessionStats {
    return {
      received: this.receivedBatches,
      total: this.totalBatches,
      written: this.messagesWritten,
      skipped: this.messagesSkipped,
    };
  }

  /** Số hội thoại đã nhận trong phiên `database: "conversation"`. */
  get conversationCount(): number {
    return this.conversationsSeen;
  }

  /**
   * Chờ phiên chạm trạng thái cuối (`DONE`/`FAILED`).
   *
   * Cần cho chuỗi hai bước của `sync-full`: bước hội thoại phải xong trước khi
   * mở phiên tin, vì `SyncV2Controller` chỉ cho một phiên tại một thời điểm.
   * Không treo vô hạn: phiên `receiving` luôn có hạn `wakeupTimeoutMs`, và hết
   * hạn thì nó tự sang `FAILED` — tức promise này luôn có đường ra.
   */
  get settled(): Promise<SyncPhaseName> {
    return this.settledPromise;
  }

  /**
   * Chờ `591` có câu trả lời — tức phiên đã **đóng trên máy chủ**, không chỉ
   * xong ở phía máy này.
   *
   * Khác `settled` có chủ đích. `settled` resolve ngay khi gói cuối tới, còn
   * `591` được gửi sau đó và là một lần đi–về qua WebSocket. Chạy nhóm tiếp theo
   * lúc `settled` đã resolve nhưng `591` chưa xong là mở một phiên mới cạnh một
   * phiên còn mở — đo 2026-11-10 14:26:28: nhóm 3 xong, nhóm 4 gửi `590` sau
   * **0 ms**, socket đóng `1006` sau **11 ms**, và nhóm 4 mất hẳn.
   *
   * Luôn resolve: không có lần `591` nào (không có `disposeSession`) thì
   * promise hoàn tất ngay; lần `591` hỏng cũng vậy. Người gọi cần nó như một
   * **nhịp**, không phải như một điều kiện thành công.
   */
  get closed(): Promise<void> {
    return this.releasePromise;
  }

  /** Payload gửi máy chủ — dựng sẵn để test đối chiếu từng trường. */
  requestPayload(): SyncRequestPayload {
    const { ephemeral, identity, tempKey, deviceName, syncId, ussidx } = this.options;
    return {
      syncId,
      syncType: SyncType.SYNC_FULL,
      ek: Buffer.from(ephemeral.publicKey).toString('base64'),
      ik: Buffer.from(identity.publicKey).toString('base64'),
      // Luôn xin **từ điện thoại**: tin 1-1 cũ chỉ nằm ở đó. Xin từ PC khác sẽ
      // trả về đúng thứ ta đã có, và máy chủ coi đó là cùng thiết bị.
      toDevice: SyncDeviceType.MOBILE,
      tempKey,
      deviceName,
      req: {
        type: this.database,
        priority: this.options.priority ?? SyncPriority.NORMAL,
        // Không có `queries` thì Zalo PC **không bao giờ** gửi yêu cầu: nó luôn
        // dựng `this.requests.map(...)` và đưa ít nhất một query vào. Mặc định ở
        // đây là xin trọn phân vùng (`limit` vô hạn, khoảng vô hạn), để yêu cầu
        // tối thiểu vẫn có nghĩa thay vì "xin 0 dòng".
        //
        // Đây **không** phải toàn bộ luồng đồng bộ của Zalo PC: máy trạng thái
        // `sync-full` của nó chạy `sync_conversations` (database `"conversation"`,
        // partition `""`) trước, rồi mới tới `oneone/<globalNoisedId>` /
        // `group/<globalNoisedId>` cho từng hội thoại — vì phải có danh sách hội
        // thoại mới biết id để xin. Muốn lấy tin của một hội thoại cụ thể thì
        // truyền `queries` tường minh (`partitionOf`).
        queries: this.options.queries ?? [{
          partition: '',
          from: 0,
          to: SYNC_MAX_TO,
          limit: SYNC_UNLIMITED_LIMIT,
        }],
        batchSize: this.options.batchSize ?? 2000,
      },
      ver: 1,
      ussidx,
    };
  }

  /** Gửi yêu cầu. Gói chỉ về sau khi hàm này trả `ok: true`. */
  async start(reqId: string): Promise<SyncRequestResult> {
    if (this.phase !== SyncPhase.IDLE) {
      return { ok: false, code: 'state', message: `phiên đã ở trạng thái ${this.phase}` };
    }
    const payload = this.requestPayload();
    this.setPhase(SyncPhase.REQUESTED);
    let result: SyncRequestResult;
    try {
      result = await this.deps.request(payload, reqId);
    } catch (error) {
      // `request` đã tự bọc lỗi mạng; ném ở đây là lỗi lập trình hoặc lỗi của
      // phía gọi, và biến nó thành `FAILED` vẫn tốt hơn là treo phiên.
      result = { ok: false, code: 'threw', message: error instanceof Error ? error.message : 'unknown' };
    }
    if (!result.ok) {
      this.releaseRecord(null);
      this.setPhase(SyncPhase.FAILED);
      this.deps.onDebug?.('sync-v2', { ok: false, reason: 'request-rejected', code: result.code });
      return result;
    }
    // Đánh thức **sau** khi xin, không phải trước.
    //
    // Tôi đã làm ngược bước này một lần, và phép đo nói rõ: `592` gửi trước
    // `590` thì không có phản hồi nào trong 3 s — chỉ `1/1` (auth) và `621` về
    // trong cửa sổ nghe. Lý do nằm trong mã Zalo PC: `sessionManager.wakeup()`
    // lấy `this.syncSessions[0]` (`CdmT.js:8779-8781`) — một **phiên đã tồn tại**
    // — mà phiên chỉ vào `syncSessions` trong `create()`, *sau* `a.start()` tức
    // sau `590`. Không có phiên thì đánh thức không có gì để đánh thức: máy chủ
    // không biết `syncId` nào vừa được mở.
    //
    // **Không chờ phản hồi.** Đo 2026-11-10 (R17): `592` không có phản hồi trong
    // 3 s, nhưng điện thoại **vẫn thức** — hai khung `601` `transfer_status` tới
    // sau 104 s. Zalo PC đặt `wakeupTimeout: 18e4` (180 s) cho *phiên*, không
    // phải cho phản hồi của `592`; chờ ở đây chỉ làm `start()` treo tới 180 s
    // trước khi vào `receiving`. Gửi rồi đi tiếp: phản hồi, nếu có, được ghi lại
    // với `elapsedMs` khi nó tới.
    //
    // Đánh thức hỏng cũng không huỷ phiên: `590` đã được nhận, và `temp_key` đến
    // trên kênh điều khiển (`601`), không phải như câu trả lời của `592`.
    if (this.deps.wake) {
      const startedAt = Date.now();
      void Promise.resolve()
        .then(() => this.deps.wake?.(this.syncId))
        .then((wakeResult) => {
          this.deps.onDebug?.('sync-v2', wakeResult?.ok
            ? { ok: true, step: 'woken', syncId: this.syncId, elapsedMs: Date.now() - startedAt }
            : {
              ok: false, step: 'wake-failed', code: wakeResult?.code,
              message: wakeResult?.message, elapsedMs: Date.now() - startedAt,
            });
        })
        .catch((error: unknown) => {
          this.deps.onDebug?.('sync-v2', {
            ok: false, step: 'wake-threw',
            message: error instanceof Error ? error.message.slice(0, 120) : 'unknown',
            elapsedMs: Date.now() - startedAt,
          });
        });
    }
    this.setPhase(SyncPhase.RECEIVING);
    // Hạn chờ gói đầu tiên: phiên phải chạm trạng thái cuối để `591` được gửi,
    // kể cả khi máy chủ không đẩy gì. 180 s là con số của Zalo PC
    // (`SessionManager.options.wakeupTimeout: 18e4`) và rộng hơn nhiều so với
    // 104 s mà điện thoại thật cần để xác nhận (R17).
    this.armWakeTimer();
    this.deps.onDebug?.('sync-v2', {
      ok: true, step: 'requested', syncId: this.syncId,
      database: payload.req.type, tempKeyChars: payload.tempKey.length,
    });
    return result;
  }

  /**
   * Hẹn lại hạn **im lặng** — không phải một hạn chạy một lần từ lúc mở phiên.
   *
   * Đọc từ bundle, `SyncSession` của Zalo PC làm đúng thế này:
   *
   * ```js
   * wakeup(){ … .then(e=>( 0==e.code && this.startTimeoutReceiveBatch(
   *     this.options.wakeupTimeout, WakeupTimeout), …)) }
   * onConnectionChanged = e => { … switch (t.status) {
   *   case WaitingConfirm: startTimeoutReceiveBatch(connectTimeout)   // chờ NGƯỜI bấm
   *   case Confirmed:      startTimeoutReceiveBatch(batchTimeout)
   *   case Idle:           clearTimeoutReceiveBatch() } }
   * ```
   *
   * và mỗi gói nhận được cũng gọi `startTimeoutReceiveBatch(batchTimeout)` một
   * lần nữa. Nghĩa là nó là **watchdog im lặng**: mỗi dấu hiệu sống đặt lại đồng
   * hồ, và đồng hồ chỉ bắn khi không còn dấu hiệu nào.
   *
   * Bản R18 đầu tiên bật hạn một lần lúc mở phiên rồi bắn thẳng ở 180 s. Trong
   * khi đó R17 đã đo được điện thoại cần **104 s** chỉ để hiện `transfer_status`,
   * và còn phải chờ người bấm nữa. Kết quả: app giải phóng phiên trước khi người
   * dùng kịp bấm thông báo trên điện thoại, nên bấm vào thì phiên đã chết —
   * đúng hiện tượng "bấm vào chả thấy gì".
   *
   * Reset điểm đúng là: mở phiên, mỗi sự kiện `transfer_status`, mỗi gói nhận
   * được. Không reset ở bất cứ thứ gì khác — frame `601` còn chở hàng chục loại
   * sự kiện không liên quan, và chúng không phải dấu hiệu phiên còn sống.
   *
   * **Hai hạn, hai ý nghĩa** — đúng như `SessionManager.options` của Zalo PC
   * (`{connectTimeout:1e4, batchTimeout:1e4, wakeupTimeout:18e4}`):
   *
   * - `wakeupTimeoutMs` (180 s) cho khoảng **chưa có gì**: mở phiên → gói đầu
   *   tiên. Đó là khoảng điện thoại cần >104 s để hiện thông báo (R17 §1).
   * - `batchTimeoutMs` (10 s) cho khoảng **giữa hai gói** một khi dòng đã chảy.
   *
   * Dùng 180 s cho cả hai (bản R18 đầu) biến một nhóm 30 hội thoại thành 3 phút
   * chờ vô ích khi máy chủ đã đẩy xong gói cuối mà không đánh dấu `isLast` —
   * đo 2026-11-10 14:03: 39 gói về trong 6 s, rồi im. Với 13 nhóm, sai số đó
   * là ~39 phút cho một lần đồng bộ.
   */
  private armWakeTimer(): void {
    const wakeupMs = this.options.wakeupTimeoutMs ?? 0;
    const batchMs = this.options.batchTimeoutMs ?? wakeupMs;
    const timeoutMs = this.receivedBatches > 0 ? batchMs : wakeupMs;
    if (timeoutMs <= 0) return;
    // Đã chạm trạng thái cuối (hoặc chưa mở phiên) thì không có gì để canh:
    // `setPhase` đã huỷ hẹn giờ, và hẹn lại ở đây sẽ hồi sinh một phiên đã đóng.
    if (this.phase !== SyncPhase.REQUESTED && this.phase !== SyncPhase.RECEIVING) return;
    this.clearWakeTimer();
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      // Không kiểm `receivedBatches > 0`: bộ hẹn giờ này **được đặt lại** ở mỗi
      // dấu hiệu sống, nên lúc nó bắn nghĩa là đã im lặng trọn một hạn — kể cả
      // khi gói đầu tới rồi dòng chảy dừng giữa đường. Đó là ca R17 ghi lại:
      // phiên nằm `receiving` mãi, không trạng thái cuối, không `591`. Chỉ
      // trạng thái cuối mới được miễn, và trạng thái cuối đã tự huỷ hẹn giờ
      // (`setPhase`).
      if (this.phase !== SyncPhase.REQUESTED && this.phase !== SyncPhase.RECEIVING) return;
      this.fail(`không có dấu hiệu sống nào trong ${timeoutMs} ms`);
    }, timeoutMs);
    // Không giữ tiến trình sống chỉ vì hẹn giờ này.
    this.wakeTimer.unref?.();
  }

  private clearWakeTimer(): void {
    if (!this.wakeTimer) return;
    clearTimeout(this.wakeTimer);
    this.wakeTimer = null;
  }

  /**
   * Xử lý một lô sự kiện điều khiển của `cmd 601`.
   *
   * Không ném: một gói hỏng chỉ đánh dấu gói đó, không kéo đổ cả phiên — máy
   * chủ vẫn có thể đẩy các gói còn lại.
   */
  handleControlEvents(events: readonly SyncControlEvent[]): void {
    for (const event of events) {
      const status = readMobileStatus(event);
      if (status) {
        // Mỗi trạng thái là một dấu hiệu phiên còn sống — Zalo PC hẹn lại đồng
        // hồ ở đây (`onConnectionChanged`), kể cả `WaitingConfirm`, tức là thời
        // gian **người dùng bấm** trên điện thoại không bị tính vào hạn.
        //
        // `Idle` là ngoại lệ. Zalo PC làm
        // `case Idle: this.pauseBatchWait() || this.clearTimeoutReceiveBatch()`
        // — vì `pauseBatchWait()` không trả gì nên vế phải luôn chạy: **xoá**
        // hạn giờ, tức là chờ vô hạn cho tới khi điện thoại báo `Active` lại.
        //
        // Ta không làm y hệt, và đây là chỗ cố ý đi lệch khỏi Zalo PC. Phiên
        // treo vô hạn chính là lỗi R17 ghi lại ("receiving forever, no 591"):
        // không trạng thái cuối, không `591`, người dùng thấy thanh chạy mãi.
        // Nên ở đây chỉ **không đặt lại** hạn — hạn đã có từ trạng thái trước
        // vẫn tiếp tục đếm, và phiên đóng đúng lúc thay vì được cộng thêm một
        // cửa sổ nữa. Đo 2026-11-10 15:49: `status:5` rồi `status:2` cách
        // nhau 20 ms, sau đó không gói nào — chuỗi này phải kết thúc, không
        // phải chờ. Lượt 15:28 cũng `status:5` mà dữ liệu vẫn về, nên `Idle`
        // ở đây là "điện thoại đóng phiên này", không phải "lần này hỏng".
        const idle = status.status === SyncTransferStatus.IDLE;
        if (!idle) this.armWakeTimer();
        if (status.fromDevice === SyncTransferDevice.MOBILE) this.deps.onStatus?.(status);
        continue;
      }
      if (event.act === SyncAct.TRANSFER_ERROR) {
        this.fail(`transfer_error: ${String(event.data.code ?? event.data.error_code ?? '')}`);
        continue;
      }
      const batch = readBatchInfo(event);
      if (!batch) continue;
      if (batch.syncId !== this.syncId) continue;
      if (batch.err !== 0) {
        this.failed.add(batch.idx);
        this.deps.onDebug?.('sync-v2', {
          ok: false, reason: 'batch-failed', idx: batch.idx, err: batch.err,
          partitions: batch.scopes.map((scope) => scope.partition).slice(0, 5),
        });
        this.countBatch(batch);
        continue;
      }
      this.enqueue(batch);
    }
  }

  /** Đặt một gói vào hàng đợi đúng loại. */
  private enqueue(batch: SyncBatchInfo): void {
    // Máy chủ đôi khi gửi lại cùng `idx` sau khi mất kết nối; xử lý lần hai sẽ
    // ghi trùng và tốn một lượt giải mã.
    if (this.seen.has(batch.idx)) {
      this.deps.onDebug?.('sync-v2', { ok: true, reason: 'duplicate-batch', idx: batch.idx });
      return;
    }
    this.seen.add(batch.idx);
    this.countBatch(batch);

    if (batch.batchType === SyncBatchType.METADATA_EMBEDDED) {
      // Metadata chạy trên chuỗi riêng: nó **mở khoá** cho chuỗi còn lại.
      this.metaChain = this.metaChain.then(() => this.processMetadata(batch));
      return;
    }
    // Mọi loại khác đi chuỗi tin, và tự chờ bản ghi phiên ở đầu chuỗi.
    this.msgChain = this.msgChain.then(() => this.processMessage(batch));
  }

  private countBatch(batch: SyncBatchInfo): void {
    this.receivedBatches += 1;
    // Mỗi gói là một dấu hiệu sống: đặt lại hạn im lặng. Zalo PC làm đúng vậy
    // (`startTimeoutReceiveBatch(this.options.batchTimeout)` trong `handleBatch`),
    // và đó là thứ khiến hạn 180 s không cắt ngang một lần đồng bộ dài.
    this.armWakeTimer();
    // Hạn chờ bản ghi phiên chỉ được bật khi có gói **cần** nó; xem
    // `ensureRecordTimer`.
    this.ensureRecordTimer();
    if (batch.isLast && batch.idx >= 0) this.totalBatches = batch.idx + 1;
    // Xong khi mọi gói `0..total-1` đều đã tới, **kể cả** những gói hỏng: hỏng
    // là câu trả lời, không phải "chưa tới".
    this.deps.onProgress?.(this.stats);
    if (this.totalBatches > 0 && this.seen.size + this.failed.size >= this.totalBatches) {
      this.setPhase(this.failed.size > 0 ? SyncPhase.FAILED : SyncPhase.DONE);
    }
  }

  private async processMetadata(batch: SyncBatchInfo): Promise<void> {
    try {
      const bytes = await this.deps.download(batch.msgUrl);
      if (this.database === SyncDatabaseType.CONVERSATION) {
        const decoded = decodeConversationMetadataBatch(bytes, this.deps.crypto, this.metadataKeys());
        this.sessionRecord = decoded.sessionRecord;
        this.releaseRecord(decoded.sessionRecord);
        this.emitConversations(decoded.chunks, batch);
        return;
      }
      const decoded = decodeMetadataBatch(bytes, this.deps.crypto, this.metadataKeys());
      const record = decoded.sessionRecord;
      this.sessionRecord = record;
      this.releaseRecord(record);
      this.emitChunks(decoded.chunks, batch);
    } catch (error) {
      // Không có bản ghi phiên thì mọi gói tin sau đều không mở được: trả
      // `null` cho hàng đợi tin để nó báo lỗi ngay thay vì chờ hết hạn.
      this.releaseRecord(null);
      this.fail(`metadata: ${error instanceof Error ? error.message : 'unknown'}`, batch);
    }
  }

  private async processMessage(batch: SyncBatchInfo): Promise<void> {
    const record = this.sessionRecord ?? await this.recordReady;
    if (!record) {
      this.fail('thiếu bản ghi phiên', batch);
      return;
    }
    try {
      const bytes = await this.deps.download(batch.msgUrl);
      if (this.database === SyncDatabaseType.CONVERSATION) {
        const decoded = decodeConversationBatch(bytes, this.deps.crypto, record);
        this.emitConversations(decoded.chunks, batch);
        return;
      }
      const decoded = decodeMessageBatch(bytes, this.deps.crypto, record);
      this.emitChunks(decoded.chunks, batch);
    } catch (error) {
      const known = error instanceof SyncBatchError;
      this.fail(known ? error.message : `không giải được gói: ${String(error)}`, batch);
    }
  }

  /** Ba khoá dùng để mở batch metadata — cùng bộ cho cả hai database. */
  private metadataKeys(): {
    identityPublicKey: Uint8Array; identityPrivateKey: Uint8Array; ephemeralPrivateKey: Uint8Array;
  } {
    return {
      identityPublicKey: this.options.identity.publicKey,
      identityPrivateKey: this.options.identity.privateKey,
      ephemeralPrivateKey: this.options.ephemeral.privateKey,
    };
  }

  /** Chuyển chunk → tin, đẩy lên, cộng dồn số liệu. */
  private resolver(): IdResolver {
    // Dựng lại mỗi gói chứ không giữ ở constructor: bảng `globalId` có thể được
    // điền **sau** khi phiên mở (danh sách bạn bè về sau khi socket lên).
    return this.options.resolver ?? makeIdResolver({ ownId: this.options.ownId });
  }

  private emitChunks(chunks: SyncChunk[], batch: SyncBatchInfo): void {
    let written = 0;
    let skipped = 0;
    // Hình dạng `senderId` của cả gói: `chars` là số ký tự thấy nhiều nhất,
    // `self` là số tin khớp `ownId`. Xem `SyncedMessage.senderShape` để biết vì
    // sao chỉ ghi hình dạng chứ không ghi giá trị.
    let senderChars = 0;
    let emptySender = 0;
    let selfMessages = 0;
    // Số phân vùng không nối được về uid/groupId. Log `batch` ghi `partition`
    // **gốc**, nên nếu chỉ nhìn nó thì tin về đúng chỗ hay rơi vào hội thoại ma
    // trông giống hệt nhau. Đây mới là con số trả lời câu hỏi đó.
    let unresolved = 0;
    // Vì sao tin bị bỏ, tách theo lý do **và** theo "của mình hay của người" —
    // gộp chung vào `skipped` thì "tin của tôi thiếu" không bao giờ thấy được.
    const skipReasons = { empty: 0 };
    const selfSkipped = { empty: 0 };
    // Số tin máy chủ không cấp `globalId` nên phải cấp khoá cục bộ. Đếm riêng
    // để một lượt chỉ toàn tin của mình vẫn phân biệt được với "không có gì về".
    let locallyKeyed = 0;
    for (const chunk of chunks) {
      const result = chunkToMessages(chunk, this.resolver());
      if (result.messages.length > 0) this.deps.onMessages(result.messages);
      written += result.messages.length;
      skipped += result.skipped;
      unresolved += result.unresolved;
      skipReasons.empty += result.skipReasons.empty;
      selfSkipped.empty += result.selfSkipped.empty;
      locallyKeyed += result.locallyKeyed;
      for (const item of result.messages) {
        if (item.senderShape.chars === 0) emptySender += 1;
        else senderChars = item.senderShape.chars;
        if (item.senderShape.isSelf) selfMessages += 1;
      }
    }
    this.messagesWritten += written;
    this.messagesSkipped += skipped;
    this.deps.onProgress?.(this.stats);
    const size = batch.scopes[0]?.partition ?? '';
    this.deps.onDebug?.('sync-v2', {
      ok: true, step: 'batch', idx: batch.idx, isLast: batch.isLast,
      batchType: batch.batchType, written, skipped, partition: size.slice(0, 40),
      unresolved, skipReasons, selfSkipped, locallyKeyed,
      // Chẩn đoán `from_me`: xem `SyncedMessage.senderShape`.
      senderChars, emptySender, selfMessages,
    });
  }

  /** Chuyển chunk hội thoại → danh sách, đẩy lên, cộng dồn số liệu. */
  private emitConversations(chunks: SyncConversationChunk[], batch: SyncBatchInfo): void {
    const conversations = chunks.flatMap(chunk => chunk.conversations);
    this.conversationsSeen += conversations.length;
    // Hội thoại không phải tin: không cộng `written`, nhưng vẫn phải báo tiến
    // trình, nếu không banner đứng im suốt bước đầu của chuỗi.
    this.deps.onProgress?.(this.stats);
    if (conversations.length > 0) this.deps.onConversations?.(conversations);
    // Chỉ đếm và **hình dạng id**, không tên hội thoại: id máy chủ là thứ dựng
    // `partition` cho bước sau, nên nó cần thấy được trong log. Đây là id, không
    // phải nội dung — cùng loại dữ liệu với `threadId` đã có trong mọi dòng khác.
    this.deps.onDebug?.('sync-v2', {
      ok: true, step: 'conversation-batch', idx: batch.idx, isLast: batch.isLast,
      batchType: batch.batchType, conversations: conversations.length,
      total: this.conversationsSeen,
      firstIds: conversations.slice(0, 3).map(item => item.convId.slice(0, 40)),
    });
  }

  private fail(reason: string, batch?: SyncBatchInfo): void {
    if (batch) this.failed.add(batch.idx);
    this.setPhase(SyncPhase.FAILED);
    this.deps.onDebug?.('sync-v2', {
      ok: false, reason, idx: batch?.idx ?? null, syncId: this.syncId,
    });
  }

  /**
   * Chờ mọi gói đã xếp hàng chạy xong.
   *
   * Nơi gọi dùng hàm này để biết phiên kết thúc **thật**, không phải lúc gói
   * cuối tới: tải và giải vẫn còn chạy sau đó.
   */
  async drain(): Promise<void> {
    await this.metaChain;
    await this.msgChain;
  }

  /** Giải phóng bộ hẹn giờ; gọi khi bỏ phiên giữa đường. */
  dispose(): void {
    this.clearWakeTimer();
    this.releaseRecord(null);
    // Mở luôn cửa `closed`: một phiên bị bỏ không đi qua `setPhase`, nên nếu
    // không có dòng này thì ai đang chờ `closed` sẽ chờ mãi.
    this.releaseResolver?.();
    this.releaseResolver = null;
  }

  /**
   * Bỏ phiên giữa đường và báo máy chủ bằng `UserCancel`.
   *
   * Zalo PC đi đúng đường này: `disposeSync` của máy trạng thái `sync-full` gọi
   * `cancelSync(UserCancel)`. Không có nó thì một lần bấm huỷ để lại phiên mở
   * cho tới khi máy chủ tự dọn — và phiên mở chặn chính lần đồng bộ sau.
   */
  cancel(): void {
    this.clearWakeTimer();
    this.releaseRecord(null);
    // Phiên đã xong thì không còn gì để huỷ, và không được lật `DONE` thành
    // `FAILED`: UI đọc trạng thái đó để báo "đồng bộ xong".
    if (this.released || this.phase === SyncPhase.DONE) return;
    this.releaseOnServerWith(SyncReleaseReason.USER_CANCEL);
    this.setPhase(SyncPhase.FAILED);
  }

  private releaseRecord(record: Uint8Array | null): void {
    if (this.recordTimer) {
      clearTimeout(this.recordTimer);
      this.recordTimer = null;
    }
    const resolve = this.resolveRecord;
    this.resolveRecord = null;
    resolve?.(record);
  }

  private setPhase(phase: SyncPhaseName): void {
    if (this.phase === phase) return;
    // `FAILED` không bị ghi đè bởi `DONE`: một phiên hỏng một nửa không được
    // báo thành công chỉ vì gói cuối tới muộn.
    if (this.phase === SyncPhase.FAILED && phase !== SyncPhase.FAILED) return;
    this.phase = phase;
    this.deps.onPhase?.(phase);
    // Giải phóng phía máy chủ **một lần** khi phiên chạm trạng thái cuối. Zalo
    // PC làm đúng vậy trong `handleSuccess` / `handleFailure` của máy trạng thái
    // `sync-full`; bỏ bước này thì mỗi lần bấm đồng bộ lại để lại một phiên mở.
    //
    // Không chặn luồng: `setPhase` là đồng bộ và đang chạy bên trong handler
    // gói, nên lỗi giải phóng chỉ được ghi lại, không được ném.
    if (phase === SyncPhase.DONE || phase === SyncPhase.FAILED) {
      this.clearWakeTimer();
      // Không đóng `recordReady` ở đây: gói metadata có thể đang giải lúc phiên
      // chạm trạng thái cuối. `drain()` vẫn phải chờ nó trước khi controller
      // đọc danh sách hội thoại — nếu không, phiên DONE mà danh sách rỗng.
      this.settledResolver?.(phase);
      this.settledResolver = null;
      this.releaseOnServer(phase);
    }
  }

  /** Gửi `591` đúng một lần; lý do khớp trạng thái cuối của phiên. */
  private releaseOnServer(phase: SyncPhaseName): void {
    const reason = phase === SyncPhase.DONE
      ? SyncReleaseReason.SYNC_SUCCESS : SyncReleaseReason.ERROR;
    this.releaseOnServerWith(reason);
  }

  /** Gửi `591` đúng một lần với lý do cho trước. */
  private releaseOnServerWith(reason: number): void {
    if (this.released) return;
    this.released = true;
    const finish = (): void => {
      this.releaseResolver?.();
      this.releaseResolver = null;
    };
    const dispose = this.deps.disposeSession;
    if (!dispose) {
      finish();
      return;
    }
    void dispose(this.syncId, reason).then((result) => {
      this.deps.onDebug?.('sync-v2', result.ok
        ? { ok: true, step: 'session-disposed', reason }
        : { ok: false, step: 'session-dispose-failed', reason, code: result.code });
    }).catch((error: unknown) => {
      this.deps.onDebug?.('sync-v2', {
        ok: false, step: 'session-dispose-threw',
        message: error instanceof Error ? error.message.slice(0, 120) : 'unknown',
      });
    }).finally(finish);
  }
}
