import { create } from 'zustand';
import type { Chat, Message, MessageAttachment } from '../types.ts';
import type {
  CatchUpProgress, LiveConnection, LoginState, SendResult, SyncPhase, SyncProgress, SyncResult,
} from '../../shared/ipc-contract.ts';
import { appendOutgoing, prependHistory, retryTarget, settleOutgoing, toggleReaction, upsertThread } from '../live/map.ts';
import { newClientId } from '../live/id.ts';
import { subscribeLive } from '../live/subscribe.ts';
import type { LiveHandlers } from '../live/subscribe.ts';
import { createBatcher } from '../live/batch.ts';
import type { LiveEvent } from '../live/apply.ts';
import { reduceLive } from '../live/apply.ts';
import { defaults, parsePreferences, PREFS_KEY, serializePreferences } from '../../shared/preferences.ts';
import type { Preferences } from '../../shared/preferences.ts';

function initialPreferences(): Preferences {
  try { return parsePreferences(localStorage.getItem(PREFS_KEY)); }
  catch { return { ...defaults }; }
}
export type LiveOverlay =
  | { kind: 'profile' }
  | { kind: 'info'; chatId: string }
  | { kind: 'settings' }
  /** Thư viện ảnh/tệp/liên kết của một hội thoại. */
  | { kind: 'media'; chatId: string }
  | { kind: 'forward'; message: Message };
interface ZaloState {
  chats: Chat[]; activeId: string; query: string;
  prefs: Preferences; drafts: Record<string, string>; toast: string;
  /** Trạng thái đăng nhập do main đẩy xuống; renderer không tự suy ra. */
  login: LoginState;
  /** Đã gọi `login()` và đang chờ main trả lời lần đầu (QR hoặc phiên cũ). */
  loginPending: boolean;
  liveConnection: LiveConnection;
  liveCatchUp: CatchUpProgress | null;
  /** Current account or settings overlay. */
  liveOverlay: LiveOverlay | null;
  openLiveOverlay(overlay: LiveOverlay): void;
  closeLiveOverlay(): void;
  /** Tab đang chọn trong thư viện phương tiện; giữ qua các lần mở trong phiên. */
  liveMediaTab: 'photo' | 'file' | 'link';
  setLiveMediaTab(tab: 'photo' | 'file' | 'link'): void;
  /** Mục đang xem chi tiết trong thư viện; `null` là đang ở danh sách. */
  liveMediaSelected: { messageId: number; item: MessageAttachment } | null;
  setLiveMediaSelected(selected: { messageId: number; item: MessageAttachment } | null): void;
  requestLogin(): void;
  requestLogout(): void;
  requestReconnect(): void;
  /** Gắn bộ lắng nghe sự kiện; trả hàm huỷ cho `useEffect` trong StrictMode. */
  connectLive(): () => void;
  /** Chọn hội thoại và đánh dấu đã đọc trên server. */
  selectThread(id: string): void;
  /** Gửi tin thật; bong bóng tạm xuất hiện ngay, kết quả vá vào đúng `clientId`. */
  sendLive(): void;
  retryLive(messageId: number): void;
  /**
   * Tiến độ tải tin cũ của từng hội thoại thật. Vắng mặt = chưa xin lần nào,
   * nên UI coi như còn trang để tải.
   */
  liveHistory: Record<string, { loading: boolean; hasMore: boolean }>;
  /** Xin thêm một trang tin cũ; main giữ con trỏ nên không truyền mốc từ đây. */
  loadLiveHistory(chatId: string): void;
  /**
   * Xin điện thoại đẩy lịch sử cũ lên. Tin không tự hiện theo chuỗi riêng: main
   * ghi cache rồi phát `ev:messageUpsert`, nên đây chỉ nói **kết quả xin**.
   */
  syncFromPhone(): void;
  /** Giai đoạn và số gói của lần đồng bộ hiện tại; `disabled` trên nút đọc từ đây. */
  liveSync: { phase: SyncPhase; stats: SyncProgress } | null;
  /**
   * Preload có kênh đồng bộ hay không. Bản preload cũ không có nó, và gọi vào
   * một kênh vắng mặt chỉ ném ra một promise bị từ chối — nên nút phải ẩn hẳn
   * thay vì hiện ra rồi báo lỗi.
   */
  liveCanSync: boolean;
  livePhoneSyncComplete: boolean;
  livePhoneSyncSetupRequired: boolean;
  setQuery(query: string): void;
  setDraft(id: string, draft: string): void;
  togglePin(): void; markUnread(): void;
  /** Thả/gỡ cảm xúc; `icon` là `rIcon` của Zalo. */
  reactLive(messageId: number, icon: string): void;
  /** Thu hồi tin của mình; kết quả nội dung về qua sự kiện Zalo. */
  recallLive(messageId: number): Promise<boolean>;
  setPrefs(patch: Partial<Preferences>): void; notify(text: string): void;
  /** Chuyển tiếp tin nhắn đến các hội thoại được chọn (chế độ live). */
  forwardMessageLive(targetChatIds: string[], message: Message): Promise<boolean>;
}

