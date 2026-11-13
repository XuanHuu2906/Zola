/**
 * Nối Sync V2 với kênh WebSocket đang chạy: nhận sự kiện điều khiển, giữ
 * `temp_key`, mở phiên, tải gói, đẩy tin đã chuẩn hoá ra ngoài.
 *
 * Ba thứ tách lớp này khỏi `SyncV2Session`:
 *
 * 1. **Frame `601` là của zca-js.** zca-js đã giải payload trước khi ta thấy
 *    nó, nhưng nó chỉ phát ba `act_type` (`file_done`, `group`, `fr`) qua sự
 *    kiện `message`; `transfer_*` bị bỏ qua **im lặng**
 *    (`dist/apis/listen.js:213-258`). Nên phải nghe trên chính socket thô —
 *    đúng cách `watchFrames` của `zalo-client` đã làm — vì không có event nào
 *    để bám vào.
 * 2. **`temp_key` chỉ là đường tốt hơn, không phải điều kiện.** Nó tới trên
 *    `transfer_after_login` ngay sau khi đăng nhập, có thể trước khi người dùng
 *    bấm đồng bộ — nên giữ một cửa sổ sự kiện gần nhất để lúc cần là tra được.
 *    Nhưng đường đồng bộ **tay** của Zalo PC chạy với khoá rỗng; xem `start`.
 * 3. **Tải gói không cần phiên.** `msgUrl` đã ký sẵn; Zalo PC gọi
 *    `fetch(url, { keepalive: true })` trần, không cookie. Không có cookie nào
 *    đi qua lớp này — bước xin phiên cũng vậy, vì nó chạy trên socket đã được
 *    xác thực (`cmd 590`).
 *
 * Không import `zca-js` (chỉ nhận `listener` đã có), không import `electron`.
 * Mọi thứ ra ngoài — tải, xin, ghi DB — đi qua `deps`.
 */
import { randomBytes } from 'node:crypto';
import type { Ed25519KeyPair, SyncV2Crypto } from './sync-v2-crypto.js';
import {
  parseControlEvents, pickTempKey, SyncPhase, SyncV2Session,
  type SyncControlEvent, type SyncMobileStatus, type SyncPhaseName, type SyncTempKey,
} from './sync-v2-session.js';
import type { IdResolver, SyncedMessage } from './sync-v2-map.js';
import type { SyncConversation } from './sync-v2-proto.js';
import {
  generateSyncId, partitionOf, SyncDatabaseType, SYNC_MAX_QUERIES_PER_REQUEST,
  SYNC_MAX_TO, SYNC_UNLIMITED_LIMIT,
  type SyncDatabaseName, type SyncQuery, type SyncRequestPayload, type SyncRequestResult,
} from './sync-v2-request.js';
import { SyncReleaseReason } from './dispose-session-ws.js';
import { BATCH_TIMEOUT_MS, WAKE_SESSION_TIMEOUT_MS } from './wake-mobile.js';
import { decodeWsFrameHeader } from './ws-frame.js';
import { unwrapPayload } from './ws-payload.js';

/** Chân dung tối thiểu của `listener` mà lớp này cần. */
export interface SyncSocket {
  ws?: WebSocket;
  /** zca-js đặt khoá phiên ở đây khi nhận `cmd 1/1` — cùng khoá `decodeEventData` dùng. */
  cipherKey?: string;
}

