import { create } from 'zustand';
import type { Chat, ConnectionState, FileMetadata, Filter, Message, Session, View } from '../adapters/types.ts';
import type { LiveConnection, LoginState, SendResult } from '../../shared/ipc-contract.ts';
import { demoAdapter } from '../adapters/demo.ts';
import { appendIncoming, appendOutgoing, retryTarget, settleOutgoing, upsertThread } from '../live/map.ts';
import { adoptEcho } from '../live/echo.ts';
import { newClientId } from '../live/id.ts';
import { subscribeLive } from '../live/subscribe.ts';
import type { LiveHandlers } from '../live/subscribe.ts';
import { defaults, parsePreferences, PREFS_KEY, serializePreferences } from '../../shared/preferences.ts';
import type { Preferences } from '../../shared/preferences.ts';
import { FALLBACK_LABEL, parseSession, SESSION_KEY, serializeSession } from '../../shared/session.ts';
import { incomingLine, pickIncomingTarget } from '../../shared/inbox.ts';
import { advanceProgress } from '../../shared/transfer.ts';
import { SYNC_MS } from '../../shared/network.ts';
import { createUiBridge } from '../../composition/ui-bridge.ts';

function initialPreferences(): Preferences {
  try { return parsePreferences(localStorage.getItem(PREFS_KEY)); }
  catch { return { ...defaults }; }
}
/** A demo sign-in lives in this window only; reload keeps it, closing the app drops it. */
function initialSession(): Session | null {
  try { return parseSession(sessionStorage.getItem(SESSION_KEY)); }
  catch { return null; }
}
/** Exactly one secondary surface is open at a time, so closing is never ambiguous. */
export type Overlay =
  | { kind: 'profile' }
  | { kind: 'info'; chatId: string }
  | { kind: 'media'; chatId: string; index: number }
  | { kind: 'call'; mode: 'voice' | 'video' }
  | { kind: 'notifications' };
interface DemoState {
  session: Session | null;
  chats: Chat[]; activeId: string; view: View; filter: Filter; query: string;
  prefs: Preferences; drafts: Record<string, string>; toast: string; overlay: Overlay | null;
  /** One-shot switch: the next outgoing message is simulated to fail, like the mock client. */
  simulateFailure: boolean;
  /** Bumped on sign-in/sign-out so a pending settle timer cannot land on a reseeded dataset. */
  epoch: number;
  /** Rotation cursor for the demo inbox, so repeated simulations do not repeat the same sender. */
  incomingSeq: number;
  /** Simulated transport health: sending is blocked offline, and recovery flushes pending mail. */
  connection: ConnectionState;