/** Ghim/chưa đọc là trạng thái máy chủ: thất bại thì phải nói, không sửa im lặng. */
const PIN_FAILED = 'Zalo không nhận thao tác ghim. Trạng thái giữ nguyên.';
const UNREAD_FAILED = 'Zalo không nhận đánh dấu chưa đọc. Trạng thái giữ nguyên.';
/** Cảm xúc cũng là trạng thái máy chủ: bị từ chối thì đảo lại và nói. */
const REACT_FAILED = 'Zalo không nhận cảm xúc này. Trạng thái giữ nguyên.';
/** Thu hồi cũng là trạng thái máy chủ; máy chủ có thể từ chối tin quá hạn. */
const RECALL_FAILED = 'Zalo không thu hồi được tin nhắn này. Có thể tin đã quá hạn hoặc không còn hợp lệ.';
/** Đã nạp danh sách từ server chưa; chỉ nạp một lần mỗi phiên đăng nhập. */
let hasLoadedConversations = false;
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

/**
 * Lô sự kiện live (plan §8.1). Sống ở tầng module chứ không trong `connectLive`
 * để `flush` gọi được từ chỗ khác — quan trọng nhất là **trước khi gửi hoặc nạp
 * lịch sử**: người dùng bấm "Gửi" thì tin vừa tới cũng phải hiện ngay, không
 * đợi hết cửa sổ gộp.
 */
const liveBatch = createBatcher<LiveEvent>({
  apply: events => useZaloStore.setState(state => {
    const outcome = reduceLive({ chats: state.chats, activeId: state.activeId, toast: state.toast }, events);
    for (const notice of outcome.notified) {
      try { window.desktop?.notify(`${notice.name} · Zalo`, notice.text, notice.threadId); }
      catch { /* browser has no shell */ }
    }
    return outcome.chats === state.chats && outcome.toast === state.toast
      ? state : { chats: outcome.chats, toast: outcome.toast };
  }),
});

/**
 * Xả lô đang chờ. Gọi ở mọi chỗ người dùng **đọc** trạng thái ngay sau đó: chọn
 * hội thoại, gửi tin, nạp lịch sử, và khi đăng xuất.
 */
const flushLive = (): void => {
  try { liveBatch.flush(); }
  // `apply` chạy trong `setState`; một lỗi ở đây (ví dụ một tin có hình dạng lạ
  // làm hỏng `appendIncoming`) không được phép làm hỏng hàm gọi. Tin vẫn nằm
  // trong cache ở main, mở lại hội thoại là thấy.
  catch { /* một lô hỏng không chặn lô sau */ }
};

