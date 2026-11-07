import {
  CloseReason, LoginQRCallbackEventType, ThreadType, Zalo, ZaloApiError,
  type API, type Message as ZaloMessage, type SendSeenEventMessageParams, type TMessage,
} from 'zca-js';
import type {
  LiveConnection, LiveMessage, LiveMessagePage, LiveThread, LoginState, SendRequest, SendResult, ThreadKind,
} from '../ipc-contract.js';
import { applyMessage, buildThreads, toLiveMessage, type RawGroupInfo, type RawMessage, type RawUser } from './mapper.js';
import type { SavedSession, SessionStore } from './session.js';

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
  login(state: LoginState): void;
  connection(state: LiveConnection): void;
  message(message: LiveMessage): void;
  thread(thread: LiveThread): void;
  /** Chẩn đoán listener; chỉ metadata, không nội dung tin, không token. */
  debug?(event: string, data: Record<string, unknown>): void;
}

export interface ZaloClient {
  login(): Promise<void>;
  logout(): Promise<void>;
  /** Dừng listener mà **không** xoá phiên: dùng khi thoát app để lần sau còn khôi phục. */
  dispose(): void;
  reconnect(): void;
  listConversations(): Promise<LiveThread[]>;
  getMessages(threadId: string, kind: ThreadKind, before?: string): Promise<LiveMessagePage>;
  send(request: SendRequest): Promise<SendResult>;
  markRead(threadId: string, kind: ThreadKind): Promise<void>;
  setActiveThread(threadId: string | null): void;
}

const LANGUAGE = 'vi';
const QR_RETRY_LIMIT = 2;
const QR_RETRY_MS = 1500;
const BACKOFF_START_MS = 2000;
const BACKOFF_MAX_MS = 60000;

const threadType = (kind: ThreadKind): ThreadType =>
  kind === 'group' ? ThreadType.Group : ThreadType.User;

const kindOf = (type: ThreadType): ThreadKind => type === ThreadType.Group ? 'group' : 'user';

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

