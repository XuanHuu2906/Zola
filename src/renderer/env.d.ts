import type {
  LiveConnection, LiveMessage, LiveMessagePage, LiveThread, LoginState, SendResult,
} from '../shared/ipc-contract.ts';

declare global {
  interface Window {
    desktop?: Readonly<{
      minimize(): void;
      toggleMaximize(): void;
      close(): void;
      notify(title: string, body: string): void;
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
      sendMessage(threadId: string, kind: string, text: string, clientId: string): Promise<SendResult>;
      retryMessage(threadId: string, kind: string, text: string, clientId: string): Promise<SendResult>;
      markRead(threadId: string, kind: string): Promise<void>;
      reconnect(): Promise<void>;
      onLoginState(callback: (state: LoginState) => void): () => void;
      onConnection(callback: (state: LiveConnection) => void): () => void;
      onMessageUpsert(callback: (message: LiveMessage) => void): () => void;
      onThreadUpsert(callback: (thread: LiveThread) => void): () => void;
    }>;
  }
}

export {};
