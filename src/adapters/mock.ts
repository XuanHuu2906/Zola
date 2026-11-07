/**
 * MockZaloClient — hiện thực offline của IZaloClient cho phát triển UI và kiểm thử.
 * Không nói chuyện với mạng. Không có host, endpoint hay credential.
 */

import type {
  Attachment,
  AuthPort,
  CallingPort,
  CapabilityState,
  ClientError,
  ClientResult,
  Contact,
  ContactsPort,
  Conversation,
  ConversationsPort,
  GroupsPort,
  IZaloClient,
  MediaPort,
  Message,
  MessagingPort,
  MessagePage,
  MessageStatusEvent,
  NotificationsPort,
  RequestOptions,
  SecureChannelPort,
  SecureState,
  SecureStateEvent,
  SessionHandle,
  SessionState,
  SyncPort,
  TransportEvent,
  TransportPort,
  TransportStatus,
  Unsubscribe,
  UploadProgressEvent,
  UploadTicket,
} from './types.ts';

const now = () => new Date().toISOString();

const ok = <T>(value: T): ClientResult<T> => ({ ok: true, value });

const fail = <T>(
  kind: ClientError['kind'],
  message: string,
  retryable = false,
  code?: string | number,
): ClientResult<T> => ({ ok: false, error: { kind, message, retryable, ...(code === undefined ? {} : { code }) } });

const unsupported = <T>(port: string): ClientResult<T> =>
  fail('unsupported', `${port} không khả dụng ở chế độ mock.`);

type Listener<T> = (value: T) => void;

class Emitter<T> {
  private readonly listeners = new Set<Listener<T>>();
  on(listener: Listener<T>): Unsubscribe {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  emit(value: T): void {
    for (const listener of [...this.listeners]) listener(value);
  }
}

export type MockPortName =
  | 'auth' | 'contacts' | 'conversations' | 'messaging' | 'media'
  | 'groups' | 'calling' | 'sync' | 'notifications' | 'secureChannel' | 'transport';

export interface MockOptions {
  /** Tắt từng cổng để kiểm thử nhánh "không hỗ trợ". Mặc định tất cả bật. */
  readonly disabled?: readonly MockPortName[];
  /** Lần gọi `messaging.send` kế tiếp trả lỗi mạng. */
  readonly failNextSend?: boolean;
  /** Trễ mỗi lần `messaging.send` để pha "đang gửi" của UI quan sát được. Mặc định 0. */
  readonly sendLatencyMs?: number;
}

const USERS = {
  me: { id: 'u-me', displayName: 'Bạn', avatarUrl: null },
  anh: { id: 'u-anh', displayName: 'Đặng Minh Ánh', avatarUrl: null },
  long: { id: 'u-long', displayName: 'Hoàng Long', avatarUrl: null },
} as const;

export class MockZaloClient implements IZaloClient {
  readonly mode = 'mock' as const;

  /** Khởi tạo bằng field initializer để các port bên dưới đọc được ngay khi field của chúng chạy. */
  private disabled = new Set<MockPortName>();
  private failNextSend = false;
  private readonly sendLatencyMs: number;
  private session: SessionState = { state: 'signed-out' };
  private transportStatus: TransportStatus = 'idle';
  private nextId = 1;

  private readonly messageStore: Message[] = [];
  private readonly attachmentStore = new Map<string, Attachment>();
  private readonly uploadStore = new Set<string>();
  private readonly conversationStore: Conversation[];

  private readonly sessionEvents = new Emitter<SessionState>();
  private readonly conversationEvents = new Emitter<Conversation>();
  private readonly incomingEvents = new Emitter<Message>();
  private readonly statusEvents = new Emitter<MessageStatusEvent>();
  private readonly uploadEvents = new Emitter<UploadProgressEvent>();
  private readonly secureEvents = new Emitter<SecureStateEvent>();
  private readonly transportEvents = new Emitter<TransportEvent>();

  private readonly contactStore: Contact[] = [
    { ...USERS.anh, alias: 'Ánh', blocked: false },
    { ...USERS.long, alias: null, blocked: false },
  ];