export function createZaloClient(store: SessionStore, events: ZaloEvents): ZaloClient {
  let api: API | null = null;
  let connection: LiveConnection = 'disconnected';
  let threads: LiveThread[] = [];
  let activeThreadId: string | null = null;
  let started = false;
  let replaced = false;
  let manualStop = false;
  let backoff = BACKOFF_START_MS;
  let backoffTimer: NodeJS.Timeout | null = null;
  let qrRestarts = 0;
  let loginInFlight = false;
  let restoreTried = false;
  const seenParams = new Map<string, SendSeenEventMessageParams>();

  const emitLogin = (next: LoginState) => { events.login(next); };
  const emitConnection = (next: LiveConnection) => {
    connection = next;
    events.debug?.('connection', { state: next });
    events.connection(next);
  };
  // `selfListen: false` khiến listener bỏ mọi tin có `isSelf`. Tin gửi từ điện
  // thoại của cùng tài khoản cũng mang cờ đó, nên phải bật để nhận được chúng.
  const makeZalo = () => new Zalo({ selfListen: true, checkUpdate: false, logging: false });

  function stopListener(): void {
    manualStop = true;
    if (api) {
      try { api.listener.stop(); } catch { /* already stopped */ }
    }
    started = false;
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

  function handleInbound(message: ZaloMessage): void {
    const kind = kindOf(message.type);
    const raw = message.data as RawMessage;
    // `message.isSelf` là cờ zca-js tính *trước* khi ghi đè `raw.uidFrom`; payload
    // sau đó không còn dấu `"0"` để tự suy ra người gửi.
    const mapped = toLiveMessage(raw, message.threadId, kind, message.isSelf);
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
    threads = applyMessage(threads, mapped, activeThreadId);
    const thread = threads.find(t => t.id === mapped.threadId && t.kind === mapped.kind);
    if (thread) events.thread(thread);
    events.message(mapped);
  }

  function wireListener(): void {
    if (!api) return;
    const listener = api.listener;
    listener.on('connected', () => {
      started = true;
      manualStop = false;
      backoff = BACKOFF_START_MS;
      emitConnection('connected');
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
      if (connection === 'connected') emitConnection('disconnected');
    });
    // cipher_key là khoá phiên WebSocket: không bao giờ được chuyển tiếp ra ngoài.
    listener.on('cipher_key', () => undefined);
    listener.on('message', message => handleInbound(message));
    listener.on('old_messages', messages => { for (const message of messages) handleInbound(message); });
  }

  async function buildThreadsFromServer(client: API): Promise<LiveThread[]> {
    const [friends, groups, pins, unread] = await Promise.all([
      client.getAllFriends(20000, 1).catch(() => [] as RawUser[]),
      client.getAllGroups().catch(() => ({ version: '', gridVerMap: {} as Record<string, string> })),
      client.getPinConversations().catch(() => ({ conversations: [] as string[], version: 0 })),
      client.getUnreadMark().catch(() => ({ data: { convsGroup: [], convsUser: [] }, status: 0 })),
    ]);
    const groupIds = Object.keys(groups.gridVerMap || {});
    const info = groupIds.length ? await client.getGroupInfo(groupIds).catch(() => null) : null;
    const groupRows: RawGroupInfo[] = info
      ? Object.values(info.gridInfoMap).map(group => ({
        groupId: group.groupId, name: group.name, avt: group.avt, totalMember: group.totalMember,
      }))
      : [];
    const unreadUser = (unread.data?.convsUser ?? []).map(item => String(item.id));
    const unreadGroup = (unread.data?.convsGroup ?? []).map(item => String(item.id));
    return buildThreads(
      friends.map(friend => ({ userId: friend.userId, displayName: friend.displayName,
        zaloName: friend.zaloName, avatar: friend.avatar })),
      groupRows, pins.conversations ?? [], unreadUser, unreadGroup,
    );
  }

  async function activate(client: API): Promise<void> {
    api = client;
    replaced = false;
    backoff = BACKOFF_START_MS;
    threads = await buildThreadsFromServer(client).catch(() => [] as LiveThread[]);
    for (const thread of threads) events.thread(thread);
    const own = await client.fetchAccountInfo().catch(() => null);
    const label = (own?.profile?.displayName || own?.profile?.zaloName || 'Tài khoản Zalo').slice(0, 60);
    emitLogin({ status: 'logged-in', label });
    wireListener();
    startListener();
  }

  async function restore(): Promise<boolean> {
    const saved = await store.load();
    if (!saved) return false;
    try {
      const client = await makeZalo().login({
        imei: saved.imei, cookie: saved.cookie, userAgent: saved.userAgent, language: saved.language,
      });
      await activate(client);
      return true;
    } catch {
      // Phiên chết hoặc bị từ chối: xóa ngay để lần sau không thử lại cookie đã hỏng.
      await store.clear();
      return false;
    }
  }

  async function loginQRFlow(): Promise<void> {
    if (loginInFlight || api) return;
    loginInFlight = true;
    replaced = false;
    try {
      const captured: { session: Omit<SavedSession, 'language'> | null } = { session: null };
      const client = await makeZalo().loginQR({ language: LANGUAGE }, event => {
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
      if (captured.session !== null) await store.save({ ...captured.session, language: LANGUAGE });
      await activate(client);
    } catch (error) {
      const message = error instanceof ZaloApiError ? error.message : 'Đăng nhập thất bại.';
      emitLogin({ status: 'error', message: message.slice(0, 200), retryable: isRetryable(error) });
    } finally {
      loginInFlight = false;
    }
  }

  async function login(): Promise<void> {
    if (api) return;
    if (!restoreTried) {
      restoreTried = true;
      emitLogin({ status: 'logged-out' });
      if (await restore()) return;
    }
    await loginQRFlow();
  }

  return {
    login,
    dispose() {
      clearBackoff();
      stopListener();
      api = null;
    },
    async logout() {
      clearBackoff();
      stopListener();
      api = null;
      replaced = false;
      restoreTried = true;
      threads = [];
      seenParams.clear();
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
      return threads;
    },
    async getMessages(threadId, kind, before) {
      if (!api) return { messages: [], hasMore: false };
      if (kind === 'group') {
        const history = await api.getGroupChatHistory(threadId).catch(() => null);
        if (!history) return { messages: [], hasMore: false };
        const messages = history.groupMsgs
          .map(message => toLiveMessage(message.data as RawMessage, threadId, 'group', message.isSelf))
          .filter((message): message is LiveMessage => message !== null)
          .reverse();
        return { messages, hasMore: false };
      }
      // zca-js 2.2.0 không có API lịch sử 1-1; chỉ còn đường listener (cmd 510).
      try { api.listener.requestOldMessages(ThreadType.User, before ?? null); } catch { /* socket chưa mở */ }
      return { messages: [], hasMore: false };
    },
    async send(request) {
      if (!api) return { ok: false, clientId: request.clientId, error: 'Chưa đăng nhập.' };
      try {
        const response = await api.sendMessage(request.text, request.threadId, threadType(request.kind));
        const msgId = response.message?.msgId;
        if (msgId === undefined) {
          return { ok: false, clientId: request.clientId, error: 'Máy chủ không trả về mã tin.' };
        }
        const mapped: LiveMessage = {
          threadId: request.threadId, kind: request.kind, msgId: String(msgId),
          clientId: request.clientId, from: 'me', text: request.text, ts: Date.now(),
        };
        threads = applyMessage(threads, mapped, activeThreadId);
        const thread = threads.find(t => t.id === request.threadId && t.kind === request.kind);
        if (thread) events.thread(thread);
        return { ok: true, clientId: request.clientId, msgId: String(msgId) };
      } catch {
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
    setActiveThread(threadId) { activeThreadId = threadId; },
  };
}

export type { TMessage };