export interface SyncV2ControllerDeps {
  /** Nạp wasm — bất đồng bộ, và chỉ cần khi thật sự mở phiên. */
  crypto: () => Promise<SyncV2Crypto>;
  /** Khoá định danh của PC; đọc từ cache, sinh nếu chưa có. */
  identity: (crypto: SyncV2Crypto) => Ed25519KeyPair;
  ownId: string;
  /** Xem `SyncV2SessionOptions.resolver`: Sync V2 báo người gửi bằng id nhiễu. */
  idResolver?: IdResolver;
  /** IMEI của phiên — `temp_key` chỉ dùng được khi `data.imei` trùng nó. */
  imei: string;
  /** Tên máy hiện trên điện thoại khi hỏi xác nhận. */
  deviceName: string;
  /** Nhận tin đã chuẩn hoá; phía gọi ghi cache rồi phát lên UI. */
  onMessages: (messages: SyncedMessage[]) => void;
  /**
   * Nhận hội thoại của phiên `database: "conversation"`.
   *
   * Phiên hội thoại **không** đẩy tin: `onMessages` không được gọi cho nó. Đây
   * là bước đầu của chuỗi thật của Zalo PC (`sync_conversations`), và việc duy
   * nhất nó làm là cho ta `convId` để dựng `partition`.
   */
  onConversations?: (conversations: SyncConversation[]) => void;
  onPhase?: (phase: SyncPhaseName) => void;
  /** Only after every message partition group has finished successfully. */
  onComplete?: () => void;
  /** Số liệu sau mỗi gói — nguồn của thanh tiến trình giữa hai lần đổi giai đoạn. */
  onStats?: (stats: SyncProgress) => void;
  onStatus?: (status: SyncMobileStatus) => void;
  onDebug?: (event: string, data: Record<string, unknown>) => void;
  /** Thay được để test không cần mạng. */
  download?: (url: string) => Promise<Uint8Array>;
  /**
   * Gửi yêu cầu `cmd 590` trên socket và chờ phản hồi. Bắt buộc: không có nó
   * thì không có phiên nào để mở. Test truyền một hàm giả.
   */
  request: (payload: SyncRequestPayload, reqId: string) => Promise<SyncRequestResult>;
  /**
   * Đánh thức điện thoại (`cmd 592`), gọi **sau** `590` — phiên phải tồn tại
   * trước. Không có thì bỏ qua bước đó: phiên vẫn chạy, nhưng điện thoại không
   * được nhắc nên có thể không đẩy gói nào.
   */
  wake?: (syncId: string) => Promise<SyncRequestResult>;
  /**
   * Giải phóng phiên phía máy chủ (`cmd 591`) khi phiên chạm `DONE`/`FAILED`.
   * Thiếu nó thì phiên vẫn chạy, nhưng mỗi lần bấm đồng bộ lại để lại một phiên
   * mở bên máy chủ — xem `dispose-session-ws.ts`.
   */
  disposeSession?: (
    syncId: string, reason: number,
  ) => Promise<{ ok: true } | { ok: false; code: number | string; message: string }>;
  /** Hội thoại đã biết của tài khoản — nguồn của `partition` cho lần xin tin. */
  knownConversations?: () => SyncConversation[];
  /** Ghi lại hội thoại vừa nhận; `store` lỗi không được làm hỏng phiên. */
  storeConversations?: (conversations: SyncConversation[]) => void;
  /**
   * Nhớ rằng `syncId` vừa được mở, và quên khi nó được giải phóng.
   *
   * Đây là cặp dùng cho lần chạy **sau**: app tắt giữa lúc đồng bộ thì cái dấu
   * còn lại là thứ duy nhất biết phải dội `OutDated` cho phiên nào. Xem
   * `sync-v2-store.ts`.
   */
  rememberOpenSession?: (syncId: string) => void;
  forgetOpenSession?: (syncId: string) => void;
  /** Các phiên còn dấu từ lần chạy trước — đầu vào của `sweepStaleSessions`. */
  listOpenSessions?: () => Array<{ syncId: string; since: number }>;
}

/** Số sự kiện điều khiển giữ lại. `temp_key` sống 600 s; cửa sổ này dư sức. */
const EVENT_BUFFER = 200;

/** Hạn tải một gói — Zalo PC dùng 60 s cho mỗi lần thử. */
const DOWNLOAD_TIMEOUT_MS = 60_000;
const DOWNLOAD_RETRIES = 3;
const DOWNLOAD_RETRY_DELAY_MS = 1_000;