  // ── Chế độ thật (ADR-004). Bản demo ở trên không đọc tới các trường này, nên
  //    chỉ cần bình thường `window.chat` vắng mặt là mọi thứ giữ nguyên hành vi cũ.
  /** `demo` = cửa giả lập như cũ; `live` = dữ liệu thật, cùng `chats` slice ở trên. */
  liveMode: 'demo' | 'live';
  /** Trạng thái đăng nhập do main đẩy xuống; renderer không tự suy ra. */
  login: LoginState;
  /** Đã gọi `login()` và đang chờ main trả lời lần đầu (QR hoặc phiên cũ). */
  loginPending: boolean;
  liveConnection: LiveConnection;
  /** Lớp phủ của chế độ thật; tách khỏi `overlay` của bản demo. */
  liveOverlay: { kind: 'info'; chatId: string } | { kind: 'profile' } | null;
  openLiveOverlay(overlay: { kind: 'info'; chatId: string } | { kind: 'profile' }): void;
  closeLiveOverlay(): void;
  /** Bật chế độ thật; giữ nguyên danh sách demo để đăng xuất quay lại được. */
  enterLive(): void;
  exitLive(): void;
  requestLogin(): void;
  requestLogout(): void;
  requestReconnect(): void;
  /** Gắn bộ lắng nghe sự kiện; trả hàm huỷ cho `useEffect` trong StrictMode. */
  connectLive(): () => void;
  /** Chọn hội thoại, đánh dấu đã đọc trên server khi đang ở chế độ thật. */
  selectThread(id: string): void;
  /** Gửi tin thật; bong bóng tạm xuất hiện ngay, kết quả vá vào đúng `clientId`. */
  sendLive(): void;
  retryLive(messageId: number): void;
  /** Flip the simulated network; the connection banner and composer read this. */
  setConnection(state: ConnectionState): void;
  /** Lose the demo connection: in-flight sends stay pending instead of settling. */
  goOffline(): void;
  /** Recover: sync for a moment, then flush pending sends to sent. */
  reconnect(): void;
  signIn(label?: string): void; signOut(): void;
  setView(view: View): void; setQuery(query: string): void; setFilter(filter: Filter): void;
  selectChat(id: string): void; setDraft(id: string, draft: string): void;
  send(): void; retry(messageId: number): void; attach(files: FileMetadata[]): void; loadOlder(chatId: string): void;
  togglePin(): void; markUnread(): void; react(messageId: number): void;
  setPrefs(patch: Partial<Preferences>): void; notify(text: string): void;
  setSimulateFailure(value: boolean): void;
  /** Drop one incoming demo message into another chat and raise its unread badge. */
  simulateIncoming(): void;
  /** One transfer tick: every 0..99 progress advances; 100 means finished. */
  advanceTransfers(): void;
  /** Start a simulated download for one attachment message. */
  download(messageId: number): void;
  /** Drop a transfer back to a plain attachment. */
  cancelTransfer(messageId: number): void;
  openOverlay(overlay: Overlay): void; closeOverlay(): void;
}

/** A send settles asynchronously so the pending state is a real, observable phase. */
const SETTLE_MS = 600;

const FAIL_TOAST = 'Gửi thất bại (giả lập). Chọn "Gửi lại" trên tin nhắn để thử lần nữa.';

/** Đường gửi/nhận thật sự đi qua Services; UI chỉ giữ id số của nó. */
const bridge = createUiBridge({ sendLatencyMs: SETTLE_MS });

/**
 * UI dùng id số cho React key và aria-label, còn Services dùng `clientMessageId`.
 * Bảng này là điểm quy đổi duy nhất, và mang theo epoch để tin của phiên cũ
 * không rơi vào tập dữ liệu vừa được seed lại.
 */
interface OutboxRef { chatId: string; messageId: number; epoch: number }
const outboxRefs = new Map<string, OutboxRef>();
let pendingInbound: { chatId: string; name: string; epoch: number } | null = null;

const mockConversationId = (chat: Chat): string => (chat.isGroup ? 'c-nhom' : 'c-anh');

/**
 * Ảnh chụp bản demo khi bật chế độ thật. Chế độ thật dùng cùng kho `chats`, nên
 * phải nhớ bản demo để `exitLive()` trả lại đúng màn hình cũ thay vì xoá sạch.
 */
interface DemoSnapshot { chats: Chat[]; activeId: string; login: LoginState }
let demoSnapshot: DemoSnapshot | null = null;
/** Đã nạp danh sách từ server chưa; chỉ nạp một lần mỗi phiên đăng nhập. */
let liveSeeded = false;
/** Một lần đăng nhập tại một thời điểm; bấm nhiều lần không mở nhiều luồng QR. */
let loginPending = false;

const liveBridge = (): Window['chat'] => {
  const bridge = window.chat;
  return bridge && typeof bridge.login === 'function' ? bridge : undefined;
};

const decoded = (login: LoginState): boolean => login.status === 'logged-in';

/** `catch` nhận `unknown`, và lỗi IPC không phải lúc nào cũng là `Error`. */
function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message.slice(0, 200) : fallback;
}

function resetServices(): void {
  outboxRefs.clear();
  pendingInbound = null;
  bridge.reset();
}

/**
 * Khi kết nối lại, trạng thái thật của outbox quyết định bong bóng nào được giải phóng.
 * Tin còn đang gửi thì ở lại pending thay vì được báo "sent" cho tiện.
 */