  constructor(options: MockOptions = {}) {
    this.disabled = new Set(options.disabled ?? []);
    this.failNextSend = options.failNextSend ?? false;
    this.sendLatencyMs = options.sendLatencyMs ?? 0;
    const ts = now();
    this.conversationStore = [
      {
        id: 'c-anh', kind: 'direct', title: 'Đặng Minh Ánh', avatarUrl: null,
        participants: [USERS.anh], unreadCount: 2, pinned: true, updatedAt: ts,
        lastMessagePreview: 'Mai gặp ở quán cũ nhé', requiresSecure: false,
      },
      {
        id: 'c-nhom', kind: 'group', title: 'Nhóm dự án', avatarUrl: null,
        participants: [USERS.anh, USERS.long], unreadCount: 0, pinned: false, updatedAt: ts,
        lastMessagePreview: 'File thiết kế đã cập nhật', requiresSecure: true,
      },
    ];
    this.messageStore.push(
      {
        id: 'm-1', conversationId: 'c-anh', clientMessageId: 'seed-1', senderId: 'u-me',
        kind: 'text', text: 'Chào buổi sáng', attachment: null, sentAt: ts, status: 'seen', replyTo: null,
      },
      {
        id: 'm-2', conversationId: 'c-anh', clientMessageId: 'seed-2', senderId: 'u-anh',
        kind: 'text', text: 'Mai gặp ở quán cũ nhé', attachment: null, sentAt: ts, status: 'seen', replyTo: null,
      },
    );
  }

  private state(port: MockPortName): CapabilityState {
    return this.disabled.has(port) ? 'unavailable' : 'mock';
  }

  private guard<T>(port: MockPortName, options?: RequestOptions): ClientResult<T> | null {
    if (options?.signal?.aborted) return fail('cancelled', 'Thao tác đã bị huỷ.', true);
    if (this.disabled.has(port)) return unsupported<T>(port);
    return null;
  }

  /**
   * Gắn `capability` sống vào literal port. Field initializer chạy trước constructor
   * body, nên nếu đọc `disabled` ngay tại đây sẽ thấy options chưa được áp.
   *
   * Mọi phương thức cũng phải tuân theo cùng trạng thái đó: `capability === 'unavailable'`
   * mà lời gọi vẫn trả dữ liệu là vi phạm hợp đồng §4.1. Listener trả hàm huỷ rỗng thay vì
   * một promise bị từ chối, để `on*` luôn đúng kiểu trả về.
   */
  private bind<T>(port: MockPortName, spec: Omit<T, 'capability'>): T {
    const wrapped: Record<string, unknown> = {};
    for (const [key, fn] of Object.entries(spec)) {
      if (typeof fn !== 'function') {
        wrapped[key] = fn;
        continue;
      }
      if (key.startsWith('on')) {
        wrapped[key] = (...args: unknown[]) => (
          this.disabled.has(port) ? () => {} : (fn as (...a: unknown[]) => unknown)(...args)
        );
        continue;
      }
      wrapped[key] = (...args: unknown[]) => {
        const last = args[args.length - 1];
        const options = last && typeof last === 'object' && 'signal' in last
          ? (last as RequestOptions)
          : undefined;
        const blocked = this.guard<unknown>(port, options);
        if (blocked) return Promise.resolve(blocked);
        return (fn as (...a: unknown[]) => unknown)(...args);
      };
    }
    return Object.defineProperty(wrapped, 'capability', {
      get: () => this.state(port),
      enumerable: true,
    }) as T;
  }

  private touch(conversationId: string, preview: string): void {
    const found = this.conversationStore.find(c => c.id === conversationId);
    if (!found) return;
    found.lastMessagePreview = preview;
    found.updatedAt = now();
    this.conversationEvents.emit(found);
  }

  /** Mô phỏng tin đến qua push (§5.5 "message receive"). Chỉ chạm state cục bộ. */
  simulateIncoming(conversationId: string, senderId: string, text: string): Message {
    const message: Message = {
      id: `m-${this.nextId++}`, conversationId,
      clientMessageId: `mock-in-${this.nextId}`, senderId, kind: 'text',
      text, attachment: null, sentAt: now(), status: 'delivered', replyTo: null,
    };
    this.messageStore.push(message);
    const found = this.conversationStore.find(c => c.id === conversationId);
    if (found) {
      found.unreadCount += 1;
      found.lastMessagePreview = text;
      found.updatedAt = message.sentAt;
      this.conversationEvents.emit(found);
    }
    this.incomingEvents.emit(message);
    return message;
  }

  /** Bật/tắt công tắc một lần: lần gửi kế tiếp thất bại rồi công tắc tự tắt. */
  armSendFailure(armed: boolean): void {
    this.failNextSend = armed;
  }