/** Chia danh sách thành các nhóm tối đa `size` phần tử, giữ nguyên thứ tự. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

/** Kết quả mở phiên: `ok`, hoặc lý do từ chối có mã đọc được. */
export type SyncStartResult = SyncRequestResult;

/** Số liệu thanh tiến trình — cùng hình dạng mà IPC gửi lên renderer. */
export interface SyncProgress {
  received: number;
  total: number;
  written: number;
  skipped: number;
}

export class SyncV2Controller {
  private readonly deps: SyncV2ControllerDeps;
  /** Sự kiện điều khiển gần nhất — nguồn của `temp_key`. */
  private events: SyncControlEvent[] = [];
  private session: SyncV2Session | null = null;
  private opening = false;
  /** Số thứ tự phiên trong lần đăng nhập (`Ao.nextIndex`, `CdmT.js:8273`). */
  private ussidx = 0;
  private detachSocket: (() => void) | null = null;
  private disposed = false;

  constructor(deps: SyncV2ControllerDeps) {
    this.deps = deps;
  }

  /**
   * Gắn vào socket của listener đang chạy. Trả hàm tháo gỡ.
   *
   * Gọi lại sẽ tháo lần gắn trước: sau khi kết nối lại, zca-js tạo socket mới
   * và lần gắn cũ trỏ vào socket đã chết — để cả hai cùng sống nghĩa là xử lý
   * mỗi frame hai lần.
   */
  attach(socket: SyncSocket): () => void {
    this.detach();
    const ws = socket.ws;
    if (!ws || typeof ws.addEventListener !== 'function') {
      this.deps.onDebug?.('sync-v2', { ok: false, reason: 'no-socket' });
      return () => undefined;
    }
    const onMessage = (event: MessageEvent): void => {
      const raw: unknown = event.data;
      // `ws` giao `Buffer` (lớp con của `Uint8Array`), không phải `ArrayBuffer`.
      // zca-js cũng kiểm đúng nhánh này (`dist/apis/listen.js:158`).
      const bytes = raw instanceof Uint8Array ? raw
        : raw instanceof ArrayBuffer ? new Uint8Array(raw) : null;
      if (bytes) this.handleFrame(bytes, socket);
    };
    ws.addEventListener('message', onMessage as EventListener);
    const detach = (): void => { ws.removeEventListener('message', onMessage as EventListener); };
    this.detachSocket = detach;
    return () => {
      if (this.detachSocket === detach) this.detachSocket = null;
      detach();
    };
  }

  detach(): void {
    const detach = this.detachSocket;
    this.detachSocket = null;
    detach?.();
  }