function flushOutbox(chats: Chat[], epoch: number): Chat[] {
  let next = chats;
  for (const [clientMessageId, ref] of outboxRefs) {
    if (ref.epoch !== epoch) continue;
    const phase = bridge.entryState(clientMessageId);
    if (phase === 'pending' || phase === null) continue;
    next = demoAdapter.settle(next, ref.chatId, ref.messageId, phase);
  }
  return next;
}

export const useDemoStore = create<DemoState>((set, get) => ({
  session: initialSession(),
  chats: demoAdapter.list(), activeId: 'minh-anh', view: 'chats', filter: 'all', query: '',
  prefs: initialPreferences(), drafts: {}, toast: '', simulateFailure: false, epoch: 0, incomingSeq: 0,
  connection: 'online',
  signIn: label => {
    const session: Session = { signedIn: true, label: label?.trim().slice(0, 40) || FALLBACK_LABEL };
    try { sessionStorage.setItem(SESSION_KEY, serializeSession(session)); } catch { /* usable without storage */ }
    resetServices();
    set({ session, chats: demoAdapter.list(), activeId: 'minh-anh', view: 'chats', filter: 'all', query: '',
      drafts: {}, simulateFailure: false, incomingSeq: 0, connection: 'online', epoch: get().epoch + 1 });
  },
  signOut: () => {
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* usable without storage */ }
    resetServices();
    set({ session: null, chats: demoAdapter.list(), activeId: 'minh-anh', view: 'chats',
      filter: 'all', query: '', drafts: {}, overlay: null, toast: '', simulateFailure: false, incomingSeq: 0,
      connection: 'online', epoch: get().epoch + 1 });
  },
  setSimulateFailure: value => set({ simulateFailure: value }),
  setConnection: connection => set({ connection }),
  goOffline: () => set({ connection: 'offline',
    toast: 'Mất mạng (giả lập). Tin đang chờ sẽ được gửi lại khi kết nối phục hồi.' }),
  reconnect: () => {
    if (get().connection !== 'offline') return;
    set({ connection: 'syncing' });
    const epoch = get().epoch;
    setTimeout(() => useDemoStore.setState(state => state.epoch !== epoch
      ? state
      : {
        connection: 'online',
        chats: flushOutbox(state.chats, epoch),
        toast: 'Đã kết nối lại. Tin đang chờ đã được gửi.',
      }), SYNC_MS);
  },
  simulateIncoming: () => {
    const state = get();
    if (state.connection === 'offline') return;
    const chat = pickIncomingTarget(state.chats, state.activeId, state.incomingSeq);
    if (!chat) return;
    const text = incomingLine(state.incomingSeq);
    pendingInbound = { chatId: chat.id, name: chat.name, epoch: state.epoch };
    set({ incomingSeq: state.incomingSeq + 1 });
    bridge.simulateIncoming(mockConversationId(chat), 'u-anh', text);
  },
  setView: view => set({ view }), setQuery: query => set({ query }), setFilter: filter => set({ filter }),
  selectChat: id => set(state => ({ activeId: id, view: 'chats',
    chats: state.chats.map(c => c.id === id ? { ...c, unread: 0 } : c) })),
  setDraft: (id, draft) => set(state => ({ drafts: { ...state.drafts, [id]: draft.slice(0, 2000) } })),
  send: () => {
    const state = get();
    if (state.connection === 'offline') return;
    const text = state.drafts[state.activeId] || '';
    if (!text.trim()) return;
    const chat = state.chats.find(c => c.id === state.activeId);
    if (!chat) return;

    bridge.armFailure(state.simulateFailure);
    const accepted = bridge.send(mockConversationId(chat), text);
    if (!accepted.ok) {
      set({ toast: accepted.error.message });
      return;
    }
    const { clientMessageId } = accepted.value;
    const chats = demoAdapter.send(state.chats, state.activeId, text, new Date(), 'pending');
    const messageId = chats.find(c => c.id === state.activeId)!.messages.at(-1)!.id;
    outboxRefs.set(clientMessageId, { chatId: state.activeId, messageId, epoch: state.epoch });
    set({ chats, drafts: { ...state.drafts, [state.activeId]: '' }, simulateFailure: false });
  },
  retry: messageId => {
    const { activeId, epoch } = get();
    const ref = [...outboxRefs.entries()].find(([, value]) =>
      value.chatId === activeId && value.messageId === messageId && value.epoch === epoch);
    if (!ref) return;
    const [clientMessageId] = ref;
    // Services là nguồn sự thật: chưa từng tới adapter thì không có gì để gửi lại.
    if (bridge.entryState(clientMessageId) !== 'failed') return;
    bridge.retry(clientMessageId);
    set(state => ({ chats: demoAdapter.settle(state.chats, activeId, messageId, 'pending') }));
  },
  attach: files => set(state => ({ chats: demoAdapter.attach(state.chats, state.activeId, files),
    toast: 'Tệp demo: chỉ tên và dung lượng, không đọc nội dung hoặc tải lên.' })),
  advanceTransfers: () => set(state => {
    let touched = false;
    const chats = state.chats.map(chat => {
      if (!chat.messages.some(m => m.transfer && typeof m.progress === 'number' && m.progress < 100)) return chat;
      touched = true;
      return { ...chat, messages: chat.messages.map(m => {
        if (!m.transfer || typeof m.progress !== 'number' || m.progress >= 100) return m;
        return { ...m, progress: advanceProgress(m.progress, m.transfer) };
      }) };
    });
    return touched ? { chats } : state;
  }),
  download: messageId => {
    const { activeId } = get();
    set(state => ({ chats: demoAdapter.setTransfer(state.chats, activeId, messageId,
      { transfer: 'download', progress: 0 }) }));
  },
  cancelTransfer: messageId => set(state => ({ chats: state.chats.map(chat => chat.id !== state.activeId ? chat : {
    ...chat, messages: chat.messages.map(m => {
      if (m.id !== messageId) return m;
      const rest: Message = { ...m };
      delete rest.transfer;
      delete rest.progress;
      return rest;
    }),
  }) })),
  loadOlder: chatId => set(state => ({ chats: demoAdapter.loadOlder(state.chats, chatId) })),
  togglePin: () => set(state => ({ chats: state.chats.map(c => c.id === state.activeId ? { ...c, pinned: !c.pinned } : c) })),
  markUnread: () => set(state => ({ chats: state.chats.map(c => c.id === state.activeId ? { ...c, unread: 1 } : c) })),
  react: id => set(state => ({ chats: state.chats.map(c => c.id === state.activeId ? {
    ...c, messages: c.messages.map(m => m.id === id ? { ...m, reaction: m.reaction ? undefined : '❤️ 1' } : m),
  } : c) })),
  setPrefs: patch => {
    const prefs = parsePreferences(serializePreferences({ ...get().prefs, ...patch }));
    try { localStorage.setItem(PREFS_KEY, serializePreferences(prefs)); } catch { /* usable without storage */ }
    set({ prefs });
  },
  notify: toast => set({ toast }),
  overlay: null,
  openOverlay: overlay => set({ overlay }),
  closeOverlay: () => set({ overlay: null }),

  liveMode: 'demo', login: { status: 'logged-out' }, loginPending: false, liveConnection: 'disconnected',
  liveOverlay: null,
  openLiveOverlay: liveOverlay => set({ liveOverlay }),
  closeLiveOverlay: () => set({ liveOverlay: null }),
  enterLive: () => {
    if (get().liveMode === 'live') return;
    const { chats, activeId, login } = get();
    demoSnapshot = { chats, activeId, login };
    liveSeeded = false;
    loginPending = false;
    // Danh sách demo thuộc một tài khoản khác, nên phải trống cho tới khi server
    // trả hội thoại thật; giữ chúng lại sẽ hiện người lạ trong hộp thư thật.
    set({ liveMode: 'live', chats: [], activeId: '', login: { status: 'logged-out' }, loginPending: false });
  },
  exitLive: () => {
    const snapshot = demoSnapshot;
    demoSnapshot = null;
    liveSeeded = false;
    loginPending = false;
    void liveBridge()?.logout().catch(() => {});
    set({
      liveMode: 'demo', chats: snapshot?.chats ?? demoAdapter.list(), activeId: snapshot?.activeId ?? 'minh-anh',
      login: { status: 'logged-out' }, loginPending: false, liveConnection: 'disconnected', liveOverlay: null,
      view: 'chats', filter: 'all', query: '', drafts: {}, overlay: null, toast: '',
    });
  },
  requestLogin: () => {
    const bridge = liveBridge();
    if (!bridge || loginPending) return;
    loginPending = true;
    set({ loginPending: true });
    void bridge.login().catch((error: unknown) => {
      loginPending = false;
      set({ loginPending: false, login: {
        status: 'error', retryable: true,
        message: errorText(error, 'Không mở được luồng đăng nhập.'),
      } });
    });
  },
  requestLogout: () => get().exitLive(),
  requestReconnect: () => { void liveBridge()?.reconnect().catch(() => {}); },
  connectLive: () => {
    if (!liveBridge()) return () => {};
    const handlers: LiveHandlers = {
      login: state => {
        const enter = decoded(state);
        // Rời phiên (hoặc chưa vào) thì lần đăng nhập sau phải nạp lại danh sách;
        // sự kiện `logged-in` lặp lại thì không được kéo thêm lần nạp thứ hai.
        if (!enter) liveSeeded = false;
        if (enter) loginPending = false;
        set({ login: state, ...(enter ? { loginPending: false } : {}) });
        if (enter && !liveSeeded) void seedLive();
      },
      connection: state => set({ liveConnection: state }),
      message: message => {
        useDemoStore.setState(state => {
          if (state.liveMode !== 'live') return state;
          const chat = state.chats.find(item => item.id === message.threadId);
          // Server dội lại tin mình vừa gửi trước khi `sendMessage` trả `msgId`:
          // gắn id chính thức vào bong bóng đang chờ thay vì thêm bong bóng thứ hai.
          const echo = adoptEcho(state.chats, message);
          if (echo) return { chats: echo.chats };
          const chats = appendIncoming(state.chats, message, state.activeId);
          if (chats === state.chats) return state;
          return { chats, ...(message.from === 'them' ? { toast: `${chat?.name || 'Hội thoại Zalo'}: ${message.text}` } : {}) };
        });
        if (message.from === 'them') {
          const target = get().chats.find(item => item.id === message.threadId);
          if (target) { try { window.desktop?.notify(`${target.name} · Zalo`, message.text); } catch { /* browser has no shell */ } }
        }
      },
      thread: thread => useDemoStore.setState(state => state.liveMode === 'live'
        ? { chats: upsertThread(state.chats, thread, state.activeId) } : state),
    };
    const off = subscribeLive(liveBridge(), handlers);
    // StrictMode gọi setup hai lần; `off` luôn là hàm thật nên lần mount đầu
    // không để lại một bộ lắng nghe thứ hai.
    return off;
  },
  selectThread: id => {
    set(state => ({ activeId: id, view: 'chats', chats: state.chats.map(chat => chat.id === id && chat.unread !== 0 ? { ...chat, unread: 0 } : chat) }));
    if (get().liveMode === 'live') {
      const chat = get().chats.find(item => item.id === id);
      if (chat) void liveBridge()?.markRead(chat.id, chat.isGroup ? 'group' : 'user').catch(() => {});
    }
  },
  sendLive: () => {
    const state = get();
    const bridge = liveBridge();
    if (!bridge || state.liveMode !== 'live') return;
    const chat = state.chats.find(item => item.id === state.activeId);
    const text = (state.drafts[state.activeId] || '').trim().slice(0, 2000);
    if (!chat || !text) return;
    const clientId = newClientId();
    set({
      chats: appendOutgoing(state.chats, chat.id, text, clientId, new Date()),
      drafts: { ...state.drafts, [state.activeId]: '' },
    });
    const kind = chat.isGroup ? 'group' : 'user';
    void bridge.sendMessage(chat.id, kind, text, clientId).then(
      (result: SendResult | undefined) => useDemoStore.setState(current => current.liveMode !== 'live' ? current : {
        chats: settleOutgoing(current.chats, clientId, result?.ok
          ? { status: 'sent', ...(result.msgId ? { msgId: result.msgId } : {}) }
          : { status: 'failed' }),
      }),
      () => useDemoStore.setState(current => current.liveMode !== 'live' ? current
        : { chats: settleOutgoing(current.chats, clientId, { status: 'failed' }) }),
    );
  },
  retryLive: messageId => {
    const state = get();
    const bridge = liveBridge();
    if (!bridge || state.liveMode !== 'live') return;
    const target = retryTarget(state.chats, state.activeId, messageId);
    if (!target) return;
    set(current => ({ chats: settleOutgoing(current.chats, target.clientId, { status: 'pending' }) }));
    void bridge.retryMessage(state.activeId, target.kind, target.text, target.clientId).then(
      (result: SendResult | undefined) => useDemoStore.setState(current => current.liveMode !== 'live' ? current : {
        chats: settleOutgoing(current.chats, target.clientId, result?.ok
          ? { status: 'sent', ...(result.msgId ? { msgId: result.msgId } : {}) }
          : { status: 'failed' }),
      }),
      () => useDemoStore.setState(current => current.liveMode !== 'live' ? current
        : { chats: settleOutgoing(current.chats, target.clientId, { status: 'failed' }) }),
    );
  },
}));

