/**
 * Hợp đồng IPC giữa main, preload và renderer (plan §5.1).
 *
 * Chỉ chứa kênh và kiểu dữ liệu thuần. Không file nào ở đây được chạm zca-js.
 * `electron/ipc-contract.ts` là bản sao bắt buộc của hằng `IPC` vì
 * `tsconfig.electron.json` có `rootDir: "electron"`; test parity giữ hai bản khớp.
 */
export const IPC = {
  // request/response (invoke)
  login: 'chat:login',
  logout: 'chat:logout',
  listConversations: 'chat:listConversations',
  getMessages: 'chat:getMessages',
  setActiveThread: 'chat:setActiveThread',
  sendMessage: 'chat:sendMessage',
  retryMessage: 'chat:retryMessage',
  markRead: 'chat:markRead',
  /**
   * Ghim / bỏ ghim một hội thoại. Đây là trạng thái **trên máy chủ** Zalo, không
   * phải một cờ cục bộ: ghim ở đây thì điện thoại cũng ghim.
   */
  setPinned: 'chat:setPinned',
  /** Đánh dấu chưa đọc / bỏ dấu; cũng là trạng thái máy chủ. */
  setUnread: 'chat:setUnread',
  /**
   * Thả / gỡ cảm xúc trên một tin. Cũng là trạng thái máy chủ; `rIcon: ''` là gỡ.
   */
  react: 'chat:react',
  /**
   * Thu hồi một tin **của mình**. Cùng loại trạng thái máy chủ với ghim và cảm
   * xúc: Zalo từ chối (quá 24 giờ, không phải tin của mình) thì renderer phải
   * trả lại bong bóng. Trạng thái thật về qua sự kiện `undo`.
   */
  recall: 'chat:recall',
  forwardMessage: 'chat:forwardMessage',
  reconnect: 'chat:reconnect',
  /**
   * Renderer báo một lỗi render cho nhật ký chẩn đoán (plan §9.1). Một chiều:
   * đây là đường chạy lúc UI vừa hỏng, không ai chờ trả lời.
   */
  reportError: 'chat:reportError',
  /**
   * Xin điện thoại đẩy lịch sử cũ lên (Sync V2). Chỉ trả lời **yêu cầu** có được
   * máy chủ nhận không; tin về sau qua `ev:messageUpsert`.
   */
  syncFromPhone: 'chat:syncFromPhone',
  // event (main → renderer)
  evLoginState: 'ev:loginState',
  evConnection: 'ev:connection',
  evMessageUpsert: 'ev:messageUpsert',
  evThreadUpsert: 'ev:threadUpsert',
  /** Main gặp một lỗi không có `catch`; renderer hiện nó thay vì để im lặng. */
  evCrash: 'ev:crash',
  /** Giai đoạn và số liệu của lần đồng bộ từ điện thoại. */
  evSync: 'ev:sync',
  /** Trạng thái bắt kịp tin mới sau khi kết nối lại. */
  evCatchUp: 'ev:catchUp',
  /**
   * Một tệp đính kèm vừa có trên đĩa. Cùng `msgId` với tin đã phát qua
   * `ev:messageUpsert`: renderer sửa tại chỗ, không thêm bong bóng.
   */
  evMedia: 'ev:media',
} as const;

/** Lỗi toàn cục của main, đã rút gọn thành một dòng cho người dùng đọc. */
export interface CrashNotice {
  message: string;
}

export type ThreadKind = 'user' | 'group';

/** Four connection states exposed to the renderer. */
export type LiveConnection = 'connected' | 'connecting' | 'disconnected' | 'replaced';

export interface CatchUpProgress {
  phase: 'checking' | 'updated' | 'current' | 'incomplete';
  received: number;
}

/**
 * Bốn trạng thái đăng nhập của plan §5.3. `qr.qrImage` là data URL đã ghép ở main;
 * renderer không bao giờ nhận cookie, IMEI hay token.
 */
export type LoginState =
  | { status: 'logged-out' }
  | { status: 'qr'; qrImage: string; note?: string }
  | { status: 'logged-in'; label: string; phoneSyncComplete?: boolean; phoneSyncSetupRequired?: boolean }
  | { status: 'error'; message: string; retryable: boolean; sessionRetained?: boolean };

export interface LiveThread {
  id: string;
  kind: ThreadKind;
  name: string;
  /**
   * Đường dẫn avatar **cục bộ** (`glass://app/avatars/<id>.png`), hoặc `null`.
   *
   * Không phải URL của Zalo: CSP `default-src 'none'; img-src 'self' data:` cấm
   * mọi host từ xa. Main tải ảnh về đĩa một lần rồi phục vụ qua chính
   * `glass://app`, nên trong CSP nó là `'self'` như mọi asset khác.
   */
  avatar: string | null;
  pinned: boolean;
  unread: number;
  lastText: string;
  lastTs: number;
}

