import { parseAvatarUrl } from '../avatars.js';
import { registerCallSignaling, type CallSignal } from './call-signaling.js';
import { watchCallControls } from '../calls/control.js';
import { hostname } from 'node:os';
import {
  CloseReason, LoginQRCallbackEventType, Reactions, ThreadType, Zalo, ZaloApiError,
  type API, type Message as ZaloMessage, type Reaction, type SendSeenEventMessageParams,
  type TMessage, type Undo,
} from 'zca-js';
import type {
  CatchUpProgress, LiveConnection, LiveMessage, LiveMessagePage, LiveThread, LoginState, SendRequest, SendResult, ThreadKind,
} from '../ipc-contract.js';
import {
  applyMessage, buildThreadsWithIds, stickerContentOf, toLiveMessage,
  type BuiltThreads, type RawGroupInfo, type RawGroupMember, type RawMessage, type RawUser,
} from './mapper.js';
import { fetchCloudHistory, type CloudHistoryPage } from './cloud-history.js';
import { probePullMobileMsg, generateSyncPublicKey } from './phone-sync-probe.js';
import { decodeWsFrameHeader, describeWsFrameBody } from './ws-frame.js';
import { describeWsEndpoints } from './ws-endpoints.js';
import { describeDecodedPayload, unwrapPayload } from './ws-payload.js';
import {
  buildWakeMobileFrame, parseWakeReply, WAKE_REPLY_TIMEOUT_MS, type WakeReply,
} from './wake-mobile.js';
import {
  buildRequestSyncFrame, parseRequestSyncReply, RequestSyncCmd,
  REQUEST_SYNC_REPLY_TIMEOUT_MS, type RequestSyncReply,
} from './request-sync-ws.js';
import type { SyncRequestPayload, SyncRequestResult } from './sync-v2-request.js';
import {
  buildDisposeSessionFrame, DisposeSessionCmd, DISPOSE_REPLY_TIMEOUT_MS,
  parseDisposeSessionReply, type DisposeSessionReply,
} from './dispose-session-ws.js';
import { withDeadline } from './deadline.js';
import type { SavedSession, SessionStore } from './session.js';
import { createThrottle } from './throttle.js';
import type { Db } from '../db/schema.js';
import { SyncV2Controller } from './sync-v2-controller.js';
import { loadIdentity } from './sync-v2-identity.js';
import {
  forgetOpenSession, listOpenSessions, loadConversations, mergeConversations, rememberOpenSession,
  hasCompletedPhoneSync, isPhoneSyncSetupRequired, markPhoneSyncComplete,
} from './sync-v2-store.js';
import type { SyncPhaseName } from './sync-v2-session.js';
import type { SyncStartResult } from './sync-v2-controller.js';
import { isServerMsgId, type SyncedMessage } from './sync-v2-map.js';
import {
  compareMsgId, insertPending, listThreads, markFailed, markRecalled, messageAttachments,
  messageCliId, messageReactions, pageMessages, readCatchUpCursor, setMessageMedia, setMessageReactions,
  setThreadAvatar, updateMessageSenderNames, upsertMessages, upsertThreads, writeCatchUpCursor, writeSyncState,
  type StoreMessage,
} from '../db/messages.js';
import { applyReaction, isRemoval, type ReactionAction } from './reactions.js';
import { recalledTarget, type UndoPayload } from './undo.js';
import { consolidateNoisedThreads } from '../db/consolidate.js';
import { previewOfMessage, toIpcMessage } from './attachment.js';
import { mediaJobsOf, parseMediaUrl, type MediaJob } from '../media.js';

/**
 * Trần số id thu hồi còn nhớ khi tin gốc chưa về. Một phiên có thể nhận hàng trăm
 * sự kiện thu hồi của tin chưa tải; không có trần thì đây là chỗ phình RAM duy
 * nhất của cả lớp này. Chạm trần thì bỏ mục **cũ nhất** — tin đó khó có khả năng
 * được tải về hơn tin vừa thu hồi.
 */
const RECALLED_IDS_MAX = 5000;
const PENDING_REACTIONS_MAX = 5000;

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function reactionContentOf(value: unknown): Record<string, unknown> | null {
  let content = value;
  if (typeof content === 'string') {
    try {
      content = JSON.parse(content) as unknown;
    } catch {
      return null;
    }
  }
  return objectRecord(content);
}

type GlobalIdLookup = (globalIds: string[]) => Promise<Record<string, string>>;
type GlobalIdLookupApi = API & {
  __glassGetUserIdsFromGlobalIds: GlobalIdLookup;
};

function registerGlobalIdLookup(client: API): GlobalIdLookup | null {
  const methodName = '__glassGetUserIdsFromGlobalIds';
  const profileUrl = client.zpwServiceMap.profile?.[0];
  if (!profileUrl) return null;

  if (!Object.hasOwn(client, methodName)) {
    client.custom<Record<string, string>, string[]>(methodName, async ({ utils, props }) => {
      const encryptedParams = utils.encodeAES(JSON.stringify({
        globalUids: JSON.stringify(props),
      }));
      if (!encryptedParams) throw new ZaloApiError('Failed to encrypt global ID lookup');
      const response = await utils.request(
        utils.makeURL(`${profileUrl.replace(/\/$/, '')}/api/gid/decrypt`, {
          params: encryptedParams,
        }),
        { method: 'GET' },
      );
      return utils.resolve(response, result => {
        const data = objectRecord(result.data);
        if (!data) return {};
        const requested = new Set(props);
        const resolved: Record<string, string> = {};
        for (const [globalId, userId] of Object.entries(data)) {
          if (requested.has(globalId) && typeof userId === 'string' && userId.length > 0) {
            resolved[globalId] = userId;
          }
        }
        return resolved;
      });
    });
  }

  return (client as GlobalIdLookupApi)[methodName].bind(client);
}

type GroupMemberInfoLookup = (groupId: string) => Promise<Record<string, unknown> | null>;
type GroupMemberInfoLookupApi = API & {
  __glassGetGroupInfoForAvatars: GroupMemberInfoLookup;
};

function registerGroupMemberInfoLookup(client: API): GroupMemberInfoLookup | null {
  const methodName = '__glassGetGroupInfoForAvatars';
  const groupUrl = client.zpwServiceMap.group?.[0];
  if (!groupUrl) return null;

  if (!Object.hasOwn(client, methodName)) {
    client.custom<Record<string, unknown> | null, string>(methodName, async ({ utils, props }) => {
      const encryptedParams = utils.encodeAES(JSON.stringify({
        grid: props.replace(/^g/, ''),
        avatar_size: 100,
        member_avatar_size: 100,
      }));
      if (!encryptedParams) throw new ZaloApiError('Failed to encrypt group member lookup');
      const response = await utils.request(
        utils.makeURL(`${groupUrl.replace(/\/$/, '')}/api/group/getgi`, { params: encryptedParams }),
        { method: 'GET' },
      );
      return utils.resolve(response, result => objectRecord(result.data));
    });
  }

  return (client as GroupMemberInfoLookupApi)[methodName].bind(client);
}

/**
 * Lớp protocol: **nơi duy nhất** trong repo được `import 'zca-js'`.
 *
 * Ranh giới (ADR-004 mục 4): không cookie, IMEI, userAgent, cipher_key hay token
 * nào rời khỏi file/dir này. Mọi thứ đi lên là `LiveThread`/`LiveMessage` đã map.
 *
 * `zca-js` là API không chính thức, không liên kết với Zalo: chạy được hay không
 * phụ thuộc server Zalo, và dùng nó có thể khiến tài khoản bị khóa.
 */
export interface ZaloEvents {
  callControl?(data: Record<string, unknown>): void;
  login(state: LoginState): void;
  connection(state: LiveConnection): void;
  catchUp?(progress: CatchUpProgress): void;
  message(message: LiveMessage): void;
  thread(thread: LiveThread): void;
  /** Tiến trình đồng bộ lịch sử từ điện thoại; chỉ trạng thái, không nội dung. */
  sync?(phase: SyncPhaseName, stats: SyncProgress): void;
  /**
   * Một hội thoại có URL avatar từ xa. Main tải về đĩa rồi mới phát `thread` với
   * đường dẫn cục bộ, nên URL của Zalo không bao giờ đi tới renderer.
   *
   * `current` là tên file avatar **đã có** theo DB (đọc từ `threads.avatar_url`
   * lúc khôi phục cache). Có nó thì lần mở app thứ hai không tải lại ảnh đã nằm
   * trên đĩa; thiếu nó là 238 lời gọi ra CDN ở mỗi lần khởi động.
   */
  avatar?(threadId: string, remote: string, current: string | null): void;
  /**
   * Một tệp đính kèm vừa có nội dung trên đĩa.
   *
   * Tách khỏi `message` vì thời điểm khác hẳn: `message` phát ngay khi tin tới,
   * còn tệp về sau (mạng chậm hơn, ảnh lớn hơn). Cùng một `msgId` có thể được
   * phát nhiều lần **chỉ** để điền `src`/`thumb` — renderer cập nhật tại chỗ,
   * không được tạo bong bóng thứ hai.
   */
  media?(message: LiveMessage): void;
  /** Chẩn đoán listener; chỉ metadata, không nội dung tin, không token. */
  debug?(event: string, data: Record<string, unknown>): void;
}

/** Số liệu một lần đồng bộ — đủ cho thanh tiến trình, không đủ để dựng lại tin. */
export interface SyncProgress {
  phoneSyncComplete?: boolean;
  received: number;
  /** `-1` cho tới khi gói `isLast` tới — lúc đó mới biết tổng số gói. */
  total: number;
  written: number;
  skipped: number;
}

/**
 * Cache cục bộ (plan §6). Không bắt buộc: `createZaloClient` cũ không truyền
 * gì và mọi hành vi cũ giữ nguyên. Có `cache` thì danh sách hội thoại và lịch
 * sử trả về **từ DB**, và tin đến/gửi đi được ghi vào DB trước khi phát lên UI.
 *
 * `ownId` lấy từ `getOwnId()` của zca-js, không phải tự đặt: mỗi tài khoản phải
 * có một file DB riêng (plan §6.10).
 */
export interface CacheOptions {
  /** Mở DB của một tài khoản. Trả `null` khi không mở được (đĩa đầy, quyền). */
  open(ownId: string): Db | null;
}

/**
 * Phần của `Zalo` mà lớp này thật sự dùng. Chỉ hai hàm `login`/`loginQR` tạo ra
 * `API`; mọi thứ sau đó đi qua `API` đã có.
 */
export type Connector = Pick<Zalo, 'login' | 'loginQR'>;

export interface ClientOptions {
  /** Có cache thì danh sách hội thoại và lịch sử được giữ qua các lần mở app. */
  cache?: CacheOptions;
  /**
   * Thay cho `new Zalo(...)`. Đây là chỗ `FakeZaloClient` bơm vào (plan §12), và
   * cũng là cách kiểm chứng phần nối DB mà không cần tài khoản thật.
   */
  connect?: () => Connector;
}

export interface ZaloClient {
  callSignal(signal: CallSignal): Promise<unknown>;
  callPeer(id: string): { id: string; name: string } | null;
  login(): Promise<void>;
  logout(): Promise<void>;
  /** Dừng listener mà **không** xoá phiên: dùng khi thoát app để lần sau còn khôi phục. */
  dispose(): void;
  reconnect(): void;
  listConversations(): Promise<LiveThread[]>;
  getMessages(threadId: string, kind: ThreadKind, before?: string): Promise<LiveMessagePage>;
  send(request: SendRequest): Promise<SendResult>;
  markRead(threadId: string, kind: ThreadKind): Promise<void>;
  /**
   * Ghim / bỏ ghim một hội thoại.
   *
   * Danh sách ghim của Zalo là **trạng thái trên máy chủ**, không phải một cờ
   * cục bộ: ghim ở đây thì Zalo trên điện thoại cũng ghim, và ngược lại. Vì vậy
   * hàm báo lỗi thay vì sửa im lặng trong RAM — một cái ghim chỉ có trên màn
   * hình này là một lời nói dối.
   */
  setPinned(threadId: string, kind: ThreadKind, pinned: boolean): Promise<boolean>;
  /**
   * Đánh dấu chưa đọc, hoặc bỏ dấu. Cũng là trạng thái máy chủ (Zalo PC hiện
   * chấm xanh ở chính hội thoại đó trên mọi thiết bị).
   */
  setUnread(threadId: string, kind: ThreadKind, unread: boolean): Promise<boolean>;
  /**
   * Thả một cảm xúc lên tin, hoặc gỡ cảm xúc đang có (`icon: ''`).
   *
   * Cũng là trạng thái máy chủ, và cùng nguyên tắc với `setPinned`: trả `false`
   * khi Zalo từ chối, để renderer trả lại trạng thái cũ thay vì giữ một cảm xúc
   * chỉ có trên màn hình này. Kết quả thật (kể cả người khác thả cùng lúc) về
   * qua sự kiện `reaction`.
   */
  react(threadId: string, kind: ThreadKind, msgId: string, icon: string): Promise<boolean>;
  /**
   * Thu hồi một tin **của mình**. Như mọi thao tác khác ở đây, đây là trạng
   * thái máy chủ: trả `false` khi Zalo từ chối (quá hạn 24 giờ, không phải tin
   * của mình, mất mạng), và khi đó renderer phải trả lại bong bóng thay vì giữ
   * một tin đã biến mất chỉ trên màn hình này.
   *
   * Trạng thái thật về qua sự kiện `undo` — cùng đường với tin người khác thu
   * hồi — nên chỗ gọi **không** sửa DB ở đây.
   */
  recall(threadId: string, kind: ThreadKind, msgId: string): Promise<boolean>;
  /**
   * Chuyển tiếp một tin nhắn đến một hội thoại.
   */
  forward(threadId: string, kind: ThreadKind, text: string, msgId?: string, ts?: number): Promise<boolean>;
  /**
   * Main đã ghi một avatar xuống đĩa: cập nhật hội thoại trong RAM, phát
   * `thread`, và ghi đường dẫn vào DB. `fileName` là tên file trong thư mục
   * avatar — không phải URL của Zalo, và không bao giờ đi ngược vào lớp này.
   */
  setAvatar(threadId: string, fileName: string | null): void;
  /**
   * Main đã tải xong một tệp đính kèm: ghi đường dẫn cục bộ vào DB rồi phát lại
   * tin qua `events.media`. `patches` ánh xạ chỉ số tệp → đường dẫn đã có.
   *
   * Chỉ số chứ không phải so khớp URL: thứ tự `attaches` của một tin là cố định,
   * còn URL có thể đổi mỗi lần máy chủ ký lại liên kết.
   */
  setMedia(threadId: string, msgId: string, kind: ThreadKind,
    patches: ReadonlyMap<number, { src: string | null; thumb: string | null; failed?: boolean }>): void;
  /**
   * Việc tải tệp còn thiếu của **một** tin, đọc từ DB.
   *
   * Tồn tại vì payload IPC đã bị bóc URL (xem `attachment.toIpcMessage`): main
   * thấy tin trên đường phát nhưng không còn URL để tải. DB là nơi duy nhất còn
   * `remote`, nên việc lập danh sách phải quay lại đó — và phải làm ngay sau khi
   * `persist` đã ghi hàng.
   */
  mediaJobs(threadId: string, msgId: string, kind: ThreadKind):
    Promise<(MediaJob & { kindOfThread: ThreadKind })[]>;
  setActiveThread(threadId: string | null): void;
  /**
   * Xin điện thoại đẩy toàn bộ lịch sử cũ (`transfer_sync2`, Sync V2).
   *
   * Kết quả chỉ nói **yêu cầu** có được nhận không; tin về sau qua
   * `events.sync`/`events.message`. Đây là đường **tay**, nên không đòi
   * `temp_key`: Zalo PC cũng không đòi ở đường tay (`manualSync` gọi
   * `startManualSync` không có trường `tempKey`, và `initNewMachineInfo` biến
   * thiếu thành `""`). Thấy sự kiện `transfer_after_login` thì khoá đó được
   * dùng; không thấy thì gửi với chuỗi rỗng.
   */
  syncFromPhone(): Promise<SyncStartResult>;
  /** Giai đoạn hiện tại của lần đồng bộ — cho UI biết đang chờ hay đang nhận. */
  syncPhase(): SyncPhaseName;
}

const LANGUAGE = 'vi';
const QR_RETRY_LIMIT = 2;
const QR_RETRY_MS = 1500;
const BACKOFF_START_MS = 2000;
const BACKOFF_MAX_MS = 60000;
/**
 * Hạn cho một lần khôi phục phiên cũ.
 *
 * `fetch` của Node không có hạn thời gian, và zca-js gọi nó trực tiếp qua
 * `ctx.options.polyfill`. Một kết nối treo giữa handshake làm `login()` không bao
 * giờ trả về — không ngoại lệ, không log, chỉ là nút đăng nhập đứng im. Đo trên
 * máy này (2026-11-09): khôi phục bình thường mất khoảng 10 giây ở lần đầu, dưới
 * 1 giây khi phiên đã ấm. 30 giây là ba lần biên rộng nhất đã thấy, đủ để không
 * cắt nhầm một lần chậm thật, và vẫn ngắn hơn nhiều so với "treo vô hạn".
 */
const LOGIN_TIMEOUT_MS = 30_000;
/**
 * Hạn cho **toàn bộ** luồng QR, tính từ lúc người dùng bấm.
 *
 * zca-js tự sinh lại mã QR tối đa `QR_RETRY_LIMIT` lần, mỗi mã sống 100 giây,
 * nên một người dùng bình thường có khoảng 300 giây để quét. Cộng thêm biên cho
 * lần chờ xác nhận, 360 giây là trần hợp lý: đủ rộng để không cắt ngang một
 * người đang thật sự quét, và vẫn có điểm dừng nếu một lần poll bị treo.
 */
const LOGIN_FLOW_TIMEOUT_MS = 360_000;
/** Số tin mỗi trang lịch sử nhóm, và trần một lần xin (API nhóm chỉ nhận `count`). */
const HISTORY_PAGE = 50;
const HISTORY_PAGE_MAX = 500;
/**
 * Số vòng xin cho hội thoại 1-1. Một trang `cmd 510` trộn tin của mọi hội thoại,
 * nên hội thoại hiếm khi nói có thể không xuất hiện trong trang đầu.
 */
const HISTORY_ROUNDS = 3;
/**
 * `requestOldMessages` chỉ đẩy dữ liệu qua listener, không trả Promise, nên phải
 * chờ `old_messages` với hạn giờ. Hết hạn **không** được coi là "hết lịch sử":
 * xem `fetchUserHistory`.
 */
const HISTORY_TIMEOUT_MS = 5000;

const threadType = (kind: ThreadKind): ThreadType =>
  kind === 'group' ? ThreadType.Group : ThreadType.User;

const kindOf = (type: ThreadType): ThreadKind => type === ThreadType.Group ? 'group' : 'user';

/**
 * `msgId` của Zalo là chuỗi số dài, tăng dần theo thời gian. So sánh bằng
 * `Number` làm tròn mất chữ số cuối, nên phải dùng `BigInt`; id không phải số
 * thì coi như không so được.
 *
 * Kiểm `isServerMsgId` **trước** nhánh `!current`: bản trước trả `true` khi con
 * trỏ còn `null` mà không hề thử `BigInt`, nên **id không phải số đầu tiên là
 * lọt thẳng vào con trỏ** — đúng đường mà khoá cục bộ đi vào `cmd 510`.
 */
const olderMsgId = (candidate: string | null, current: string | null): boolean => {
  if (!isServerMsgId(candidate)) return false;
  if (!current) return true;
  try { return BigInt(candidate) < BigInt(current); }
  catch { return false; }
};

/** Một lần đóng kết nối do bị thay thế: không được tự kết nối lại (plan §5.5). */
const isReplaced = (code: number): boolean =>
  code === CloseReason.DuplicateConnection || code === CloseReason.KickConnection;

/** Lỗi mạng tạm thời thì thử lại; lỗi xác thực phải quét QR lại (plan §5.3). */
function isRetryable(error: unknown): boolean {
  if (error instanceof ZaloApiError) {
    const code = error.code;
    if (code === null || code === undefined) return false;
    return code === 0 || code >= 500 || code === -1 || code === -2;
  }
  return true;
}

/**
 * Chặn một promise bằng hạn thời gian, để một kết nối treo không giữ UI đứng im.
 *
 * Không huỷ được việc đang chạy bên dưới — `fetch` của Node không nhận
 * `AbortSignal` qua đường zca-js. Nhưng điều cần là **trả lại quyền điều khiển**:
 * người dùng thấy một lỗi và bấm lại được, thay vì một nút bấm không có phản hồi.
 * Cài đặt nằm ở `deadline.ts` để test được mà không phải nạp `zca-js`.
 */

/**
 * Lời hứa lịch sử đang chờ `old_messages`. Sự kiện này **không** mang `threadId`
 * và không phân biệt hội thoại, nên chỉ một yêu cầu được bay tại một thời điểm.
 */
interface HistoryWaiter {
  settle(messages: ZaloMessage[]): void;
}

interface CatchUpWaiter {
  type: ThreadType;
  settle(messages: ZaloMessage[] | null): void;
}

/**
 * Phần phiên cần cho một request cloud. Chỉ tồn tại trong tiến trình main và
 * không bao giờ đi lên renderer (ADR-004 mục 4).
 */
interface CloudSession {
  baseUrl: string;
  imei: string;
  secretKey: string;
  cookie: string;
  userAgent: string;
  apiVersion: number;
  apiType: number;
  /**
   * `zpw_service_map_v3.file[0]` — domain của `/api/message/*`, tức họ mà
   * `pull_mobile_msg` thuộc về. `null` nghĩa là service map của phiên này không
   * có mục `file`, và khi đó phép đo phải nói đúng thế thay vì đoán một domain.
   */
  fileBaseUrl: string | null;
  /** Mọi domain của họ `file`; mục đầu là domain chính. Rỗng nếu service map thiếu. */
  fileBaseUrls: string[];
  /**
   * Cookie cho **host file**, không phải host cloud. `ctx.cookie` là
   * `tough-cookie` Jar và `getCookieStringSync(url)` chỉ trả cookie khớp đúng
   * URL truyền vào: `zpw_sek` đặt trên `tt-files-wpa…` không tự đi sang
   * `tt-group-cm…` và ngược lại. Dùng nhầm chuỗi thì request vẫn bay, máy chủ
   * vẫn trả lời — bằng một trang HTML của "chưa đăng nhập", đúng lỗi đo được
   * 2026-11-09 20:12 (`Unexpected token '<'`).
   */
  fileCookie: string;
  /** `$znode.os.hostname()` bên Zalo PC — trường `pc_name` của `pull_mobile_msg`. */
  pcName: string;
}

