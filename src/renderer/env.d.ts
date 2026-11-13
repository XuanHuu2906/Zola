import type {
  LiveConnection, LiveMessage, LiveMessagePage, LiveThread, LoginState, SendResult,
  CatchUpProgress, SyncPhase, SyncProgress, SyncResult,
} from '../shared/ipc-contract.ts';

declare global {
  interface Window {
    calls?: Readonly<{
      status(): Promise<{ available: boolean; state?: Record<string, unknown> | null }>;
      start(id: string, video: boolean): Promise<{ ok: boolean; message?: string }>;
      action(action: string, value?: unknown): void;
      onEvent(callback: (event: Record<string, unknown>) => void): () => void;
    }>;
    desktop?: Readonly<{
      mediaAction(src: string, name: string, action: 'open' | 'save'): Promise<{ ok: boolean; canceled?: boolean; message?: string }>;
      minimize(): void;
      toggleMaximize(): void;
      close(): void;
      notify(title: string, body: string, threadId: string): void;
      onOpenThread?(callback: (threadId: string) => void): () => void;
    }>;
    /**
     * Cầu nối chat thật do preload dựng. Vắng mặt trong trình duyệt thường
     * (`npm run dev`) — mọi chỗ dùng phải chịu được `undefined`.
     */
    chat?: Readonly<{
      login(): Promise<void>;
      logout(): Promise<void>;
      listConversations(): Promise<LiveThread[]>;
      getMessages(threadId: string, before?: string): Promise<LiveMessagePage>;
      setActiveThread?(threadId: string | null): void;
      sendMessage(threadId: string, kind: string, text: string, clientId: string): Promise<SendResult>;
      retryMessage(threadId: string, kind: string, text: string, clientId: string): Promise<SendResult>;
      markRead(threadId: string, kind: string): Promise<void>;
      /** Ghim/bỏ ghim trên máy chủ Zalo; `false` nghĩa là Zalo từ chối. */
      setPinned?(threadId: string, kind: string, value: boolean): Promise<boolean>;
      /** Đánh dấu chưa đọc / bỏ dấu trên máy chủ Zalo; `false` nghĩa là bị từ chối. */
      setUnread?(threadId: string, kind: string, value: boolean): Promise<boolean>;
      /**
       * Thả/gỡ cảm xúc trên máy chủ Zalo. `icon` là `rIcon` (`"/-heart"`),
       * `''` là gỡ; `false` nghĩa là Zalo từ chối.
       */
      react?(threadId: string, kind: string, msgId: string, icon: string): Promise<boolean>;
      /**
       * Thu hồi một tin của mình. `false` nghĩa là Zalo từ chối (quá hạn 24 giờ,
       * không phải tin của mình); trạng thái thật về qua sự kiện `undo`.
       */
      recall?(threadId: string, kind: string, msgId: string): Promise<boolean>;
      /** Chuyển tiếp tin nhắn đến một hội thoại. */
      forwardMessage?(threadId: string, kind: string, text: string, msgId?: string, ts?: number): Promise<boolean>;
      reconnect(): Promise<void>;
      /**
       * Xin điện thoại đẩy lịch sử cũ. Không bắt buộc: bản preload cũ không có
       * kênh này, nên UI phải tự ẩn nút khi vắng mặt thay vì gọi và hỏng.
       */
      syncFromPhone?(): Promise<SyncResult>;
      /** Báo lỗi render cho nhật ký. Một chiều; có thể vắng ở bản preload cũ. */
      reportRenderError?(payload: { name: string; componentStack: string; messageLength: number }): void;
      onLoginState(callback: (state: LoginState) => void): () => void;
      onConnection(callback: (state: LiveConnection) => void): () => void;
      onMessageUpsert(callback: (message: LiveMessage) => void): () => void;
      onThreadUpsert(callback: (thread: LiveThread) => void): () => void;
      /** Lỗi toàn cục của main; vắng mặt ở bản preload cũ. */
      onCrash?(callback: (notice: { message: string }) => void): () => void;
      /** Tiến trình đồng bộ; vắng mặt khi main chạy không bật đồng bộ. */
      onSync?(callback: (payload: { phase: SyncPhase } & SyncProgress) => void): () => void;
      /** Trạng thái bắt kịp tin mới sau khi kết nối lại. */
      onCatchUp?(callback: (progress: CatchUpProgress) => void): () => void;
    }>;
  }
}

export {};
