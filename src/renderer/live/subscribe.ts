import type {
  CatchUpProgress, CrashNotice, LiveConnection, LiveMessage, LiveThread, LoginState, SyncPhase, SyncProgress,
} from '../../shared/ipc-contract.ts';

/**
 * Event bridge for the Zalo session. It receives the bridge as an argument, so
 * `tests/live.test.ts` kiểm được thứ tự đăng ký/huỷ đăng ký mà không cần Electron.
 *
 * `window.chat` vắng mặt trong trình duyệt thường: khi đó không đăng ký gì và trả
 * về hàm huỷ rỗng, để mọi chỗ gọi không phải tự kiểm tra `undefined`.
 */

export interface ChatEvents {
  onLoginState(callback: (state: LoginState) => void): () => void;
  onConnection(callback: (state: LiveConnection) => void): () => void;
  onMessageUpsert(callback: (message: LiveMessage) => void): () => void;
  onThreadUpsert(callback: (thread: LiveThread) => void): () => void;
  /**
   * Lỗi toàn cục của main (plan §9.1). Kênh này **không bắt buộc**: bản preload
   * cũ không có nó, và trong trình duyệt thường thì không có bridge nào cả.
   */
  onCrash?(callback: (notice: CrashNotice) => void): () => void;
  /**
   * Tiến trình đồng bộ lịch sử từ điện thoại. Cũng **không bắt buộc**: chỉ có
   * khi main chạy với đồng bộ bật, các bản khác không có kênh này.
   */
  onSync?(callback: (payload: { phase: SyncPhase } & SyncProgress) => void): () => void;
  onCatchUp?(callback: (progress: CatchUpProgress) => void): () => void;
  /**
   * Một tệp đính kèm vừa tải xong. Cũng **không bắt buộc**: bản preload cũ không
   * có kênh này, và khi thiếu thì ảnh vẫn hiện ở lần mở hội thoại sau (đọc từ
   * cache) — chỉ là không hiện ngay trong phiên đang chạy.
   */
  onMedia?(callback: (message: LiveMessage) => void): () => void;
}

export interface LiveHandlers {
  login(state: LoginState): void;
  connection(state: LiveConnection): void;
  message(message: LiveMessage): void;
  /** Tệp đính kèm vừa có trên đĩa; cùng `msgId` với một tin đã hiện. */
  media(message: LiveMessage): void;
  thread(thread: LiveThread): void;
  crash(notice: CrashNotice): void;
  sync(phase: SyncPhase, stats: SyncProgress): void;
  catchUp(progress: CatchUpProgress): void;
}

export function subscribeLive(bridge: ChatEvents | undefined, handlers: LiveHandlers): () => void {
  if (!bridge) return () => {};
  const offs = [
    bridge.onLoginState(handlers.login),
    bridge.onConnection(handlers.connection),
    bridge.onMessageUpsert(handlers.message),
    bridge.onThreadUpsert(handlers.thread),
    bridge.onMedia?.(handlers.media),
    // Thiếu `onCrash` (bản preload cũ) thì bỏ qua, không trả về `undefined` trong
    // danh sách huỷ đăng ký — nơi đó sẽ gọi nó như một hàm.
    bridge.onCrash?.(handlers.crash),
    // Phong bì mang `phase` cùng số đếm; tách ra ngay ở đây để tầng trên không
    // phải biết kênh IPC đóng gói thế nào.
    bridge.onSync?.(payload => handlers.sync(payload.phase, {
      received: payload.received, total: payload.total,
      written: payload.written, skipped: payload.skipped,
      ...(payload.phoneSyncComplete ? { phoneSyncComplete: true } : {}),
    })),
    bridge.onCatchUp?.(handlers.catchUp),
  ].filter((off): off is () => void => typeof off === 'function');
  return () => {
    for (const off of offs) {
      // Preload đã bị gỡ (cửa sổ đang đóng) thì removeListener không còn tác dụng.
      try { off(); } catch { /* window is gone */ }
    }
  };
}