/**
 * Loại tệp đính kèm đã phân loại ở main (`electron/protocol/attachment.ts`).
 *
 * Renderer không tự đoán từ `msgType`: bảng phân loại dùng enum số của Zalo PC
 * (`Ai` trong bundle), và nó là thứ duy nhất biết `type` chuỗi nào ứng với ảnh,
 * tệp hay liên kết.
 */
export type AttachmentKind =
  | 'photo' | 'video' | 'voice' | 'sticker' | 'doodle'
  | 'file' | 'link' | 'location' | 'contact' | 'gif' | 'other';

/**
 * Một tệp đính kèm **ở dạng đi qua IPC**.
 *
 * Không có URL của Zalo ở đây, cùng lý do như `LiveThread.avatar`: CSP là
 * `img-src 'self' data:` (ADR-002), nên một host từ xa vừa không vẽ được vừa là
 * một đích mạng do renderer khởi phát. Main tải nội dung về `<dataRoot>/media/`
 * rồi điền `src`/`thumb` bằng đường dẫn `glass://app/media/…`.
 *
 * `src: null` là **chưa tải xong**, không phải "không có": với ảnh, UI hiện ô
 * chờ; ảnh sẽ về bằng một sự kiện `message` thứ hai cho cùng `msgId`.
 */
export interface LiveAttachment {
  kind: AttachmentKind;
  title?: string;
  description?: string;
  /** Đích của liên kết, chỉ với `kind: 'link'`. Hiển thị dạng chữ, không tự mở. */
  url?: string;
  size?: number;
  /** Đuôi tệp, chữ thường, không có dấu chấm. */
  ext?: string;
  /** Thời lượng (mili-giây) của ghi âm/video, khi Zalo gửi kèm. */
  duration?: number;
  /** Đường dẫn ảnh cục bộ, `glass://app/media/<name>`; `null` khi chưa tải về. */
  src: string | null;
  /** Ảnh thu nhỏ cục bộ (nếu đã tải). */
  thumb: string | null;
  failed?: boolean;
}

/**
 * Tin được trích dẫn (trả lời). Xem bản `electron/ipc-contract.ts` — hai tệp
 * phải khai giống nhau, `tests/ipc-contract.test.ts` so chúng.
 */
export interface LiveQuote {
  msgId: string | null;
  from: 'me' | 'them';
  text: string;
  fromName?: string;
  attachmentKind?: AttachmentKind;
  ts?: number;
}

/**
 * Một cảm xúc đã thả lên tin — bản sao của hợp đồng bên main.
 *
 * `icon` là `rIcon` của Zalo (`"/-heart"`, `":>"`, …), không phải emoji và không
 * phải `rType`: `rIcon` là thứ máy chủ gửi trên cả hai đường (realtime và đồng
 * bộ), nên nó là khoá ổn định để gộp nhiều người thả cùng một biểu tượng.
 */
export interface LiveReaction {
  icon: string;
  count: number;
  /** Tôi có nằm trong số người đã thả cảm xúc này không. */
  mine: boolean;
}

/** Text range of an @mention. User IDs stay in the main process. */
export interface MessageMention {
  pos: number;
  len: number;
}

