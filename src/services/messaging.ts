/**
 * MessagingService — M1.
 * Sở hữu optimistic state, hàng đợi gửi, retry có giới hạn và khử echo trùng.
 * Chỉ nói chuyện với `IZaloClient`; không biết endpoint, host hay credential.
 * Xem docs/CUSTOM_CLIENT_ARCHITECTURE.md §5.1 và §5.2.
 */

import type {
  ClientError,
  ClientResult,
  ConversationId,
  IZaloClient,
  Message,
  MessageId,
  MessageStatus,
  MessageStatusEvent,
  RequestOptions,
  Unsubscribe,
} from '../adapters/types.ts';

export type OutboxState = 'sending' | 'sent' | 'failed';

export interface OutboxEntry {
  readonly clientMessageId: string;
  readonly conversationId: ConversationId;
  readonly text: string;
  readonly replyTo: MessageId | null;
  state: OutboxState;
  attempts: number;
  /** Message id thật khi đã gửi xong; bằng clientMessageId khi còn tạm. */
  messageId: MessageId;
  error: ClientError | null;
}

export interface MessagingPolicy {
  /** Số lần thử tối đa, tính cả lần đầu. */
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  /** Lệch ngẫu nhiên 0..1 để nhiều tin không dội cùng lúc. */
  readonly jitter: () => number;
}

export const DEFAULT_POLICY: MessagingPolicy = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 4_000,
  jitter: Math.random,
};

/** Cho phép test chạy retry không cần chờ thời gian thật. */
export interface Scheduler {
  schedule(delayMs: number, fn: () => void): Unsubscribe;
}

export const timerScheduler: Scheduler = {
  schedule: (delayMs, fn) => {
    const timer = setTimeout(fn, delayMs);
    return () => clearTimeout(timer);
  },
};

export interface MessagingServiceOptions {
  readonly policy?: Partial<MessagingPolicy>;
  readonly scheduler?: Scheduler;
  readonly newId?: () => string;
}

export type MessageEvent =
  | { type: 'upsert'; message: Message }
  | { type: 'removed'; conversationId: ConversationId; messageId: MessageId };

type Listener<T> = (value: T) => void;

/**
 * Lỗi mà thử lại chắc chắn không giúp gì: nội dung sai, thiếu quyền, cổng không hỗ trợ.
 * Chỉ lỗi mạng/ứng dụng tạm thời mới được retry tự động.
 */
const PERMANENT: ReadonlySet<ClientError['kind']> = new Set([
  'invalid',
  'unsupported',
  'unauthorized',
  'conflict',
  'cancelled',
]);

export class MessagingService {
  private readonly client: IZaloClient;
  private readonly policy: MessagingPolicy;
  private readonly scheduler: Scheduler;
  private readonly newId: () => string;

  private readonly outbox = new Map<string, OutboxEntry>();
  /** Tin đã biết theo id thật, dùng để khử push trùng và cập nhật trạng thái. */
  private readonly known = new Map<MessageId, Message>();
  private readonly pendingRetries = new Map<string, Unsubscribe>();

  private readonly messageEvents = new Set<Listener<MessageEvent>>();
  private readonly outboxEvents = new Set<Listener<OutboxEntry>>();
  private readonly stops: Unsubscribe[] = [];
  private disposed = false;

  constructor(client: IZaloClient, options: MessagingServiceOptions = {}) {
    this.client = client;
    this.policy = { ...DEFAULT_POLICY, ...options.policy };
    this.scheduler = options.scheduler ?? timerScheduler;
    this.newId = options.newId ?? (() => globalThis.crypto.randomUUID());

    this.stops.push(client.messaging.onIncoming(message => this.handleIncoming(message)));
    this.stops.push(client.messaging.onStatus(event => this.handleStatus(event)));
  }

  /** Trả về Message của bong bóng optimistic ngay lập tức; kết quả mạng đi qua sự kiện. */
  sendText(
    conversationId: ConversationId,
    text: string,
    replyTo: MessageId | null = null,
  ): ClientResult<Message> {
    if (this.disposed) {
      return fail('cancelled', 'Dịch vụ đã đóng.', false);
    }
    const trimmed = text.trim();
    if (!trimmed) {
      return fail('invalid', 'Nội dung tin nhắn rỗng.', false);
    }
    const entry: OutboxEntry = {
      clientMessageId: this.newId(),
      conversationId,
      text: trimmed,
      replyTo,
      state: 'sending',
      attempts: 0,
      messageId: '',
      error: null,
    };
    entry.messageId = entry.clientMessageId;
    this.outbox.set(entry.clientMessageId, entry);

    const optimistic = this.toMessage(entry, 'sending');
    this.known.set(optimistic.id, optimistic);
    this.emitMessage({ type: 'upsert', message: optimistic });

    void this.attempt(entry);
    return { ok: true, value: optimistic };
  }

  /** Người dùng bấm "Gửi lại" trên bong bóng đã hỏng. */
  retry(clientMessageId: string): ClientResult<void> {
    const entry = this.outbox.get(clientMessageId);
    if (!entry) return fail('invalid', 'Không có tin đang chờ để gửi lại.', false);
    if (entry.state !== 'sent') this.retryNow(entry, true);
    return { ok: true, value: undefined };
  }

  /** Còn bao nhiêu tin chưa tới trạng thái cuối; Services dùng để chặn đóng app. */
  pendingCount(): number {
    let count = 0;
    for (const entry of this.outbox.values()) if (entry.state === 'sending') count += 1;
    return count;
  }