  /** Mô phỏng mất mạng (§5.5 "reconnect scenario"): offline + sự kiện retryable. */
  simulateDisconnect(reason = 'mock-loss'): void {
    this.transportStatus = 'offline';
    this.transportEvents.emit({ type: 'disconnected', reason, retryable: true });
  }

  readonly auth: AuthPort = this.bind<AuthPort>('auth', {
    getSession: async () => ok(this.session),
    signIn: async (_request, options) => {
      const blocked = this.guard<SessionState>('auth', options);
      if (blocked) return blocked;
      this.session = { state: 'signed-in', userId: 'u-me', expiresAt: null };
      this.sessionEvents.emit(this.session);
      return ok(this.session);
    },
    signOut: async () => {
      this.session = { state: 'signed-out' };
      this.sessionEvents.emit(this.session);
      return ok(undefined);
    },
    onSessionChange: listener => this.sessionEvents.on(listener),
  });

  readonly contacts: ContactsPort = this.bind<ContactsPort>('contacts', {
    list: async query => ok(query
      ? this.contactStore.filter(c => c.displayName.toLowerCase().includes(query.toLowerCase()))
      : [...this.contactStore]),
    resolve: async ids => ok(this.contactStore.filter(c => ids.includes(c.id))),
    onChanged: () => () => {},
  });

  readonly conversations: ConversationsPort = this.bind<ConversationsPort>('conversations', {
    list: async () => ok({ items: [...this.conversationStore], nextCursor: null }),
    get: async id => {
      const found = this.conversationStore.find(c => c.id === id);
      return found ? ok(found) : fail<Conversation>('invalid', `Không có hội thoại ${id}.`);
    },
    setPinned: async (id, pinned) => {
      const found = this.conversationStore.find(c => c.id === id);
      if (!found) return fail('invalid', `Không có hội thoại ${id}.`);
      found.pinned = pinned;
      this.conversationEvents.emit(found);
      return ok(undefined);
    },
    markRead: async id => {
      const found = this.conversationStore.find(c => c.id === id);
      if (!found) return fail('invalid', `Không có hội thoại ${id}.`);
      found.unreadCount = 0;
      this.conversationEvents.emit(found);
      return ok(undefined);
    },
    onChanged: listener => this.conversationEvents.on(listener),
  });

  readonly messaging: MessagingPort = this.bind<MessagingPort>('messaging', {
    history: async (conversationId, _cursor, options) => {
      const blocked = this.guard<MessagePage>('messaging', options);
      if (blocked) return blocked;
      return ok({
        items: this.messageStore.filter(m => m.conversationId === conversationId),
        nextCursor: null,
      });
    },
    send: async (input, options) => {
      const blocked = this.guard<{ clientMessageId: string; message: Message }>('messaging', options);
      if (blocked) return blocked;
      const text = input.text.trim();
      if (!text) return fail('invalid', 'Nội dung tin nhắn rỗng.');
      if (this.sendLatencyMs > 0) {
        await new Promise(resolve => setTimeout(resolve, this.sendLatencyMs));
      }
      if (this.failNextSend) {
        this.failNextSend = false;
        return fail('network', 'Mô phỏng mất mạng khi gửi.', true, 'MOCK_NETWORK');
      }
      const message: Message = {
        id: `m-${this.nextId++}`, conversationId: input.conversationId,
        clientMessageId: input.clientMessageId, senderId: 'u-me', kind: 'text',
        text, attachment: null, sentAt: now(), status: 'sent', replyTo: input.replyTo,
      };
      this.messageStore.push(message);
      this.touch(input.conversationId, text);
      return ok({ clientMessageId: input.clientMessageId, message });
    },
    setReaction: async () => ok(undefined),
    onIncoming: listener => this.incomingEvents.on(listener),
    onStatus: listener => this.statusEvents.on(listener),
  });