export interface LiveMessage {
  threadId: string;  kind: ThreadKind;
  /** ID phía server. Tin tạm chưa có nên dùng `clientId`. */
  msgId: string | null;
  clientId: string | null;
  from: 'me' | 'them';
  /** Tên người gửi trong nhóm; không có với tin của mình hoặc tin 1-1. */
  fromName?: string;
  /** Ảnh thành viên trong nhóm, chỉ là đường dẫn cục bộ do main phục vụ. */
  senderAvatar?: string;
  /**
   * Tin đã thu hồi (plan §6.10). Dòng **vẫn còn** để tin không biến mất khỏi đúng
   * chỗ nó từng ở; `text` rỗng và UI hiện "Tin nhắn đã thu hồi". Không có trường
   * này thì hiểu là `false`.
   */
  recalled?: boolean;
  /**
   * Sự kiện này là **thay đổi cảm xúc** trên một tin đã có, không phải một tin
   * mới. Cờ tường minh chứ không suy từ `reactions` có mặt hay không: khi người
   * cuối cùng gỡ cảm xúc, `reactions` là mảng rỗng và một tin thường cũng chẳng
   * có trường đó — hai thứ trông giống nhau, và renderer sẽ nối một bong bóng
   * rỗng vào cuối hội thoại.
   */
  reacted?: boolean;
  text: string;  ts: number;
  /** @mention ranges in UTF-16 code units, without mentioned-user IDs. */
  mentions?: MessageMention[];
  /**
   * Tệp đính kèm (ảnh, tệp, liên kết, ghi âm…).
   *
   * Vắng mặt hoặc rỗng là tin chỉ có chữ. Một tin **chỉ** có tệp vẫn có `text`
   * rỗng — và đó là lý do `text` không còn là điều kiện để tin được ghi: bỏ tin
   * rỗng chính là cách ảnh và tệp biến mất khỏi lịch sử trước đây.
   */
  attachments?: LiveAttachment[];
  /** Tin này trả lời một tin khác. */
  quote?: LiveQuote;
  /**
   * Cảm xúc đã thả lên tin. Vắng/rỗng là không có ai thả.
   *
   * Một phần tử cho mỗi **loại** biểu tượng, không phải mỗi người: UI hiện
   * "❤️ 3" chứ không hiện ba lần ❤️.
   */
  reactions?: LiveReaction[];
  /**
   * Id phía máy khách gửi của tin (`cliMsgId`). Zalo bắt buộc có nó khi thả
   * cảm xúc; xem bản `electron/ipc-contract.ts`.
   */
  cliMsgId?: string;
  /**
   * Tin lấy từ đồng bộ lịch sử (Sync V2), không phải tin đến trực tiếp.
   *
   * Renderer phải xử lý khác đi: chèn **theo thời điểm** thay vì nối vào cuối
   * hội thoại, không tăng số chưa đọc, và không bắn thông báo — một lần đồng bộ
   * đầu có thể mang hàng nghìn tin của nhiều năm trước.
   */
  backfill?: boolean;
}

/** Giai đoạn của một lần đồng bộ lịch sử từ điện thoại (`SyncPhase` bên main). */
export type SyncPhase = 'idle' | 'requested' | 'receiving' | 'done' | 'failed';

/** Số liệu một lần đồng bộ — đủ cho thanh tiến trình, không đủ để dựng lại tin. */
export interface SyncProgress {
  /** All message partitions completed and the per-account flag was saved. */
  phoneSyncComplete?: boolean;
  received: number;
  /** `0` khi chưa biết tổng số gói; main gửi `0`, không gửi `-1` qua IPC. */
  total: number;
  written: number;
  skipped: number;
}

/** Kết quả của một lần xin đồng bộ. */
export interface SyncResult {
  ok: boolean;
  /** Mã lỗi: `disabled`, `state`, `not-ready`, `wasm`, `timeout`, hoặc mã máy chủ. */
  code?: string | number;
  message?: string;
}

export interface LiveMessagePage {
  messages: LiveMessage[];
  /**
   * Còn tin cũ hơn phía server hay không. Đường listener (`cmd 510`) không trả cờ
   * "còn nữa", nên với hội thoại 1-1 main báo `true` khi vừa nhận được trang mới;
   * `false` nghĩa là UI phải tắt nút tải thêm.
   */
  hasMore: boolean;
}

export interface SendResult {
  ok: boolean;
  clientId: string;
  msgId?: string;
  error?: string;
}

export interface SendRequest {
  threadId: string;
  kind: ThreadKind;
  text: string;
  /** Cùng `clientId` khi bấm "Gửi lại", để nối tin tạm với tin thật. */
  clientId: string;
}

export const TEXT_MAX = 2000;
export const THREAD_ID_MAX = 128;
export const CLIENT_ID_MAX = 64;

/** Validate ở main; renderer có thể mắc lỗi hoặc bị lỗi, không được tin payload. */
export function readSendRequest(value: unknown): SendRequest | null {
  if (typeof value !== 'object' || value === null) return null;
  const { threadId, kind, text, clientId } = value as Record<string, unknown>;
  if (typeof threadId !== 'string' || !threadId || threadId.length > THREAD_ID_MAX) return null;
  if (kind !== 'user' && kind !== 'group') return null;
  if (typeof text !== 'string' || !text.trim() || text.length > TEXT_MAX) return null;
  if (typeof clientId !== 'string' || !clientId || clientId.length > CLIENT_ID_MAX) return null;
  return { threadId, kind, text, clientId };
}

export function readMessagesRequest(value: unknown): { threadId: string; before?: string } | null {
  if (typeof value !== 'object' || value === null) return null;
  const { threadId, before } = value as Record<string, unknown>;
  if (typeof threadId !== 'string' || !threadId || threadId.length > THREAD_ID_MAX) return null;
  if (before !== undefined && (typeof before !== 'string' || before.length > THREAD_ID_MAX)) return null;
  return before === undefined ? { threadId } : { threadId, before };
}

