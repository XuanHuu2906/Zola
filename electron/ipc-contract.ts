/**
 * Bản sao của `src/shared/ipc-contract.ts` cho main process.
 *
 * `tsconfig.electron.json` đặt `rootDir: "electron"`, nên `electron/` không import
 * được từ `src/` kể cả `import type` (TS6059). Hằng, kiểu và validator dưới đây
 * phải giữ đúng từng giá trị; `tests/ipc-contract.test.ts` so hai bản và fail nếu lệch.
 */
export const IPC = {
  login: 'chat:login',
  logout: 'chat:logout',
  listConversations: 'chat:listConversations',
  getMessages: 'chat:getMessages',
  setActiveThread: 'chat:setActiveThread',
  sendMessage: 'chat:sendMessage',
  retryMessage: 'chat:retryMessage',
  markRead: 'chat:markRead',
  /** Ghim / bỏ ghim một hội thoại (trạng thái máy chủ Zalo). */
  setPinned: 'chat:setPinned',
  /** Đánh dấu chưa đọc / bỏ dấu (trạng thái máy chủ Zalo). */
  setUnread: 'chat:setUnread',
  /**
   * Thả / gỡ cảm xúc trên một tin (trạng thái máy chủ Zalo). Zalo chỉ cho **một**
   * cảm xúc mỗi người mỗi tin, nên đây là phép đặt chứ không phải phép cộng.
   */
  react: 'chat:react',
  /** Thu hồi một tin của mình (trạng thái máy chủ Zalo; về qua sự kiện `undo`). */
  recall: 'chat:recall',
  forwardMessage: 'chat:forwardMessage',
  reconnect: 'chat:reconnect',
  /** Renderer báo lỗi render cho nhật ký chẩn đoán (plan §9.1). */
  reportError: 'chat:reportError',
  syncFromPhone: 'chat:syncFromPhone',
  evLoginState: 'ev:loginState',
  evConnection: 'ev:connection',
  evMessageUpsert: 'ev:messageUpsert',
  evThreadUpsert: 'ev:threadUpsert',
  /** Main gặp một lỗi không có `catch`; renderer hiện nó thay vì để im lặng. */
  evCrash: 'ev:crash',
  evSync: 'ev:sync',
  evCatchUp: 'ev:catchUp',
  /** Một tệp đính kèm vừa tải xong; cùng `msgId` với tin đã phát. */
  evMedia: 'ev:media',
} as const;

/** Lỗi toàn cục của main, đã rút gọn thành một dòng cho người dùng đọc. */
export interface CrashNotice {
  message: string;
}

export type ThreadKind = 'user' | 'group';

/** Connection state exposed to the renderer. */
export type LiveConnection = 'connected' | 'connecting' | 'disconnected' | 'replaced';

export interface CatchUpProgress {
  phase: 'checking' | 'updated' | 'current' | 'incomplete';
  received: number;
}

/** Plan §5.3. `qr.qrImage` là data URL đã ghép ở main. */
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
 * Bản sao của `src/shared/ipc-contract.ts`; `tests/ipc-contract.test.ts` so hai bản.
 */
export type AttachmentKind =
  | 'photo' | 'video' | 'voice' | 'sticker' | 'doodle'
  | 'file' | 'link' | 'location' | 'contact' | 'gif' | 'other';

/**
 * Một tệp đính kèm **ở dạng đi qua IPC**. Không có URL của Zalo: main tải nội
 * dung về `<dataRoot>/media/` và chỉ trả đường dẫn `glass://app/media/…`.
 * `src: null` là chưa tải xong.
 */
export interface LiveAttachment {
  kind: AttachmentKind;
  title?: string;
  description?: string;
  url?: string;
  size?: number;
  ext?: string;
  duration?: number;
  src: string | null;
  thumb: string | null;
  failed?: boolean;
}

/**
 * Một tin được **trích dẫn** trong tin khác (trả lời).
 *
 * `msgId` là id server của tin gốc — thứ duy nhất nối được mũi trích dẫn về đúng
 * bong bóng để bấm vào là nhảy tới. Zalo không đảm bảo tin gốc còn trong máy
 * (nó có thể đã bị thu hồi hoặc nằm ngoài phần đã đồng bộ), nên `text` được giữ
 * như bản chụp: mũi trích dẫn vẫn đọc được dù tin gốc vắng mặt.
 */
export interface LiveQuote {
  msgId: string | null;
  from: 'me' | 'them';
  text: string;
  /** Tên người gửi của tin gốc, khi Zalo gửi kèm — nhóm cần nó để phân biệt. */
  fromName?: string;
  /** Tin gốc là tệp chứ không phải chữ; `text` có thể rỗng. */
  attachmentKind?: AttachmentKind;
  ts?: number;
}

