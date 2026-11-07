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
  sendMessage: 'chat:sendMessage',
  retryMessage: 'chat:retryMessage',
  markRead: 'chat:markRead',
  reconnect: 'chat:reconnect',
  evLoginState: 'ev:loginState',
  evConnection: 'ev:connection',
  evMessageUpsert: 'ev:messageUpsert',
  evThreadUpsert: 'ev:threadUpsert',
} as const;

export type ThreadKind = 'user' | 'group';

/** Plan §5.5. Khác `ConnectionState` của bản demo (online/offline/syncing). */
export type LiveConnection = 'connected' | 'connecting' | 'disconnected' | 'replaced';

/** Plan §5.3. `qr.qrImage` là data URL đã ghép ở main. */
export type LoginState =
  | { status: 'logged-out' }
  | { status: 'qr'; qrImage: string; note?: string }
  | { status: 'logged-in'; label: string }
  | { status: 'error'; message: string; retryable: boolean };

export interface LiveThread {
  id: string;
  kind: ThreadKind;
  name: string;
  /** Luôn null: CSP `img-src 'self'` không cho avatar từ xa. */
  avatar: null;
  pinned: boolean;
  unread: number;
  lastText: string;
  lastTs: number;
}

export interface LiveMessage {
  threadId: string;
  kind: ThreadKind;
  msgId: string | null;
  clientId: string | null;
  from: 'me' | 'them';
  text: string;
  ts: number;
}

export interface LiveMessagePage {
  messages: LiveMessage[];
  /** MVP chưa có API lịch sử 1-1 với server, nên luôn false. */
  hasMore: false;
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