export function readReadRequest(value: unknown): { threadId: string; kind: ThreadKind } | null {
  if (typeof value !== 'object' || value === null) return null;
  const { threadId, kind } = value as Record<string, unknown>;
  if (typeof threadId !== 'string' || !threadId || threadId.length > THREAD_ID_MAX) return null;
  if (kind !== 'user' && kind !== 'group') return null;
  return { threadId, kind };
}

/** Ghim/bỏ ghim: cùng danh tính hội thoại như `markRead`, cộng một cờ bật/tắt. */
export function readToggleRequest(value: unknown): { threadId: string; kind: ThreadKind; value: boolean } | null {
  const request = readReadRequest(value);
  const flag = (value as { value?: unknown } | null)?.value;
  if (!request || typeof flag !== 'boolean') return null;
  return { ...request, value: flag };
}

/** Đặt một cảm xúc: hội thoại + tin + `rIcon`; `icon: ''` là **gỡ**. */
export interface ReactionRequest {
  threadId: string;
  kind: ThreadKind;
  msgId: string;
  icon: string;
}

/** Validate cho `chat:react`; xem bản `electron/ipc-contract.ts`. */
export function readReactionRequest(value: unknown): ReactionRequest | null {
  const request = readReadRequest(value);
  const { msgId, icon } = (value ?? {}) as Record<string, unknown>;
  if (!request || typeof msgId !== 'string' || !msgId || msgId.length > THREAD_ID_MAX) return null;
  if (typeof icon !== 'string' || icon.length > 32) return null;
  return { ...request, msgId, icon };
}

/**
 * Thu hồi một tin của mình. Không mang nội dung: máy chủ tra tin bằng id, và
 * gửi kèm nội dung chỉ làm nó đi qua thêm một tầng nữa.
 */
export interface RecallRequest {
  threadId: string;
  kind: ThreadKind;
  msgId: string;
}

/** Validate cho `chat:recall`; xem bản `electron/ipc-contract.ts`. */
export function readRecallRequest(value: unknown): RecallRequest | null {
  const request = readReadRequest(value);
  const { msgId } = (value ?? {}) as Record<string, unknown>;
  // Cùng trần với `msgId` của cảm xúc: đây là cùng một id máy chủ, chỉ khác
  // thao tác, nên hai validator từ chối đúng cùng một tập giá trị.
  if (!request || typeof msgId !== 'string' || !msgId || msgId.length > THREAD_ID_MAX) return null;
  return { ...request, msgId };
}

/** Chuyển tiếp tin nhắn đến một hội thoại. */
export interface ForwardRequest {
  threadId: string;
  kind: ThreadKind;
  text: string;
  msgId?: string;
  ts?: number;
}

/** Validate cho `chat:forwardMessage`; xem bản `electron/ipc-contract.ts`. */
export function readForwardRequest(value: unknown): ForwardRequest | null {
  const request = readReadRequest(value);
  if (!request) return null;
  const { text, msgId, ts } = (value ?? {}) as Record<string, unknown>;
  if (typeof text !== 'string' || !text.trim() || text.length > TEXT_MAX) return null;
  const cleanMsgId = typeof msgId === 'string' && msgId.trim() && msgId.length <= THREAD_ID_MAX
    ? msgId.trim()
    : undefined;
  const cleanTs = typeof ts === 'number' && Number.isFinite(ts) && ts > 0
    ? ts
    : undefined;
  return { ...request, text: text.trim(), ...(cleanMsgId ? { msgId: cleanMsgId } : {}), ...(cleanTs ? { ts: cleanTs } : {}) };
}

/** Trần cho component stack trong báo cáo lỗi (khớp `renderer/live/error-report.ts`). */
export const COMPONENT_STACK_MAX = 1200;
/** Trần cho tên lỗi: `name` của một Error tự chế có thể dài bất kỳ. */
export const ERROR_NAME_MAX = 80;

export interface RenderErrorPayload {
  name: string;
  componentStack: string;
  /** Chỉ **độ dài** thông điệp (nguyên văn có thể chứa nội dung tin — xem `error-report.ts`). */
  messageLength: number;
}

export function readRenderError(value: unknown): RenderErrorPayload | null {
  if (typeof value !== 'object' || value === null) return null;
  const { name, componentStack, messageLength } = value as Record<string, unknown>;
  if (typeof name !== 'string' || !name || name.length > ERROR_NAME_MAX) return null;
  if (typeof componentStack !== 'string' || componentStack.length > COMPONENT_STACK_MAX) return null;
  if (typeof messageLength !== 'number' || !Number.isFinite(messageLength)) return null;
  return { name, componentStack, messageLength: Math.max(0, Math.floor(messageLength)) };
}