export const useZaloStore = create<ZaloState>((set, get) => ({
  chats: [], activeId: '', query: '',
  prefs: initialPreferences(), drafts: {}, toast: '',
  setQuery: query => set({ query }),
  setDraft: (id, draft) => set(state => ({ drafts: { ...state.drafts, [id]: draft.slice(0, 2000) } })),
  // Pin and unread state are authoritative on the Zalo server.
  togglePin: () => {
    const state = get();
    const chat = state.chats.find(c => c.id === state.activeId);
    if (!chat) return;
    const next = !chat.pinned;
    const apply = (value: boolean) => set(current => ({
      chats: current.chats.map(c => c.id === chat.id ? { ...c, pinned: value } : c),
    }));
    apply(next);
    const bridge = liveBridge();
    if (!bridge?.setPinned) { apply(!next); set({ toast: 'Bản ứng dụng này chưa hỗ trợ ghim hội thoại.' }); return; }
    void bridge.setPinned(chat.id, chat.isGroup ? 'group' : 'user', next).then(
      ok => { if (!ok) { apply(!next); useZaloStore.setState({ toast: PIN_FAILED }); } },
      () => { apply(!next); useZaloStore.setState({ toast: PIN_FAILED }); },
    );
  },
  markUnread: () => {
    const state = get();
    const chat = state.chats.find(c => c.id === state.activeId);
    if (!chat) return;
    set(current => ({ chats: current.chats.map(c => c.id === chat.id ? { ...c, unread: 1 } : c) }));
    const bridge = liveBridge();
    if (!bridge?.setUnread) { set({ toast: 'Bản ứng dụng này chưa hỗ trợ đánh dấu chưa đọc.' }); return; }
    void bridge.setUnread(chat.id, chat.isGroup ? 'group' : 'user', true).then(
      ok => { if (!ok) useZaloStore.setState({ toast: UNREAD_FAILED }); },
      () => useZaloStore.setState({ toast: UNREAD_FAILED }),
    );
  },
  /**
   * Thả/gỡ cảm xúc.
   *
   * Ghi tại UI ngay (xem `toggleReaction`), rồi gọi máy chủ; máy chủ từ chối thì
   * đảo lại và nói. Kết quả thật không phải bản lạc quan: sự kiện `reaction` từ
   * main sẽ ghi đè bằng trạng thái đầy đủ, kể cả khi người khác cũng vừa thả.
   *
   * Cùng biểu tượng đang thả của mình ⇒ gỡ (`icon: ''`), đúng quy ước Zalo.
   */
  reactLive: (messageId, icon) => {
    const state = get();
    const chat = state.chats.find(c => c.id === state.activeId);
    const row = chat?.messages.find(m => m.id === messageId);
    if (!chat || !row?.msgId) return;
    const bridge = liveBridge();
    if (!bridge?.react) { set({ toast: 'Bản ứng dụng này chưa hỗ trợ cảm xúc.' }); return; }
    const mine = row.reactions?.some(item => item.icon === icon && item.mine) ?? false;
    const next = toggleReaction(chat.messages, messageId, icon);
    const apply = (messages: Message[]) => set(current => ({
      chats: current.chats.map(c => c.id === chat.id ? { ...c, messages } : c),
    }));
    apply(next);
    void bridge.react(chat.id, chat.isGroup ? 'group' : 'user', row.msgId, mine ? '' : icon).then(
      ok => { if (!ok) { apply(chat.messages); useZaloStore.setState({ toast: REACT_FAILED }); } },
      () => { apply(chat.messages); useZaloStore.setState({ toast: REACT_FAILED }); },
    );
  },
  recallLive: async messageId => {
    const state = get();
    const chat = state.chats.find(c => c.id === state.activeId);
    const row = chat?.messages.find(m => m.id === messageId);
    if (!chat || row?.from !== 'me' || !row.msgId
      || row.recalled || row.status === 'pending' || row.status === 'failed') return false;
    const bridge = liveBridge();
    if (!bridge?.recall) { set({ toast: 'Bản ứng dụng này chưa hỗ trợ thu hồi.' }); return false; }
    try {
      const ok = await bridge.recall(chat.id, chat.isGroup ? 'group' : 'user', row.msgId);
      useZaloStore.setState({ toast: ok ? 'Đã gửi yêu cầu thu hồi tin nhắn.' : RECALL_FAILED });
      return ok;
    } catch {
      useZaloStore.setState({ toast: RECALL_FAILED });
      return false;
    }
  },
  setPrefs: patch => {
    const prefs = parsePreferences(serializePreferences({ ...get().prefs, ...patch }));
    try { localStorage.setItem(PREFS_KEY, serializePreferences(prefs)); } catch { /* usable without storage */ }
    set({ prefs });
  },
  notify: toast => set({ toast }),
  login: { status: 'logged-out' }, loginPending: false, liveConnection: 'disconnected', liveCatchUp: null,
  liveOverlay: null, liveHistory: {}, liveSync: null, liveCanSync: false, livePhoneSyncComplete: false, livePhoneSyncSetupRequired: true,
  liveMediaTab: 'photo', liveMediaSelected: null,
  openLiveOverlay: liveOverlay => set({ liveOverlay, liveMediaSelected: null }),
  // Đóng hộp thì xoá cả mục đang xem: lần mở sau phải bắt đầu ở danh sách, không
  // nhảy vào một ảnh của lần trước.
  closeLiveOverlay: () => set({ liveOverlay: null, liveMediaSelected: null }),
  setLiveMediaTab: liveMediaTab => set({ liveMediaTab }),
  setLiveMediaSelected: liveMediaSelected => set({ liveMediaSelected }),
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
  requestLogout: () => {
    const bridge = liveBridge();
    if (!bridge) return;
    liveBatch.discard();
    hasLoadedConversations = false;
    loginPending = false;
    set({
      chats: [], activeId: '', liveHistory: {}, liveCatchUp: null, liveOverlay: null,
      login: { status: 'logged-out' },
    });
    void bridge.logout().then(() => get().requestLogin()).catch((error: unknown) => {
      set({ toast: errorText(error, 'Không đăng xuất được khỏi Zalo.') });
    });
  },
  requestReconnect: () => { void liveBridge()?.reconnect().catch(() => {}); },
  syncFromPhone: () => {
    // Chụp hàm ra biến: `bridge.syncFromPhone` là thuộc tính tuỳ chọn nên mỗi
    // lần đọc có thể là `undefined`, còn `then` bên dưới chạy sau khi đã qua
    // phép kiểm. Preload dựng hàm bằng arrow nên gọi rời không mất `this`.
    const start = liveBridge()?.syncFromPhone;
    if (!start) return;
    const running = get().liveSync?.phase;
    // Bấm hai lần không mở hai phiên: máy chủ coi đó là một thiết bị xin hai
    // luồng, và bản ghi phiên của luồng thứ hai sẽ ghi đè luồng thứ nhất.
    if (running === 'requested' || running === 'receiving') return;
    set({ liveSync: { phase: 'requested', stats: { received: 0, total: 0, written: 0, skipped: 0 } } });
    void start().then((result: SyncResult) => {
      if (result.ok) return;
      // Câu trả lời phải nói **vì sao**, không chỉ "thất bại": bị tắt và máy
      // chủ từ chối là hai việc khác nhau và cách xử lý cũng khác.
      const reason = result.code === 'disabled'
        ? 'Phiên bản này chưa hỗ trợ đồng bộ. Hãy cập nhật Zola rồi thử lại.'
        : result.code === 'not-ready'
            ? 'Đang kết nối với Zalo. Hãy đợi kết nối hoàn tất rồi thử đồng bộ lại.'
            : result.code === 'state' ? 'Đang có một lần đồng bộ dở dang.'
              : result.code === 'wasm'
                ? 'Không mở được đồng bộ. Hãy khởi động lại Zola; nếu vẫn gặp lỗi, hãy cài lại bản mới nhất.'
                : `Đồng bộ không mở được (${String(result.code ?? 'không rõ')})${result.message ? `: ${result.message}` : ''}.`;
      set({ liveSync: { phase: 'failed', stats: get().liveSync?.stats ?? { received: 0, total: 0, written: 0, skipped: 0 } } });
      get().notify(reason.slice(0, 200));
    }, (error: unknown) => {
      set({ liveSync: { phase: 'failed', stats: { received: 0, total: 0, written: 0, skipped: 0 } } });
      get().notify(errorText(error, 'Không gọi được đồng bộ.'));
    });
  },
  connectLive: () => {
    const bridge = liveBridge();
    if (!bridge) return () => {};
    set({ liveCanSync: typeof bridge.syncFromPhone === 'function' });
    const handlers: LiveHandlers = {
      login: state => {
        const enter = decoded(state);
        // Rời phiên (hoặc chưa vào) thì lần đăng nhập sau phải nạp lại danh sách;
        // sự kiện `logged-in` lặp lại thì không được kéo thêm lần nạp thứ hai.
        if (!enter) hasLoadedConversations = false;
        // Xoá `loginPending` ở **mọi** trạng thái, không chỉ `logged-in`.
        //
        // Trước đây chỉ `logged-in` xoá nó. Nhưng `loginQRFlow` phát
        // `{status:'error', retryable:true}` khi mã QR hết hạn hoặc bị từ chối rồi
        // **trả về bình thường** (`login.js` của main vẫn giữ listener). Giải
        // phóng cờ pending để người dùng có thể thử lại.
        //
        // Bất kỳ state nào từ main cũng có nghĩa là thao tác đang chờ đã có kết
        // quả; giữ cờ "đang chờ" sau khi đã có kết quả là sai ở mọi nhánh.
        loginPending = false;
        set({ login: state, loginPending: false,
          livePhoneSyncComplete: state.status === 'logged-in' && state.phoneSyncComplete === true,
          livePhoneSyncSetupRequired: state.status === 'logged-in' && state.phoneSyncSetupRequired !== false,
          ...(!enter ? { liveSync: null } : {}),
        });
        if (enter && !hasLoadedConversations) void loadConversations();
      },
      connection: state => set({ liveConnection: state }),
      catchUp: progress => {
        set({ liveCatchUp: progress });
        if (progress.phase === 'updated') {
          get().notify(`Đã nhận ${progress.received} tin mới sau khi kết nối lại. Zalo không xác nhận đã bắt kịp hoàn toàn; nếu còn thiếu, hãy đồng bộ lịch sử từ điện thoại.`);
        } else if (progress.phase === 'incomplete') {
          get().notify(progress.received
            ? `Đã nhận ${progress.received} tin nhưng chưa xác nhận lưu checkpoint. Hãy thử kết nối lại.`
            : 'Chưa xác nhận được tin mới sau khi kết nối lại. Hãy thử kết nối lại; không thể kết luận đã đồng bộ đủ.');
        }
      },
      // Tiến trình đồng bộ không phải một lô tin: nó tới theo từng gói và phải
      // hiện ngay, không qua cửa sổ gộp của `liveBatch`.
      sync: (phase, stats) => {
        set({ liveSync: { phase, stats }, ...(stats.phoneSyncComplete ? { livePhoneSyncComplete: true } : {}) });
        // Xong thì tin đã nằm trong cache nhưng danh sách hội thoại của renderer
        // vẫn là bản trước khi đồng bộ: nạp lại để các hội thoại cũ hiện ra.
        if (phase === 'done') void loadConversations();
      },
      // Một lô cho cả `thread` và `message`: main phát `thread` trước mỗi tin,
      // nên tách lô sẽ render hai lần cho cùng một tin.
      message: message => liveBatch.push({ type: 'message', message }),
      // Tệp đính kèm tải xong: vào **cùng** lô với tin, và đi nhánh riêng trong
      // `reduceLive` — nó sửa một bong bóng đã có, không thêm bong bóng mới.
      media: message => liveBatch.push({ type: 'media', message }),
      thread: thread => liveBatch.push({ type: 'thread', thread }),
      // Lỗi toàn cục của main: người dùng thấy một dòng thay vì một cửa sổ im
      // lặng hành xử lạ. Không đổi trạng thái kết nối — lỗi này không nói gì về
      // máy chủ Zalo.
      crash: notice => set({
        toast: `Lỗi nội bộ: ${String(notice?.message || '').slice(0, 120) || 'không rõ'}. Đã ghi vào nhật ký.`,
      }),
    };
    const off = subscribeLive(bridge, handlers);
    const offNotice = window.desktop?.onOpenThread?.(id => {
      flushLive();
      if (get().login.status !== 'logged-in' || !get().chats.some(chat => chat.id === id)) return;
      set({ liveOverlay: null, liveMediaSelected: null });
      get().selectThread(id);
    });
    // Subscribe before login: restore may succeed immediately and emit state
    // before another render. Main restores the saved session, or starts QR login
    // when no valid session remains.
    get().requestLogin();
    // StrictMode gọi setup hai lần; `off` luôn là hàm thật nên lần mount đầu
    // không để lại một bộ lắng nghe thứ hai. Xả lô khi tháo để không còn hẹn giờ
    // trỏ vào một store đang bị dỡ.
    return () => {
      flushLive();
      off();
      offNotice?.();
    };
  },
  selectThread: id => {
    // Tin vừa tới mà còn trong lô thì phải vào trạng thái trước khi đọc `chats`
    // bên dưới; nếu không, mở hội thoại lúc đó thấy thiếu tin và `unread` cũ.
    flushLive();
    set(state => ({ activeId: id, chats: state.chats.map(chat => chat.id === id && chat.unread !== 0 ? { ...chat, unread: 0 } : chat) }));
    const bridge = liveBridge();
    bridge?.setActiveThread?.(id);
    const chat = get().chats.find(item => item.id === id);
    if (chat) void bridge?.markRead(chat.id, chat.isGroup ? 'group' : 'user').catch(() => {});
    if (!get().liveHistory[id]) get().loadLiveHistory(id);
  },
  loadLiveHistory: chatId => {
    flushLive();
    const state = get();
    const bridge = liveBridge();
    const progress = state.liveHistory[chatId];
    if (!bridge || progress?.loading || progress?.hasMore === false) return;
    set(current => ({ liveHistory: { ...current.liveHistory, [chatId]: { loading: true, hasMore: true } } }));
    // Mốc để xin **trước**: tin cũ nhất đang hiển thị. Không truyền mốc thì mỗi
    // lần bấm đều là "cho tôi trang mới nhất", và máy chủ trả đúng trang đã có —
    // người dùng bấm mà không thấy gì đổi. `msgId` là chuỗi số nên so bằng
    // `BigInt`, không bằng `<`.
    const oldest = (state.chats.find(chat => chat.id === chatId)?.messages ?? [])
      .map(row => row.msgId).filter((id): id is string => Boolean(id))
      .reduce<string | null>((a, b) => {
        if (!a) return b;
        try { return BigInt(b) < BigInt(a) ? b : a; } catch { return a < b ? a : b; }
      }, null);
    void bridge.getMessages(chatId, oldest ?? undefined).then(
      page => useZaloStore.setState(current => {
        // Đăng xuất giữa chừng: kết quả về muộn không được chèn vào danh sách mới.
        if (!current.chats.some(chat => chat.id === chatId)) return current;
        const chats = prependHistory(current.chats, chatId, page?.messages ?? []);
        // Máy chủ trả tin mà hội thoại đã có đủ: `cmd 510` với `lastId` là
        // catch-up chứ không phải trượt lùi (đo 2026-11-08 12:34 — gửi mốc cũ
        // nhất, nhận lại trang mới hơn). Bấm nút khi đó không đổi gì trên UI, và
        // im lặng là kiểu hỏng tệ nhất: người dùng bấm mãi không biết vì sao.
        // Có tin trả về mà chèn không được tin nào ⇒ nói rõ, và đừng hứa "còn nữa".
        const added = chats !== current.chats;
        const stale = (page?.messages?.length ?? 0) > 0 && !added;
        return {
          chats,
          liveHistory: { ...current.liveHistory, [chatId]: {
            loading: false, hasMore: Boolean(page?.hasMore) && !stale,
          } },
          ...(stale ? { toast: 'Zalo không trả về tin cũ hơn cho hội thoại này. Có thể máy chủ chỉ cho xem lịch sử gần đây.' } : {}),
        };
      }),
      // Lỗi IPC không phải "hết lịch sử": giữ nút bấm lại được.
      () => useZaloStore.setState(current => ({
        liveHistory: { ...current.liveHistory, [chatId]: { loading: false, hasMore: true } },
      })),
    );
  },
  sendLive: () => {
    // Tin đến trong 50 ms vừa rồi phải hiện trước bong bóng mình vừa gõ; nếu
    // không, người gửi thấy tin của mình nhảy lên trước tin vừa tới.
    flushLive();
    const state = get();
    const bridge = liveBridge();
    if (!bridge) return;
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
      (result: SendResult | undefined) => useZaloStore.setState(current => ({
        chats: settleOutgoing(current.chats, clientId, result?.ok
          ? { status: 'sent', ...(result.msgId ? { msgId: result.msgId } : {}) }
          : { status: 'failed' }),
      })),
      () => useZaloStore.setState(current => ({ chats: settleOutgoing(current.chats, clientId, { status: 'failed' }) })),
    );
  },
  retryLive: messageId => {
    flushLive();
    const state = get();
    const bridge = liveBridge();
    if (!bridge) return;
    const target = retryTarget(state.chats, state.activeId, messageId);
    if (!target) return;
    set(current => ({ chats: settleOutgoing(current.chats, target.clientId, { status: 'pending' }) }));
    void bridge.retryMessage(state.activeId, target.kind, target.text, target.clientId).then(
      (result: SendResult | undefined) => useZaloStore.setState(current => ({
        chats: settleOutgoing(current.chats, target.clientId, result?.ok
          ? { status: 'sent', ...(result.msgId ? { msgId: result.msgId } : {}) }
          : { status: 'failed' }),
      })),
      () => useZaloStore.setState(current => ({ chats: settleOutgoing(current.chats, target.clientId, { status: 'failed' }) })),
    );
  },
  forwardMessageLive: async (targetChatIds, message) => {
    flushLive();
    const bridge = liveBridge();
    if (!bridge?.forwardMessage) {
      set({ toast: 'Bản ứng dụng này chưa hỗ trợ chuyển tiếp.' });
      return false;
    }
    const state = get();
    let sentCount = 0;
    const text = message.text || (message.attachments?.length ? `[${message.attachments[0].title || 'Tệp'}]` : '');
    for (const chatId of targetChatIds) {
      const chat = state.chats.find(c => c.id === chatId);
      const kind = chat?.isGroup ? 'group' : 'user';
      try {
        const ok = await bridge.forwardMessage(chatId, kind, text, message.msgId, message.ts);
        if (ok) sentCount++;
      } catch {
        // tiếp tục chuyển tiếp các hội thoại khác
      }
    }
    if (sentCount > 0) {
      set({
        toast: `Đã chuyển tiếp tin nhắn đến ${sentCount} cuộc trò chuyện.`,
        liveOverlay: null,
      });
      return true;
    }
    set({ toast: 'Chuyển tiếp tin nhắn thất bại.' });
    return false;
  },
}));

/**
 * Load the account's conversations after sign-in. Renderer ids are positive and
 * unique across the loaded messages.
 */
async function loadConversations(): Promise<void> {
  const bridge = liveBridge();
  if (!bridge) return;
  hasLoadedConversations = true;
  const threads = await bridge.listConversations().catch(() => []);
  useZaloStore.setState(state => {
    const chats = threads.reduce((acc, thread) => upsertThread(acc, thread, state.activeId), state.chats);
    return { chats, activeId: state.chats.length ? state.activeId : chats[0]?.id ?? '' };
  });
  // Hội thoại đầu tiên được chọn tự động thì cũng phải nạp lịch sử; `selectThread`
  // không chạy trong nhánh này vì đây là store tự đổi `activeId`.
  const active = useZaloStore.getState();
  if (active.activeId) {
    bridge.setActiveThread?.(active.activeId);
    active.loadLiveHistory(active.activeId);
  }
}