export function createZaloClient(store: SessionStore, events: ZaloEvents, options: ClientOptions = {}): ZaloClient {
  const cache = options.cache;
  let api: API | null = null;
  let connection: LiveConnection = 'disconnected';
  let threads: LiveThread[] = [];
  /**
   * Cache của **tài khoản đang đăng nhập**. `dbOwnId` là id mà file DB này thuộc
   * về: đổi tài khoản phải đóng handle cũ trước khi mở file khác, nếu không hai
   * tài khoản cùng ghi vào một connection.
   */
  let db: Db | null = null;
  let dbOwnId: string | null = null;
  /**
   * Hai không gian id của Zalo, và cầu nối giữa chúng.
   *
   * `uid` (số thập phân) là thứ `getOwnId`, `getAllFriends` và DB của repo
   * dùng. `globalId` (32 ký tự base62, đã nhiễu hoá) là thứ **Sync V2** dùng
   * cho `senderId`, `convId` và `partition`. Không có cầu thì mọi tin lịch sử
   * đều không rõ của ai.
   *
   * `globalIds` ánh xạ `globalId` → `uid`, dựng từ `getAllFriends` — cùng nguồn
   * `profile.globalId` mà Zalo PC dùng trong `_getGlobalIdsFromUserIds`
   * (`lazy/main-startup…`). `ownNoisedId` là `globalId` của chính mình, lấy từ
   * `fetchAccountInfo().profile.globalId`; Zalo PC gọi bước tương ứng là
   * `resolveMyGlobalNoisedId()`.
   */
  let globalIds = new Map<string, string>();
  let globalNames = new Map<string, string>();
  let groupMemberIds = new Map<string, string[]>();
  let avatarSources = new Map<string, string>();
  let memberAvatarUrls = new Map<string, string>();
  const avatarProfileLookups = new Set<string>();
  let globalIdLookup: GlobalIdLookup | null = null;
  let groupMemberInfoLookup: GroupMemberInfoLookup | null = null;
  const groupMemberDetailsLoaded = new Set<string>();
  const groupMemberInfoRequests = new Map<string, Promise<void>>();
  let ownNoisedId: string | null = null;
  /**
   * Hội thoại đã trả một trang **từ cache** trong phiên này. Lần đầu UI mở hội
   * thoại phải thấy ngay dữ liệu cũ; lần bấm "Tải tin nhắn cũ hơn" mới là lúc
   * hỏi máy chủ. Không có cờ này thì mỗi lần bấm lại trả đúng trang cache và
   * không bao giờ lấy thêm được tin cũ.
   */
  const servedFromCache = new Set<string>();
  /**
   * Tin đã thu hồi mà ta **chưa** có dòng trong cache (`threadId:msgId`). Sự kiện
   * thu hồi tới trước trang lịch sử của hội thoại đó, và trang đó — nếu không có
   * tập này — sẽ hồi sinh tin với nội dung gốc. Chỉ sống trong bộ nhớ: sau khi
   * mở lại app, cache hoặc đã có dòng `recalled`, hoặc tin gốc vẫn chưa được tải.
   */
  const recalledIds = new Set<string>();
  /** Reactions can arrive before catch-up inserts their message row. */
  const pendingReactions = new Map<string, Map<string, ReactionAction>>();
  let pendingReactionCount = 0;
  let activeThreadId: string | null = null;
  let started = false;
  let replaced = false;
  let manualStop = false;
  let backoff = BACKOFF_START_MS;
  let backoffTimer: NodeJS.Timeout | null = null;

  function toIpcMessageWithAvatar(message: Parameters<typeof toIpcMessage>[0]) {
    const live = toIpcMessage(message);
    if (message.kind !== 'group' || message.from !== 'them' || !message.senderId) return live;
    const members = groupMemberIds.get(message.threadId);
    const mappedId = globalIds.get(message.senderId);
    const userId = members?.includes(message.senderId) ? message.senderId
      : mappedId ?? message.senderId;
    const senderAvatar = memberAvatarUrls.get(userId);
    return senderAvatar ? { ...live, senderAvatar } : live;
  }
  let qrRestarts = 0;
  let loginInFlight = false;
  let loginTask: Promise<boolean> | null = null;
  const seenParams = new Map<string, SendSeenEventMessageParams>();
  /**
   * Yêu cầu lịch sử 1-1 đang chờ. `old_messages` không trả Promise và không mang
   * `threadId`, nên tối đa một yêu cầu được bay tại một thời điểm.
   */
  let historyWaiter: HistoryWaiter | null = null;
  /** Số tin đã xin cho mỗi nhóm: API nhóm không có `before`, chỉ có `count`. */
  const groupHistoryCount = new Map<string, number>();
  const groupProfileRequests = new Map<string, Promise<void>>();
  /**
   * Mốc cũ nhất đã nhận của đường listener 1-1. `cmd 510` không nhận `threadId`
   * và trả tin của **mọi** hội thoại, nên mốc này là mốc chung: một mốc riêng
   * cho từng hội thoại sẽ xin lại đúng trang cũ và lặp tin.
   */
  let userHistoryCursor: string | null = null;
  /**
   * Tin của các hội thoại khác trong cùng một trang 510. Renderer chỉ hỏi một hội
   * thoại mỗi lần, nhưng con trỏ đã đi qua cả trang; bỏ phần còn lại là mất tin
   * vĩnh viễn. Giữ lại và trả khi hội thoại đó được mở.
   */
  const userHistoryBuffer = new Map<string, StoreMessage[]>();
  /** Hàng đợi yêu cầu lịch sử 1-1: `old_messages` không mang `threadId` nên không chạy song song được. */
  let userHistoryQueue: Promise<unknown> = Promise.resolve();
  /**
   * Trần số tin đệm cho các hội thoại chưa mở. Chạm trần thì bỏ hội thoại được
   * đệm lâu nhất; con trỏ chung đã đi qua phần đó nên **không xin lại được** —
   * đây là đánh đổi có chủ ý để một phiên dài không phình RAM, và nó chỉ ảnh
   * hưởng tới các hội thoại người dùng chưa hề mở trong phiên này.
   */
  const USER_HISTORY_BUFFER_MAX = 2000;
  let userHistoryBuffered = 0;
  /**
   * Nhịp xin lịch sử (plan §6.7). Dùng **chung** cho cả nhóm và 1-1 vì giới hạn
   * của máy chủ tính theo tài khoản, không theo loại hội thoại: bấm "Tải thêm"
   * trong một nhóm rồi mở ngay một hội thoại khác vẫn là hai yêu cầu sát nhau.
   */
  const historyThrottle = createThrottle();
  let catchUpWaiter: CatchUpWaiter | null = null;
  let catchUpInFlight = false;
  let catchUpQueued = false;
  const stickerUrlCache = new Map<number, Promise<string | null>>();

  const emitLogin = (next: LoginState) => { events.login(next); };
  const emitConnection = (next: LiveConnection) => {
    connection = next;
    events.debug?.('connection', { state: next });
    events.connection(next);
  };
  // `selfListen: false` khiến listener bỏ mọi tin có `isSelf`. Tin gửi từ điện
  // thoại của cùng tài khoản cũng mang cờ đó, nên phải bật để nhận được chúng.
  const connect = options.connect
    ?? (() => new Zalo({ selfListen: true, checkUpdate: false, logging: false }));

  /**
   * Mọi lời gọi cache đều đi qua đây. Cache là thứ tăng tốc, không phải điều
   * kiện để chat chạy: một DB hỏng, đầy đĩa hay bị khoá **không được** làm chết
   * đường realtime. Lỗi được ghi log rồi bỏ qua, và tầng gọi quyết định đi tiếp
   * bằng dữ liệu mạng như trước khi có cache.
   */
  function safe<T>(what: string, run: () => T): T | null {
    try {
      return run();
    } catch (error) {
      events.debug?.('cache', { op: what, ok: false,
        message: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
      return null;
    }
  }

  /** Đóng cache của tài khoản cũ (nếu có) rồi mở cache của `ownId`. */
  function openCache(ownId: string): void {
    if (!cache) return;
    if (db && dbOwnId === ownId) return;
    closeCache();
    const opened = safe('open', () => cache.open(ownId));
    if (!opened) return;
    db = opened;
    dbOwnId = ownId;
    // Persist fresh-vs-established setup policy before loading server metadata.
    isPhoneSyncSetupRequired(db);
    servedFromCache.clear();
    events.debug?.('cache', { op: 'open', ok: true });
  }

  function closeCache(): void {
    pendingReactions.clear();
    pendingReactionCount = 0;
    if (!db) return;
    safe('close', () => db?.close());
    db = null;
    dbOwnId = null;
    servedFromCache.clear();
  }

  /** Đánh dấu bong bóng tạm là hỏng, để lần mở sau còn thấy nó ở trạng thái "Gửi lại". */
  function failPending(threadId: string, clientId: string): void {
    if (!db) return;
    const store = db;
    safe('failed', () => markFailed(store, threadId, clientId));
  }

  /** Ghi tin vào cache. */
  function persist(threadId: string, batch: StoreMessage[]): StoreMessage[] {
    if (!db || !batch.length) return batch;
    const store = db;
    // Sự kiện thu hồi có thể đã tới trước tin gốc. Áp lại ở đây để trang lịch sử
    // không hồi sinh nội dung của một tin người dùng đã rút.
    const rows = recalledIds.size
      ? batch.map(message => (message.msgId && recalledIds.has(`${threadId}:${message.msgId}`)
        ? { ...message, recalled: true, text: '' } : message))
      : batch;
    const saved = safe('upsert', () => {
      upsertMessages(store, threadId, rows);
      return true;
    });
    if (!saved) return rows;
    safe('sync-state', () => {
      // Mốc catch-up là `msgId` lớn nhất **đã thấy**, kể cả tin không ghi mới vì
      // trùng nội dung: mốc nói "đã đọc tới đâu", không phải "đã ghi gì".
      // `writeSyncState` chỉ đẩy mốc này lên, nên trang cũ không kéo nó lùi.
      const highest = batch.reduce<string | null>((max, message) =>
        (message.msgId && (!max || compareMsgId(message.msgId, max) > 0) ? message.msgId : max), null);
      if (highest) writeSyncState(store, threadId, { lastSyncedMsgId: highest });
      for (const kind of ['user', 'group'] as const) {
        const latestId = batch.reduce<string | null>((max, message) =>
          (message.kind === kind && message.msgId
            && isServerMsgId(message.msgId)
            && (!max || compareMsgId(message.msgId, max) > 0) ? message.msgId : max), null);
        if (latestId) writeCatchUpCursor(store, latestId, kind);
      }
    });
    return rows.map(message => applyPendingReactions(store, threadId, message));
  }

  function pendingReactionKey(threadId: string, msgId: string): string {
    return `${threadId}\u0000${msgId}`;
  }

  function forgetPendingReactions(key: string): void {
    const actions = pendingReactions.get(key);
    if (!actions) return;
    pendingReactionCount -= actions.size;
    pendingReactions.delete(key);
  }

  function queuePendingReaction(threadId: string, msgId: string, action: ReactionAction): void {
    const key = pendingReactionKey(threadId, msgId);
    const existing = pendingReactions.get(key);
    if (existing?.has(action.uid)) {
      existing.set(action.uid, action);
      return;
    }
    if (pendingReactionCount >= PENDING_REACTIONS_MAX) {
      for (const [oldestKey, oldestActions] of pendingReactions) {
        const oldestUid = oldestActions.keys().next();
        if (oldestUid.done) continue;
        oldestActions.delete(oldestUid.value);
        pendingReactionCount -= 1;
        if (!oldestActions.size) pendingReactions.delete(oldestKey);
        events.debug?.('reaction', { ok: false, reason: 'pending-limit' });
        break;
      }
    }
    const actions = pendingReactions.get(key) ?? new Map<string, ReactionAction>();
    actions.set(action.uid, action);
    pendingReactions.set(key, actions);
    pendingReactionCount += 1;
  }

  function applyPendingReactions(
    store: Db, threadId: string, message: StoreMessage,
  ): StoreMessage {
    if (!message.msgId) return message;
    const key = pendingReactionKey(threadId, message.msgId);
    const actions = pendingReactions.get(key);
    if (!actions) return message;
    if (message.recalled) {
      forgetPendingReactions(key);
      return message;
    }
    const updated = safe('pending-reactions', () => {
      let next = messageReactions(store, threadId, message.msgId!);
      for (const action of actions.values()) next = applyReaction(next, action);
      return setMessageReactions(store, threadId, message.msgId!, next);
    });
    if (!updated) return message;
    forgetPendingReactions(key);
    return { ...message, reactions: updated.reactions };
  }

  /** Ghi nhớ một tin đã thu hồi mà cache chưa có (xem `recalledIds`). */
  function rememberRecall(threadId: string, msgId: string): void {
    const key = `${threadId}:${msgId}`;
    // `Set` giữ thứ tự chèn, nên phần tử đầu tiên là mục cũ nhất.
    recalledIds.delete(key);
    recalledIds.add(key);
    while (recalledIds.size > RECALLED_IDS_MAX) {
      const oldest = recalledIds.values().next();
      if (oldest.done) break;
      recalledIds.delete(oldest.value);
    }
  }

  // ------------------------------------------------------- Sync V2 (điện thoại)

  /**
   * Bộ điều khiển đồng bộ — chỉ tồn tại sau khi có phiên và socket.
   *
   * Không dựng trong `activate`: wasm nạp bất đồng bộ và chỉ cần khi thật sự
   * đồng bộ, còn dựng sớm ở đây sẽ đọc đĩa trong đường khởi động.
   */
  let sync: SyncV2Controller | null = null;

  /**
   * Tên của một hội thoại, tra trong danh sách đã biết.
   *
   * Trả **nhãn mặc định** khi chưa biết tên, không trả chuỗi rỗng: UI cần một
   * chuỗi để vẽ. Nhưng bên gọi phải hiểu rằng nhãn đó không phải tên thật —
   * `upsertThreads` không cho nó đè lên một tiêu đề đã có.
   */
  function threadNameFromKnown(threadId: string, kind: LiveMessage['kind']): string {
    const found = threads.find(t => t.id === threadId && t.kind === kind);
    return found?.name || (kind === 'group' ? 'Nhóm Zalo' : 'Người dùng Zalo');
  }

  /**
   * Tin đã đồng bộ được ghi cache **và** phát lên UI theo đúng đường của tin
   * sống, nhưng khác một chỗ: `applyMessage` tăng `unread` cho tin của người
   * khác, mà một lần kéo cả lịch sử sẽ biến hàng nghìn tin cũ thành chưa đọc.
   * Tin lịch sử không phải tin mới — đẩy hội thoại lên đầu danh sách thì có,
   * tăng số chưa đọc thì không.
   */
  function applySynced(threadId: string, messages: StoreMessage[]): void {
    if (!messages.length) return;
    messages = persist(threadId, messages);
    // Ghi cache theo **từng hội thoại**: `persist` khoá theo `threadId`, còn một
    // gói có thể mang tin của nhiều hội thoại.
    const touched = new Map<string, StoreMessage>();
    for (const message of messages) {
      const key = `${message.threadId}:${message.kind}`;
      const best = touched.get(key);
      if (!best || message.ts > best.ts) touched.set(key, message);
    }
    for (const message of touched.values()) {
      const index = threads.findIndex(t => t.id === message.threadId && t.kind === message.kind);
      if (index < 0) {
        const created: LiveThread = {
          id: message.threadId, kind: message.kind,
          name: threadNameFromKnown(message.threadId, message.kind),
          avatar: null, pinned: false, unread: 0,
          lastText: previewOfMessage(message), lastTs: message.ts,
        };
        threads = [created, ...threads];
        events.thread(created);
      } else {
        let current = threads[index];
        // Nhãn mặc định **không** phải tên: thread tạo ra lúc chưa có danh sách
        // bạn bè phải được nâng cấp khi tên thật về, kể cả khi không có tin mới.
        const known = threadNameFromKnown(message.threadId, message.kind);
        if (current.name !== known) {
          current = { ...current, name: known };
          threads = threads.map((item, i) => (i === index ? current : item));
          events.thread(current);
        }
        // Chỉ đẩy lên khi tin này **mới hơn** tin cuối đang thấy: một gói lịch
        // sử cũ không được làm lùi preview của hội thoại.
        if (message.ts <= current.lastTs) continue;
        const next: LiveThread = {
          ...current, lastText: previewOfMessage(message) || current.lastText, lastTs: message.ts,
        };
        threads = [next, ...threads.filter((_, i) => i !== index)];
        events.thread(next);
      }
    }
    if (db && threads.length) {
      const store = db;
      safe('upsertSyncedThreads', () => upsertThreads(store, [...touched.values()].map(message =>
        threads.find(t => t.id === message.threadId && t.kind === message.kind))
        .filter((thread): thread is LiveThread => thread !== undefined)));
    }
    for (const message of messages) events.message(toIpcMessageWithAvatar(message));
    if (threadId === activeThreadId && messages.some(message =>
      message.kind === 'group' && message.from === 'them'
      && message.senderId && !globalNames.has(message.senderId))) {
      void refreshGroupSenderNames(threadId, true).catch(error => {
        events.debug?.('group-name-refresh', {
          ok: false, error: error instanceof Error ? error.name : 'unknown',
        });
      });
    }
  }

  /**
   * Dựng controller cho phiên hiện tại và gắn vào socket.
   *
   * Gọi ở mỗi lần `activate`. Controller cũ được đóng trước: khoá tạm, số thứ
   * tự phiên và bản ghi phiên đều thuộc về **một** lần đăng nhập.
   */
  function attachSync(client: API): void {
    // Luôn sẵn sàng sau đăng nhập; chỉ tải crypto và xin lịch sử khi người dùng chọn đồng bộ.
    sync?.dispose();
    sync = null;
    const socket = (client.listener as unknown as { ws?: WebSocket });
    // Listener chưa mở: `connected` gọi lại hàm này khi socket sống.
    if (!socket?.ws) return;
    if (!cloudSession || !db) {
      events.debug?.('sync-v2', {
        ok: false, reason: !db ? 'no-cache' : 'no-session',
      });
      return;
    }
    const ownId = dbOwnId;
    if (!ownId) return;
    const syncDb = db;

    const controller = new SyncV2Controller({
      // `import()` động: `sync-v2-wasm.ts` là file **duy nhất** trong protocol
      // chạm `electron` (để tìm đường dẫn wasm), và một import tĩnh ở đây kéo
      // `electron` vào cả những test chạy `zalo-client.ts` bằng node thật.
      crypto: async () => (await import('./sync-v2-wasm.js')).loadSyncV2Crypto(),
      identity: (crypto) => loadIdentity(db, crypto),
      ownId,
      // `ownId` là uid số, nhưng `senderId` của Sync V2 là id nhiễu; so trực
      // tiếp thì không tin nào là của mình. Xem `globalIds`/`ownNoisedId`.
      // Dựng resolver ở đây chứ không truyền sẵn bảng: `globalIds` được điền
      // **sau** khi danh sách bạn bè về, có thể sau lần `attach` này.
      idResolver: {
        uidOf: (globalId) => globalIds.get(globalId),
        nameOf: (senderId) => globalNames.get(senderId),
        isSelf: (senderId) => senderId.length > 0
          && (ownNoisedId ? senderId === ownNoisedId : senderId === ownId),
      },
      imei: cloudSession.imei,
      deviceName: cloudSession.pcName,
      onMessages: (messages: SyncedMessage[]) => {
        // Một gói trộn nhiều hội thoại; `persist` và `applySynced` đều nhận
        // theo lô của một hội thoại.
        const grouped = new Map<string, StoreMessage[]>();
        for (const item of messages) {
          const list = grouped.get(item.threadId) ?? [];
          list.push(item.message);
          grouped.set(item.threadId, list);
        }
        for (const [threadId, batch] of grouped) applySynced(threadId, batch);
      },
      onPhase: (phase) => events.sync?.(phase, controller.stats),
      onComplete: () => {
        const complete = markPhoneSyncComplete(syncDb);
        events.sync?.('done', { ...controller.stats, phoneSyncComplete: complete });
      },
      // Giữa hai lần đổi giai đoạn, số gói vẫn tăng: không phát thì banner đứng
      // ở "0 gói" cho tới lúc xong.
      onStats: (stats) => events.sync?.(controller.currentPhase, stats),
      onStatus: (status) => events.debug?.('sync-v2', { status: status.status, from: status.fromDevice }),
      onDebug: (event, data) => events.debug?.(event, data),
      // Hội thoại của bước `sync_conversations`: chỉ mục cho `partition` của lần
      // xin tin. Ghi xuống `kv` để lần đồng bộ sau không phải chạy lại bước này.
      onConversations: (conversations) => {
        const list = mergeConversations(db, conversations);
        events.debug?.('sync-v2', {
          ok: true, step: 'conversations', received: conversations.length, stored: list.length,
        });
      },
      knownConversations: () => loadConversations(db).map(item => ({
        convId: item.convId, convType: item.convType,
        respondedByMe: false, lastTs: '0', lastGlobalId: '0', lastClientId: '0',
      })),
      rememberOpenSession: (syncId) => rememberOpenSession(db, syncId),
      forgetOpenSession: (syncId) => forgetOpenSession(db, syncId),
      listOpenSessions: () => listOpenSessions(db),
      // Đánh thức điện thoại. Chạy **sau** bước xin phiên — `wakeup()` của Zalo
      // PC lấy phiên trong `syncSessions[0]`, mà phiên chỉ tồn tại sau `create()`
      // (`CdmT.js:8694`, `:8779`). Đo 2026-11-09: gửi `592` trước thì không nhận
      // được phản hồi nào.
      wake: (syncId: string) => sendWakeMobile(client.listener, syncId),
      // Bước xin phiên đi trên **chính socket này** (`cmd 590`), không qua
      // HTTP: endpoint `/api/transfer-sync-v2/*` không tồn tại trên máy chủ —
      // xem `request-sync-ws.ts`.
      request: (payload, reqId) => sendRequestSync(client.listener, payload, reqId),
      // Giải phóng phiên khi xong. Zalo PC luôn làm bước này (`disposeSync`
      // trong cả `handleSuccess` và `handleFailure` của máy trạng thái
      // `sync-full`); bỏ nó thì mỗi lần bấm đồng bộ lại để lại một phiên mở.
      disposeSession: (syncId, reason) => sendDisposeSession(client.listener, syncId, reason),
    });
    controller.attach(socket);
    sync = controller;
    events.debug?.('sync-v2', { ok: true, step: 'attached' });
    // Dọn phiên của lần chạy trước, tương đương `cleanOldSyncSession` của Zalo
    // PC. Chạy khi socket đã sống và **trước** mọi `start()` — phiên hiện tại
    // chưa được mở nên không lọt vào danh sách bị dội `OutDated`.
    void controller.sweepStaleSessions().catch(() => undefined);
  }

  let stopCallControls: (() => void) | null = null;
  function attachCalls(): void {
    stopCallControls?.();
    stopCallControls = null;
    if (api && events.callControl) stopCallControls = watchCallControls(api.listener as unknown as { ws?: WebSocket; cipherKey?: string }, events.callControl);
  }

  function stopListener(): void {
    stopCallControls?.(); stopCallControls = null;
    manualStop = true;
    // `dispose`, không phải `detach`: một phiên đang mở phải gửi `591`
    // (`UserCancel`) trước khi socket đóng. `stopListener` chạy ở cả [`dispose`],
    // [`logout`] và nhánh "bị thay thế" — mọi đường thoát đều cần bước này, và
    // `cancel()` tự chống gửi hai lần.
    sync?.dispose();
    sync = null;
    if (api) {
      try { api.listener.stop(); } catch { /* already stopped */ }
    }
    started = false;
  }

  /** Con trỏ lịch sử thuộc về một phiên đăng nhập, không thuộc về tiến trình. */
  function resetHistory(): void {
    userHistoryCursor = null;
    userHistoryBuffer.clear();
    userHistoryBuffered = 0;
    groupHistoryCount.clear();
    // Id thu hồi cũng thuộc về một phiên: đổi tài khoản mà giữ lại thì id của
    // người này sẽ đánh dấu nhầm tin của người kia (id hai tài khoản khác nhau).
    recalledIds.clear();
    pendingReactions.clear();
    pendingReactionCount = 0;
    if (historyWaiter) { historyWaiter.settle([]); historyWaiter = null; }
    if (catchUpWaiter) { catchUpWaiter.settle(null); catchUpWaiter = null; }
  }

  function clearBackoff(): void {
    if (backoffTimer) { clearTimeout(backoffTimer); backoffTimer = null; }
  }

  function scheduleReconnect(): void {
    if (api === null || replaced || backoffTimer) return;
    const delay = backoff;
    // 2s → 4s → 8s … tối đa 60s. Không dồn dập đăng nhập/kết nối lại.
    backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
    backoffTimer = setTimeout(() => {
      backoffTimer = null;
      if (!started) startListener();
    }, delay);
  }

  function startListener(): void {
    if (!api || started) return;
    manualStop = false;
    try {
      api.listener.start({ retryOnClose: false });
      started = true;
      events.debug?.('start', { ok: true });
      emitConnection('connecting');
    } catch (error) {
      // `start()` ném "Already started"; socket vẫn sống nên không phải lỗi nặng.
      started = true;
      events.debug?.('start', { ok: false, message: error instanceof Error ? error.message : 'unknown' });
    }

  }

  function emitCatchUp(phase: CatchUpProgress['phase'], received = 0): void {
    events.catchUp?.({ phase, received });
  }

  function requestCatchUpPage(
    client: API, type: ThreadType, cursor: string | null,
  ): Promise<ZaloMessage[] | null> {
    return historyThrottle.run(() => new Promise(resolve => {
      const waiter: CatchUpWaiter = {
        type,
        settle: messages => { clearTimeout(timer); resolve(messages); },
      };
      const timer = setTimeout(() => {
        if (catchUpWaiter === waiter) catchUpWaiter = null;
        events.debug?.('catch-up', {
          ok: false, reason: 'timeout', kind: kindOf(type), hasCursor: cursor !== null,
        });
        resolve(null);
      }, HISTORY_TIMEOUT_MS);
      catchUpWaiter = waiter;
      try {
        client.listener.requestOldMessages(type, cursor);
        events.debug?.('catch-up-request', { kind: kindOf(type), hasCursor: cursor !== null });
      } catch (error) {
        catchUpWaiter = null;
        clearTimeout(timer);
        events.debug?.('catch-up', {
          ok: false, reason: 'request-error', kind: kindOf(type),
          message: error instanceof Error ? error.message.slice(0, 120) : 'unknown',
        });
        resolve(null);
      }
    }));
  }

  function requestOldReactionHistory(client: API, type: ThreadType): void {
    if (!db) return;
    try {
      // Reactions have their own server queue (cmd 610/611), separate from the
      // message catch-up queue. No reaction cursor is persisted yet, so request
      // the server's initial backlog on each connection; applying it is idempotent.
      client.listener.requestOldReactions(type, null);
      events.debug?.('reaction-catch-up-request', { ok: true, kind: kindOf(type) });
    } catch (error) {
      events.debug?.('reaction-catch-up-request', {
        ok: false, kind: kindOf(type),
        errorType: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  function scheduleCatchUp(): void {
    catchUpQueued = true;
    if (catchUpInFlight || !api || !started) return;
    catchUpQueued = false;
    catchUpInFlight = true;
    const client = api;
    emitCatchUp('checking');
    const run = userHistoryQueue.then(async () => {
      let received = 0;
      let incomplete = false;
      for (const kind of ['user', 'group'] as const) {
        const type = threadType(kind);
        const cursor = db ? safe('readCatchUpCursor', () => readCatchUpCursor(db as Db, kind)) ?? null : null;
        requestOldReactionHistory(client, type);
        const page = await requestCatchUpPage(client, type, cursor);
        if (!page) {
          if (manualStop || client !== api) return;
          incomplete = true;
          continue;
        }

        let undoCount = 0;
        let kindReceived = 0;
        const orderedPage = [...page].sort((a, b) =>
          compareMsgId(String(a.data.msgId ?? ''), String(b.data.msgId ?? '')));
        for (const message of orderedPage) {
          if (message.data.msgType === 'chat.undo') {
            undoCount += 1;
            handleUndoData(
              message.threadId, message.data, message.isSelf, kind === 'group', message.data.ts,
            );
            continue;
          }
          const mapped = toLiveMessage(message.data as RawMessage, message.threadId, kind, message.isSelf,
            uid => globalNames.get(uid));
          if (mapped && (!cursor || compareMsgId(mapped.msgId ?? '', cursor) > 0)) kindReceived += 1;
          await handleInbound(message, true);
        }
        received += kindReceived;
        if (!db) {
          events.debug?.('catch-up', {
            ok: false, reason: 'cache-unavailable', kind, received: kindReceived, pageSize: page.length,
          });
          incomplete = true;
          continue;
        }
        const latest = safe('readCatchUpCursor', () => readCatchUpCursor(db as Db, kind)) ?? null;
        if (page.length > 0 && undoCount === page.length && kindReceived === 0) {
          events.debug?.('catch-up', {
            ok: false, reason: 'control-only-page', kind, pageSize: page.length, undoCount,
          });
          incomplete = true;
          continue;
        }
        events.debug?.('catch-up', {
          ok: true, kind, received: kindReceived, pageSize: page.length,
          advanced: Boolean(latest && (!cursor || compareMsgId(latest, cursor) > 0)),
        });
      }
      emitCatchUp(incomplete ? 'incomplete' : received > 0 ? 'updated' : 'current', received);
    }).catch(error => {
      events.debug?.('catch-up', {
        ok: false, reason: 'error',
        message: error instanceof Error ? error.message.slice(0, 120) : 'unknown',
      });
      emitCatchUp('incomplete');
    });
    userHistoryQueue = run.then(() => undefined, () => undefined);
    void run.finally(() => {
      catchUpInFlight = false;
      if (catchUpQueued && started) scheduleCatchUp();
    });
  }

  /**
   * Xin một trang 1-1 qua listener và chờ `old_messages`. zca-js không trả
   * Promise cho `requestOldMessages` và cũng không trả cờ "còn nữa", nên hạn
   * giờ là tín hiệu duy nhất cho biết máy chủ không còn gì để gửi.
   */
  function awaitOldMessages(client: API, lastId: string | null): Promise<ZaloMessage[]> {
    // Nghỉ **trước** khi gửi yêu cầu, và qua chính hàng đợi throttle: `cmd 510`
    // vốn đã phải tuần tự (chỉ một `historyWaiter`), nhưng nghỉ là phần còn thiếu
    // của §6.7 — ba lần gọi liền trong 100 ms như log 18:59 là nhịp bot.
    return historyThrottle.run(() => new Promise<ZaloMessage[]>(resolve => {
      const waiter: HistoryWaiter = {
        settle: messages => { clearTimeout(timer); resolve(messages); },
      };
      const timer = setTimeout(() => {
        if (historyWaiter === waiter) historyWaiter = null;
        events.debug?.('history', { ok: false, reason: 'timeout' });
        resolve([]);
      }, HISTORY_TIMEOUT_MS);
      historyWaiter = waiter;
      try {
        client.listener.requestOldMessages(ThreadType.User, lastId);
        // Chỉ là "đã gửi yêu cầu". Trang đến (hoặc không đến) được ghi ở
        // `listener.on('old_messages')` / `history {reason:'timeout'}` — ghi chung
        // một event sẽ khiến lần đo §10.3 đọc ra "có trang" dù máy chủ im lặng.
        events.debug?.('history-request', { hasCursor: lastId !== null });
      } catch {
        historyWaiter = null;
        clearTimeout(timer);
        resolve([]);
      }
    }));
  }

  /** Lấy (và xoá) phần đã đệm của một hội thoại; hạ luôn bộ đếm dùng cho trần. */
  function takeBuffered(threadId: string): StoreMessage[] {
    const buffered = userHistoryBuffer.get(threadId);
    if (!buffered) return [];
    userHistoryBuffer.delete(threadId);
    userHistoryBuffered -= buffered.length;
    return buffered;
  }

  /**
   * Một lần xin lịch sử 1-1: giữ tin của hội thoại được hỏi, đệm phần của hội
   * thoại khác (con trỏ dùng chung đã đi qua chúng), rồi báo còn hay hết.
   */
  async function fetchUserHistory(
    threadId: string, before?: string,
  ): Promise<{ messages: StoreMessage[]; hasMore: boolean }> {
    const buffered = takeBuffered(threadId);
    if (buffered.length) return { messages: buffered, hasMore: true };
    // Chưa có socket thì `requestOldMessages` chỉ rơi vào khoảng không và người
    // dùng phải chờ hết hạn 5 giây. Báo `hasMore: true` để nút tải còn bấm lại
    // được sau khi kết nối lại — "hết lịch sử" là một khẳng định về máy chủ, và
    // chưa kết nối thì không có cơ sở nào để nói vậy.
    if (!api || !started) return { messages: [], hasMore: true };
    const client = api;
    // Con trỏ dùng chung: xin cho hội thoại A cũng kéo lịch sử của B, nên nó chỉ
    // được đi lùi và mọi trang (kể cả trang của hội thoại khác) đều đẩy nó lùi.
    // Ghi lại giá trị **đã gửi** để lần đo sau phân biệt được "máy chủ trả lại
    // đúng trang cũ" với "ta đã gửi lại đúng con trỏ cũ" — log sáng nay chỉ có
    // `first`/`last`, không đủ để nói cái nào.
    for (let round = 0; round < HISTORY_ROUNDS; round += 1) {
      // Ghi **giá trị sắp gửi** ở từng vòng: log `history` một mình không phân
      // biệt được "máy chủ trả lại đúng trang cũ" với "ta gửi lại đúng con trỏ
      // cũ". Hai nguyên nhân đó dẫn tới hai cách sửa khác hẳn nhau.
      events.debug?.('history-cursor', {
        round, asked: before ?? userHistoryCursor, hasBefore: Boolean(before),
      });
      const page = await awaitOldMessages(client, before ?? userHistoryCursor);
      // Hết hạn chờ **không** đồng nghĩa hết lịch sử: mạng chậm vẫn còn tin cũ,
      // và đánh dấu "hết" sẽ khoá nút tải cho tới lần đăng nhập sau.
      if (!page.length) return { messages: [], hasMore: true };
      for (const raw of page) {
        const mapped = await mapInboundMessage(raw.data as RawMessage, raw.threadId, 'user', raw.isSelf);
        if (!mapped) continue;
        const bucket = userHistoryBuffer.get(mapped.threadId);
        if (bucket) bucket.push(mapped);
        else userHistoryBuffer.set(mapped.threadId, [mapped]);
        userHistoryBuffered += 1;
        while (userHistoryBuffered > USER_HISTORY_BUFFER_MAX) {
          const oldest = userHistoryBuffer.keys().next();
          if (oldest.done) break;
          userHistoryBuffered -= userHistoryBuffer.get(oldest.value)?.length ?? 0;
          userHistoryBuffer.delete(oldest.value);
        }
        // `msgId` tăng dần theo thời gian; giữ mốc cũ nhất để lần sau xin tiếp,
        // nếu không trang kế tiếp lặp lại đúng trang vừa nhận.
        if (olderMsgId(mapped.msgId, userHistoryCursor)) userHistoryCursor = mapped.msgId;
      }
      const mine = takeBuffered(threadId);
      if (mine.length) return { messages: mine, hasMore: true };
    }
    // Ba vòng mà hội thoại này không xuất hiện. **Không** được tuyên bố "hết
    // lịch sử": `cmd 510` trả tin của mọi hội thoại và con trỏ chỉ đi lùi, nên
    // một hội thoại im lặng có thể chỉ đang nằm ngoài cửa sổ hiện tại. Log
    // 2026-11-08 12:34 cho thấy đúng điều đó — xin cho hội thoại trống, máy chủ
    // trả 12 tin của hội thoại khác và ta không có gì để hiện. Báo `false` sẽ
    // khoá nút tải và ghi lên UI một câu không ai kiểm chứng được ("Đã hết lịch
    // sử Zalo") cho một hội thoại chưa hề được hỏi tới.
    events.debug?.('history', { ok: false, reason: 'not-in-page', rounds: HISTORY_ROUNDS });
    return { messages: [], hasMore: true };
  }

  /**
   * Phiên bí mật của zca-js, giữ trong bộ nhớ để `fetchCloudHistory` dùng được.
   * Lấy qua `client.custom` — API công khai của zca-js — chứ không đọc trường nội
   * bộ. Không bao giờ rời khỏi tiến trình main.
   */
  let cloudSession: CloudSession | null = null;
  /**
   * `utils` của zca-js (mã hoá AES, cookie jar, `resolve` giải hai lớp). Giữ lại
   * để đối chứng: nếu chính đường này cũng bị từ chối thì lỗi không nằm ở phần
   * ta tự viết. Chỉ nằm trong bộ nhớ tiến trình main.
   */
  let cloudUtils: CloudUtils | null = null;

  interface CloudUtils {
    makeURL(baseURL: string, params?: Record<string, string | number>, apiVersion?: boolean): string;
    encodeAES(data: string): string | null;
    request(url: string, options?: RequestInit, raw?: boolean): Promise<Response>;
    resolve(res: Response): Promise<unknown>;
  }

  function captureCloudSession(client: API): void {
    if (cloudSession) return;
    try {
      // Hộp giữ kết quả: gán vào biến `let` trong closure thì TypeScript coi là
      // `null` ở chỗ đọc (nó không biết callback chạy đồng bộ ngay sau đó).
      const box: { value: CloudSession | null } = { value: null };
      client.custom('__glassCapture', ({ ctx, utils }) => {
        const url = client.zpwServiceMap?.group_cloud_message?.[0];
        if (!url || !ctx.secretKey || !ctx.cookie) return null;
        // Domain `file` là họ khác của cùng service map. `[0]` là domain
        // **chính**, nhưng họ này có nhiều mục: Zalo PC chọn domain bằng
        // `getActiveDomain()` — thử lần lượt khi một host lỗi. Giữ cả danh sách
        // để `request-sync` thử tiếp khi mục đầu trả `404` (đo 2026-11-09
        // 20:18: `tt-files-wpa` trả `HTTP 404`).
        const fileList = ((client.zpwServiceMap as unknown as
          { file?: string[] } | undefined)?.file ?? []).filter(item => typeof item === 'string');
        const fileUrl = fileList[0] ?? null;
        cloudUtils = utils as unknown as CloudUtils;
        box.value = {
          baseUrl: url.replace(/\/$/, ''),
          imei: ctx.imei,
          secretKey: ctx.secretKey,
          // Cookie phải lấy theo **host của domain cloud**, không phải `chat.zalo.me`:
          // `tt-group-cm.chat.zalo.me` là host khác, và `zpw_sek` chỉ được gửi cho
          // đúng domain đã đặt nó. Lấy sai host thì request vẫn bay, máy chủ vẫn
          // trả lời — nhưng trả lời như một người chưa đăng nhập.
          cookie: ctx.cookie.getCookieStringSync?.(new URL(url).origin) ?? '',
          userAgent: ctx.userAgent,
          apiVersion: ctx.API_VERSION,
          apiType: ctx.API_TYPE,
          fileBaseUrl: fileUrl ? fileUrl.replace(/\/$/, '') : null,
          /** Mọi domain họ `file`, theo thứ tự ưu tiên của service map. */
          fileBaseUrls: fileList.map(item => item.replace(/\/$/, '')),
          // Cookie riêng cho host file. Không dùng lại `cookie` ở trên: chuỗi
          // đó được lấy cho origin của domain cloud, và jar của `tough-cookie`
          // lọc theo host — gửi nó sang `tt-files-wpa…` là gửi một cookie
          // không dành cho nơi nhận.
          fileCookie: fileUrl
            ? ctx.cookie.getCookieStringSync?.(new URL(fileUrl).origin) ?? ''
            : '',
          // Trùng tên máy như Zalo PC (`$znode.os.hostname()`). Trường này máy chủ
          // chỉ dùng để hiển thị trên điện thoại khi hỏi xác nhận.
          pcName: hostname(),
        };
        return null;
      });
      (client as unknown as { __glassCapture: () => void }).__glassCapture();
      cloudSession = box.value;
      events.debug?.('cloud-session', {
        ok: cloudSession !== null, baseUrl: cloudSession?.baseUrl ?? null,
        // Độ dài khoá, không phải khoá: đủ để phát hiện "AES-128 hay AES-256".
        keyBytes: cloudSession ? Buffer.from(cloudSession.secretKey, 'base64').length : null,
        // **Tên** cookie gửi kèm cho host cloud — không giá trị, không độ dài giá
        // trị. Cần thiết vì `604` có thể là "thiếu cookie phiên", và cookie đặt
        // trên `chat.zalo.me` không tự động đi sang host con `tt-group-cm...`.
        cookieNames: cloudSession
          ? cloudSession.cookie.split('; ').filter(Boolean).map(pair => pair.split('=')[0]).sort()
          : null,
        // Tên cookie của host **file** — nơi `/api/transfer-sync-v2/*` thật sự
        // nằm. Hai danh sách này khác nhau là chuyện bình thường (jar lọc theo
        // host); chúng **giống hệt** nghĩa là `fileUrl` và `url` cùng origin và
        // phép tách này không có tác dụng gì.
        fileHost: cloudSession?.fileBaseUrl ?? null,
        fileHosts: cloudSession?.fileBaseUrls ?? null,
        fileCookieNames: cloudSession
          ? cloudSession.fileCookie.split('; ').filter(Boolean).map(pair => pair.split('=')[0]).sort()
          : null,
      });
    } catch (error) {
      events.debug?.('cloud-session', {
        ok: false, message: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  /**
   * Ghi danh sách endpoint WS máy chủ cấp — phép đo của hướng B.
   *
   * Câu hỏi hẹp: `zpw_ws` có mục nào là socket **điều khiển** không? Zalo PC mở
   * hai socket (`enable_chat_socket` / `enable_ctrl_socket` trong cùng settings),
   * còn zca-js mở một, từ chính danh sách này. `transfer_after_login` — nguồn
   * duy nhất của `temp_key` — đi trên socket điều khiển. Không thấy nó trong log
   * suốt 711 dòng, và trước khi viết socket thứ hai thì phải biết nó ở đâu.
   *
   * **Đọc `ctx` qua `custom` là cách duy nhất**: `API` không giữ `ctx` công khai,
   * và `custom` là cửa zca-js mở cho việc này. Chạy **luôn**, không sau cờ: đây
   * là một lần đọc bộ nhớ đã có sẵn, không gọi mạng, không gửi gì lên máy chủ,
   * và câu trả lời cần cho lần chạy thật kế tiếp — bắt người dùng nhớ thêm một
   * biến môi trường nữa chỉ để đọc một danh sách là cái giá không đáng.
   */
  function reportWsEndpoints(client: API): void {
    try {
      // Gộp `ctx` với `zpwServiceMap` của `api`: service map sống trên `api`,
      // không trên `ctx` (xem `describeWsEndpoints`). Thiếu bước này thì phép đo
      // báo `serviceMapKeys: 0` — đúng cái đã xảy ra ở lần đo đầu.
      const box: { value: unknown } = { value: null };
      client.custom('__glassWsEndpoints', ({ ctx }) => {
        box.value = {
          ...(ctx as unknown as Record<string, unknown>),
          zpwServiceMap: (client as unknown as { zpwServiceMap?: unknown }).zpwServiceMap,
        };
        return null;
      });
      (client as unknown as { __glassWsEndpoints: () => void }).__glassWsEndpoints();
      events.debug?.('ws-endpoints', { ...describeWsEndpoints(box.value) });
    } catch (error) {
      events.debug?.('ws-endpoints', {
        ok: false, message: error instanceof Error ? error.message.slice(0, 120) : 'unknown',
      });
    }
  }

  /**
   * Cùng một yêu cầu `getoldv2`, nhưng qua `utils` của zca-js thay vì mã tự viết.
   *
   * Chỉ dùng cho phép đối chứng `GLASS_CLOUD_VIA=zca`. Mục đích là **loại trừ
   * biến số**: AES, cookie jar, header và cách giải hai lớp đều do zca-js làm,
   * giống hệt những API đang chạy được (`getGroupChatHistory`). Nếu đường này
   * thành công thì lỗi nằm ở bản tự viết; nếu cũng hỏng thì nguyên nhân ở nơi
   * khác, và bản tự viết không bị kết luận oan.
   */
  async function viaZcaUtils(
    threadId: string, globalMsgId: string,
  ): Promise<{ error?: { code: number | string; message: string }; count?: number;
    hasMore?: boolean; isOld?: boolean; lastMsgId?: string }> {
    if (!cloudSession || !cloudUtils) return { error: { code: 'no-session', message: 'no session' } };
    const utils = cloudUtils;
    const params = {
      groupId: threadId.replace(/^g/, ''),
      globalMsgId,
      count: HISTORY_PAGE,
      msgIds: [] as string[],
      imei: cloudSession.imei,
      src: -1,
    };
    let encoded: string | null;
    try {
      encoded = utils.encodeAES(JSON.stringify(params));
    } catch (error) {
      return { error: { code: 'crypto', message: error instanceof Error ? error.message : 'unknown' } };
    }
    if (!encoded) return { error: { code: 'crypto', message: 'encodeAES trả null' } };
    // `/api/cm/getrecentv2` là biến thể "trang mới nhất" của cùng endpoint; Zalo PC
    // gọi nó khi **không** lật về cũ. Thử được cả hai mới phân biệt được "máy chủ
    // không cho host này" với "tham số `globalMsgId` sai".
    const endpoint = process.env.GLASS_CLOUD_ENDPOINT === 'recent' ? 'getrecentv2' : 'getoldv2';
    // Hai host đều có thật trong Zalo: cấu hình của Zalo PC dùng
    // `https://group-cm.api.zalo.me`, còn `zpw_service_map_v3.group_cloud_message`
    // của phiên này trả `https://tt-group-cm.chat.zalo.me`. Cho phép chọn để đo.
    const host = process.env.GLASS_CLOUD_HOST ?? cloudSession.baseUrl;
    let url = utils.makeURL(`${host}/api/cm/${endpoint}`, { params: encoded });
    // `makeURL` luôn điền `zpw_ver`/`zpw_type` của ctx. Zalo PC gửi `zpw_ver=695`;
    // cho phép ghi đè bằng biến môi trường để đo đúng biến số đó thay vì đoán.
    const overrideVersion = process.env.GLASS_CLOUD_VER;
    if (overrideVersion) {
      const parsed = new URL(url);
      parsed.searchParams.set('zpw_ver', overrideVersion);
      url = parsed.toString();
    }
    // Ghi lại đúng chuỗi truy vấn đang gửi (đã che `params`): nếu số phiên bản
    // lệch với Zalo PC thì đây là chỗ duy nhất thấy được.
    events.debug?.('cloud-query', {
      query: url.replace(/params=[^&]+/, 'params=<redacted>'),
    });
    try {
      const response = await utils.request(url, { method: 'GET' });
      const data = await utils.resolve(response) as { groupMsgs?: unknown[]; hasMore?: boolean;
        isOld?: boolean; lastMsgId?: string } | null;
      return {
        count: Array.isArray(data?.groupMsgs) ? data.groupMsgs.length : 0,
        hasMore: Boolean(data?.hasMore), isOld: Boolean(data?.isOld),
        lastMsgId: data?.lastMsgId != null ? String(data.lastMsgId) : undefined,
      };
    } catch (error) {
      // `resolve` ném `ZaloApiError` mang đúng `code` máy chủ trả.
      const code = (error as { code?: number | string })?.code;
      return { error: { code: code ?? 'error', message: error instanceof Error ? error.message : 'unknown' } };
    }
  }

  /**
   * Gửi **một** yêu cầu `/api/cm/getoldv2` và ghi lại đúng thứ máy chủ trả.
   *
   * Không có cổng nào ở đây: người gọi quyết định khi nào được gọi. Tách khỏi
   * `fetchCloudPage` để phần đo đối chứng (`GLASS_CLOUD_PROBE`) gọi được mà
   * không phải đi qua UI — bấm nút trong danh sách hội thoại là cách duy nhất
   * trước đó, và nó chỉ chạm được hội thoại đang hiện.
   */
  async function requestCloudPage(
    threadId: string, kind: ThreadKind, globalMsgId: string,
  ): Promise<CloudHistoryPage | null> {
    if (!cloudSession) return null;
    // Đối chứng qua chính `utils` của zca-js: nếu đường này cũng 604 thì lỗi
    // không nằm ở phần mã hoá/HTTP ta tự viết mà ở chỗ khác (tham số, quyền,
    // hoặc máy chủ thật sự không cho endpoint này cho tài khoản đó).
    if (process.env.GLASS_CLOUD_VIA === 'zca') {
      const page = await viaZcaUtils(threadId, globalMsgId);
      events.debug?.('cloud-history', { via: 'zca', kind, threadId, asked: globalMsgId, ...page });
      return page.error
        ? { messages: [], hasMore: false, lastMsgId: null, isOld: false, error: page.error }
        : { messages: [], hasMore: Boolean(page.hasMore), lastMsgId: page.lastMsgId ?? null,
          isOld: Boolean(page.isOld) };
    }
    const page = await fetchCloudHistory({
      ...cloudSession,
      // `getCM` cắt tiền tố `g` trước khi gửi; id nhóm của app đã bỏ `g` từ đầu,
      // nhưng vẫn cắt cho khớp đúng dòng mã của Zalo PC.
      groupId: threadId.replace(/^g/, ''),
      kind,
      globalMsgId,
      count: HISTORY_PAGE,
      resolveName: uid => globalNames.get(uid),
    });
    events.debug?.('cloud-history', {
      kind, threadId, asked: globalMsgId,
      ok: !page.error, error: page.error?.code ?? null,
      // Chỉ thông điệp lỗi cắt ngắn — không cookie, không khoá, không nội dung tin.
      message: page.error ? page.error.message.slice(0, 120) : null,
      count: page.messages.length, first: page.messages[0]?.msgId ?? null,
      last: page.messages.at(-1)?.msgId ?? null,
      serverLast: page.lastMsgId, hasMore: page.hasMore, isOld: page.isOld,
    });
    return page;
  }

  /**
   * Lùi trang bằng cloud — đúng đường Zalo PC dùng cho **nhóm**.
   *
   * Zalo PC chỉ mở `getoldv2` cho id bắt đầu bằng `g` (`apiEnable`), nên đường
   * này **chỉ dành cho nhóm**: `GLASS_CLOUD_HISTORY=group|all` bật nó. `=1` là
   * cờ riêng của phép đo 1-1 (xem dưới) và không mở đường nhóm.
   *
   * Mặc định tắt vì phép đo 2026-11-08 cho thấy endpoint trả `604 SESSION` cho
   * cả hai loại; khi nó từ chối, `getGroupChatHistory` phía dưới là đường lùi.
   *
   * Trả `null` khi không bật cờ, chưa có phiên, hoặc máy chủ từ chối — người gọi
   * rơi về đường cũ. Trang rỗng có `error` là dữ liệu cần ghi lại, không được
   * nuốt thành "hết lịch sử".
   */
  async function fetchCloudPage(
    threadId: string, kind: ThreadKind, before?: string,
  ): Promise<{ messages: StoreMessage[]; hasMore: boolean } | null> {
    const mode = process.env.GLASS_CLOUD_HISTORY;
    const groupsEnabled = mode === 'group' || mode === 'all';
    const userEnabled = mode === '1' || mode === 'all';
    if (!(kind === 'group' ? groupsEnabled : userEnabled)) return null;
    if (!cloudSession) return null;
    // Mốc dự phòng chỉ có nghĩa với 1-1: `userHistoryCursor` là con trỏ của
    // listener `cmd 510` cho hội thoại 1-1. Dùng nó cho một nhóm là gửi nhầm
    // `msgId` của hội thoại khác — máy chủ sẽ từ chối, và phép đo đọc thành
    // "nhóm cũng bị chặn" trong khi thật ra ta hỏi sai. Nhóm không có mốc thì
    // hỏi từ `"0"` (mới nhất), đúng như `getCM` mặc định.
    // `isServerMsgId` cũng áp cho `before`: người gọi có thể truyền lại con trỏ
    // đọc từ một hàng có khoá cục bộ, và gửi chuỗi đó lên máy chủ là cùng một
    // lỗi ở một cửa khác.
    const fromCaller = before && isServerMsgId(before) ? before : null;
    const globalMsgId = fromCaller ?? (kind === 'user' && isServerMsgId(userHistoryCursor)
      ? userHistoryCursor : null) ?? '0';
    const page = await requestCloudPage(threadId, kind, globalMsgId);
    if (!page || page.error) return null;
    return { messages: page.messages, hasMore: page.hasMore };
  }

  /**
   * Lùi trang cho **1-1** — đúng cách Zalo PC làm: đọc DB cục bộ, không gọi cloud.
   *
   * Trong `loadTopMessageForConversation` của Zalo PC, khi `apiEnable` trả `false`
   * (mọi hội thoại không phải nhóm) thì code đọc SQLite và `return` ngay trước
   * mọi lời gọi cloud. Tin 1-1 cũ có trong DB vì đồng bộ điện thoại
   * (`pull_mobile_msg`, E2EE) đã đổ vào — đó là phần chưa làm ở đây, nên trang
   * này có thể rỗng dù Zalo trên điện thoại còn tin.
   *
   * `pageMessages` chỉ đọc những gì đã cache; nó không tự gọi mạng. `hasMore`
   * của nó nói về **DB** — với Zalo PC đó là toàn bộ câu trả lời, vì DB của nó
   * đã đầy nhờ đồng bộ điện thoại. App này chưa có đồng bộ đó nên `hasMore`
   * `false` chỉ nghĩa "hết phần đã cache"; `fetchFromServer` mới là chỗ quyết
   * định có đổ thêm vào cache hay không.
   */
  function pageFromCache(
    threadId: string, kind: ThreadKind, before?: string,
  ): { messages: StoreMessage[]; hasMore: boolean } | null {
    if (!db) return null;
    const store = db;
    return safe('pageLocal', () => pageMessages(store, threadId, kind, HISTORY_PAGE, before ?? null));
  }

  /**
   * Đối chứng một lần, không qua UI: `GLASS_CLOUD_PROBE=<id>:<user|group>`.
   *
   * Cần thiết vì Zalo PC chỉ gọi cloud cho nhóm. Nếu một nhóm đã biết trả lỗi
   * giống hệt hội thoại 1-1 thì lỗi nằm ở hình dạng request của ta, và kết quả
   * 1-1 không nói gì về việc máy chủ có chặn 1-1 hay không. Không có cờ thì
   * hàm này không làm gì.
   *
   * Nhiều mục cách nhau bằng dấu phẩy, để 1-1 và nhóm được hỏi trong **cùng một
   * phiên**: hai lần chạy khác phiên thì không loại trừ được biến thiên của
   * phiên, mà đó chính là thứ phép đối chứng cần loại trừ.
   */
  async function runCloudProbe(): Promise<void> {
    const spec = process.env.GLASS_CLOUD_PROBE;
    if (!spec) return;
    for (const entry of spec.split(',')) {
      const [threadId, rawKind] = entry.trim().split(':');
      if (!threadId) continue;
      // Mục `baseline:<id>` gọi `getGroupChatHistory` — API của zca-js mà đường
      // nhóm vẫn dùng hằng ngày. Nếu nó chạy được trong cùng phiên thì phiên và
      // mạng đều ổn, nên mã lỗi 604 của `getoldv2` là **máy chủ trả lời**, không
      // phải phiên hỏng hay request không tới nơi.
      if (rawKind === 'baseline') {
        const history = await api?.getGroupChatHistory(threadId, 5).catch((error: unknown) => ({ error }));
        const failure = history as { error?: unknown };
        events.debug?.('cloud-baseline', {
          threadId,
          ok: history !== undefined && !('error' in (history as object)),
          count: (history as { groupMsgs?: unknown[] })?.groupMsgs?.length ?? null,
          // Mã lỗi và thông điệp của chính zca-js — để biết baseline hỏng vì mạng,
          // vì phiên, hay vì máy chủ, chứ không phải chỉ "hỏng".
          code: (failure.error as { code?: unknown })?.code ?? null,
          message: failure.error instanceof Error
            ? failure.error.message.slice(0, 120)
            : typeof failure.error === 'string' ? failure.error.slice(0, 120) : null,
        });
        continue;
      }
      const kind: ThreadKind = rawKind === 'group' ? 'group' : 'user';
      // Mục `other:*` gọi một API chắc chắn không liên quan tới lịch sử cloud.
      // Nếu nó cũng hỏng thì phiên hiện tại không dùng được API nào, và mọi mã
      // lỗi của `getoldv2` đều vô nghĩa — phải biết điều đó trước khi kết luận.
      if (rawKind === 'other') {
        // `getAllFriends` là lời gọi mạng thật, không liên quan tới cloud history.
        const friends = await api?.getAllFriends(100, 1).catch((error: unknown) => ({ error }));
        events.debug?.('cloud-other', {
          ok: Array.isArray(friends),
          count: Array.isArray(friends) ? friends.length : null,
          message: !Array.isArray(friends) && (friends as { error?: unknown })?.error instanceof Error
            ? ((friends as { error: Error }).error.message).slice(0, 120) : null,
        });
        continue;
      }
      // Không truyền mốc: hỏi trang mới nhất, đúng mặc định `globalMsgId: "0"`
      // của `getCM`. Đây là phép đo khả năng gọi, không phải phân trang.
      await requestCloudPage(threadId, kind, '0');
    }
  }

  /**
   * Phép đo cửa vào của đường đồng bộ điện thoại: `GLASS_SYNC_PROBE=1`.
   *
   * Mục đích duy nhất là trả lời *máy chủ có chấp nhận client này không* trước
   * khi đầu tư dựng máy trạng thái đồng bộ. Nó gửi một `public_key` sinh đúng
   * định dạng nhưng vứt đi ngay: nếu máy chủ từ chối phiên thì trả `604` ngay,
   * không cần khoá thật; nếu phiên được chấp nhận thì mới phàn nàn về
   * `temp_key`/`from_seq_id`. Hai câu trả lời đó khác nhau, và đó là toàn bộ
   * thứ phép đo cần.
   *
   * Khoá **phải** là RSA-2048 `spki`/`der` base64 — lần đo đầu gửi X25519 và
   * nhận `114`, một câu trả lời vô nghĩa vì máy chủ không thể mã hoá gói tin
   * cho một khoá sai loại.
   *
   * Không có cờ thì hàm này không làm gì — không lời gọi mạng nào.
   */
  async function runSyncProbe(): Promise<void> {
    if (!process.env.GLASS_SYNC_PROBE) return;
    if (!cloudSession) {
      events.debug?.('sync-probe', { ok: false, reason: 'no-session' });
      return;
    }
    const { fileBaseUrl, pcName, imei, secretKey, userAgent, apiVersion, apiType } = cloudSession;
    if (!fileBaseUrl) {
      // Service map không có `file`: ghi đúng thế. Đoán một domain rồi nhận `604`
      // sẽ dẫn tới kết luận sai là "máy chủ chặn", trong khi thật ra ta gọi sai chỗ.
      events.debug?.('sync-probe', { ok: false, reason: 'no-file-domain' });
      return;
    }
    const result = await probePullMobileMsg({
      baseUrl: fileBaseUrl,
      pcName,
      // RSA-2048 `spki`/`der` base64, đúng thứ `SyncMessageKeyGenerator` của Zalo
      // PC sinh ra. Sinh rồi vứt — phép đo không giải gói tin nào.
      publicKey: generateSyncPublicKey(),
      fromSeqId: 0,
      tempKey: '',
      imei, secretKey, userAgent, apiVersion, apiType,
      cookie: cloudSession.cookie,
    });
    events.debug?.('sync-probe', {
      ok: result.code === 0,
      code: result.code,
      message: result.message.slice(0, 160),
      url: result.url,
      publicKeyBytes: result.publicKeyBytes,
      // Hình dạng `data` trả về: khoá con, số ký tự, số byte base64. Không có
      // nội dung. Đây là thứ phân biệt "máy chủ nhận request" với "máy chủ có
      // dữ liệu để đưa" — lần đo đầu vứt bỏ nó nên chỉ trả lời được vế đầu.
      payload: result.payload,
      // `604` = `Common.SESSION` trong enum lỗi của Zalo PC: cùng mã `getoldv2`
      // trả. Nếu thấy nó ở đây thì lỗi ở tầng phiên, không phải ở hình dạng
      // request — và cả hướng đồng bộ điện thoại dừng ở đây.
      verdict: result.code === 604 ? 'session-rejected'
        : result.code === 0 ? 'accepted'
          : typeof result.code === 'number' ? 'server-error'
            : 'client-error',
    });
  }

  /**
   * Hàng đợi điều khiển máy chủ cấp trong `1/1`, ghi lại bởi `runAuthProbe`.
   *
   * Vì sao là **biến**, không phải giá trị trả về: `1/1` tới trên sự kiện
   * socket, không có lời gọi nào để chờ. `runCtrlPollProbe` chạy sau đó cần
   * đúng danh sách này — poll `603` bằng một con số đoán là đúng cách đã thất
   * bại ở lần đo trước.
   */
  let pendingControlQueues: Array<{ cmd: number; subCmd: number | null; priority: number | null; queueName: string | null; queueNameType: string; keys: string[] }> = [];

  /**
   * Phép đo thứ ba: long-poll điều khiển `cmd 603`.
   *
   * Câu hỏi: `601` có đến được qua **socket zca-js đang dùng** không?
   *
   * R14 tìm ra đường thật trong mã Zalo PC: `ctr-handler` là một hàng đợi
   * long-poll, và `doGetOffline` của nó gửi bằng `this.socket._send(...)` —
   * **cùng WebSocket**, chỉ khác `cmd`. Không có kết nối thứ hai nào. Nghĩa là
   * vấn đề không phải "thiếu socket", mà là "chưa ai hỏi".
   *
   * Hình dạng lấy nguyên văn từ `doGetOffline` (`compact-app-pc…js`):
   *
   *     { cmd, subCmd: 0,
   *       data: { first, reqId, lastId: '1', preIds: [] } }
   *
   * `lastId: '1'` là mốc "từ đầu" mà Zalo PC dùng cho một hàng đợi chưa từng
   * đọc: nó không xin phần bù kể từ một mốc, nó xin cả hàng đợi.
   *
   * Chỉ chạy sau `GLASS_CTRL_POLL_PROBE`, và **không** làm gì khác: không mở
   * phiên đồng bộ, không gửi `590`, không chạm `temp_key`. Gửi `603` là đăng ký
   * nhận sự kiện điều khiển — đúng việc Zalo PC làm ở mỗi lần đăng nhập.
   */
  async function runCtrlPollProbe(): Promise<void> {
    if (!process.env.GLASS_CTRL_POLL_PROBE) return;
    const listener = safe('listenerForProbe', () => api?.listener);
    if (!listener) {
      events.debug?.('ctrl-poll-probe', { ok: false, reason: 'no-listener' });
      return;
    }
    if (!(await waitForSocketOpen(listener, 10_000))) {
      events.debug?.('ctrl-poll-probe', { ok: false, reason: 'socket-not-open' });
      return;
    }
    // Hàng đợi do máy chủ cấp trong `1/1`. `runAuthProbe` (cùng cờ) đã ghi
    // `queueDetail`; ở đây poll **mọi** mục như `signalGetOffline` làm, không
    // chỉ `603` — `transfer_after_login` có thể nằm ở hàng khác, và đoán sai
    // một hàng là mất một vòng chạy thật.
    const queues = pendingControlQueues;
    if (queues.length === 0) {
      events.debug?.('ctrl-poll-probe', { ok: false, reason: 'no-queues', hint: 'bật GLASS_AUTH_PROBE để đọc 1/1' });
      return;
    }
    const stopWatching = watchFrames(listener);
    const sorted = [...queues].sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0));
    // `603` là **long-poll**, không phải một lần hỏi. `offline_timeout` của Zalo
    // PC là `48e4` ms (`compact-app-pc`, `E` config) — máy chủ giữ yêu cầu mở và
    // chỉ trả lời khi có sự kiện, hoặc khi hết hạn đó. Cửa sổ 120 s của lần đo
    // trước ngắn hơn 4 lần, nên "im lặng" ở đó **không** chứng minh máy chủ bỏ
    // qua; nó chỉ chứng minh không có sự kiện nào trong 120 s.
    //
    // Vì vậy: giữ nghe 10 phút, và gửi lại mỗi hàng đợi mỗi 60 s. Gửi lại là
    // đúng cách một long-poll bị ngắt được nối lại — nhưng phải **sau** khi lần
    // trước im, không chồng lên nó.
    const POLL_WINDOW_MS = 600_000;
    const REPOLL_MS = 60_000;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const pollOnce = (queue: typeof sorted[number]): void => {
      // Cùng hình dạng `doGetOffline`: `first`, `reqId`, `lastId`, `preIds`.
      // `lastId` để **chuỗi** `'1'`: `doGetOffline` khởi tạo bằng số `1` rồi ghi
      // đè bằng `getLastActionIdsForSocket(...)`, mà hàm đó trả `'1'` dạng chuỗi
      // cho hàng chưa từng đọc. Giá trị trên dây vì thế là chuỗi.
      const payload = {
        version: 1,
        cmd: queue.cmd,
        subCmd: queue.subCmd ?? 0,
        data: { first: true, reqId: `ctrl_${queue.cmd}_${Date.now().toString(36)}`, lastId: '1', preIds: [] },
      };
      try {
        listener.sendWs(payload as unknown as Parameters<typeof listener.sendWs>[0], false);
        events.debug?.('ctrl-poll-probe', {
          ok: true, cmd: payload.cmd, subCmd: payload.subCmd, sent: true,
        });
      } catch (error) {
        events.debug?.('ctrl-poll-probe', {
          ok: false, reason: 'send-threw', cmd: payload.cmd, subCmd: payload.subCmd,
          message: error instanceof Error ? error.message.slice(0, 160) : 'unknown',
        });
      }
    };
    for (const queue of sorted) {
      pollOnce(queue);
      // Chỉ lặp lại với `603`: `610`/`611` đã trả lời ngay trong lần đo trước, nên
      // gửi lại chúng chỉ tạo nhiễu. `603` là hàng duy nhất im lặng.
      if (queue.cmd === 603) {
        for (let at = REPOLL_MS; at < POLL_WINDOW_MS; at += REPOLL_MS) {
          timers.push(setTimeout(() => pollOnce(queue), at));
        }
      }
    }
    events.debug?.('ctrl-poll-probe', {
      ok: true, step: 'window', ms: POLL_WINDOW_MS, repollMs: REPOLL_MS,
      cmds: sorted.map(queue => queue.cmd),
    });
    setTimeout(() => {
      for (const timer of timers) clearTimeout(timer);
      stopWatching();
    }, POLL_WINDOW_MS);
  }

  /**
   * Phép đo `cmd 592`, tách khỏi cả phiên đồng bộ: `GLASS_WAKE_PROBE=1`.
   *
   * Vì sao phải tách: đo `592` bên trong cả phiên làm hai ẩn số chồng lên nhau —
   * một lần đo không còn nói được cái nào sai.
   *
   * Phép đo này gửi **đúng một** khung `592` với một `syncId` sinh mới, rồi ghi
   * kết quả: khớp `reqId` hay không, `code` bao nhiêu, mất bao lâu. Không kèm
   * `590`: `590` đã bị gỡ hẳn (xem `runWakeProbe` phía dưới và báo cáo), và một
   * phiên thật mở bằng đường HTTP `request-sync`.
   *
   * Bật cờ này **có thể làm điện thoại rung**: đây đúng là khung Zalo PC gửi khi
   * người dùng bấm đồng bộ. Đó là lý do nó nằm sau một cờ riêng.
   */
  async function runWakeProbe(): Promise<void> {
    if (!process.env.GLASS_WAKE_PROBE) return;
    const listener = safe('listenerForProbe', () => api?.listener);
    if (!listener) {
      events.debug?.('wake-probe', { ok: false, reason: 'no-listener' });
      return;
    }
    // `syncId` ở đây **không** thuộc phiên nào — không có phiên. Nó chỉ cần đúng
    // hình dạng (32 ký tự) để máy chủ nhận, và để log đọc được là phép đo này
    // không tự nhận là phiên thật.
    // `syncId` 32 ký tự — đúng `generateRandomString(32)` của Zalo PC. Lần đo
    // trước dùng 21 ký tự và máy chủ vẫn nhận, nhưng không có lý do gì gửi một
    // hình dạng khác hình dạng thật khi ta đang hỏi "đường này có chạy không".
    const syncId = Array.from({ length: 32 }, () =>
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[
        Math.floor(Math.random() * 62)]).join('');
    // Nghe **mọi** khung trong lúc đo, không chỉ `592`. Lần đo đầu chỉ chờ đúng
    // `592` và kết luận "không có phản hồi" — nhưng một phản hồi trên cmd khác
    // cũng là câu trả lời, chỉ khác chỗ đọc. Không có bộ nghe này thì hai khả
    // năng đó không phân biệt được.
    const stopWatching = watchFrames(listener);
    if (!(await waitForSocketOpen(listener, 10_000))) {
      events.debug?.('wake-probe', { ok: false, reason: 'socket-not-open' });
      stopWatching();
      return;
    }
    // KHÔNG gửi `590` ở đây. Đo 2026-11-09 17:39 chốt lại điều đó bằng một phép
    // so trực tiếp: `590` được máy chủ nhận (`errorCode: 0`), nhưng sự kiện điện
    // thoại trả về mang `sid: false` — `syncId` không phải của phiên ta — và
    // `pk: false` — `public_key` cũng không phải `ik` ta gửi. Nghĩa là `590` làm
    // điện thoại rung và hiện thông báo, nhưng không có phiên nào của ta phía sau
    // để nó đẩy dữ liệu tới. Đó đúng là triệu chứng "ấn vào không thấy gì", và
    // gửi thêm `590` chỉ tái tạo nó.
    //
    // Lý do sâu hơn, đọc từ bundle: `ik` của Zalo PC là
    // `IdentityKeyManager.getIdentityKeyPair()` — cặp khoá định danh **E2EE của
    // tài khoản**, đã đăng ký với máy chủ qua prekey bundle và đã chia sẻ với
    // điện thoại. `loadIdentity` của ta sinh một cặp mới mà cả hai bên chưa từng
    // thấy, nên điện thoại không có khoá nào để niêm phong gói cho ta.
    //
    // `592` đi một mình: nó chỉ đánh thức thiết bị theo `syncId`, và câu hỏi của
    // phép đo là "máy chủ có trả lời trên cùng cmd hay không" — câu đó không phụ
    // thuộc vào việc ta có mở được phiên hay không.
    //
    // Hệ quả phải nói rõ: **không có phiên nào tồn tại** ở đây, nên `592` chỉ có
    // thể im lặng hoặc từ chối. Đó là kết quả đúng của phép đo này, không phải
    // hỏng hóc — và nó khác hẳn "máy chủ bỏ qua `592`".
    const wakeStarted = Date.now();
    const woken = await sendWakeMobile(listener, syncId);
    events.debug?.('wake-probe', {
      ...(woken.ok
        ? { ok: true, cmd: 592, reply: true }
        : { ok: false, cmd: 592, code: woken.code, message: woken.message }),
      elapsedMs: Date.now() - wakeStarted,
    });
    // Mở cửa sổ nghe dài: gói đầu tiên chỉ tới sau khi người dùng bấm xác nhận
    // trên điện thoại, và cửa sổ đó do con người quyết định. `frame-summary`
    // của `stopWatching` là chỗ đọc kết quả — nó liệt kê mọi cmd đã về, kể cả
    // `601` (gói) mà `watchFrames` giờ cũng ghi `act`/`act_type`.
    setTimeout(stopWatching, 600_000);
  }

  /**
   * Theo dõi khung điều khiển `601` trong một cửa sổ dài, **không gửi gì**.
   * `GLASS_CTRL_WAIT=1`.
   *
   * Đây là phép đo thay cho `GLASS_HTTP_SYNC_PROBE`. Đường HTTP
   * (`/api/transfer-sync-v2/request-sync`, `commandId 12888`) đã được đo và
   * **không tồn tại**: `404 text/html` từ nginx trên cả 44 host của service map,
   * trong khi endpoint khác cùng host trả JSON `error_code: 600`. Giữ lại phép
   * đo đó chỉ sinh thêm log `404`.
   *
   * Thứ còn thiếu để chạy đường thật là **`temp_key`**, và nó chỉ đến qua khung
   * điều khiển `601` với `act: "transfer_after_login"`. Ba lần đo trước không
   * lần nào bắt được một khung `601` nào. Hai lý do khả dĩ, và phép đo này phân
   * biệt chúng bằng thời gian chứ không bằng suy đoán:
   *
   * - Server chỉ đẩy `601` khi có sự kiện (điện thoại vừa đăng nhập, hoặc thiết
   *   bị khác vừa yêu cầu đồng bộ) — nên phải **ngồi chờ**, không phải "hỏi rồi
   *   mong có trả lời".
   * - Kênh điều khiển không hoạt động với đường đăng nhập của ta.
   *
   * Cửa sổ 15 phút: đủ để người dùng mở điện thoại, đăng nhập lại tài khoản phụ,
   * và chờ Zalo trên điện thoại đẩy sự kiện sang. `watchFrames` ghi `act`/
   * `act_type`/`hasTempKey` cho mọi `601` nên kết quả đọc thẳng từ log.
   */
  async function runCtrlWaitProbe(): Promise<void> {
    if (!process.env.GLASS_CTRL_WAIT) return;
    const listener = safe('listenerForProbe', () => api?.listener);
    if (!listener) {
      events.debug?.('ctrl-wait', { ok: false, reason: 'no-listener' });
      return;
    }
    if (!(await waitForSocketOpen(listener, 30_000))) {
      events.debug?.('ctrl-wait', { ok: false, reason: 'socket-not-open' });
      return;
    }
    const WINDOW_MS = 900_000;
    events.debug?.('ctrl-wait', { ok: true, step: 'window', ms: WINDOW_MS, sends: 0 });
    const stop = watchFrames(listener);
    setTimeout(stop, WINDOW_MS);
  }

  /**
   * Đọc **hình dạng** của khung auth `1/1`: máy chủ có cấp hàng đợi điều khiển
   * (`ctrl_qCmds`) không, và cấp cho những `cmd` nào.
   *
   * Câu hỏi hẹp nhưng quyết định. `transfer_after_login` — nguồn của `temp_key`
   * — đến qua hàng đợi điều khiển: `onAuthenticated` của ctr-handler đọc
   * `e.data.ctrl_qCmds` để biết phải long-poll những `cmd` nào, rồi
   * `signalGetOffline()` → `doGetOffline(cmd, subCmd, …)` cho từng cái
   * (`compact-app-pc:130937-130943`). zca-js đọc `1/1` **chỉ** để lấy `cipherKey`
   * và bỏ toàn bộ phần còn lại (`dist/apis/listen.js:158-166`), nên nếu
   * `ctrl_qCmds` có ở đó thì đây là chỗ duy nhất thấy được nó từ phía ta.
   *
   * Chỉ ghi **số lượng và các cmd** — đó là giao thức, không phải dữ liệu người
   * dùng. Không ghi token, không ghi nội dung.
   */
  function describeAuthQueues(payload: unknown): Record<string, unknown> {
    const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const data = root.data && typeof root.data === 'object'
      ? root.data as Record<string, unknown> : null;
    if (!data) return { ok: false, reason: 'no-data' };
    const queues = data.ctrl_qCmds;
    const backup = data.bk_cmds;
    const cmdsOf = (list: unknown): number[] | null => {
      if (!Array.isArray(list)) return null;
      const out: number[] = [];
      for (const item of list) {
        const cmd = (item as { cmd?: unknown } | null)?.cmd;
        if (typeof cmd === 'number') out.push(cmd);
      }
      return out;
    };
    // `signalGetOffline` của Zalo PC gửi `doGetOffline(e.cmd, e.subCmd, …)` cho
    // **từng** mục, nên `subCmd` mới là thứ cần để long-poll đúng hàng đợi.
    // `priority` là trường sắp thứ tự gửi (`e.sort((a,b)=>b.priority-a.priority)`).
    const queueDetail = Array.isArray(queues)
      ? queues.map(item => {
        const record = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
        return {
          cmd: typeof record.cmd === 'number' ? record.cmd : null,
          subCmd: typeof record.subCmd === 'number' ? record.subCmd : null,
          priority: typeof record.priority === 'number' ? record.priority : null,
          // `queueName` là nhãn giao thức do máy chủ đặt (`transfer`, `ctrl`, …),
          // không phải dữ liệu người dùng. Đây là thứ duy nhất nói được hàng đợi
          // **nào** chở `transfer_msg` mà không phải thử từng hàng một.
          queueName: typeof record.queueName === 'string' ? record.queueName.slice(0, 40) : null,
          queueNameType: Array.isArray(record.queueName) ? 'array' : typeof record.queueName,
          // Tên khoá của chính mục hàng đợi.
          keys: Object.keys(record).sort(),
        };
      })
      : null;
    return {
      ok: true,
      // `keys` đã sắp xếp: đọc được máy chủ gửi thêm gì mà không lộ giá trị.
      keys: Object.keys(data).sort(),
      ctrlQCmds: Array.isArray(queues) ? queues.length : null,
      ctrlQCmdIds: cmdsOf(queues),
      queueDetail,
      // `qCmds` là hàng **E2EE**, do `E2eeQueueOfflineController` long-poll riêng
      // (`onAuthenticated` của nó đọc `e.data.qCmds`). Ghi số lượng và cmd để
      // biết nó có tồn tại hay không — nhưng `transfer_after_login` đi hàng
      // `ctrl_qCmds`, không phải hàng này.
      qCmds: Array.isArray(data.qCmds) ? data.qCmds.length : null,
      qCmdIds: cmdsOf(data.qCmds),
      backupCmds: Array.isArray(backup) ? backup.length : null,
      backupCmdIds: cmdsOf(backup),
    };
  }

  /**
   * Nghe khung auth `1/1` và ghi hình dạng hàng đợi điều khiển. `GLASS_AUTH_PROBE=1`.
   *
   * Chạy **trước** khi frame auth về — hàm này được gọi ngay sau `startListener()`,
   * còn `1/1` tới ngay sau khi socket mở. Khung auth đi qua zca-js trước (nó đặt
   * `cipherKey`), nhưng `payload` ở đây đọc thẳng từ thân frame nên không phụ
   * thuộc thứ tự đó.
   */
  function runAuthProbe(): void {
    if (!process.env.GLASS_AUTH_PROBE) return;
    const listener = safe('listenerForProbe', () => api?.listener);
    const socket = listener ? (listener as unknown as { ws?: WebSocket }).ws : null;
    if (!socket || typeof socket.addEventListener !== 'function') {
      events.debug?.('auth-probe', { ok: false, reason: 'no-socket' });
      return;
    }
    const onMessage = (event: MessageEvent): void => {
      const raw: unknown = event.data;
      const bytes = raw instanceof Uint8Array ? raw
        : raw instanceof ArrayBuffer ? new Uint8Array(raw) : null;
      if (!bytes) return;
      const header = decodeWsFrameHeader(bytes);
      if (!header || header.version !== 1 || header.cmd !== 1) return;
      let outer: unknown;
      try {
        outer = JSON.parse(new TextDecoder().decode(bytes.subarray(4)));
      } catch {
        events.debug?.('auth-probe', { ok: false, reason: 'not-json', subCmd: header.subCmd });
        return;
      }
      // Phong bì `1/1` giống mọi frame khác: `data` có thể là **chuỗi đã mã
      // hoá** (`t.data` bên `_processAuthData` của Zalo PC được `_decrypt` rồi
      // `_decompress` trước khi `JSON.parse`). Đọc thẳng `outer.data` như
      // object là bỏ sót toàn bộ nội dung — đúng lỗi của lần đo trước, khi
      // probe báo `no-data` trong khi `data` chỉ là một chuỗi.
      const cipherKey = (listener as unknown as { cipherKey?: string } | null)?.cipherKey;
      const record = (outer && typeof outer === 'object' ? outer : {}) as
        { encrypt?: unknown; data?: unknown };
      const encrypt = typeof record.encrypt === 'number' ? record.encrypt : 0;
      const handled = (): void => {
        let inner: unknown;
        try {
          if (record.data && typeof record.data === 'object') {
            inner = record.data;
          } else if (encrypt === 0 && typeof record.data === 'string') {
            inner = JSON.parse(record.data);
          } else {
            inner = unwrapPayload(encrypt, String(record.data ?? ''), cipherKey);
          }
        } catch (error) {
          events.debug?.('auth-probe', {
            ok: false, reason: 'decode', subCmd: header.subCmd, encrypt,
            hasCipherKey: typeof cipherKey === 'string' && cipherKey.length > 0,
            message: error instanceof Error ? error.message.slice(0, 120) : 'unknown',
          });
          return;
        }
        const described = describeAuthQueues(inner);
        const detail = described.queueDetail;
        if (Array.isArray(detail)) {
          // Gán **trước** khi poll: `runCtrlPollProbe` đọc đúng danh sách này.
          // Chỉ nhận mục có `cmd` là số — `doGetOffline` từ chối mọi thứ khác
          // (`"number" != typeof e → req offline invalid cmd`).
          pendingControlQueues = detail
            .filter((item): item is { cmd: number; subCmd: number | null; priority: number | null; queueName: string | null; queueNameType: string; keys: string[] } =>
              typeof item.cmd === 'number');
        }
        events.debug?.('auth-probe', {
          subCmd: header.subCmd,
          bodyBytes: header.bodyBytes,
          encrypt,
          ...described,
        });
        socket.removeEventListener('message', onMessage as EventListener);
        // Poll ngay khi có danh sách: chạy từ lúc khởi động sẽ thấy danh sách
        // rỗng (probe này còn chưa chạy), và bỏ lỡ đúng cửa sổ `1/1` vừa mở.
        if (process.env.GLASS_CTRL_POLL_PROBE && pendingControlQueues.length > 0) {
          void runCtrlPollProbe().catch(() => undefined);
        }
      };
      // zca-js gán `cipherKey` **trong** chính lượt xử lý `1/1` của nó
      // (`dist/apis/listen.js:151-158`), và `onmessage` của nó chạy trước hay
      // sau listener của ta là chuyện của thứ tự đăng ký. Hoãn một macrotask
      // là chắc chắn qua được cả hai thứ tự.
      setTimeout(handled, 0);
    };
    socket.addEventListener('message', onMessage as EventListener);
    events.debug?.('auth-probe', { ok: true, step: 'listening' });
  }

  /**
   * Chờ `listener.ws` mở, tối đa `timeoutMs`. Trả `false` nếu không mở kịp.
   *
   * Không dùng `ws.onopen` vì zca-js đã gán `onopen` của riêng nó; đặt đè sẽ
   * phá `connected` event của thư viện. Chỉ hỏi `readyState`.
   */
  function waitForSocketOpen(listener: unknown, timeoutMs: number): Promise<boolean> {
    const socket = (listener as { ws?: WebSocket }).ws;
    if (!socket) return Promise.resolve(false);
    if (socket.readyState === 1) return Promise.resolve(true);
    return new Promise<boolean>(resolve => {
      const started = Date.now();
      const tick = (): void => {
        if (socket.readyState === 1) { resolve(true); return; }
        if (socket.readyState > 1 || Date.now() - started > timeoutMs) { resolve(false); return; }
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  /**
   * Gửi `cmd 592` (`REQUEST_MOBILE_WAKE_UP`) và **chờ phản hồi khớp `reqId`**.
   *
   * Vì sao phải đánh thức: `temp_key` chỉ đến khi điện thoại đã mở một phiên
   * chuyển. Gửi `590` trước đó thì máy chủ nhận và trả **rỗng** — `errorCode: 0`
   * mà không có gì để đẩy. Đo 2026-11-09 xác nhận đúng hình dạng đó cho cả
   * `590` và `603`.
   *
   * Vì sao phải chờ: `wakeup()` của Zalo PC chỉ bắt đầu hẹn giờ nhận gói khi
   * `0 == e.code`. Đọc "đã gửi được" thành "đã đánh thức" là đúng cái bẫy đã
   * làm hỏng hai lần đo trước — một lần vì `sendWs` ném khi socket còn
   * `CONNECTING`, và kết quả `sent: true` ở các lần khác chỉ là may mắn về thời
   * điểm chứ không có bảo đảm nào.
   *
   * Phản hồi về trên **chính cmd 592** (`isApiCommand` → handler api →
   * `onData` tra `n.data.reqId`, `compact-app-pc:630456-630465`), không phải
   * trên kênh điều khiển `601` như tôi từng giả định. Chỉ hình dạng được ghi:
   * `code`, `keys`, không một byte nội dung.
   */
  async function sendWakeMobile(
    listener: unknown, syncId: string,
  ): Promise<{ ok: true } | { ok: false; code: number | string; message: string }> {
    if (!(await waitForSocketOpen(listener, 10_000))) {
      return { ok: false, code: 'no-socket', message: 'socket chưa mở' };
    }
    const socket = (listener as { ws?: WebSocket }).ws;
    if (!socket || typeof socket.addEventListener !== 'function') {
      return { ok: false, code: 'no-socket', message: 'socket không nghe được' };
    }
    const reqId = `wake_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const cipherKey = (listener as { cipherKey?: string }).cipherKey;

    // Gắn bộ nghe **trước** khi gửi: `592` là lệnh nhẹ, phản hồi có thể về trong
    // cùng một vòng lặp sự kiện.
    type Attempt =
      | { kind: 'reply'; reply: WakeReply }
      | { kind: 'timeout' }
      | { kind: 'send-threw'; message: string };
    const attempt = await new Promise<Attempt>(resolve => {
      let settled = false;
      const finish = (value: Attempt): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.removeEventListener('message', onMessage as EventListener);
        resolve(value);
      };
      const timer = setTimeout(() => finish({ kind: 'timeout' }), WAKE_REPLY_TIMEOUT_MS);
      const onMessage = (event: MessageEvent): void => {
        const raw: unknown = event.data;
        const bytes = raw instanceof Uint8Array ? raw
          : raw instanceof ArrayBuffer ? new Uint8Array(raw) : null;
        if (!bytes) return;
        const header = decodeWsFrameHeader(bytes);
        if (!header || header.version !== 1 || header.cmd !== 592) return;
        let parsed: unknown;
        try {
          const outer: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(4)));
          const record = (outer && typeof outer === 'object' ? outer : {}) as
            { encrypt?: unknown; data?: unknown };
          const encrypt = typeof record.encrypt === 'number' ? record.encrypt : 0;
          parsed = encrypt === 0
            ? (typeof record.data === 'string' ? JSON.parse(record.data) : outer)
            : unwrapPayload(encrypt, String(record.data ?? ''), cipherKey);
        } catch (error) {
          events.debug?.('wake-mobile', {
            ok: false, reason: 'reply-decode',
            message: error instanceof Error ? error.message.slice(0, 120) : 'unknown',
          });
          return;
        }
        const answer = parseWakeReply(parsed, reqId);
        if (!answer.matched) return;
        finish({ kind: 'reply', reply: answer });
      };
      socket.addEventListener('message', onMessage as EventListener);
      try {
        const target = listener as { sendWs?: (payload: unknown, needDedup: boolean) => void };
        target.sendWs?.(buildWakeMobileFrame(syncId, reqId), false);
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 160) : 'unknown';
        events.debug?.('wake-mobile', { ok: false, reason: 'send-threw', message });
        finish({ kind: 'send-threw', message });
      }
    });

    if (attempt.kind === 'send-threw') {
      return { ok: false, code: 'send-threw', message: attempt.message };
    }
    if (attempt.kind === 'timeout') {
      // Không có phản hồi **không** chứng minh được là đã hỏng: `592` có thể
      // thành công mà phản hồi lạc. Nhưng ta cũng không có gì để chứng minh nó
      // thành công, và bước sau (`590`) sẽ trả rỗng nếu nó hỏng — nên dừng ở
      // đây với một lý do đọc được, thay vì đi tiếp vào im lặng.
      events.debug?.('wake-mobile', { ok: false, reason: 'no-reply', timeoutMs: WAKE_REPLY_TIMEOUT_MS });
      return { ok: false, code: 'no-reply', message: `không có phản hồi trong ${WAKE_REPLY_TIMEOUT_MS} ms` };
    }
    if (attempt.reply.code !== 0) {
      const code = attempt.reply.code;
      events.debug?.('wake-mobile', { ok: false, reason: 'code', code });
      return { ok: false, code: code ?? 'no-code', message: 'máy chủ từ chối đánh thức' };
    }
    events.debug?.('wake-mobile', { ok: true, cmd: 592, sent: true, code: attempt.reply.code });
    return { ok: true };
  }

  /**
   * Gửi `cmd 590` (`SYNC_MESSAGE.REQUEST`) và chờ phản hồi trên **chính `590`**.
   *
   * Đây là đường thật. Đường HTTP `/api/transfer-sync-v2/request-sync` không tồn
   * tại: `404 text/html` trên cả 46 origin của service map, trong khi endpoint
   * cùng bảng cùng host trả JSON `error_code: 600`. Xem `request-sync-ws.ts`.
   *
   * Cùng cấu trúc với `sendWakeMobile` phía trên — gắn bộ nghe **trước** khi gửi,
   * giải phong bì, khớp `reqId` — vì cái bẫy y hệt: `sendWs` trả về trước khi có
   * phản hồi, nên "đã gửi" không phải "đã mở phiên".
   *
   * Khác `592` ở chỗ phản hồi **có thể không mang `reqId`** (đo 2026-11-09:
   * `innerDataChars: 0`), nên `parseRequestSyncReply` coi vắng mặt là khớp.
   * `SyncV2Controller` đã chặn hai yêu cầu song song, nên một `590` trong lúc
   * chờ chỉ có thể là câu trả lời cho yêu cầu này.
   */
  async function sendRequestSync(
    listener: unknown, payload: SyncRequestPayload, reqId: string,
  ): Promise<SyncRequestResult> {
    if (!(await waitForSocketOpen(listener, 10_000))) {
      return { ok: false, code: 'no-socket', message: 'socket chưa mở' };
    }
    const socket = (listener as { ws?: WebSocket }).ws;
    if (!socket || typeof socket.addEventListener !== 'function') {
      return { ok: false, code: 'no-socket', message: 'socket không nghe được' };
    }
    const cipherKey = (listener as { cipherKey?: string }).cipherKey;

    type Attempt =
      | { kind: 'reply'; reply: RequestSyncReply }
      | { kind: 'timeout' }
      | { kind: 'send-threw'; message: string };
    const attempt = await new Promise<Attempt>(resolve => {
      let settled = false;
      const finish = (value: Attempt): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.removeEventListener('message', onMessage as EventListener);
        resolve(value);
      };
      const timer = setTimeout(() => finish({ kind: 'timeout' }), REQUEST_SYNC_REPLY_TIMEOUT_MS);
      const onMessage = (event: MessageEvent): void => {
        const raw: unknown = event.data;
        const bytes = raw instanceof Uint8Array ? raw
          : raw instanceof ArrayBuffer ? new Uint8Array(raw) : null;
        if (!bytes) return;
        const header = decodeWsFrameHeader(bytes);
        if (!header || header.version !== 1 || header.cmd !== RequestSyncCmd.REQUEST) return;
        let parsed: unknown;
        try {
          const outer: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(4)));
          const record = (outer && typeof outer === 'object' ? outer : {}) as
            { encrypt?: unknown; data?: unknown };
          const encrypt = typeof record.encrypt === 'number' ? record.encrypt : 0;
          parsed = encrypt === 0
            ? (typeof record.data === 'string' ? JSON.parse(record.data) : outer)
            : unwrapPayload(encrypt, String(record.data ?? ''), cipherKey);
        } catch (error) {
          events.debug?.('request-sync', {
            ok: false, reason: 'reply-decode',
            message: error instanceof Error ? error.message.slice(0, 120) : 'unknown',
          });
          return;
        }
        const answer = parseRequestSyncReply(parsed, reqId);
        if (!answer.matched) return;
        finish({ kind: 'reply', reply: answer });
      };
      socket.addEventListener('message', onMessage as EventListener);
      try {
        const target = listener as { sendWs?: (payload: unknown, requireId: boolean) => void };
        // `false`: `reqId` đã nằm trong `data` (do ta đặt), và `sendWs` sẽ chèn
        // thêm `req_id` vào `data` nếu để mặc định — hai trường khác nhau bị
        // trộn vào cùng một tầng.
        target.sendWs?.(buildRequestSyncFrame(payload, reqId), false);
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 160) : 'unknown';
        events.debug?.('request-sync', { ok: false, reason: 'send-threw', message });
        finish({ kind: 'send-threw', message });
      }
    });

    if (attempt.kind === 'send-threw') {
      return { ok: false, code: 'send-threw', message: attempt.message };
    }
    if (attempt.kind === 'timeout') {
      events.debug?.('request-sync', {
        ok: false, reason: 'no-reply', timeoutMs: REQUEST_SYNC_REPLY_TIMEOUT_MS,
      });
      return { ok: false, code: 'no-reply', message: `không có phản hồi trong ${REQUEST_SYNC_REPLY_TIMEOUT_MS} ms` };
    }
    if (attempt.reply.code !== null && attempt.reply.code !== 0) {
      events.debug?.('request-sync', {
        ok: false, reason: 'code', code: attempt.reply.code, message: attempt.reply.message,
      });
      return { ok: false, code: attempt.reply.code, message: attempt.reply.message ?? 'máy chủ từ chối' };
    }
    events.debug?.('request-sync', { ok: true, cmd: 590, sent: true, code: attempt.reply.code });
    return { ok: true };
  }

  /**
   * Gửi `cmd 591` (`SYNC_MESSAGE.ACK_DELETE_SYNC_SESSION`) và chờ phản hồi.
   *
   * Cùng khung hai tầng như `590` (`ackDeleteSyncSession` cũng bọc
   * `data: { data: e }`), nhưng hạn chờ là 3 s như `592`. Không ném: đây là một
   * bước dọn dẹp, và một phiên đã xong không được biến thành "hỏng" chỉ vì máy
   * chủ chậm trả lời xác nhận xoá.
   */
  async function sendDisposeSession(
    listener: unknown, syncId: string, reason: number,
  ): Promise<{ ok: true } | { ok: false; code: number | string; message: string }> {
    const socket = (listener as { ws?: WebSocket }).ws;
    if (!socket || typeof socket.addEventListener !== 'function') {
      return { ok: false, code: 'no-socket', message: 'socket không nghe được' };
    }
    const cipherKey = (listener as { cipherKey?: string }).cipherKey;
    const reqId = `dispose_${syncId}`;

    type Attempt =
      | { kind: 'reply'; reply: DisposeSessionReply }
      | { kind: 'timeout' }
      | { kind: 'send-threw'; message: string };
    const attempt = await new Promise<Attempt>(resolve => {
      let settled = false;
      const finish = (value: Attempt): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.removeEventListener('message', onMessage as EventListener);
        resolve(value);
      };
      const timer = setTimeout(() => finish({ kind: 'timeout' }), DISPOSE_REPLY_TIMEOUT_MS);
      const onMessage = (event: MessageEvent): void => {
        const raw: unknown = event.data;
        const bytes = raw instanceof Uint8Array ? raw
          : raw instanceof ArrayBuffer ? new Uint8Array(raw) : null;
        if (!bytes) return;
        const header = decodeWsFrameHeader(bytes);
        if (!header || header.version !== 1 || header.cmd !== DisposeSessionCmd.ACK_DELETE) return;
        let parsed: unknown;
        try {
          const outer: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(4)));
          const record = (outer && typeof outer === 'object' ? outer : {}) as
            { encrypt?: unknown; data?: unknown };
          const encrypt = typeof record.encrypt === 'number' ? record.encrypt : 0;
          parsed = encrypt === 0
            ? (typeof record.data === 'string' ? JSON.parse(record.data) : outer)
            : unwrapPayload(encrypt, String(record.data ?? ''), cipherKey);
        } catch {
          return;
        }
        const answer = parseDisposeSessionReply(parsed, reqId);
        if (!answer.matched) return;
        finish({ kind: 'reply', reply: answer });
      };
      socket.addEventListener('message', onMessage as EventListener);
      try {
        const target = listener as { sendWs?: (payload: unknown, needDedup: boolean) => void };
        target.sendWs?.(buildDisposeSessionFrame(syncId, reason, reqId), false);
      } catch (error) {
        finish({ kind: 'send-threw', message: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
      }
    });

    if (attempt.kind === 'send-threw') {
      return { ok: false, code: 'send-threw', message: attempt.message };
    }
    if (attempt.kind === 'timeout') {
      return { ok: false, code: 'no-reply', message: `không có phản hồi trong ${DISPOSE_REPLY_TIMEOUT_MS} ms` };
    }
    if (attempt.reply.code !== null && attempt.reply.code !== 0) {
      return { ok: false, code: attempt.reply.code, message: attempt.reply.message ?? 'máy chủ từ chối' };
    }
    return { ok: true };
  }

  /**
   * Đọc **tên** sự kiện điều khiển trong một frame `601` — không nội dung.
   *
   * `601` mang `{ controls: [{ act, act_type, ts, data }] }`, và Zalo PC rẽ nhánh
   * theo `act_type` (`_processCtrlMessages`): `transfer_sync2` cho trạng thái
   * gói, `transfer_msg` cho `transfer_after_login` — sự kiện mang `temp_key`.
   *
   * Chỉ ghi `act`, `act_type`, `ts` dạng số và **số lượng**. Không `data`: với
   * `transfer_after_login` thì `data.temp_key` là khoá phiên, còn `syncmsg_info`
   * mang thông tin người dùng. `temp_key` **không** được vào log, kể cả một phần.
   */

  function describeControlMetadata(
    parsed: unknown, listener: unknown,
  ): {
    ok: boolean; controls?: number; acts?: string[]; actTypes?: string[]; hasTempKey?: boolean;
    errorCodes?: number[]; syncIdPrefix?: string; fields?: Array<{ act?: string; has: string[] }>;
    backup?: Record<string, number | boolean>;
  } | null {
    let root: unknown = parsed;
    // `encrypt: 0` để nguyên thân; các kiểu khác đã được giải ở nơi gọi.
    if (!root || typeof root !== 'object') return null;
    const record = root as Record<string, unknown>;
    if (typeof record.encrypt === 'number' && record.encrypt !== 0 && typeof record.data === 'string') {
      try {
        root = unwrapPayload(record.encrypt, record.data, (listener as { cipherKey?: string }).cipherKey);
      } catch {
        return null;
      }
    }
    const data = root && typeof root === 'object' ? (root as Record<string, unknown>).data : null;
    const holder = data && typeof data === 'object' ? data as Record<string, unknown>
      : (root as Record<string, unknown>);
    const list = holder.controls;
    if (!Array.isArray(list)) return { ok: false, controls: 0 };
    const acts: string[] = [];
    const actTypes: string[] = [];
    // Mã lỗi của `transfer_error` — **số**, không phải nội dung: đây là trường
    // duy nhất nói được vì sao điện thoại từ chối. Không có nó thì "điện thoại
    // báo lỗi" là tất cả những gì đọc được, mà mã mới là thứ tra được trong
    // enum của Zalo PC.
    const errorCodes: number[] = [];
    let hasTempKey = false;
    // Với **mỗi** sự kiện: những trường nào thực sự có mặt trong `data`.
    //
    // Đây là phần còn lại sau khi gỡ `590`. Bản trước còn so `public_key`/
    // `pc_name`/`syncId` với định danh vừa gửi, nhưng khi `590` bị gỡ thì không
    // còn gì để so — và một phép so với giá trị rỗng luôn trả `false`, trông y
    // hệt "có nhưng khác". Đo 2026-11-09 17:39 đã trả lời xong câu đó
    // (`sid: false`, `pk: false`), nên ở đây chỉ còn việc ghi **sự hiện diện**:
    // "trường vắng mặt" và "trường có giá trị khác" là hai kết luận trái ngược,
    // và từ một dòng log không phân biệt được thì cả hai đều được rút ra.
    const presence: Array<{ act?: string; has: string[] }> = [];
    // `syncmsg_info` mang mô tả bản sao lưu: `msg_total`, `msg_thread`,
    // `url`/`file_name`/`checksum_code` để PC tự tải. Chỉ ghi **số** — số tin
    // và số hội thoại là thứ trả lời được "điện thoại có gì để chuyển"; không
    // ghi `url`, `file_name` hay `encrypted_key`.
    let backup: Record<string, number | boolean> | undefined;
    // Tiền tố `syncId` của sự kiện điều khiển, khi nó mang một cái — xem chỗ gán.
    let syncIdPrefix: string | undefined;
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const content = (item as Record<string, unknown>).content;
      const fields = content && typeof content === 'object' ? content as Record<string, unknown> : null;
      if (!fields) continue;
      if (typeof fields.act === 'string') acts.push(fields.act);
      if (typeof fields.act_type === 'string') actTypes.push(fields.act_type);
      // Chỉ **sự tồn tại** của `temp_key`, không giá trị và không độ dài: độ dài
      // của một khoá vẫn là thông tin về khoá.
      const inner = fields.data;
      if (inner && typeof inner === 'object') {
        const record = inner as Record<string, unknown>;
        if (typeof record.temp_key === 'string') hasTempKey = true;
        // `transfer_error` mang `err`/`errorCode` (số), và `syncmsg_info` mang
        // `msgInfo`. Chỉ đọc các trường **mã**, không đọc chuỗi nào.
        for (const key of ['err', 'errorCode', 'error_code']) {
          if (typeof record[key] === 'number') errorCodes.push(record[key] as number);
        }
        presence.push({
          ...(typeof fields.act === 'string' ? { act: fields.act } : {}),
          has: (['public_key', 'pc_name', 'syncId', 'temp_key'] as const)
            .filter(key => key in record),
        });
        // Tiền tố `syncId` là **bằng chứng**, không phải chi tiết vụn: hai khung
        // `transfer_status` của R17 khớp thời gian với phiên của ta nhưng log
        // không chứng minh được chúng thuộc `syncId` nào. Tám ký tự đủ để so với
        // `sync-v2 {"step":"requested","syncId":…}` mà không đủ để dựng lại một
        // phiên; `syncId` là chuỗi ngẫu nhiên do chính app sinh, không phải bí mật.
        if (typeof record.syncId === 'string' && record.syncId.length > 0) {
          syncIdPrefix = record.syncId.slice(0, 8);
        }
        if (fields.act === 'syncmsg_info') {
          const shape: Record<string, number | boolean> = {};
          // `db_info` là chuỗi JSON: đếm được số tin mà không đọc định danh nào.
          if (typeof record.db_info === 'string') {
            try {
              const info = JSON.parse(record.db_info) as Record<string, unknown>;
              const slot = (info.backup_db ?? info.origin_db) as Record<string, unknown> | undefined;
              for (const key of ['msg_total', 'msg_thread']) {
                if (slot && typeof slot[key] === 'number') shape[key] = slot[key] as number;
              }
              if (typeof info.db_format === 'number') shape.db_format = info.db_format;
            } catch {
              // `db_info` không phải JSON — ghi nhận, không làm hỏng frame khác.
              shape.dbInfoParsed = false;
            }
          }
          // Chỉ sự tồn tại của các trường cần cho bước tải về.
          shape.hasUrl = typeof record.url === 'string' && record.url.length > 0;
          shape.hasChecksum = typeof (record.checksum_code ?? record.checksum) === 'string';
          shape.hasEncryptedKey = typeof record.encrypted_key === 'string';
          backup = shape;
        }
      }
    }
    return {
      ok: true, controls: list.length, acts, actTypes, hasTempKey,
      ...(errorCodes.length ? { errorCodes } : {}),
      ...(syncIdPrefix ? { syncIdPrefix } : {}),
      ...(presence.length ? { fields: presence } : {}),
      ...(backup ? { backup } : {}),
    };
  }

  /**
   * Ghi lại **header** của mọi frame WS về trong một cửa sổ ngắn.
   *
   * Chỉ `cmd`, `subCmd` và số byte — không nội dung, không giải mã. Mục đích là
   * trả lời một câu hỏi hẹp: `cmd 590` gửi đi thì máy chủ có trả lời trên cùng
   * cmd, hay đẩy một sự kiện điều khiển khác (`601`), hay không trả lời gì.
   *
   * zca-js chỉ xử lý `510/511/601/502/522/602/610/611/612`; mọi cmd khác nó bỏ
   * qua im lặng. Không có bộ quan sát này thì "không thấy phản hồi" và "phản hồi
   * đến nhưng bị bỏ" trông giống hệt nhau trong log.
   */
  function watchFrames(listener: unknown): () => void {
    const socket = (listener as { ws?: WebSocket }).ws;
    if (!socket || typeof socket.addEventListener !== 'function') {
      events.debug?.('frame-watch', { ok: false, reason: 'no-socket' });
      return () => undefined;
    }
    const seen = new Map<string, number>();
    // Ba lỗi đã làm hai lần đo trước báo `frames: []` trong khi khung thật vẫn về:
    //
    // 1. Trong tiến trình chính của Electron, `ws` giao `event.data` là **Buffer**
    //    (lớp con của `Uint8Array`), không phải `ArrayBuffer` cũng không phải
    //    `Blob`. zca-js xác nhận đúng điều đó: `if (!(data instanceof Buffer)) return`
    //    (`dist/apis/listen.js:158`). Chỉ kiểm hai loại kia là bỏ lỡ toàn bộ.
    // 2. Header là `[version:u8][cmd:u16 LE][subCmd:u8]` — `getHeader` của zca-js
    //    đọc `buffer.readUInt16LE(1)`. Đọc `int32` tại offset 1 là lấn sang byte
    //    `subCmd` và cho ra số vô nghĩa.
    // 3. `event.data` có thể là chuỗi với frame văn bản; bỏ qua chứ không ném.
    const record = (bytes: Uint8Array): void => {
      const header = decodeWsFrameHeader(bytes);
      if (!header) return;
      const key = `${header.version}/${header.cmd}/${header.subCmd}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
      // `601` được mô tả **cùng** cách: đó là kênh điều khiển, và gói tin của
      // phiên đồng bộ về đúng ở đó (`transfer_status`, `transfer_error`,
      // `upload_batch`). Chỉ header thì không phân biệt được "có gói" với "có
      // khung rỗng", mà đó chính là câu hỏi của phép đo.
      const shape = header.version === 1 &&
        (header.cmd === 590 || header.cmd === 601 || header.cmd === 603 || header.cmd === 610 || header.cmd === 611)
        ? describeWsFrameBody(bytes.subarray(4))
        : null;
      // Khi phong bì có `encrypt` khác 0, mọi thứ ở tầng ngoài chỉ nói về vận
      // chuyển. `reqId`/`error_code` thật nằm bên trong, nên phải mở — nhưng chỉ
      // ghi hình dạng. Khoá phiên lấy từ chính listener (zca-js đặt nó ở đó ở
      // `dist/apis/listen.js:158`), không đọc từ đâu khác và không ghi ra log.
      const decoded = shape && shape.encrypt && shape.encrypt !== 0
        ? ((): { parsed: unknown; shape: ReturnType<typeof describeDecodedPayload> } | null => {
          let parsed: unknown;
          try { parsed = JSON.parse(new TextDecoder().decode(bytes.subarray(4))); } catch { return null; }
          if (!parsed || typeof parsed !== 'object') return null;
          const fields = parsed as Record<string, unknown>;
          const cipherKey = (listener as { cipherKey?: string }).cipherKey;
          return { parsed, shape: describeDecodedPayload(fields.encrypt, fields.data, cipherKey) };
        })()
        : null;
      const inner = decoded?.shape ?? null;
      // `601` và `603` đều là kênh điều khiển: hình dạng một mình không trả lời
      // được câu hỏi "sự kiện này là gì". Ghi thêm **tên** `act`/`act_type` và
      // **số lượng** — đúng những gì `_processCtrlMessages` của Zalo PC phân
      // nhánh theo — nhưng không một byte `data` nào: `transfer_after_login` mang
      // `temp_key` trong `data`, và `syncmsg_info`/`upload_batch` mang thông tin
      // người dùng.
      //
      // `603` (`CTRL_PULL_CTRL`) **cũng** mang sự kiện điều khiển, không chỉ
      // `601` (`CTRL_PUSH_CTRL`): Zalo PC long-poll `603` rồi đưa kết quả qua
      // cùng `_processCtrlMessages`. Ba lần đo trước chỉ mô tả `601`, mà `603` là
      // kênh duy nhất thật sự trả lời trong môi trường này — nên "không thấy
      // `601` nào" chưa từng đồng nghĩa với "không có sự kiện điều khiển nào".
      const control = header.version === 1 && (header.cmd === 601 || header.cmd === 603)
        ? describeControlMetadata(decoded?.parsed ?? null, listener)
        : null;
      events.debug?.('frame', {
        version: header.version,
        cmd: header.cmd,
        subCmd: header.subCmd,
        bytes: header.bodyBytes,
        // `keys`/`reqIdChars`/`errorCode` — hình dạng, không nội dung.
        ...(shape ? { shape } : {}),
        // `ok`/`reason`/`keys`/`errorCode`/`reqIdChars`/`innerDataChars` của phần
        // **đã giải** — cũng chỉ hình dạng, không một byte nội dung nào.
        ...(inner ? { inner } : {}),
        // `controls`/`acts`/`actTypes` — tên sự kiện và số lượng, không nội dung.
        ...(control ? { control } : {}),
      });
    };
    const onMessage = (event: MessageEvent): void => {
      const raw: unknown = event.data;
      // `Buffer` là `Uint8Array`; nhánh này cũng bắt `ArrayBuffer` đã bọc.
      if (raw instanceof Uint8Array) {
        record(raw);
        return;
      }
      if (raw instanceof ArrayBuffer) {
        record(new Uint8Array(raw));
        return;
      }
      if (typeof raw === 'string') {
        events.debug?.('frame-text', { chars: raw.length });
        return;
      }
      if (typeof Blob !== 'undefined' && raw instanceof Blob) {
        void raw.arrayBuffer().then(buffer => record(new Uint8Array(buffer))).catch(() => undefined);
      }
    };
    socket.addEventListener('message', onMessage as EventListener);
    return () => {
      socket.removeEventListener('message', onMessage as EventListener);
      events.debug?.('frame-summary', {
        frames: [...seen.entries()].map(([key, count]) => ({ key, count })),
      });
    };
  }

  async function fetchFromServer(
    threadId: string, kind: ThreadKind, before?: string,
  ): Promise<{ messages: StoreMessage[]; hasMore: boolean }> {
    if (!api) return { messages: [], hasMore: false };
    const client = api;
    if (kind === 'group') {
      // Offline (hoặc khi API nhóm tạm lỗi), các trang cũ đã có trong cache vẫn
      // phải hiện được. Nếu hỏi mạng trước, `getGroupChatHistory` trả null và
      // người dùng chỉ thấy trang mới nhất dù DB đã có lịch sử trước đó.
      if (before) {
        const local = pageFromCache(threadId, kind, before);
        if (local?.messages.length) return { messages: local.messages, hasMore: true };
      }
      // Đường của Zalo PC cho nhóm: `/api/cm/getoldv2` với `globalMsgId` = tin cũ
      // nhất đang hiển thị. Chỉ bật khi có cờ — endpoint này Zalo PC gọi thật,
      // nhưng nó đòi đúng phiên/domain, và khi từ chối thì `cmd`/`getGroupChatHistory`
      // phía dưới vẫn là đường lùi được.
      const viaCloud = await historyThrottle.run(() => fetchCloudPage(threadId, kind, before));
      if (viaCloud) return viaCloud;
      // API nhóm không có `before`: mỗi lần xin nhiều hơn lần trước, và renderer
      // khử trùng theo `msgId` nên phần chồng lấn không thành bong bóng đôi.
      const count = Math.min((groupHistoryCount.get(threadId) ?? HISTORY_PAGE) + HISTORY_PAGE, HISTORY_PAGE_MAX);
      // Nghỉ trước mỗi lần hỏi: Zalo không công bố giới hạn, và bấm "Tải thêm"
      // liên tục sẽ tạo đúng nhịp máy đều đặn mà §6.7 muốn tránh.
      const history = await historyThrottle.run(
        () => client.getGroupChatHistory(threadId, count).catch(() => null));
      if (!history) return { messages: [], hasMore: false };
      groupHistoryCount.set(threadId, count);
      const messages = (await Promise.all(history.groupMsgs
        .map(message => mapInboundMessage(message.data as RawMessage, threadId, 'group', message.isSelf))))
        .filter((message): message is StoreMessage => message !== null)
        .reverse();
      // Chạm trần `count` thì `more` vẫn > 0 nhưng xin thêm cũng chỉ trả lại
      // đúng trang đó, nên báo hết để nút tải không quay vô ích.
      return { messages, hasMore: history.more > 0 && count < HISTORY_PAGE_MAX };
    }
    // 1-1: Zalo PC **không** gọi cloud (xem `pageFromCache`). Lùi trang ở đây là
    // đọc cache cục bộ — đúng thứ tự của Zalo PC: DB trước, mạng chỉ là nguồn
    // đổ vào DB.
    //
    // Điểm cốt lõi, và là chỗ dễ hiểu sai nhất: **Zalo PC không tự lấy tin 1-1 cũ
    // từ DB của nó lên được.** DB đó rỗng lúc mới đăng nhập — README của Olaz
    // (`zalo-swift-re`) ghi thẳng "a fresh PC session has no message history
    // except My Cloud, because Zalo keeps history on the phone", và `Sync.db` trên
    // máy này xác nhận: `missing_message_range` còn `reason: first_login`,
    // `status: 0`. Tin 1-1 cũ chỉ vào DB bằng **đồng bộ từ điện thoại**
    // (`pull_mobile_msg` + E2EE), có người xác nhận trên điện thoại.
    //
    // App này chưa có đồng bộ đó. Nên lùi trang 1-1 ở đây chỉ cuộn được trong phần
    // đã tình cờ có mặt — và **không có cách nào** làm dày nó bằng một lời gọi
    // mạng: `cmd 510` là hàng đợi catch-up (trả tin *mới hơn* mốc, đo 2026-11-08),
    // `getoldv2` từ chối 1-1. Đây là giới hạn thật, không phải chỗ có thể vá bằng
    // cờ. Muốn có lịch sử 1-1 thì phải làm `pull_mobile_msg`, việc riêng.
    const local = pageFromCache(threadId, kind, before);
    // Zalo giữ **hai** cờ: `hasMoreLocal` (DB còn tin) và `hasMoreCloud` (nguồn
    // cloud còn tin), và chỉ dừng cuộn khi cả hai cùng hết — đọc ở `ZCU6.js`
    // (`loadTopMessagesForConversation` trả `i(T, y, false)` với `y`=local,
    // `false`=cloud) và reducer `LOAD_MORE_MSG` trong `iKSP.js`.
    //
    // Không chép nguyên mô hình đó được, và đây là lý do: cờ thứ hai của Zalo
    // đứng trên **cloud segment của nhóm + đồng bộ điện thoại**. Với 1-1, thứ duy
    // nhất phía ta có để "đổ thêm" là `cmd 510`, mà phép đo 2026-11-08 cho thấy nó
    // trả tin *mới hơn* mốc (catch-up), không phải tin cũ hơn. Bật `hasMore` bằng
    // nó là hứa một trang lùi mà không có nguồn nào cấp được — nút sẽ bấm được mãi
    // và mỗi lần bấm chỉ tốn 5 giây×3 rồi hiện toast "không có tin cũ hơn".
    //
    // Nên với 1-1, `hasMore` đúng là `hasMoreLocal`: lùi trang dừng ở mép cache,
    // đúng như Zalo PC dừng ở mép DB của nó. Khác biệt duy nhất là DB của Zalo đầy
    // nhờ đồng bộ điện thoại còn cache của ta thì không — và đó là việc phải làm
    // (`pull_mobile_msg` + E2EE), không phải một cờ có thể lật.
    if (local?.messages.length) return local;
    // Cache **rỗng hoàn toàn** thì vẫn phải hỏi nguồn kia: hội thoại chưa có gì
    // trong cache (lần mở đầu chưa kịp ghi) không được hiện màn hình trống.
    // Phép đo `GLASS_CLOUD_HISTORY=1`: thử endpoint cloud cho cả 1-1 để đối chứng.
    // Chỉ tới được đây khi cache rỗng, nên nó không chen vào đường thật.
    const viaCloudUser = await fetchCloudPage(threadId, kind, before);
    if (viaCloudUser) return viaCloudUser;
    // zca-js 2.2.0 không có API lịch sử 1-1 dạng request/response: chỉ còn
    // listener (`cmd 510`), và trang đó trộn tin của mọi hội thoại. Một yêu cầu
    // được bay tại một thời điểm — hai yêu cầu song song sẽ tranh nhau
    // `historyWaiter` và một trong hai chỉ đợi hết hạn 5 giây.
    const run = userHistoryQueue.then(() => fetchUserHistory(threadId, before));
    userHistoryQueue = run.catch(() => undefined);
    return run;
  }

  async function resolveGroupMemberProfiles(threadId: string): Promise<void> {
    const pending = groupProfileRequests.get(threadId);
    if (pending) return pending;
    const client = api;
    const store = db;
    if (!client || !store) return;

    if (!groupMemberDetailsLoaded.has(threadId) && groupMemberInfoLookup) {
      const infoPending = groupMemberInfoRequests.get(threadId);
      if (infoPending) {
        await infoPending;
      } else {
        const lookup = groupMemberInfoLookup;
        const request = (async () => {
          try {
            const response = await lookup(threadId);
            const root = objectRecord(response);
            const gridInfoMap = objectRecord(root?.gridInfoMap);
            const group = objectRecord(gridInfoMap?.[threadId]) ?? objectRecord(root?.data) ?? root;
            if (!group) return;

            const rawMembers = Array.isArray(group.currentMems) ? group.currentMems : [];
            const members: RawGroupMember[] = [];
            for (const value of rawMembers) {
              const member = objectRecord(value);
              if (!member || typeof member.id !== 'string' || !member.id) continue;
              members.push({
                id: member.id,
                dName: typeof member.dName === 'string' ? member.dName : '',
                zaloName: typeof member.zaloName === 'string' ? member.zaloName : '',
                avatarSource: parseAvatarUrl(member.avatar_25)?.href
                  ?? parseAvatarUrl(member.avatar)?.href,
              });
            }
            const listedIds = Array.isArray(group.memberIds)
              ? group.memberIds.filter((id): id is string => typeof id === 'string' && Boolean(id))
              : [];
            const memberIds = [...new Set([...listedIds, ...members.map(member => member.id)])];
            if (memberIds.length) groupMemberIds.set(threadId, memberIds);
            for (const member of members) {
              const name = (member.dName || member.zaloName).trim().slice(0, 120);
              if (name && !globalNames.has(member.id)) globalNames.set(member.id, name);
              if (member.avatarSource && !avatarSources.has(member.id)) {
                avatarSources.set(member.id, member.avatarSource);
              }
            }
            if (Array.isArray(group.memberIds) || Array.isArray(group.currentMems)) {
              groupMemberDetailsLoaded.add(threadId);
            }
            events.debug?.('group-member-info', {
              ok: groupMemberDetailsLoaded.has(threadId),
              members: memberIds.length,
              avatars: members.filter(member => Boolean(member.avatarSource)).length,
            });
          } catch (error) {
            events.debug?.('group-member-info', {
              ok: false, error: error instanceof ZaloApiError ? error.code ?? error.name
                : error instanceof Error ? error.name : 'unknown',
            });
          }
        })();
        groupMemberInfoRequests.set(threadId, request);
        try {
          await request;
        } finally {
          if (groupMemberInfoRequests.get(threadId) === request) groupMemberInfoRequests.delete(threadId);
        }
      }
    }
    const pendingAfterInfo = groupProfileRequests.get(threadId);
    if (pendingAfterInfo) return pendingAfterInfo;

    const request = (async () => {
      const cached = safe('pageGroupProfiles', () =>
        pageMessages(store, threadId, 'group', HISTORY_PAGE));
      const senderIds = [...new Set((cached?.messages ?? [])
        .filter(message => message.from === 'them')
        .map(message => message.senderId)
        .filter((senderId): senderId is string => Boolean(senderId && senderId !== '0')))];
      const memberIds = groupMemberIds.get(threadId) ?? [];
      const memberIdSet = new Set(memberIds);
      const isUid = (senderId: string): boolean =>
        memberIdSet.has(senderId) || /^\d+$/.test(senderId);
      const noisedIds = senderIds.filter(senderId =>
        !isUid(senderId) && !globalIds.has(senderId));
      const profileIds = new Set(memberIds);
      for (const senderId of senderIds) {
        const userId = isUid(senderId) ? senderId : globalIds.get(senderId);
        if (userId) profileIds.add(userId);
      }
      const senderUserIds = new Set(senderIds.map(senderId =>
        isUid(senderId) ? senderId : globalIds.get(senderId)).filter((id): id is string => Boolean(id)));
      const knownUserIds = new Set(globalIds.values());
      const queueSenderAvatars = () => {
        for (const userId of senderUserIds) {
          const remote = avatarSources.get(userId);
          if (remote && !memberAvatarUrls.has(userId)) events.avatar?.(userId, remote, null);
        }
      };
      queueSenderAvatars();
      const needsProfile = [...profileIds].some(userId =>
        !globalNames.has(userId)
        || (senderUserIds.has(userId) && !avatarSources.has(userId) && !avatarProfileLookups.has(userId))
        || (memberIdSet.has(userId) && !knownUserIds.has(userId) && !avatarProfileLookups.has(userId)));
      if (!noisedIds.length && !needsProfile) return;

      let failedBatches = 0;
      let mapped = 0;
      let resolved = 0;
      let lastError: string | number | null = null;
      const batchSize = 50;
      for (let index = 0; index < noisedIds.length; index += batchSize) {
        const batch = noisedIds.slice(index, index + batchSize);
        if (!globalIdLookup) {
          failedBatches += 1;
          lastError = 'lookup-unavailable';
          continue;
        }
        try {
          const usersByGlobalId = await globalIdLookup(batch);
          for (const [globalId, userId] of Object.entries(usersByGlobalId)) {
            globalIds.set(globalId, userId);
            knownUserIds.add(userId);
            profileIds.add(userId);
            mapped += 1;
          }
        } catch (error) {
          failedBatches += 1;
          lastError = error instanceof ZaloApiError ? error.code ?? error.name
            : error instanceof Error ? error.name : 'unknown';
        }
      }

      for (const senderId of senderIds) {
        const userId = isUid(senderId) ? senderId : globalIds.get(senderId);
        if (userId) {
          senderUserIds.add(userId);
          profileIds.add(userId);
        }
      }
      queueSenderAvatars();
      const profileRequests = [...profileIds].filter(userId =>
        !globalNames.has(userId)
        || (senderUserIds.has(userId) && !avatarSources.has(userId) && !avatarProfileLookups.has(userId))
        || (memberIdSet.has(userId) && !knownUserIds.has(userId) && !avatarProfileLookups.has(userId)));
      for (let index = 0; index < profileRequests.length; index += batchSize) {
        const batch = profileRequests.slice(index, index + batchSize);
        try {
          const response = await client.getUserInfo(batch);
          for (const userId of batch) avatarProfileLookups.add(userId);
          for (const profile of Object.values(response.changed_profiles ?? {})) {
            const name = (profile.displayName || profile.zaloName || '').trim().slice(0, 120);
            if (!profile.userId) continue;
            if (name) {
              globalNames.set(profile.userId, name);
              resolved += 1;
            }
            if (profile.globalId && profile.globalId !== '0') {
              globalIds.set(profile.globalId, profile.userId);
              knownUserIds.add(profile.userId);
              if (name) globalNames.set(profile.globalId, name);
            }
            const avatar = parseAvatarUrl(profile.avatar)?.href;
            if (avatar) avatarSources.set(profile.userId, avatar);
          }
        } catch (error) {
          failedBatches += 1;
          lastError = error instanceof ZaloApiError ? error.code ?? error.name
            : error instanceof Error ? error.name : 'unknown';
        }
      }
      for (const senderId of senderIds) {
        const userId = isUid(senderId) ? senderId : globalIds.get(senderId);
        if (userId) senderUserIds.add(userId);
      }
      queueSenderAvatars();
      events.debug?.('group-profiles', {
        ok: failedBatches === 0, members: memberIds.length, senders: senderIds.length,
        mapped, resolved, failedBatches,
        ...(lastError ? { error: lastError } : {}),
      });
    })();
    groupProfileRequests.set(threadId, request);
    try {
      await request;
    } finally {
      groupProfileRequests.delete(threadId);
    }
  }

  async function refreshGroupSenderNames(threadId: string, publish: boolean): Promise<void> {
    if (!db || !api || connection !== 'connected') return;
    await resolveGroupMemberProfiles(threadId);
    const store = db;
    const cached = safe('pageGroupSenderNames', () =>
      pageMessages(store, threadId, 'group', HISTORY_PAGE));
    if (!cached) return;
    const missingNames = cached.messages.filter(message => message.from === 'them' && !message.fromName).length;
    if (!missingNames) return;

    events.debug?.('group-name-refresh', {
      ok: true, step: 'started', cached: cached.messages.length, missingNames,
    });
    let namesAssigned = safe('updateSenderNames', () =>
      updateMessageSenderNames(store, threadId, globalNames)) ?? 0;
    const refreshed = await fetchFromServer(threadId, 'group');
    if (refreshed.messages.length) {
      persist(threadId, refreshed.messages);
      namesAssigned += safe('updateSenderNames', () =>
        updateMessageSenderNames(store, threadId, globalNames)) ?? 0;
    }
    const page = safe('pageGroupSenderNames', () =>
      pageMessages(store, threadId, 'group', HISTORY_PAGE));
    if (!page) return;
    const named = page.messages.filter(message => message.from === 'them' && message.fromName).length;
    events.debug?.('group-name-refresh', {
      ok: named > 0, step: 'complete', fetched: refreshed.messages.length, namesAssigned, named,
    });
    if (!publish) return;
    for (const message of page.messages) {
      if (message.from !== 'them' || !message.fromName) continue;
      events.message(toIpcMessageWithAvatar({ ...message, backfill: true }));
    }
  }

  function stickerUrlFor(id: number): Promise<string | null> {
    const cached = stickerUrlCache.get(id);
    if (cached) return cached;
    const client = api;
    if (!client) return Promise.resolve(null);

    const request = client.getStickersDetail(id).then(details => {
      const detail = details[0];
      for (const candidate of [detail?.stickerWebpUrl, detail?.stickerUrl]) {
        const url = parseMediaUrl(candidate);
        if (url) return url.toString();
      }
      return null;
    }).catch(error => {
      stickerUrlCache.delete(id);
      throw error;
    });
    stickerUrlCache.set(id, request);
    if (stickerUrlCache.size > 256) {
      const oldest = stickerUrlCache.keys().next().value;
      if (oldest !== undefined && oldest !== id) stickerUrlCache.delete(oldest);
    }
    void request.then(url => {
      if (!url && stickerUrlCache.get(id) === request) stickerUrlCache.delete(id);
    }, () => undefined);
    return request;
  }

  const repairedStickerThreads = new Set<string>();

  async function prepareMediaPage(threadId: string, kind: ThreadKind,
    messages: StoreMessage[]): Promise<StoreMessage[]> {
    // Older caches discarded Attach.id. Re-read history once to recover it;
    // never guess an ID from catId (one pack contains many different stickers).
    if (kind === 'group' && connection === 'connected' && !repairedStickerThreads.has(threadId)
      && messages.some(message => !/^\[\^\d+,\d+\^\]$/.test(message.text.trim()) && message.attachments?.some(item =>
        item.kind === 'sticker' && !item.remote && !item.raw?.id && !item.raw?.params))) {
      repairedStickerThreads.add(threadId);
      try {
        const refreshed = await fetchFromServer(threadId, kind);
        persist(threadId, refreshed.messages);
        if (db) messages = messages.map(message => ({ ...message,
          attachments: message.msgId ? messageAttachments(db as Db, threadId, message.msgId) : message.attachments,
        }));
      } catch {
        repairedStickerThreads.delete(threadId);
      }
    }
    const enriched = await Promise.all(messages.map(enrichStickerMessage));
    return persist(threadId, enriched);
  }

  async function enrichStickerMessage<T extends Pick<StoreMessage, 'text' | 'attachments'>>(message: T): Promise<T> {
      if (!message.attachments?.some(item => item.kind === 'sticker' && !item.remote)) return message;
      const attachments = await Promise.all(message.attachments.map(async item => {
        if (item.kind !== 'sticker' || item.remote) return item;
        let id = item.raw?.id;
        // Sync V2 also carries the sticker identity in content: [^catId,id^].
        // This recovers old caches that dropped Attach.id without another sync.
        const token = /^\[\^(\d+),(\d+)\^\]$/.exec(message.text.trim());
        if (!id && token && (!item.raw?.catId || Number(token[1]) === item.raw.catId)) {
          id = Number(token[2]);
        }
        if (!id && typeof item.raw?.params === 'string') {
          try { id = (JSON.parse(item.raw.params) as { id?: number }).id; } catch { /* invalid metadata */ }
        }
        if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return item;
        try {
          const remote = await stickerUrlFor(id);
          return remote ? { ...item, remote, raw: { ...item.raw, id } } : item;
        } catch { return item; }
      }));
      return { ...message, attachments };
  }

  function mapInboundMessage(
    raw: RawMessage, threadId: string, kind: ThreadKind, isSelf: boolean,
  ): StoreMessage | null | Promise<StoreMessage | null> {
    const mapped = toLiveMessage(raw, threadId, kind, isSelf, uid => globalNames.get(uid));
    const sticker = stickerContentOf(raw);
    if (!mapped || !sticker || mapped.attachments?.some(item => item.kind === 'sticker' && item.remote)) {
      return mapped;
    }
    if (!api) {
      events.debug?.('sticker-detail', { ok: false, reason: 'api-unavailable' });
      return mapped;
    }

    return Promise.resolve().then(() => stickerUrlFor(sticker.id)).then(url => {
      if (!url) {
        events.debug?.('sticker-detail', { ok: false, reason: 'detail-not-found' });
        return mapped;
      }
      const enriched = toLiveMessage({
        ...raw,
        content: { ...sticker, type: 'chat.sticker', href: url },
      }, threadId, kind, isSelf, uid => globalNames.get(uid));
      if (!enriched) {
        events.debug?.('sticker-detail', { ok: false, reason: 'mapping-failed' });
        return mapped;
      }
      events.debug?.('sticker-detail', { ok: true });
      return enriched;
    }).catch(error => {
      events.debug?.('sticker-detail', {
        ok: false, reason: 'request-failed',
        errorType: error instanceof Error ? error.name : typeof error,
      });
      return mapped;
    });
  }

  function handleInbound(message: ZaloMessage, backfill = false): void | Promise<void> {
    const kind = kindOf(message.type);
    const raw = message.data as RawMessage;
    // `message.isSelf` là cờ zca-js tính *trước* khi ghi đè `raw.uidFrom`; payload
    // sau đó không còn dấu `"0"` để tự suy ra người gửi.
    const mapped = mapInboundMessage(raw, message.threadId, kind, message.isSelf);
    if (mapped instanceof Promise) return mapped.then(result => commitInbound(message, raw, result, kind, backfill));
    commitInbound(message, raw, mapped, kind, backfill);
  }

  function commitInbound(
    message: ZaloMessage, raw: RawMessage, mapped: StoreMessage | null, kind: ThreadKind, backfill: boolean,
  ): void {
    events.debug?.('inbound', {
      kind, self: message.isSelf, threadId: message.threadId,
      msgType: raw.msgType, contentType: typeof raw.content, mapped: mapped !== null,
    });
    if (!mapped) return;
    seenParams.set(message.threadId, {
      msgId: raw.msgId, cliMsgId: raw.cliMsgId, uidFrom: raw.uidFrom, idTo: raw.idTo,
      msgType: raw.msgType, st: message.data.st, at: message.data.at,
      cmd: message.data.cmd, ts: raw.ts,
    });
    // Cache trước, rồi mới phát: một lần tắt app ngay sau khi tin hiện lên vẫn
    // không làm mất tin. Ghi hỏng thì vẫn phát — UI không phải chịu lỗi DB.
    const committed = persist(mapped.threadId, [mapped])[0] ?? mapped;
    threads = applyMessage(threads, committed, activeThreadId);
    const thread = threads.find(t => t.id === committed.threadId && t.kind === committed.kind);
    if (thread) {
      events.thread(thread);
      if (db) {
        const store = db;
        safe('upsertThread', () => upsertThreads(store, [thread]));
      }
    }
    events.message(toIpcMessageWithAvatar({ ...committed, ...(backfill ? { backfill: true } : {}) }));
    if (kind === 'group' && committed.senderId) {
      void resolveGroupMemberProfiles(committed.threadId).catch(error => {
        events.debug?.('group-profile-refresh', {
          ok: false, error: error instanceof Error ? error.name : 'unknown',
        });
      });
    }
  }

  function dispatchInbound(message: ZaloMessage, backfill = false): void {
    const report = (error: unknown) => {
      events.debug?.('inbound', {
        ok: false, reason: 'handler-failed',
        errorType: error instanceof Error ? error.name : typeof error,
      });
    };
    try {
      const result = handleInbound(message, backfill);
      if (result) void result.catch(report);
    } catch (error) {
      report(error);
    }
  }

  /**
   * Một tin bị thu hồi (plan §6.10). Dòng **vẫn còn** trong cache và trên UI,
   * chỉ mất nội dung — tin không được phép biến mất khỏi đúng chỗ nó từng ở.
   *
   * Id của tin gốc nằm ở `content.globalMsgId`, **không** phải `data.msgId`:
   * `msgId` là id của chính bản ghi điều khiển mang lệnh thu hồi (model `TUndo`
   * của zca-js tách hẳn hai thứ: `msgId`/`cliMsgId` của sự kiện, và
   * `content.{globalMsgId, cliMsgId, deleteMsg}` của tin bị xoá). Đọc nhầm
   * trường `msgId` cũ từng làm hỏng **mọi** lần thu hồi trong im lặng.
   * Không thấy dòng nào trong cache thì ghi nhớ id trong `recalledIds` và áp lại
   * khi một trang lịch sử mang tin đó về: tin cũ có thể chưa được tải lần nào.
   */
  function handleUndoData(
    threadId: string, data: UndoPayload & { ts?: unknown }, isSelf: boolean, isGroup: boolean, ts?: unknown,
  ): void {
    const target = recalledTarget(data);
    const msgId = target?.msgId ?? '';
    const kind = isGroup ? 'group' : 'user';
    // `ts` của sự kiện thu hồi là lúc thu hồi, **không** phải lúc tin được gửi.
    // Chỉ dùng khi chưa có dòng nào và như một mốc sắp xếp tạm; dòng thật (nếu
    // có) giữ nguyên `ts` gốc để bong bóng không nhảy khỏi chỗ của nó.
    const recallTs = Number(ts) || Date.now();
    events.debug?.('undo', {
      kind, self: isSelf, threadId, hasMsgId: Boolean(msgId),
    });
    if (!threadId || !msgId) return;
    const result = db
      ? safe('recall', () => markRecalled(db as Db, threadId, msgId))
      : null;
    // Ghi nhớ khi **hoặc** chưa có dòng, **hoặc** không đọc/ghi được cache: cả hai
    // trường hợp đều có nguy cơ một trang lịch sử sau đó mang nội dung gốc về.
    if (db && !result?.found) rememberRecall(threadId, msgId);
    // Luôn phát: UI phải đổi bong bóng ngay cả khi cache đang hỏng hoặc hội thoại
    // này chưa từng được ghi. Không có `ts` thật (chưa tải được tin gốc) thì dùng
    // mốc tạm; renderer khớp theo `msgId` nên mốc đó không quyết định vị trí.
    events.message({
      threadId, kind, msgId, clientId: null, from: isSelf ? 'me' : 'them',
      recalled: true, text: '', ts: result?.found ? result.ts : recallTs,
    });
  }

  function handleUndo(undo: Undo): void {
    handleUndoData(undo.threadId, undo.data, undo.isSelf, undo.isGroup, undo.data.ts);
  }

  /**
   * Một cảm xúc vừa thay đổi trên một tin của hội thoại.
   *
   * Không gọi trực tiếp `setMessageReactions` để ghi đè: sự kiện `reaction` chỉ
   * nói về **một người** (thả, đổi, hoặc bỏ), nên trạng thái mới là "bản đồ cũ
   * cộng hành động này". Sự kiện bỏ không nói đã bỏ biểu tượng nào — nó chỉ gỡ
   * mục của người đó, và đó là lý do cột `reactions` lưu theo **người thả** chứ
   * không phải bảng đếm.
   *
   * Nếu tin chưa được tải, giữ trạng thái đến khi catch-up ghi dòng gốc vào cache.
   */
  function handleReaction(reaction: Reaction): void {
    const threadId = reaction.threadId;
    // zca-js parses `content` for live cmd 612 events but leaves it serialized
    // for the old-reaction backlog (cmd 610/611).
    const rawContent: unknown = reaction.data?.content;
    const content = reactionContentOf(rawContent);
    const target = content && Array.isArray(content.rMsg) ? objectRecord(content.rMsg[0]) : null;
    const rawMsgId = target?.gMsgID;
    const msgId = (typeof rawMsgId === 'string' || typeof rawMsgId === 'number') && rawMsgId
      ? String(rawMsgId)
      : '';
    const icon = typeof content?.rIcon === 'string' ? content.rIcon : '';
    const remove = isRemoval(Number(content?.rType), icon);
    events.debug?.('reaction', {
      kind: reaction.isGroup ? 'group' : 'user', self: reaction.isSelf,
      hasMsgId: Boolean(msgId), remove, hasIcon: Boolean(icon),
      ...(content ? {} : { invalidContent: true }),
    });
    if (!content || !threadId || !msgId || !db) return;
    // uid người thả: zca-js ghi đè `uidFrom` thành uid **của mình** khi máy chủ
    // gửi `"0"` (chính là khi mình thả), nên trường này luôn đúng người.
    const uid = String(reaction.data?.uidFrom ?? '');
    const action = { uid, icon, remove };
    const store = db;
    const updated = safe('reaction', () => {
      const next = applyReaction(messageReactions(store, threadId, msgId), action);
      return setMessageReactions(store, threadId, msgId, next);
    });
    if (!updated) {
      if (uid) queuePendingReaction(threadId, msgId, action);
      return;
    }
    const kind = updated.kind ?? (reaction.isGroup ? 'group' : 'user');
    // `reacted` là cờ tường minh, và `reactions: []` phải được khai cả khi rỗng:
    // khi người cuối cùng gỡ cảm xúc, `toLive` bỏ trường (một tin không có cảm
    // xúc thì không mang mảng rỗng) và sự kiện sẽ trông y hệt một tin thường.
    events.message(toIpcMessageWithAvatar({ ...updated, kind, reacted: true, reactions: updated.reactions ?? [] }));
  }

  function wireListener(): void {
    if (!api) return;
    const listener = api.listener;
    listener.on('connected', () => {
      const wasConnected = connection === 'connected';
      started = true;
      manualStop = false;
      backoff = BACKOFF_START_MS;
      // Socket mới mỗi lần kết nối lại: controller phải gắn lại vào socket
      // đang sống, nếu không mọi frame `601` sau đó rơi vào khoảng không.
      if (api) attachSync(api);
      attachCalls();
      emitConnection('connected');
      if (!wasConnected) {
        scheduleCatchUp();
        const active = threads.find(thread => thread.id === activeThreadId && thread.kind === 'group');
        if (active) {
          void refreshGroupSenderNames(active.id, true).catch(error => {
            events.debug?.('group-name-refresh', {
              ok: false, error: error instanceof Error ? error.message.slice(0, 120) : 'unknown',
            });
          });
        }
      }
    });
    listener.on('disconnected', code => {
      started = false;
      events.debug?.('disconnected', { code, manualStop });
      if (manualStop) return;
      if (isReplaced(code)) {
        replaced = true;
        clearBackoff();
        stopListener();
        emitConnection('replaced');
        return;
      }
      emitConnection('disconnected');
      scheduleReconnect();
    });
    listener.on('error', error => {
      events.debug?.('error', { message: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
      const socketState = (listener as unknown as { ws?: { readyState: number } }).ws?.readyState;
      if (connection === 'connected' && socketState !== 1) emitConnection('disconnected');
    });
    // cipher_key là khoá phiên WebSocket: không bao giờ được chuyển tiếp ra ngoài.
    listener.on('cipher_key', () => undefined);
    listener.on('message', message => dispatchInbound(message));
    listener.on('undo', undo => handleUndo(undo));
    // Cảm xúc: `reaction` là thay đổi trực tiếp, `old_reactions` là trạng thái cũ
    // máy chủ đẩy về sau khi kết nối lại. Cùng một hàm xử lý — mỗi sự kiện là một
    // hành động của một người, nên áp tuần tự cho cùng kết quả.
    listener.on('reaction', reaction => handleReaction(reaction));
    listener.on('old_reactions', (reactions, isGroup) => {
      events.debug?.('reaction-catch-up', {
        kind: isGroup ? 'group' : 'user', received: reactions.length,
      });
      for (const reaction of reactions) handleReaction(reaction);
    });
    listener.on('old_messages', (messages, type) => {
      const catchUp = catchUpWaiter;
      if (catchUp && type === catchUp.type) {
        catchUpWaiter = null;
        catchUp.settle(messages);
        return;
      }
      // Đang có yêu cầu lịch sử: trang này trả cho nó, và renderer sẽ chèn lên
      // đầu hội thoại. Chạy thêm `handleInbound` sẽ nối chúng xuống cuối như tin
      // mới trước khi bị chèn lại — trùng bong bóng và sai thứ tự.
      const waiter = historyWaiter;
      if (waiter && type === ThreadType.User) {
        historyWaiter = null;
        // Đây là số liệu §10.3 cần: máy chủ trả bao nhiêu tin mỗi trang. `null`
        // trong `first`/`last` nghĩa là tin đó không map được sang `LiveMessage`.
        events.debug?.('history', { ok: true, count: messages.length,
          first: messages[0]?.data.msgId ?? null, last: messages.at(-1)?.data.msgId ?? null });
        waiter.settle(messages);
        return;
      }
      for (const message of messages) dispatchInbound(message, true);
    });
  }

  async function buildThreadsFromServer(client: API): Promise<BuiltThreads> {
    const [friends, groups, pins, unread] = await Promise.all([
      client.getAllFriends(20000, 1).catch(() => [] as RawUser[]),
      client.getAllGroups().catch(() => ({ version: '', gridVerMap: {} as Record<string, string> })),
      client.getPinConversations().catch(() => ({ conversations: [] as string[], version: 0 })),
      client.getUnreadMark().catch(() => ({ data: { convsGroup: [], convsUser: [] }, status: 0 })),
    ]);
    const groupIds = Object.keys(groups.gridVerMap || {});
    // `getGroupInfo` gửi `gridVerMap` trong **một** tham số URL-encoded. Đo
    // 2026-11-11: 106 id cùng lúc → máy chủ trả `Tham số không hợp lệ` và
    // `gridInfoMap` không bao giờ có, nên bảng `globalId` chỉ còn bạn bè và
    // mọi tin nhóm rơi vào hội thoại ma. Gọi theo lô nhỏ: lô nào hỏng thì chỉ
    // mất lô đó, không mất cả danh sách như trước.
    const GROUP_INFO_BATCH = 20;
    const gridInfoMap: Record<string, RawGroupInfo> = {};
    const failures: string[] = [];
    for (let index = 0; index < groupIds.length; index += GROUP_INFO_BATCH) {
      const slice = groupIds.slice(index, index + GROUP_INFO_BATCH);
      const info = await client.getGroupInfo(slice).catch((error: unknown) => {
        failures.push(error instanceof Error ? error.message.slice(0, 60) : 'unknown');
        return null;
      });
      for (const group of Object.values(info?.gridInfoMap ?? {})) {
        gridInfoMap[group.groupId] = {
          groupId: group.groupId, name: group.name, avt: group.avt,
          totalMember: group.totalMember, globalId: group.globalId,
          memberIds: group.memberIds,
          // `avt` của `getGroupInfo` là URL đầy đủ, cùng dạng với `avatar` của
          // `getAllFriends`. Trường `avatarSource` chỉ là nguồn để main tải về.
          avatarSource: group.avt || undefined,
          members: (group.currentMems ?? []).map(member => ({
            id: member.id, dName: member.dName, zaloName: member.zaloName,
            avatarSource: parseAvatarUrl(member.avatar_25)?.href ?? parseAvatarUrl(member.avatar)?.href,
          })),
        };
      }
    }
    // Đếm từng chặng: `groups: 0` ở log `global-ids` có ba nguyên nhân hoàn
    // toàn khác nhau — `getAllGroups` hỏng, `getAllGroups` trả rỗng thật, hay
    // `getGroupInfo` hỏng — và cả ba đều bị `.catch` nuốt thành `0` như nhau.
    // `failed` là số lô hỏng, `got` là số nhóm về được.
    events.debug?.('sync-v2', {
      ok: groupIds.length > 0, step: 'group-list', gridIds: groupIds.length,
      got: Object.keys(gridInfoMap).length, failed: failures.length,
      withMemberIds: Object.values(gridInfoMap).filter(group =>
        Boolean(group.memberIds?.length || group.members?.length)).length,
      error: failures[0] ?? null,
    });
    const groupRows: RawGroupInfo[] = Object.values(gridInfoMap);
    const unreadUser = (unread.data?.convsUser ?? []).map(item => String(item.id));
    const unreadGroup = (unread.data?.convsGroup ?? []).map(item => String(item.id));
    return buildThreadsWithIds(
      friends.map(friend => ({ userId: friend.userId, displayName: friend.displayName,
        zaloName: friend.zaloName, avatar: friend.avatar, avatarSource: friend.avatar || undefined,
        globalId: friend.globalId })),
      groupRows, pins.conversations ?? [], unreadUser, unreadGroup,
    );
  }

  async function activate(client: API): Promise<void> {
    api = client;
    globalIdLookup = registerGlobalIdLookup(client);
    groupMemberInfoLookup = registerGroupMemberInfoLookup(client);
    events.debug?.('global-id-resolver', { ok: globalIdLookup !== null });
    replaced = false;
    resetHistory();
    backoff = BACKOFF_START_MS;
    // `getOwnId()` đọc `ctx.uid` đã có sau khi đăng nhập, không gọi mạng.
    const ownId = safe('ownId', () => client.getOwnId());
    if (ownId) openCache(ownId);
    captureCloudSession(client);
    reportWsEndpoints(client);
    // Cache trước, mạng sau: mở app lần hai phải thấy hội thoại ngay, không chờ
    // vài lượt gọi API. Danh sách từ mạng ghi đè lên đúng những hàng đó (cùng
    // khoá `id`), nên người dùng thấy dữ liệu cũ rồi được làm mới tại chỗ.
    const cached = db ? safe('listThreads', () => listThreads(db as Db)) : null;
    if (cached?.length) {
      threads = cached;
      for (const thread of threads) events.thread(thread);
    }
    // Mạng trả danh sách rỗng thì **giữ** danh sách vừa đọc từ cache: mọi lời gọi
    // trong `buildThreadsFromServer` đều tự nuốt lỗi thành mảng rỗng, nên "rỗng"
    // không phân biệt được với "máy chủ không trả lời". Xoá danh sách của một tài
    // khoản vì một lần mạng hỏng là mất dữ liệu người dùng đang thấy.
    const fromServer = await buildThreadsFromServer(client)
      .catch(() => ({
        threads: [] as LiveThread[], globalIds: new Map<string, string>(), globalNames: new Map<string, string>(),
        groupMemberIds: new Map<string, string[]>(),
        counts: { friends: 0, groups: 0, groupIds: 0 }, avatars: new Map<string, string>(),
      }));
    // Bảng ánh xạ id nhiễu → uid phải sống ngoài `threads`: nó là thứ duy nhất
    // giải được `senderId` của Sync V2, và `threads` bị ghi đè ở dòng dưới.
    if (fromServer.globalIds.size > 0) globalIds = fromServer.globalIds;
    if (fromServer.globalNames.size > 0) globalNames = fromServer.globalNames;
    groupMemberIds = fromServer.groupMemberIds;
    avatarSources = new Map([...fromServer.avatars].filter(([, remote]) => parseAvatarUrl(remote)));
    avatarProfileLookups.clear();
    groupMemberDetailsLoaded.clear();
    groupMemberInfoRequests.clear();
    for (const groupId of groupMemberIds.keys()) groupMemberDetailsLoaded.add(groupId);
    memberAvatarUrls = new Map(threads
      .filter(thread => thread.kind === 'user' && thread.avatar)
      .map(thread => [thread.id, thread.avatar as string]));
    // Chỉ **số lượng**: `globalId` là danh tính người dùng, ghi giá trị vào log
    // là đưa nó ra khỏi DB. Con số này đủ để biết bản sửa `from_me` có nguồn
    // dữ liệu hay không — đo 2026-11-10 lần đầu: 0 tin khớp uid vì thiếu bảng.
    //
    // `friends`/`groups`/`groupIds` đi kèm vì `count` một mình không nói được
    // vì sao nhóm không vào bảng: "không có nhóm nào" (lời gọi hỏng, đã bị
    // `.catch` nuốt) khác hẳn "có nhóm nhưng `globalId` rỗng".
    events.debug?.('sync-v2', {
      ok: fromServer.globalIds.size > 0, step: 'global-ids', count: fromServer.globalIds.size,
      friends: fromServer.counts.friends, groups: fromServer.counts.groups,
    });
    if (fromServer.threads.length || !threads.length) {
      // Ảnh đã có trên đĩa phải sống qua lần thay này. Danh sách từ server dựng
      // mới hoàn toàn và `avatar` của nó là `null` (ảnh chưa tải), nên gán thẳng
      // là quên mất đường dẫn cục bộ vừa đọc từ cache — và lần mở app sau lại
      // thành 238 lời gọi ra CDN dù ảnh đã nằm trên đĩa.
      const stored = new Map(threads.map(thread => [thread.id, thread.avatar]));
      threads = fromServer.threads.map(thread => {
        const avatar = stored.get(thread.id);
        return avatar ? { ...thread, avatar } : thread;
      });
      for (const thread of threads) events.thread(thread);
    }
    if (db && threads.length) {
      const store = db;
      // Chỉ metadata hội thoại: chưa tải tin của từng hội thoại ở bước này
      // (plan §6.4 — danh sách hiện ngay, lịch sử tải khi người dùng mở).
      safe('upsertThreads', () => upsertThreads(store, threads));
    }
    // Avatar sau cùng và **không chờ**: mỗi ảnh là một lời gọi ra CDN của Zalo,
    // và danh sách hội thoại không được đợi 238 lời gọi đó mới hiện. Hội thoại
    // nào đã có ảnh trên đĩa (lần mở trước) thì `upsertThreads` không đụng vào
    // cột `avatar_url`, và `threads` vừa đọc từ cache đã mang sẵn đường dẫn.
    if (fromServer.avatars.size) {
      const known = new Set(threads.map(thread => thread.id));
      // Đường dẫn cục bộ đã có (từ cache) → tên file, để main biết ảnh nào đã
      // nằm trên đĩa. Không tìm thấy nghĩa là ảnh chưa tải bao giờ.
      const have = new Map<string, string>();
      for (const thread of threads) {
        const name = thread.avatar?.startsWith('glass://app/avatars/')
          ? thread.avatar.slice('glass://app/avatars/'.length) : null;
        if (name) have.set(thread.id, name);
      }
      for (const [threadId, remote] of fromServer.avatars) {
        if (known.has(threadId)) events.avatar?.(threadId, remote, have.get(threadId) ?? null);
      }
    }
    // Dọn di sản của lỗi hai không gian id: hội thoại còn mang id nhiễu, và
    // 79 139 tin là bản sao của hàng đã có dưới uid (đo 2026-11-11). Đây là
    // thao tác **xoá dữ liệu thật** nên nó chỉ chạy **một lần** cho mỗi tài
    // khoản, và chỉ khi bảng ánh xạ đã có nhóm — thiếu nhóm thì tin nhóm sẽ
    // mất chỗ chứ không được gộp.
    //
    // Đặt **sau** `upsertThreads` để hội thoại có tên thật vừa về không bị gộp
    // trước khi tên được ghi; và đọc lại danh sách vào RAM ngay tại đây vì vòng
    // phát `threads` phía trên đã chạy xong.
    if (db && fromServer.globalIds.size > 0) {
      const store = db;
      const done = safe('consolidateDone', () => store.handle
        .prepare("SELECT value FROM kv WHERE key = 'consolidate_noised_v1'").get() !== undefined);
      if (!done) {
        const result = safe('consolidateNoised', () => consolidateNoisedThreads(store, globalIds));
        if (result) {
          // Chỉ số lượng: chính các con số này là thứ nói lần dọn có đúng
          // không, và chúng không mang nội dung tin nào.
          events.debug?.('sync-v2', { ok: true, step: 'consolidate', ...result });
          // Đánh dấu **sau** khi gộp xong. Ghi cờ trước là tự khoá mình khỏi
          // lần chạy sau nếu lần này hỏng giữa đường.
          safe('consolidateMark', () => store.handle
            .prepare("INSERT INTO kv (key, value) VALUES ('consolidate_noised_v1', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
            .run(String(Date.now())));
          // Danh sách đang cầm trong RAM đã cũ sau khi gộp.
          const refreshed = safe('listThreadsAfterConsolidate', () => listThreads(store));
          if (refreshed) threads = refreshed;
        }
      }
    }
    const own = await client.fetchAccountInfo().catch(() => null);
    const label = (own?.profile?.displayName || own?.profile?.zaloName || 'Tài khoản Zalo').slice(0, 60);
    // Id nhiễu của **chính mình**: `senderId` của tin do ta gửi mang đúng giá
    // trị này, còn `getOwnId()` là uid số. Hai không gian id, nên so `senderId`
    // với `ownId` luôn sai — đo 2026-11-10: 0/4 768 tin khớp. Zalo PC lấy nó
    // bằng `resolveMyGlobalNoisedId()` → `getGlobalIdsFromUserIds(uid)`; cùng
    // nguồn với `globalId` của bạn bè, chỉ khác là ở đây là hồ sơ của ta.
    const ownGlobalId = own?.profile?.globalId;
    if (ownGlobalId && ownGlobalId !== '0') ownNoisedId = ownGlobalId;
    // Cờ, không phải giá trị: biết id nhiễu của mình là điều kiện để `from_me`
    // đúng, và thiếu nó thì mọi tin thành "của người khác" mà không có dấu hiệu
    // nào khác trong log.
    events.debug?.('sync-v2', { ok: Boolean(ownNoisedId), step: 'own-noised-id' });
    emitLogin({ status: 'logged-in', label, phoneSyncComplete: hasCompletedPhoneSync(db), phoneSyncSetupRequired: isPhoneSyncSetupRequired(db) });
    wireListener();
    startListener();
    // Sau `startListener` vì cần socket đã có; hàm này tự thoát nếu chưa có
    // và `connected` sẽ gọi lại.
    attachSync(client);
    // Đối chứng, chỉ khi có `GLASS_CLOUD_PROBE`: chạy sau khi listener đã lên để
    // không chen vào đường khởi động bình thường. `GLASS_SYNC_PROBE` đi cùng chỗ
    // vì cùng lý do: cả hai là phép đo, không phải đường chạy.
    void runCloudProbe().catch(() => undefined);
    void runSyncProbe().catch(() => undefined);
    // `runRequestSyncProbe` (xem `590`) đã bị **gỡ hẳn**, không phải tắt bằng
    // cờ: nó là thứ làm điện thoại rung mà không có phiên nào phía sau.
    // KHÔNG gọi `runCtrlPollProbe` ở đây: nó cần `ctrl_qCmds` từ `1/1`, mà frame
    // đó về sau điểm này. `runAuthProbe` sẽ gọi nó đúng lúc danh sách có.
    void runWakeProbe().catch(() => undefined);
    void runCtrlWaitProbe().catch(() => undefined);
    // Gọi **trước** `wireListener`/`startListener` ở trên là không được: socket
    // chưa có. Ở đây `1/1` có thể đã về rồi — nếu vậy phép đo không thấy gì, và
    // đó là một kết quả đọc nhầm thành "không có hàng đợi". Chấp nhận: chạy lại
    // app với cờ này sẽ có lần bắt được, vì `1/1` đến ở mỗi lần kết nối lại.
    runAuthProbe();
  }

  async function refreshSavedSession(client: API, saved: SavedSession): Promise<void> {
    try {
      // Keep the same device identity; persist cookies rotated during login.
      const jar = typeof client.getCookie === 'function' ? client.getCookie() : null;
      const cookie = jar?.serializeSync()?.cookies;
      if (cookie?.length) await store.save({ ...saved, cookie });
    } catch {
      events.debug?.('session-save', { ok: false });
      // A failed refresh must not erase the previous usable credentials.
    }
  }

  async function restore(): Promise<boolean> {
    const saved = await store.load();
    if (!saved) return false;
    const client = await withDeadline(
      connect().login({
        imei: saved.imei, cookie: saved.cookie, userAgent: saved.userAgent, language: saved.language,
      }), LOGIN_TIMEOUT_MS, 'Khôi phục phiên cũ quá lâu.',
    );
    await refreshSavedSession(client, saved);
    await activate(client);
    return true;
  }

  async function loginQRFlow(): Promise<void> {
    if (loginInFlight || api) return;
    loginInFlight = true;
    replaced = false;
    // Đồng hồ cho **cả** luồng, không phải từng bước. `loginQR` của zca-js có
    // hạn riêng cho mã QR (100 giây, sinh lại tối đa `QR_RETRY_LIMIT` lần) và
    // cho từng lần chờ quét/xác nhận — nhưng `waitingScan` gọi `ctx.options.polyfill`
    // mà `fetch` không có hạn thời gian. Một lần poll bị treo là cả luồng treo,
    // và `catch` bên dưới không bao giờ chạy. Đồng hồ tổng bắt đúng trường hợp
    // đó và luôn trả về một trạng thái cho renderer.
    const deadline = setTimeout(() => {
      if (!loginInFlight) return;
      loginInFlight = false;
      emitLogin({ status: 'error', retryable: true,
        message: 'Đăng nhập quá lâu không phản hồi. Bấm "Thử lại" để thử lại.' });
    }, LOGIN_FLOW_TIMEOUT_MS);
    try {
      const captured: { session: Omit<SavedSession, 'language'> | null } = { session: null };
      const client = await connect().loginQR({ language: LANGUAGE }, event => {
        if (event.type === LoginQRCallbackEventType.QRCodeGenerated) {
          qrRestarts = 0;
          emitLogin({ status: 'qr', qrImage: `data:image/png;base64,${event.data.image}`,
            note: 'Mở Zalo trên điện thoại và quét mã. Mã hết hạn sau ít phút.' });
        } else if (event.type === LoginQRCallbackEventType.QRCodeScanned) {
          emitLogin({ status: 'qr', qrImage: '', note: 'Đã quét. Xác nhận đăng nhập trên điện thoại.' });
        } else if (event.type === LoginQRCallbackEventType.QRCodeExpired) {
          if (qrRestarts >= QR_RETRY_LIMIT) {
            emitLogin({ status: 'error', message: 'Mã QR đã hết hạn. Bấm "Thử lại" để tạo mã mới.', retryable: true });
            event.actions.abort();
            return;
          }
          qrRestarts += 1;
          setTimeout(() => { void event.actions.retry(); }, QR_RETRY_MS);
        } else if (event.type === LoginQRCallbackEventType.QRCodeDeclined) {
          emitLogin({ status: 'error', message: 'Bạn đã từ chối đăng nhập trên điện thoại.', retryable: true });
          event.actions.abort();
        } else if (event.type === LoginQRCallbackEventType.GotLoginInfo) {
          captured.session = {
            cookie: event.data.cookie, imei: event.data.imei, userAgent: event.data.userAgent,
          };
        }
      });
      if (!client) throw new ZaloApiError('Không đăng nhập được bằng QR.');
      if (captured.session !== null) {
        const saved = { ...captured.session, language: LANGUAGE };
        await store.save(saved);
        await refreshSavedSession(client, saved);
      }
      await activate(client);
    } catch (error) {
      const message = error instanceof ZaloApiError ? error.message : 'Đăng nhập thất bại.';
      emitLogin({ status: 'error', message: message.slice(0, 200), retryable: isRetryable(error) });
    } finally {
      clearTimeout(deadline);
      loginInFlight = false;
    }
  }

  async function login(): Promise<void> {
    if (api || loginInFlight) return;
    if (loginTask) { await loginTask; return; }
    loginTask = (async () => {
      emitLogin({ status: 'logged-out' });
      try { return await restore(); }
      catch {
        emitLogin({ status: 'error', retryable: true, sessionRetained: true,
          message: 'Chưa khôi phục được phiên Zalo. Phiên vẫn được giữ trên máy; hãy kiểm tra mạng, mở khóa kho khóa hệ điều hành và bấm Thử lại. Nếu Zalo đã thu hồi phiên, bạn cần đăng nhập lại bằng QR.' });
        return true; // Handled: keep the saved session and wait for retry.
      }
    })();
    let handled: boolean;
    try { handled = await loginTask; } finally { loginTask = null; }
    if (!handled) await loginQRFlow();
  }

  return {
    async callSignal(signal) {
      if (!api || connection !== 'connected') throw new Error('Call session unavailable');
      return registerCallSignaling(api)(signal);
    },
    callPeer(id) {
      const peer = threads.find(t => t.id === id && t.kind === 'user');
      return peer ? { id: peer.id, name: peer.name } : null;
    },
    login,
    dispose() {
      clearBackoff();
      stopListener();
      api = null;
      // Đóng handle trước khi tiến trình thoát để WAL được gộp về file chính.
      closeCache();
    },
    async logout() {
      clearBackoff();
      stopListener();
      api = null;
      replaced = false;
      threads = [];
      avatarSources.clear();
      memberAvatarUrls.clear();
      avatarProfileLookups.clear();
      repairedStickerThreads.clear();
      groupMemberInfoLookup = null;
      groupMemberDetailsLoaded.clear();
      groupMemberInfoRequests.clear();
      groupProfileRequests.clear();
      seenParams.clear();
      resetHistory();
      // Đăng xuất chỉ xoá **phiên**, không xoá cache: plan §6.10 để người dùng
      // quyết định có xoá dữ liệu cục bộ hay không, và câu hỏi đó chưa có trong
      // UI. Giữ cache lại thì đăng nhập lại không phải tải lịch sử từ đầu.
      closeCache();
      await store.clear();
      emitLogin({ status: 'logged-out' });
      emitConnection('disconnected');
    },
    reconnect() {
      if (!api) return;
      clearBackoff();
      replaced = false;
      backoff = BACKOFF_START_MS;
      started = false;
      startListener();
    },
    async listConversations() {
      // Cache làm mới `threads` trong `activate()`; tới đây nó đã là nguồn đúng.
      return threads;
    },
    async getMessages(threadId, kind, before) {
      if (kind === 'group' && connection === 'connected') {
        await resolveGroupMemberProfiles(threadId);
      }
      // Trang từ cache chỉ cho **lần mở đầu tiên** của mỗi hội thoại trong phiên.
      // Lần sau (người dùng bấm "Tải tin nhắn cũ hơn") phải hỏi máy chủ, nếu không
      // nút tải chỉ trả lại đúng trang cache và không bao giờ đi xa hơn.
      const cacheKey = `${kind}:${threadId}`;
      if (db && !before && !servedFromCache.has(cacheKey)) {
        const store = db;
        const page = safe('page', () => pageMessages(store, threadId, kind, HISTORY_PAGE));
        // Hội thoại chưa có gì trong cache thì để đường mạng chạy như cũ, nhưng
        // vẫn đánh dấu: lần bấm sau không được thử cache nữa.
        servedFromCache.add(cacheKey);
        // `hasMore` của trang cache nói về **DB**, không nói gì về máy chủ: cache
        // hết tin cũ không có nghĩa Zalo hết. Trả `false` ở đây sẽ tắt hẳn nút
        // "Tải tin nhắn cũ hơn" và người dùng không bao giờ lấy được phần còn lại.
        if (page?.messages.length) {
          let messages = page.messages;
          // Cache trước bản sửa thiếu senderId. Lấy profile thành viên và đồng
          // bộ lại trang gần nhất để bổ sung tên cho các dòng đã lưu từ trước.
          if (kind === 'group' && connection === 'connected'
            && messages.some(message => message.from === 'them' && !message.fromName)) {
            await refreshGroupSenderNames(threadId, false);
            messages = safe('pageRefreshed', () => pageMessages(store, threadId, kind, HISTORY_PAGE))
              ?.messages ?? messages;
          }
          messages = await prepareMediaPage(threadId, kind, messages);
          return { messages: messages.map(toIpcMessageWithAvatar), hasMore: true };
        }
      }
      const page = await fetchFromServer(threadId, kind, before);
      // Ghi cả trang nhận từ máy chủ: lần mở sau đọc được ngay từ cache.
      const messages = await prepareMediaPage(threadId, kind, persist(threadId, page.messages));
      if (kind === 'group') {
        void resolveGroupMemberProfiles(threadId).catch(error => {
          events.debug?.('group-profile-refresh', {
            ok: false, error: error instanceof Error ? error.name : 'unknown',
          });
        });
      }
      return { messages: messages.map(toIpcMessageWithAvatar), hasMore: page.hasMore };
    },
    async send(request) {
      if (!api) return { ok: false, clientId: request.clientId, error: 'Chưa đăng nhập.' };
      // Ghi bong bóng tạm **trước** khi gọi mạng: app tắt giữa chừng thì lần sau
      // vẫn biết có một tin đang `sending` chưa có mã, thay vì mất dấu hoàn toàn
      // (plan §6.10 "Gửi tin rồi mất mạng trước khi nhận phản hồi").
      if (db) {
        const store = db;
        safe('pending', () => insertPending(store, {
          threadId: request.threadId, kind: request.kind, msgId: null,
          clientId: request.clientId, from: 'me', text: request.text, ts: Date.now(),
        }));
      }
      try {
        const response = await api.sendMessage(request.text, request.threadId, threadType(request.kind));
        const msgId = response.message?.msgId;
        // Không có dòng này thì "gửi được" không bao giờ chứng minh được từ ngoài:
        // bong bóng trong UI do renderer tự vẽ, còn đây là chỗ duy nhất biết máy
        // chủ đã trả `msgId` thật. Chỉ id và độ dài text — không nội dung tin.
        events.debug?.('send', { ok: msgId !== undefined, kind: request.kind, len: request.text.length,
          ...(msgId !== undefined ? { msgId: String(msgId) } : {}) });
        if (msgId === undefined) {
          failPending(request.threadId, request.clientId);
          return { ok: false, clientId: request.clientId, error: 'Máy chủ không trả về mã tin.' };
        }
        const mapped: LiveMessage = {
          threadId: request.threadId, kind: request.kind, msgId: String(msgId),
          clientId: request.clientId, from: 'me', text: request.text, ts: Date.now(),
        };
        // Gộp bong bóng tạm vào tin thật qua `clientId` (plan §6.3 quy tắc 3).
        const committed = persist(request.threadId, [mapped])[0] ?? mapped;
        threads = applyMessage(threads, committed, activeThreadId);
        const thread = threads.find(t => t.id === request.threadId && t.kind === request.kind);
        if (thread) events.thread(thread);
        return { ok: true, clientId: request.clientId, msgId: String(msgId) };
      } catch (error) {
        events.debug?.('send', { ok: false, kind: request.kind, len: request.text.length,
          message: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
        failPending(request.threadId, request.clientId);
        return { ok: false, clientId: request.clientId, error: 'Gửi thất bại. Chọn "Gửi lại" để thử lại.' };
      }
    },
    async markRead(threadId, kind) {
      if (!api) return;
      const seen = seenParams.get(threadId);
      if (seen) {
        try { await api.sendSeenEvent(seen, threadType(kind)); } catch { /* best effort */ }
      }
      const thread = threads.find(t => t.id === threadId && t.kind === kind);
      if (thread && thread.unread !== 0) {
        threads = threads.map(item => item === thread ? { ...item, unread: 0 } : item);
        events.thread({ ...thread, unread: 0 });
      }
    },
    setAvatar(threadId, fileName) {
      // Ảnh về muộn hơn danh sách hội thoại, nên bản trong RAM phải được sửa
      // **tại chỗ** và phát lại: danh sách UI đã dựng từ bản cũ.
      const url = fileName ? `glass://app/avatars/${fileName}` : null;
      if (url) memberAvatarUrls.set(threadId, url);
      else memberAvatarUrls.delete(threadId);
      let changed = false;
      threads = threads.map(item => {
        if (item.id !== threadId || item.avatar === url) return item;
        changed = true;
        return { ...item, avatar: url };
      });
      const thread = changed ? threads.find(item => item.id === threadId) : undefined;
      if (thread) events.thread(thread);
      // Ghi DB để lần mở app sau không phải tải lại ảnh đã có trên đĩa.
      if (changed && db) {
        const store = db;
        safe('setThreadAvatar', () => setThreadAvatar(store, threadId, url));
      }
      const activeId = activeThreadId;
      // History includes former members and groups with a partial roster. Match
      // the sender identity itself, rather than requiring current membership.
      if (!url || !activeId || !db
        || !threads.some(item => item.id === activeId && item.kind === 'group')) return;
      const page = safe('pageGroupAvatarRefresh', () =>
        pageMessages(db as Db, activeId, 'group', HISTORY_PAGE));
      for (const message of page?.messages ?? []) {
        if (message.from === 'them' && (message.senderId === threadId
          || (message.senderId && globalIds.get(message.senderId) === threadId))) {
          events.message(toIpcMessageWithAvatar({ ...message, backfill: true }));
        }
      }
    },
    setActiveThread(threadId) {
      activeThreadId = threadId;
      const active = threadId
        ? threads.find(thread => thread.id === threadId && thread.kind === 'group') : undefined;
      events.debug?.('active-thread', { active: Boolean(threadId), kind: active ? 'group' : null });
      if (!threadId || connection !== 'connected' || !servedFromCache.has(`group:${threadId}`)) return;
      if (!active) return;
      void refreshGroupSenderNames(threadId, true).catch(error => {
        events.debug?.('group-name-refresh', {
          ok: false, error: error instanceof Error ? error.message.slice(0, 120) : 'unknown',
        });
      });
    },
    async setPinned(threadId, kind, pinned) {
      if (!api) return false;
      try {
        await api.setPinnedConversations(pinned, threadId, threadType(kind));
      } catch (error) {
        events.debug?.('pin', { ok: false, kind, pinned,
          message: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
        return false;
      }
      events.debug?.('pin', { ok: true, kind, pinned });
      // Chỉ sửa RAM **sau** khi máy chủ nhận: ghim cục bộ không tồn tại trên
      // Zalo, và một hàng ghim sai sẽ tự bỏ ghim ở lần nạp danh sách kế tiếp.
      threads = threads.map(item => (item.id === threadId ? { ...item, pinned } : item));
      const thread = threads.find(item => item.id === threadId);
      if (thread) events.thread(thread);
      const store = db;
      if (store && thread) safe('pin', () => upsertThreads(store, [thread]));
      return true;
    },
    async setUnread(threadId, kind, unread) {
      if (!api) return false;
      try {
        if (unread) await api.addUnreadMark(threadId, threadType(kind));
        else await api.removeUnreadMark(threadId, threadType(kind));
      } catch (error) {
        events.debug?.('unread', { ok: false, kind, unread,
          message: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
        return false;
      }
      events.debug?.('unread', { ok: true, kind, unread });
      // Số chưa đọc là **số** trên UI; Zalo chỉ có dấu (có/không). Đánh dấu là
      // `1`, bỏ dấu là `0` — bịa một con số lớn hơn là nói sai về hội thoại.
      threads = threads.map(item => (item.id === threadId ? { ...item, unread: unread ? 1 : 0 } : item));
      const thread = threads.find(item => item.id === threadId);
      if (thread) events.thread(thread);
      const store = db;
      if (store && thread) safe('unread', () => upsertThreads(store, [thread]));
      return true;
    },
    async react(threadId, kind, msgId, icon) {
      if (!api) return false;
      // `addReaction` đòi **cả** `gMsgID` lẫn `cMsgID`: máy chủ tra tin theo cặp
      // đó. Thiếu id máy khách thì không có gì để bịa — `parseInt('')` là NaN, và
      // một lời gọi chắc chắn hỏng còn tệ hơn một câu trả lời "không làm được".
      const cliMsgId = db ? messageCliId(db, threadId, msgId) : null;
      if (!cliMsgId) {
        events.debug?.('react', { ok: false, reason: 'no-cli-id', kind });
        return false;
      }
      try {
        // `icon: ''` là **gỡ**. `addReaction` không có nhánh nào cho `Reactions.NONE`
        // (rơi vào `default` → `rType = -1`), và đó chính là mã Zalo PC dùng cho
        // "bỏ cảm xúc" — nên đường gỡ đi qua đúng lời gọi này, không có API riêng.
        // `rIcon` đi qua IPC là `string`; ép về enum của zca-js là đúng nghĩa ở
        // đây vì main vừa kiểm nó là chuỗi ngắn, và mọi giá trị lạ đều rơi vào
        // `default` ở phía zca-js (rType = -1 = gỡ), không phải một biểu tượng sai.
        await api.addReaction((icon || Reactions.NONE) as Reactions,
          { data: { msgId, cliMsgId }, threadId, type: threadType(kind) });
      } catch (error) {
        events.debug?.('react', { ok: false, kind, hasIcon: Boolean(icon),
          message: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
        return false;
      }
      events.debug?.('react', { ok: true, kind, hasIcon: Boolean(icon) });
      // Trạng thái thật (gồm cả người khác thả cùng lúc) về qua sự kiện `reaction`,
      // nên ở đây **không** sửa DB: ghi một phỏng đoán rồi bị ghi đè là hai lần
      // phát tin cho một cú bấm, và lần đầu có thể sai.
      return true;
    },
    async recall(threadId, kind, msgId) {
      if (!api) return false;
      // `undo` gửi `msgId` **và** `cliMsgIdUndo`: máy chủ tra tin theo cặp đó,
      // đúng như `addReaction`. Thiếu id máy khách thì không có gì để bịa.
      const cliMsgId = db ? messageCliId(db, threadId, msgId) : null;
      if (!cliMsgId) {
        events.debug?.('recall', { ok: false, reason: 'no-cli-id', kind });
        return false;
      }
      try {
        const reply = await api.undo({ msgId, cliMsgId }, threadId, threadType(kind));
        // zca-js trả `{status}`; 0 là thành công. Không có trường nào khác đáng
        // đọc — nội dung tin không bao giờ vào log.
        if (Number(reply?.status) !== 0) {
          events.debug?.('recall', { ok: false, reason: 'status', kind, status: Number(reply?.status) });
          return false;
        }
      } catch (error) {
        events.debug?.('recall', { ok: false, kind,
          message: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
        return false;
      }
      events.debug?.('recall', { ok: true, kind });
      // Như `react`: trạng thái thật về qua sự kiện `undo`, nên DB do đường đó
      // ghi. Tự sửa ở đây sẽ là hai lần phát tin cho một thao tác.
      return true;
    },
    async forward(threadId, kind, text, msgId, ts) {
      if (!api) return false;
      const targetType = threadType(kind);
      try {
        if (typeof (api as { forwardMessage?: unknown }).forwardMessage === 'function') {
          const payload = {
            message: text,
            ...(msgId && ts ? { reference: { id: msgId, ts, logSrcType: 0, fwLvl: 1 } } : {}),
          };
          const res = await (api as unknown as {
            forwardMessage(p: unknown, ids: string[], t: ThreadType): Promise<{ success: unknown[] }>;
          }).forwardMessage(payload, [threadId], targetType);
          if (res?.success && res.success.length > 0) {
            events.debug?.('forward', { ok: true, kind, threadId, mode: 'forwardMessage' });
            return true;
          }
        }
      } catch (err) {
        events.debug?.('forward', {
          ok: false,
          kind,
          threadId,
          fallback: true,
          message: err instanceof Error ? err.message.slice(0, 160) : 'unknown',
        });
      }
      try {
        const sendRes = await api.sendMessage(text, threadId, targetType);
        const ok = sendRes?.message?.msgId !== undefined;
        events.debug?.('forward', { ok, kind, threadId, mode: 'sendMessageFallback' });
        return ok;
      } catch (error) {
        events.debug?.('forward', {
          ok: false,
          kind,
          threadId,
          message: error instanceof Error ? error.message.slice(0, 160) : 'unknown',
        });
        return false;
      }
    },
    setMedia(threadId, msgId, kind, patches) {
      if (!patches.size) return;
      // Đọc hàng từ DB rồi vá **một** trường: URL gốc và `raw` phải giữ nguyên,
      // và không được ghi đè `text`/`ts` bằng giá trị rỗng. Đây là lý do không
      // đi qua `upsertMessages` — hàm đó cần cả tin, còn ở đây chỉ có đường dẫn.
      if (!db) return;
      const store = db;
      const updated = safe('setMedia', () => setMessageMedia(store, threadId, msgId, patches));
      if (!updated) return;
      // Phát lại đúng hình dạng của `message`, để renderer chỉ cần cập nhật tại
      // chỗ theo `msgId`. Không đụng `unread`/`lastTs`: tệp đến muộn không phải
      // tin mới.
      events.media?.(toIpcMessageWithAvatar({ ...updated, kind }));
    },
    async mediaJobs(threadId, msgId, kind) {
      if (!db || !msgId) return [];
      const store = db;
      const row = safe('mediaStickerMetadata', () => store.handle.prepare(
        'SELECT text FROM messages WHERE thread_id = ? AND msg_id = ?').get(threadId, msgId)) as
        { text?: string } | undefined;
      const items = messageAttachments(store, threadId, msgId);
      if (items.some(item => item.kind === 'sticker' && !item.remote)) {
        const enriched = await enrichStickerMessage({ text: row?.text ?? '', attachments: items });
        const attachments = enriched.attachments;
        if (attachments) safe('saveStickerMetadata', () => store.handle.prepare(
          'UPDATE messages SET attachments = ? WHERE thread_id = ? AND msg_id = ? AND attachments = ?')
          .run(JSON.stringify(attachments), threadId, msgId, JSON.stringify(items)));
      }
      const jobs = safe('mediaJobs', () =>
        mediaJobsOf(threadId, msgId, messageAttachments(store, threadId, msgId)));
      return (jobs ?? []).map(job => ({ ...job, kindOfThread: kind }));
    },
    async syncFromPhone() {
      const controller = sync;
      if (!controller) {
        return { ok: false, code: 'not-ready', message: 'chưa đăng nhập hoặc chưa mở kết nối' };
      }
      // Hai bước: hội thoại trước (lấy `convId` = `globalNoisedId`), rồi mới xin
      // tin theo `oneone/<id>` / `group/<id>`. Xin tin khi chưa có id không phải
      // "thử thêm một lần" — nó là một yêu cầu không có database nào để phục vụ.
      return controller.syncAll();
    },
    syncPhase() { return sync?.currentPhase ?? 'idle'; },
  };
}

export type { TMessage };