  /**
   * Đọc một frame thô: chỉ `cmd 601` mang sự kiện điều khiển.
   *
   * Không ném ra ngoài: socket này dùng chung với zca-js, và một ngoại lệ ở đây
   * làm gãy cả đường tin nhắn. Mọi lỗi thành một dòng chẩn đoán có lý do.
   */
  handleFrame(bytes: Uint8Array, socket: SyncSocket): void {
    const header = decodeWsFrameHeader(bytes);
    if (!header || header.version !== 1 || header.cmd !== 601) return;
    let parsed: unknown;
    try {
      const outer: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(4)));
      const record = (outer && typeof outer === 'object' ? outer : {}) as
        { encrypt?: unknown; data?: unknown };
      const encrypt = typeof record.encrypt === 'number' ? record.encrypt : 0;
      // `encrypt: 0` nghĩa là payload nằm thẳng trong `data` — không giải gì.
      // Các kiểu 1/2/3 đi qua `unwrapPayload`, cùng hàm mà bộ quan sát hình
      // dạng dùng, để chỉ có **một** cách đọc phong bì trong repo.
      parsed = encrypt === 0
        ? (typeof record.data === 'string' ? JSON.parse(record.data) : outer)
        : unwrapPayload(encrypt, String(record.data ?? ''), socket.cipherKey);
    } catch (error) {
      this.deps.onDebug?.('sync-v2', {
        ok: false, reason: 'frame-decode',
        message: error instanceof Error ? error.message.slice(0, 120) : 'unknown',
      });
      return;
    }
    this.accept(parseControlEvents(parsed));
  }

  /** Nhận một lô sự kiện đã chuẩn hoá: cất vào cửa sổ rồi chuyển cho phiên. */
  accept(events: SyncControlEvent[]): void {
    if (events.length === 0) return;
    this.events.push(...events);
    if (this.events.length > EVENT_BUFFER) this.events.splice(0, this.events.length - EVENT_BUFFER);
    this.session?.handleControlEvents(events);
  }

  /** `temp_key` còn sống, hoặc `null` nếu chưa từng thấy khoá dùng được. */
  currentTempKey(now = Date.now()): SyncTempKey | null {
    return pickTempKey(this.events, { imei: this.deps.imei, now });
  }

  get currentPhase(): SyncPhaseName {
    return this.session?.currentPhase ?? SyncPhase.IDLE;
  }

  /**
   * Số liệu để UI vẽ thanh tiến trình.
   *
   * `total` âm nghĩa là "chưa biết" (chỉ biết khi gói `isLast` tới). Ra tới IPC
   * nó phải là `0`: renderer không có ngữ nghĩa cho số âm và sẽ vẽ một thanh
   * rỗng kèm "0/-1".
   */
  get stats(): SyncProgress {
    const stats = this.session?.stats ?? { received: 0, total: -1, written: 0, skipped: 0 };
    return { ...stats, total: Math.max(stats.total, 0) };
  }

  /**
   * Mở một phiên đồng bộ và chờ máy chủ trả lời yêu cầu.
   *
   * **Không có `temp_key` vẫn mở được** — đây là đường đồng bộ **tay**, và Zalo
   * PC đi đúng như vậy: `manualSync` gọi
   * `startManualSync({userSyncSessionId, source, lastSyncConvSuccessTs,
   * fullResyncRound})` với **không** trường `tempKey`, rồi `initNewMachineInfo`
   * làm `this.tempKey = e.tempKey ?? ""`
   * (`lazy/main-startup.89bb530b91927fd5dd28.js`, `compact-app-pc @3867540`).
   * Khoá chỉ bắt buộc ở `autoSyncWhenLogin`, nơi thiếu nó thì Zalo bỏ luôn lần
   * đồng bộ (`"Auto sync when login failed: tempKey is undefined"`).
   *
   * Bản trước của hàm này từ chối với `no-temp-key`, và đó là toàn bộ lý do
   * "đồng bộ thật" không chạy được: cổng ấy do tôi đặt, không phải máy chủ.
   * Tra được khoá trong cửa sổ sự kiện thì vẫn dùng — nó chỉ là đường tốt hơn,
   * không phải điều kiện.
   */
  async start(options: {
    tempKey?: string; queries?: SyncQuery[]; priority?: number;
    /** `"message"` (mặc định) hoặc `"conversation"`. */
    database?: SyncDatabaseName;
  } = {}): Promise<SyncStartResult> {
    if (this.disposed) return { ok: false, code: 'disposed', message: 'controller đã đóng' };
    if (this.opening) return { ok: false, code: 'state', message: 'phiên đang mở' };
    const phase = this.currentPhase;
    if (phase !== SyncPhase.IDLE && phase !== SyncPhase.FAILED && phase !== SyncPhase.DONE) {
      return { ok: false, code: 'state', message: `phiên đang ${phase}` };
    }

    const found = this.currentTempKey()?.tempKey;
    const tempKey = options.tempKey ?? found ?? '';
    // Ghi lại **nguồn** của khoá: `''` vì chưa từng thấy sự kiện
    // `transfer_after_login`, khác hẳn `''` vì người gọi truyền vào. Không có
    // dòng này thì hai nguyên nhân rất khác nhau đọc ra giống hệt nhau trong
    // log, và đó là kiểu nhầm đã tốn ba vòng đo ở đây rồi.
    this.deps.onDebug?.('sync-v2', {
      ok: true, step: 'start',
      tempKeySource: found ? 'event' : options.tempKey !== undefined ? 'caller' : 'empty',
      tempKeyChars: tempKey.length,
      database: options.database ?? SyncDatabaseType.MESSAGE,
    });

    this.opening = true;
    try {
      return await this.openSession(tempKey, options);
    } finally {
      this.opening = false;
    }
  }

  /**
   * Chạy chuỗi hai bước của Zalo PC: **hội thoại trước, tin sau**.
   *
   * Đây là thứ tự bắt buộc, không phải tuỳ chọn. `partition` của một gói tin là
   * `oneone/<globalNoisedId>` hoặc `group/<globalNoisedId>` —
   * `globalNoisedId` chính là `convId` mà bước hội thoại trả về (R16 §3, đọc từ
   * `normalizeConversations`). Xin tin trước khi biết id thì ta phải tự bịa
   * `partition`, và mọi `("message", "")` đã thử trước R17 đều không có gói nào.
   *
   * Bước hội thoại hỏng **không** chặn bước tin nếu đã có danh sách từ lần
   * trước: danh sách hội thoại không phải dữ liệu người dùng, nó là chỉ mục.
   * Nhưng nếu chưa có gì để xin thì dừng — chạy tiếp chỉ tạo một phiên mở nữa,
   * đúng thứ vừa sửa xong.
   */
  async syncAll(options: { tempKey?: string; priority?: number } = {}): Promise<SyncStartResult> {
    const known = this.deps.knownConversations?.() ?? [];
    if (known.length === 0) {
      this.deps.onDebug?.('sync-v2', { ok: true, step: 'conversations-first' });
      const conversationStart = await this.start({
        ...options,
        database: SyncDatabaseType.CONVERSATION,
        // `createConversationQuery` của Zalo PC: `partition ""`, `limit: yo.a`
        // (vô hạn), `to: Number.MAX_SAFE_INTEGER`. Không có `partition` ở đây là
        // đúng — hội thoại là database phẳng, không chia hội thoại con.
        queries: [{ partition: '', from: 0, to: SYNC_MAX_TO, limit: SYNC_UNLIMITED_LIMIT }],
      });
      if (!conversationStart.ok) return conversationStart;
      const session = this.session;
      if (!session) return { ok: false, code: 'state', message: 'phiên hội thoại không mở được' };
      await session.drain();
      await session.settled;
      if (this.disposed) return { ok: false, code: 'disposed', message: 'controller đã đóng' };
    }

    const conversations = this.deps.knownConversations?.() ?? [];
    if (conversations.length === 0) {
      this.deps.onDebug?.('sync-v2', { ok: false, reason: 'no-conversations' });
      return { ok: false, code: 'no-conversations', message: 'chưa lấy được danh sách hội thoại' };
    }

    // Mỗi hội thoại một `partition`, và **tối đa 30 partition mỗi yêu cầu** —
    // `buildPrepareQuery` của Zalo PC chia đúng như vậy, mỗi nhóm thành một
    // `590` riêng, các nhóm chạy tuần tự. Xem `SYNC_MAX_QUERIES_PER_REQUEST`:
    // gửi cả 363 trong một khung làm máy chủ đóng kết nối `1009` mà không kèm
    // lời từ chối nào.
    const queries = conversations.map(item => ({
      // `convType` của `Sync2.Conversation.ConvType`: `CONV_TYPE_GROUP = 2`,
      // `CONV_TYPE_ONEONE = 1`. Dùng số chứ không đoán từ tiền tố id — id nhóm
      // bắt đầu bằng `g` là quy ước của Zalo PC, không phải hợp đồng.
      partition: partitionOf(item.convType === 2, item.convId),
      from: 0,
      to: SYNC_MAX_TO,
      limit: SYNC_UNLIMITED_LIMIT,
    }));

    const groups = chunk(queries, SYNC_MAX_QUERIES_PER_REQUEST);
    this.deps.onDebug?.('sync-v2', {
      ok: true, step: 'message-groups', conversations: queries.length, groups: groups.length,
    });

    // Nhóm đầu **báo kết quả** cho người gọi — cùng hợp đồng với bản một-nhóm
    // trước đây: `syncAll` trả về khi yêu cầu đầu tiên đã được máy chủ nhận,
    // không chờ hết dữ liệu. Các nhóm sau nối tiếp trong nền, mỗi nhóm mở khi
    // nhóm trước đã chạm trạng thái cuối (Zalo PC cũng chạy tuần tự).
    const first = await this.start({ ...options, queries: groups[0] });
    if (!first.ok) return first;
    void this.runRemainingGroups(groups.slice(1), options, first);
    return first;
  }

  /**
   * Chạy các nhóm `partition` còn lại, tuần tự.
   *
   * Lỗi giữa chừng **không** bị ném và không huỷ dữ liệu đã nhận: mất một nhóm
   * là mất lịch sử của 30 hội thoại, còn ném thì mất cả phần đã có.
   */
  private async runRemainingGroups(
    groups: SyncQuery[][],
    options: { tempKey?: string; priority?: number },
    fallback: SyncStartResult,
  ): Promise<void> {
    for (let index = 0; index < groups.length; index += 1) {
      const phase = await this.waitForSession();
      if (this.disposed) return;
      // Phiên trước **hỏng** thì dừng cả chuỗi, không chỉ dừng nhóm đó.
      //
      // Đo 2026-11-10 14:14–14:23: điện thoại không phản hồi, nên cả 13 nhóm
      // lần lượt treo đủ 180 s rồi bỏ — 36 phút chờ cho một phiên đã biết là
      // chết. Lý do hỏng (mất kết nối, phiên cũ treo trên máy chủ) là điều kiện
      // chung của cả chuỗi, không phải của riêng một nhóm: nhóm sau mở phiên mới
      // trên cùng một kết nối, cùng một máy chủ, cùng một điện thoại.
      //
      // Khác với `start()` trả `ok:false` — đó là máy chủ **từ chối ngay**; còn
      // đây là phiên mở được rồi im lặng. Cả hai đều không có gì để chờ tiếp.
      if (phase === 'failed') {
        this.deps.onDebug?.('sync-v2', {
          ok: false, reason: 'message-group-aborted', group: index + 1, groups: groups.length + 1,
        });
        return;
      }
      const started = await this.start({ ...options, queries: groups[index] });
      if (!started.ok) {
        this.deps.onDebug?.('sync-v2', {
          ok: false, reason: 'message-group-failed', group: index + 1, code: started.code,
        });
        // Nhóm hỏng vì phiên trước chưa đóng được thì các nhóm sau cũng thế;
        // dừng thay vì để lại một chuỗi `no-reply` trong log.
        return;
      }
    }
    const finalPhase = await this.waitForSession();
    if (this.disposed || finalPhase !== SyncPhase.DONE) return;
    this.deps.onComplete?.();
    this.deps.onDebug?.('sync-v2', {
      ok: true, step: 'message-groups-done', groups: groups.length + 1,
      firstOk: fallback.ok,
    });
  }

  /**
   * Chờ phiên hiện tại chạm trạng thái cuối và trả về trạng thái đó.
   *
   * Không có phiên thì trả `null` — không phải `'done'`: "không có gì để chờ"
   * và "chờ xong tốt đẹp" là hai chuyện khác nhau với người gọi.
   */
  private async waitForSession(): Promise<string | null> {
    const session = this.session;
    if (!session) return null;
    await session.drain();
    const phase = await session.settled;
    // Chờ `591` xong mới trả về: mở phiên kế tiếp khi phiên trước **chưa đóng
    // trên máy chủ** là mở hai phiên cùng lúc, và máy chủ đáp bằng đóng socket
    // (`1006`). Đo 14:26:28: `start` nhóm 4 cách `done` nhóm 3 đúng 0 ms,
    // socket đóng 11 ms sau, nhóm 4 mất hẳn.
    await session.closed;
    return phase;
  }

  private async openSession(
    tempKey: string,
    options: {
      queries?: SyncQuery[]; priority?: number; database?: SyncDatabaseName;
    },
  ): Promise<SyncStartResult> {
    let crypto: SyncV2Crypto;
    try {
      crypto = await this.deps.crypto();
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 160) : 'unknown';
      this.deps.onDebug?.('sync-v2', { ok: false, reason: 'wasm', message });
      return { ok: false, code: 'wasm', message };
    }
    if (this.disposed) return { ok: false, code: 'disposed', message: 'controller đã đóng' };

    const session = new SyncV2Session({
      crypto,
      request: this.deps.request,
      ...(this.deps.wake ? { wake: this.deps.wake } : {}),
      ...(this.deps.disposeSession
        // Bọc bằng arrow, **không** truyền `this.releaseServer` trần: phiên gọi
        // nó dưới dạng `this.deps.disposeSession(...)`, tức mất `this`, và mọi
        // lần `591` sẽ ném `Cannot read properties of undefined (reading 'deps')`
        // — đúng lỗi mà test `dispose controller` bắt được. Hậu quả trên bản
        // chạy thật: `591` không bao giờ tới máy chủ, phiên cũ để lại.
        ? { disposeSession: (syncId: string, reason: number) => this.releaseServer(syncId, reason) }
        : {}),
      download: this.deps.download ?? (url => this.download(url)),
      onMessages: this.deps.onMessages,
      ...(this.deps.onConversations ? { onConversations: this.deps.onConversations } : {}),
      onStatus: this.deps.onStatus,
      onPhase: (next) => {
        this.deps.onPhase?.(next);
        this.deps.onDebug?.('sync-v2', { phase: next, ...this.stats });
      },
      onProgress: () => { this.deps.onStats?.(this.stats); },
      onDebug: this.deps.onDebug,
    }, {
      ownId: this.deps.ownId,
      resolver: this.deps.idResolver,
      syncId: generateSyncId(size => new Uint8Array(randomBytes(size))),
      tempKey,
      deviceName: this.deps.deviceName,
      identity: this.deps.identity(crypto),
      // Khoá tạm **sinh mới mỗi phiên**: nó chỉ cần sống bằng phiên này.
      ephemeral: crypto.generateKeyPair(),
      ussidx: this.ussidx,
      database: options.database ?? SyncDatabaseType.MESSAGE,
      queries: options.queries,
      priority: options.priority,
      // 180 s — `wakeupTimeout: 18e4` của Zalo PC. Phiên phải chạm trạng thái
      // cuối để `591` được gửi, kể cả khi máy chủ không đẩy gói nào.
      wakeupTimeoutMs: WAKE_SESSION_TIMEOUT_MS,
      // 10 s — `batchTimeout: 1e4`, hạn giữa hai gói một khi dòng đã chảy.
      batchTimeoutMs: BATCH_TIMEOUT_MS,
    });

    this.session = session;
    this.ussidx += 1;
    // Nhớ phiên **trước** khi gửi: nếu app chết trong lúc `590` đang bay, dấu
    // này là thứ duy nhất cho lần chạy sau biết có một phiên mở.
    this.deps.rememberOpenSession?.(session.syncId);
    const started = await session.start(`sync_${session.syncId}`);
    if (!started.ok) {
      // `590` bị từ chối: không có phiên nào bên máy chủ để dọn.
      this.deps.forgetOpenSession?.(session.syncId);
    }
    return started;
  }

  /**
   * Chuyển `591` xuống máy chủ rồi xoá dấu phiên.
   *
   * Bọc `deps.disposeSession` thay vì truyền thẳng: dấu phiên phải được xoá khi
   * và chỉ khi phiên đã chạm trạng thái cuối, và đó là cùng một sự kiện.
   */
  private async releaseServer(
    syncId: string, reason: number,
  ): Promise<{ ok: true } | { ok: false; code: number | string; message: string }> {
    const dispose = this.deps.disposeSession;
    if (!dispose) return { ok: true };
    try {
      return await dispose(syncId, reason);
    } finally {
      this.deps.forgetOpenSession?.(syncId);
    }
  }

  /**
   * Dội `OutDated` cho mọi phiên còn dấu từ lần chạy trước.
   *
   * Tương đương `SessionManager.cleanOldSyncSession` của Zalo PC. Gọi **một
   * lần** sau khi socket sống, trước lần đồng bộ đầu tiên. Không chặn gì: mỗi
   * phiên là một `591` độc lập, và lỗi của một cái không ảnh hưởng cái khác.
   *
   * Phiên của **chính lần chạy này** không nằm trong danh sách khi hàm được gọi
   * đúng lúc gắn socket — trước `start()` đầu tiên.
   */
  async sweepStaleSessions(): Promise<number> {
    const stale = this.deps.listOpenSessions?.() ?? [];
    if (stale.length === 0) return 0;
    const dispose = this.deps.disposeSession;
    this.deps.onDebug?.('sync-v2', { ok: true, step: 'sweep', stale: stale.length });
    let swept = 0;
    for (const item of stale) {
      // Dấu bị xoá trước khi gửi: dù `591` hỏng, lần chạy sau không được thử lại
      // mãi một phiên đã chết — nó chỉ làm chậm khởi động mà không thêm thông tin.
      this.deps.forgetOpenSession?.(item.syncId);
      if (!dispose) continue;
      const ageMs = item.since > 0 ? Date.now() - item.since : null;
      try {
        const result = await dispose(item.syncId, SyncReleaseReason.OUT_DATED);
        this.deps.onDebug?.('sync-v2', result.ok
          ? { ok: true, step: 'session-outdated', reason: SyncReleaseReason.OUT_DATED, ageMs }
          : { ok: false, step: 'session-outdated-failed', reason: SyncReleaseReason.OUT_DATED, code: result.code, ageMs });
        if (result.ok) swept += 1;
      } catch (error) {
        this.deps.onDebug?.('sync-v2', {
          ok: false, step: 'session-outdated-threw',
          message: error instanceof Error ? error.message.slice(0, 120) : 'unknown', ageMs,
        });
      }
    }
    return swept;
  }

  /** Chờ gói cuối chạy xong tải và giải. Chỉ trả về khi phiên kết thúc hẳn. */
  async drain(): Promise<void> {
    await this.session?.drain();
  }

  dispose(): void {
    this.disposed = true;
    this.detach();
    this.session?.cancel();
    this.session = null;
  }

  /**
   * Tải một gói.
   *
   * Không cookie, không header: `msgUrl` đã ký sẵn (`executeDownload` của Zalo
   * PC gọi `fetch(url, { keepalive: true })` trần). Thử lại vì một gói hỏng làm
   * mất cả một khoảng lịch sử — chứ không phải một tin.
   */
  private async download(url: string): Promise<Uint8Array> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < DOWNLOAD_RETRIES; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
      try {
        const response = await fetch(url, { signal: controller.signal, keepalive: true });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
      } catch (error) {
        lastError = error;
        if (attempt + 1 < DOWNLOAD_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, DOWNLOAD_RETRY_DELAY_MS));
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError instanceof Error ? lastError : new Error('tải gói thất bại');
  }
}