/**
 * Một cảm xúc đã thả lên tin.
 *
 * `icon` là `rIcon` của Zalo (`"/-heart"`, `":>"`, …) — **không** phải emoji và
 * không phải `rType`. Renderer vẽ nó thành emoji bằng một bảng riêng, vì `rType`
 * chỉ có nghĩa với bảng tra của Zalo còn `rIcon` là thứ máy chủ gửi qua cả hai
 * đường (realtime và đồng bộ), nên nó là khoá ổn định hơn.
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
  threadId: string;
  kind: ThreadKind;
  msgId: string | null;
  clientId: string | null;
  from: 'me' | 'them';
  /** Tên người gửi trong nhóm; không có với tin của mình hoặc tin 1-1. */
  fromName?: string;
  /** Ảnh thành viên trong nhóm, chỉ là đường dẫn cục bộ do main phục vụ. */
  senderAvatar?: string;
  /**
   * Tin đã thu hồi (plan §6.10): dòng **vẫn còn**, nội dung **rỗng**. UI hiển thị
   * "Tin nhắn đã thu hồi" thay cho nội dung; xoá dòng sẽ làm tin biến mất khỏi
   * đúng chỗ nó từng ở.
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
  text: string;
  /** @mention ranges in UTF-16 code units, without mentioned-user IDs. */
  mentions?: MessageMention[];
  ts: number;
  /** Tệp đính kèm; vắng/rỗng là tin chỉ có chữ. Tin **chỉ** có tệp có `text` rỗng. */
  attachments?: LiveAttachment[];
  /** Tin này trả lời một tin khác; xem `LiveQuote`. */
  quote?: LiveQuote;
  /**
   * Cảm xúc đã thả lên tin. Vắng/rỗng là không có ai thả.
   *
   * Một phần tử cho mỗi **loại** biểu tượng, không phải mỗi người: UI hiện
   * "❤️ 3" chứ không hiện ba lần ❤️.
   */
  reactions?: LiveReaction[];
  /**
   * Id phía **máy khách gửi** của tin (`cliMsgId` của Zalo). Vắng khi chưa biết.
   *
   * Zalo bắt buộc phải có nó khi thả cảm xúc: `addReaction` gửi cả `gMsgID` lẫn
   * `cMsgID`, và không suy được `cMsgID` từ `msgId`. Renderer cần nó để gọi
   * `chat:react` trên đúng tin.
   */
  cliMsgId?: string;
  /** Tin lấy từ đồng bộ lịch sử; chèn theo thời điểm, không báo, không tăng chưa đọc. */
  backfill?: boolean;
}

export type SyncPhase = 'idle' | 'requested' | 'receiving' | 'done' | 'failed';

export interface SyncProgress {
  /** All message partitions completed and the per-account flag was saved. */
  phoneSyncComplete?: boolean;
  received: number;
  total: number;
  written: number;
  skipped: number;
}

export interface SyncResult {
  ok: boolean;
  code?: string | number;
  message?: string;
}

export interface LiveMessagePage {
  messages: LiveMessage[];
  /** `false` = không còn trang nào để tải thêm (xem bản `src/shared`). */
  hasMore: boolean;
}

export interface SendRequest {
  threadId: string;
  kind: ThreadKind;
  text: string;
  clientId: string;
}

export interface SendResult {
  ok: boolean;
  clientId: string;
  msgId?: string;
  error?: string;
}

export const TEXT_MAX = 2000;
export const THREAD_ID_MAX = 128;
export const CLIENT_ID_MAX = 64;

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

/**
 * Validate cho `chat:react`.
 *
 * `icon` là chuỗi `rIcon` của Zalo, **không** phải emoji: renderer có bảng
 * emoji→`rIcon` riêng, còn main chỉ chuyển tiếp. Trần 32 ký tự là đủ cho mọi
 * giá trị trong bảng của Zalo và chặn một payload tự chế mang theo văn bản dài.
 */
export function readReactionRequest(value: unknown): ReactionRequest | null {
  const request = readReadRequest(value);
  const { msgId, icon } = (value ?? {}) as Record<string, unknown>;
  if (!request || typeof msgId !== 'string' || !msgId || msgId.length > THREAD_ID_MAX) return null;
  if (typeof icon !== 'string' || icon.length > 32) return null;
  return { ...request, msgId, icon };
}

/** Thu hồi một tin của mình (không mang nội dung). */
export interface RecallRequest {
  threadId: string;
  kind: ThreadKind;
  msgId: string;
}

/** Validate cho `chat:recall`; xem bản `src/shared/ipc-contract.ts`. */
export function readRecallRequest(value: unknown): RecallRequest | null {
  const request = readReadRequest(value);
  const { msgId } = (value ?? {}) as Record<string, unknown>;
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

/** Validate cho `chat:forwardMessage`; xem bản `src/shared/ipc-contract.ts`. */
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

/** Trần cho component stack trong báo cáo lỗi (khớp `src/renderer/live/error-report.ts`). */
export const COMPONENT_STACK_MAX = 1200;
/** Trần cho tên lỗi: `name` của một Error tự chế có thể dài bất kỳ. */
export const ERROR_NAME_MAX = 80;

export interface RenderErrorPayload {
  name: string;
  componentStack: string;
  /** Chỉ **độ dài** thông điệp: nguyên văn có thể chứa nội dung tin (xem bản `src/`). */
  messageLength: number;
}

/**
 * Báo cáo lỗi render từ renderer. Mọi trường bị cắt theo trần: payload này đi
 * thẳng vào nhật ký, và một renderer bị chiếm không được phép làm phình file log
 * hay nhét văn bản tuỳ ý vào đó.
 */
export function readRenderError(value: unknown): RenderErrorPayload | null {
  if (typeof value !== 'object' || value === null) return null;
  const { name, componentStack, messageLength } = value as Record<string, unknown>;
  if (typeof name !== 'string' || !name || name.length > ERROR_NAME_MAX) return null;
  if (typeof componentStack !== 'string' || componentStack.length > COMPONENT_STACK_MAX) return null;
  if (typeof messageLength !== 'number' || !Number.isFinite(messageLength)) return null;
  return { name, componentStack, messageLength: Math.max(0, Math.floor(messageLength)) };
}