  readonly media: MediaPort = this.bind<MediaPort>('media', {
    createUpload: async request => {
      if (this.disabled.has('media')) return unsupported<UploadTicket>('media');
      if (request.byteSize <= 0) return fail('invalid', 'Kích thước tệp không hợp lệ.');
      const chunkSize = 256 * 1024;
      const ticket: UploadTicket = {
        uploadId: `up-${this.nextId++}`, chunkSize,
        chunkCount: Math.max(1, Math.ceil(request.byteSize / chunkSize)),
      };
      this.uploadStore.add(ticket.uploadId);
      this.attachmentStore.set(ticket.uploadId, {
        fileId: ticket.uploadId, name: request.name, byteSize: request.byteSize,
        mimeType: request.mimeType, url: null,
      });
      return ok(ticket);
    },
    putChunk: async (ticket, index, _data, options) => {
      const blocked = this.guard<void>('media', options);
      if (blocked) return blocked;
      if (!this.uploadStore.has(ticket.uploadId)) return fail('invalid', 'Ticket không tồn tại.');
      if (index < 0 || index >= ticket.chunkCount) return fail('invalid', 'Chỉ số chunk ngoài phạm vi.');
      const uploadedChunks = index + 1;
      this.uploadEvents.emit({
        uploadId: ticket.uploadId, uploadedChunks, chunkCount: ticket.chunkCount,
        state: uploadedChunks === ticket.chunkCount ? 'complete' : 'uploading',
      });
      return ok(undefined);
    },
    complete: async ticket => {
      const attachment = this.attachmentStore.get(ticket.uploadId);
      return attachment ? ok(attachment) : fail<Attachment>('invalid', 'Ticket không tồn tại.');
    },
    cancel: async ticket => {
      this.uploadStore.delete(ticket.uploadId);
      this.attachmentStore.delete(ticket.uploadId);
      this.uploadEvents.emit({
        uploadId: ticket.uploadId, uploadedChunks: 0, chunkCount: ticket.chunkCount, state: 'failed',
      });
      return ok(undefined);
    },
    resolve: async fileId => {
      const attachment = this.attachmentStore.get(fileId);
      return attachment ? ok(attachment) : fail<Attachment>('invalid', `Không có tệp ${fileId}.`);
    },
    onUploadProgress: listener => this.uploadEvents.on(listener),
  });

  readonly groups: GroupsPort = this.bind<GroupsPort>('groups', {
    get: async id => (id === 'g-du-an'
      ? ok({
        id: 'g-du-an', conversationId: 'c-nhom', name: 'Nhóm dự án',
        members: [
          { userId: 'u-me', role: 'owner' },
          { userId: 'u-anh', role: 'admin' },
          { userId: 'u-long', role: 'member' },
        ],
      })
      : fail('invalid', `Không có nhóm ${id}.`)),
    create: async name => {
      const id = this.nextId++;
      return ok({
        id: `g-${id}`, conversationId: `c-${id}`, name,
        members: [{ userId: 'u-me', role: 'owner' }],
      });
    },
    addMembers: async () => fail('unsupported', 'Mock không mô phỏng thêm thành viên.'),
    removeMember: async () => fail('unsupported', 'Mock không mô phỏng xoá thành viên.'),
    leave: async () => ok(undefined),
  });

  /** R7 §9: renderer Zalo không có media stack; mock cũng không giả vờ có. */
  readonly calling: CallingPort = {
    capability: 'unavailable',
    start: async () => unsupported('calling'),
    onIncoming: () => () => {},
  };

  /** R7 §10: sai thứ tự đồng bộ có thể mất tin; mock không mô phỏng để tránh ấn tượng sai. */
  readonly sync: SyncPort = {
    capability: 'unavailable',
    pull: async () => unsupported('sync'),
    reset: async () => unsupported('sync'),
  };

  readonly notifications: NotificationsPort = this.bind<NotificationsPort>('notifications', {
    create: async input => ok({ ...input, id: `n-${this.nextId++}`, createdAt: now() }),
    close: async () => ok(undefined),
    isSupported: async () => ok(true),
    onClick: () => () => {},
  });

  readonly secureChannel: SecureChannelPort = this.bind<SecureChannelPort>('secureChannel', {
    state: async conversationId => {
      const found = this.conversationStore.find(c => c.id === conversationId);
      if (!found) return fail<SecureState>('invalid', `Không có hội thoại ${conversationId}.`);
      return ok(found.requiresSecure ? 'pending' : 'none');
    },
    onStateChange: listener => this.secureEvents.on(listener),
  });

  readonly transport: TransportPort = this.bind<TransportPort>('transport', {
    connect: async (handle: SessionHandle, options) => {
      const blocked = this.guard<void>('transport', options);
      if (blocked) return blocked;
      if (!handle.id) return fail('unauthorized', 'Session handle không hợp lệ.');
      this.transportStatus = 'online';
      this.transportEvents.emit({ type: 'connected' });
      return ok(undefined);
    },
    disconnect: async () => {
      this.transportStatus = 'offline';
      this.transportEvents.emit({ type: 'disconnected', reason: 'mock-disconnect', retryable: true });
      return ok(undefined);
    },
    status: async () => ok(this.transportStatus),
    onEvent: listener => this.transportEvents.on(listener),
  });
}