  entry(clientMessageId: string): OutboxEntry | null {
    return this.outbox.get(clientMessageId) ?? null;
  }

  onMessage(listener: Listener<MessageEvent>): Unsubscribe {
    this.messageEvents.add(listener);
    return () => { this.messageEvents.delete(listener); };
  }

  onOutbox(listener: Listener<OutboxEntry>): Unsubscribe {
    this.outboxEvents.add(listener);
    return () => { this.outboxEvents.delete(listener); };
  }

  /** Push tới: cùng clientMessageId nghĩa là echo của chính tin ta vừa gửi. */
  handleIncoming(message: Message, options?: RequestOptions): void {
    if (this.disposed || options?.signal?.aborted) return;

    const echo = this.outbox.get(message.clientMessageId);
    if (echo) {
      // Server xác nhận bằng push trước khi lời gọi send trả về.
      if (echo.state !== 'sent') {
        this.markSent(echo, message.id, message.status);
      }
      return;
    }
    if (this.known.has(message.id)) return;

    this.known.set(message.id, message);
    this.emitMessage({ type: 'upsert', message });
  }

  private handleStatus(event: MessageStatusEvent): void {
    if (this.disposed) return;
    const message = this.known.get(event.messageId);
    if (!message || message.status === event.status) return;
    const updated = { ...message, status: event.status };
    this.known.set(event.messageId, updated);
    this.emitMessage({ type: 'upsert', message: updated });
  }

  private toMessage(entry: OutboxEntry, status: MessageStatus): Message {
    return {
      id: entry.messageId || entry.clientMessageId,
      conversationId: entry.conversationId,
      clientMessageId: entry.clientMessageId,
      senderId: 'me',
      kind: 'text',
      text: entry.text,
      attachment: null,
      sentAt: new Date().toISOString(),
      status,
      replyTo: entry.replyTo,
    };
  }

  private async attempt(entry: OutboxEntry): Promise<void> {
    if (this.disposed) return;
    entry.state = 'sending';
    entry.attempts += 1;
    entry.error = null;
    this.emitOutbox(entry);

    const result = await this.client.messaging.send({
      conversationId: entry.conversationId,
      clientMessageId: entry.clientMessageId,
      text: entry.text,
      replyTo: entry.replyTo,
    });

    if (this.disposed) return;

    if (result.ok) {
      this.markSent(entry, result.value.message.id, result.value.message.status);
      return;
    }

    entry.error = result.error;
    const canRetry = result.error.retryable
      && !PERMANENT.has(result.error.kind)
      && entry.attempts < this.policy.maxAttempts;

    if (!canRetry) {
      entry.state = 'failed';
      this.emitOutbox(entry);
      this.emitMessage({ type: 'upsert', message: this.toMessage(entry, 'failed') });
      return;
    }

    this.emitOutbox(entry);
    // Bong bóng vẫn ở trạng thái gửi trong lúc chờ; không xoá, không báo lỗi sớm.
    this.emitMessage({ type: 'upsert', message: this.toMessage(entry, 'sending') });
    this.scheduleRetry(entry);
  }

  private scheduleRetry(entry: OutboxEntry): void {
    const id = entry.clientMessageId;
    this.pendingRetries.get(id)?.();
    const delay = Math.min(
      this.policy.maxDelayMs,
      this.policy.baseDelayMs * 2 ** (entry.attempts - 1),
    );
    const jittered = Math.round(delay * (1 - this.policy.jitter() * 0.25));
    const cancel = this.scheduler.schedule(jittered, () => {
      this.pendingRetries.delete(id);
      if (this.disposed || entry.state !== 'sending') return;
      void this.attempt(entry);
    });
    this.pendingRetries.set(id, cancel);
  }

  private retryNow(entry: OutboxEntry, resetCounter: boolean): void {
    this.pendingRetries.get(entry.clientMessageId)?.();
    this.pendingRetries.delete(entry.clientMessageId);
    if (resetCounter) entry.attempts = 0;
    void this.attempt(entry);
  }

  private markSent(entry: OutboxEntry, messageId: MessageId, status: MessageStatus): void {
    this.pendingRetries.get(entry.clientMessageId)?.();
    this.pendingRetries.delete(entry.clientMessageId);

    entry.state = 'sent';
    entry.error = null;
    entry.messageId = messageId;

    const settled: Message = {
      ...this.toMessage(entry, status),
      id: messageId,
    };
    this.known.set(messageId, settled);
    this.emitOutbox(entry);
    this.emitMessage({ type: 'upsert', message: settled });
  }

  private emitMessage(event: MessageEvent): void {
    for (const listener of [...this.messageEvents]) listener(event);
  }

  private emitOutbox(entry: OutboxEntry): void {
    const snapshot = { ...entry };
    for (const listener of [...this.outboxEvents]) listener(snapshot);
  }

  dispose(): void {
    this.disposed = true;
    for (const cancel of this.pendingRetries.values()) cancel();
    this.pendingRetries.clear();
    for (const stop of this.stops) stop();
    this.stops.length = 0;
    this.messageEvents.clear();
    this.outboxEvents.clear();
  }
}

const fail = <T>(kind: ClientError['kind'], message: string, retryable: boolean): ClientResult<T> =>
  ({ ok: false, error: { kind, message, retryable } });
