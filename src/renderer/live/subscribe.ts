import type { LiveConnection, LiveMessage, LiveThread, LoginState } from '../../shared/ipc-contract.ts';

/**
 * Cầu nối sự kiện của chế độ thật. Chỉ là hàm thuần nhận bridge qua tham số, nên
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
}

export interface LiveHandlers {
  login(state: LoginState): void;
  connection(state: LiveConnection): void;
  message(message: LiveMessage): void;
  thread(thread: LiveThread): void;
}

export function subscribeLive(bridge: ChatEvents | undefined, handlers: LiveHandlers): () => void {
  if (!bridge) return () => {};
  const offs = [
    bridge.onLoginState(handlers.login),
    bridge.onConnection(handlers.connection),
    bridge.onMessageUpsert(handlers.message),
    bridge.onThreadUpsert(handlers.thread),
  ];
  return () => {
    for (const off of offs) {
      // Preload đã bị gỡ (cửa sổ đang đóng) thì removeListener không còn tác dụng.
      try { off(); } catch { /* window is gone */ }
    }
  };
}
