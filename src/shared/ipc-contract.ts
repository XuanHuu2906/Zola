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
  sendMessage: 'chat:sendMessage',
  retryMessage: 'chat:retryMessage',
  markRead: 'chat:markRead',
  reconnect: 'chat:reconnect',
  // event (main → renderer)
  evLoginState: 'ev:loginState',
  evConnection: 'ev:connection',
  evMessageUpsert: 'ev:messageUpsert',
  evThreadUpsert: 'ev:threadUpsert',
} as const;

export type ThreadKind = 'user' | 'group';

/** Bốn trạng thái của plan §5.5. Khác `ConnectionState` của bản demo (online/offline/syncing). */
export type LiveConnection = 'connected' | 'connecting' | 'disconnected' | 'replaced';

/**
 * Bốn trạng thái đăng nhập của plan §5.3. `qr.qrImage` là data URL đã ghép ở main;
 * renderer không bao giờ nhận cookie, IMEI hay token.
 */
export type LoginState =
  | { status: 'logged-out' }
  | { status: 'qr'; qrImage: string; note?: string }
  | { status: 'logged-in'; label: string }
  | { status: 'error'; message: string; retryable: boolean };

export interface LiveThread {
  id: string;
  kind: ThreadKind;
  name: string;
  /** Luôn null: CSP `img-src 'self'` không cho phép avatar từ xa. */
  avatar: null;
  pinned: boolean;
  unread: number;
  lastText: string;
  lastTs: number;
}

export interface LiveMessage {
  threadId: string;
  kind: ThreadKind;
  /** ID phía server. Tin tạm chưa có nên dùng `clientId`. */
  msgId: string | null;
  clientId: string | null;
  from: 'me' | 'them';
  text: string;
  ts: number;
}

export interface LiveMessagePage {
  messages: LiveMessage[];
  /** MVP chưa có API lịch sử 1-1, nên luôn false — UI không được hứa tin cũ. */
  hasMore: false;
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