/**
 * Nạp danh sách hội thoại thật sau khi đăng nhập. Chỉ nạp khi renderer đang ở chế
 * độ thật; id số bắt đầu từ 1 nên bong bóng mẫu không thể trùng khoá.
 */
async function seedLive(): Promise<void> {
  const bridge = liveBridge();
  if (!bridge) return;
  liveSeeded = true;
  const threads = await bridge.listConversations().catch(() => []);
  useDemoStore.setState(state => {
    if (state.liveMode !== 'live') return state;
    const chats = threads.reduce((acc, thread) => upsertThread(acc, thread, state.activeId), state.chats);
    return { chats, activeId: state.chats.length ? state.activeId : chats[0]?.id ?? '' };
  });
}

/**
 * Kết quả gửi đến từ Services, không từ bộ hẹn giờ: một tin chỉ "sent" khi adapter
 * đã xác nhận. Mất mạng giữa chừng vẫn để bong bóng pending và để lần kết nối lại
 * giải phóng nó, như hành vi cũ.
 */
bridge.onDelivery(update => {
  const ref = outboxRefs.get(update.clientMessageId);
  if (!ref) return;
  if (update.phase === 'pending') return;
  useDemoStore.setState(state => {
    if (state.epoch !== ref.epoch || state.connection === 'offline') return state;
    return {
      chats: demoAdapter.settle(state.chats, ref.chatId, ref.messageId, update.phase),
      ...(update.phase === 'failed' ? { toast: FAIL_TOAST } : {}),
    };
  });
});

bridge.onInbound(message => {
  const target = pendingInbound;
  pendingInbound = null;
  if (!target) return;
  useDemoStore.setState(state => {
    if (state.epoch !== target.epoch || state.connection === 'offline') return state;
    return {
      chats: demoAdapter.receive(state.chats, target.chatId, message.text, new Date()),
      toast: `${target.name}: ${message.text}`,
    };
  });
  // A real OS toast is best-effort: in a plain browser `window.desktop` is absent,
  // so the in-app toast is the only notification and must not be treated as missing.
  try { window.desktop?.notify(`${target.name} · bản demo`, message.text); } catch { /* browser has no shell */ }
});
