/**
 * Hợp đồng IZaloClient — R8.
 * Xem docs/CUSTOM_CLIENT_ARCHITECTURE.md và docs/API_AUTHORIZATION_GAP.md trước khi hiện thực.
 * Không chứa host, endpoint, khóa hay credential.
 */

/** `unverified` = đã biết hình dạng nhưng chưa có quyền; `unavailable` = không tồn tại trong bản này. */
export type CapabilityState = 'mock' | 'unverified' | 'authorized' | 'unavailable';

export type ClientErrorKind =
  | 'application'
  | 'network'
  | 'unauthorized'
  | 'unsupported'
  | 'conflict'
  | 'invalid'
  | 'cancelled';

export interface ClientError {
  kind: ClientErrorKind;
  /** Mã ứng dụng nguyên văn; là dữ liệu mờ, không diễn giải ở tầng trên. */
  code?: string | number;
  message: string;
  retryable: boolean;
}

/** HTTP 200 vẫn có thể là lỗi ứng dụng, nên mọi lời gọi trả kết quả có nhãn thay vì ném lỗi. */
export type ClientResult<T, E = ClientError> = { ok: true; value: T } | { ok: false; error: E };

export interface Pagination<T> {
  items: T[];
  nextCursor: string | null;
}

export type Unsubscribe = () => void;

export interface RequestOptions {
  /** Huỷ thao tác đang chờ; adapter phải bỏ kết quả thay vì ghi state. */
  signal?: AbortSignal;
}

export type UserId = string;
export type ConversationId = string;
export type MessageId = string;
export type GroupId = string;
export type FileId = string;

export interface ZaloUser {
  id: UserId;
  displayName: string;
  avatarUrl: string | null;
}

export interface Contact extends ZaloUser {
  alias: string | null;
  blocked: boolean;
}

export type ConversationKind = 'direct' | 'group';

export interface Conversation {
  id: ConversationId;
  kind: ConversationKind;
  title: string;
  avatarUrl: string | null;
  participants: ZaloUser[];
  unreadCount: number;
  pinned: boolean;
  /** ISO 8601. */
  updatedAt: string;
  lastMessagePreview: string | null;
  /** Hội thoại yêu cầu kênh an toàn; xem SecureChannelPort. */
  requiresSecure: boolean;
}

export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'seen' | 'failed';
export type MessageKind = 'text' | 'file' | 'sticker' | 'system';

export interface Attachment {
  fileId: FileId;
  name: string;
  byteSize: number;
  mimeType: string;
  /** null cho tới khi media phân giải xong. */
  url: string | null;
}

export interface Message {
  id: MessageId;
  conversationId: ConversationId;
  /** Khóa idempotency do tầng Services sinh; dùng để khử echo trùng. */
  clientMessageId: string;
  senderId: UserId;
  kind: MessageKind;
  text: string | null;
  attachment: Attachment | null;
  sentAt: string;
  status: MessageStatus;
  replyTo: MessageId | null;
}

export interface MessageStatusEvent {
  conversationId: ConversationId;
  messageId: MessageId;
  status: MessageStatus;
}

/** Handle mờ đục: không mang credential, adapter tự ánh xạ sang kho bí mật của nó. */
export interface SessionHandle {
  readonly id: string;
}

export type SessionState =
  | { state: 'signed-out' }
  | { state: 'signed-in'; userId: UserId; expiresAt: string | null };

export type SignInMethod = 'qr' | 'password' | 'enterprise';

export interface SignInRequest {
  method: SignInMethod;
}

export interface AuthPort {
  readonly capability: CapabilityState;
  getSession(): Promise<ClientResult<SessionState>>;
  signIn(request: SignInRequest, options?: RequestOptions): Promise<ClientResult<SessionState>>;
  signOut(): Promise<ClientResult<void>>;
  onSessionChange(listener: (session: SessionState) => void): Unsubscribe;
}

export interface ContactsPort {
  readonly capability: CapabilityState;
  list(query?: string): Promise<ClientResult<Contact[]>>;
  resolve(ids: UserId[]): Promise<ClientResult<Contact[]>>;
  onChanged(listener: (contacts: Contact[]) => void): Unsubscribe;
}

export interface ConversationsPort {
  readonly capability: CapabilityState;
  list(): Promise<ClientResult<Pagination<Conversation>>>;
  get(id: ConversationId): Promise<ClientResult<Conversation>>;
  setPinned(id: ConversationId, pinned: boolean): Promise<ClientResult<void>>;
  markRead(id: ConversationId): Promise<ClientResult<void>>;
  onChanged(listener: (conversation: Conversation) => void): Unsubscribe;
}

export interface SendTextInput {
  conversationId: ConversationId;
  clientMessageId: string;
  text: string;
  replyTo: MessageId | null;
}

export interface SendAck {
  clientMessageId: string;
  message: Message;
}

export type MessagePage = Pagination<Message>;

export interface MessagingPort {
  readonly capability: CapabilityState;
  history(
    conversationId: ConversationId,
    cursor?: string | null,
    options?: RequestOptions,
  ): Promise<ClientResult<MessagePage>>;
  send(input: SendTextInput, options?: RequestOptions): Promise<ClientResult<SendAck>>;
  setReaction(
    conversationId: ConversationId,
    messageId: MessageId,
    emoji: string | null,
  ): Promise<ClientResult<void>>;
  onIncoming(listener: (message: Message) => void): Unsubscribe;
  onStatus(listener: (event: MessageStatusEvent) => void): Unsubscribe;
}

export interface UploadRequest {
  name: string;
  byteSize: number;
  mimeType: string;
}

export interface UploadTicket {
  uploadId: string;
  chunkSize: number;
  chunkCount: number;
}

export interface UploadProgressEvent {
  uploadId: string;
  uploadedChunks: number;
  chunkCount: number;
  state: 'uploading' | 'complete' | 'failed';
}

export interface MediaPort {
  readonly capability: CapabilityState;
  createUpload(input: UploadRequest): Promise<ClientResult<UploadTicket>>;
  putChunk(
    ticket: UploadTicket,
    index: number,
    data: Uint8Array,
    options?: RequestOptions,
  ): Promise<ClientResult<void>>;
  complete(ticket: UploadTicket): Promise<ClientResult<Attachment>>;
  cancel(ticket: UploadTicket): Promise<ClientResult<void>>;
  resolve(fileId: FileId): Promise<ClientResult<Attachment>>;
  onUploadProgress(listener: (event: UploadProgressEvent) => void): Unsubscribe;
}

export type GroupRole = 'owner' | 'admin' | 'member';

export interface GroupMember {
  userId: UserId;
  role: GroupRole;
}

export interface Group {
  id: GroupId;
  conversationId: ConversationId;
  name: string;
  members: GroupMember[];
}

export interface GroupsPort {
  readonly capability: CapabilityState;
  get(id: GroupId): Promise<ClientResult<Group>>;
  create(name: string, members: UserId[]): Promise<ClientResult<Group>>;
  addMembers(id: GroupId, members: UserId[]): Promise<ClientResult<Group>>;
  removeMember(id: GroupId, member: UserId): Promise<ClientResult<Group>>;
  leave(id: GroupId): Promise<ClientResult<void>>;
}

export interface CallSession {
  callId: string;
}

/** v1: `capability` là `unavailable`; mọi lời gọi phải trả `kind: 'unsupported'`. */
export interface CallingPort {
  readonly capability: CapabilityState;
  start(conversationId: ConversationId, video: boolean): Promise<ClientResult<CallSession>>;
  onIncoming(listener: (call: CallSession) => void): Unsubscribe;
}

export interface SyncPage {
  applied: number;
  nextCursor: string | null;
  hasMore: boolean;
}

/** v1: `capability` là `unavailable`; sai thứ tự áp dụng có thể làm mất tin trên thiết bị thật. */
export interface SyncPort {
  readonly capability: CapabilityState;
  pull(cursor: string | null, options?: RequestOptions): Promise<ClientResult<SyncPage>>;
  reset(): Promise<ClientResult<void>>;
}

export interface NotificationRequest {
  conversationId: ConversationId;
  title: string;
  body: string;
  silent: boolean;
}

export interface DesktopNotification extends NotificationRequest {
  id: string;
  createdAt: string;
}

export interface NotificationsPort {
  readonly capability: CapabilityState;
  create(input: NotificationRequest): Promise<ClientResult<DesktopNotification>>;
  close(notificationId: string): Promise<ClientResult<void>>;
  isSupported(): Promise<ClientResult<boolean>>;
  onClick(listener: (notificationId: string, conversationId: ConversationId) => void): Unsubscribe;
}

export type SecureState = 'none' | 'pending' | 'established' | 'failed';

export interface SecureStateEvent {
  conversationId: ConversationId;
  state: SecureState;
}

/** Chỉ phơi trạng thái, không phơi phép mã hoá: crypto không bao giờ lọt vào tầng Services. */
export interface SecureChannelPort {
  readonly capability: CapabilityState;
  state(conversationId: ConversationId): Promise<ClientResult<SecureState>>;
  onStateChange(listener: (event: SecureStateEvent) => void): Unsubscribe;
}

export type TransportStatus = 'idle' | 'connecting' | 'online' | 'offline';
export type TransportEvent =
  | { type: 'connected' }
  | { type: 'disconnected'; reason: string; retryable: boolean };

/** Điểm nối duy nhất được phép nói chuyện với backend; v1 chỉ có hiện thực mock. */
export interface TransportPort {
  readonly capability: CapabilityState;
  connect(handle: SessionHandle, options?: RequestOptions): Promise<ClientResult<void>>;
  disconnect(): Promise<ClientResult<void>>;
  status(): Promise<ClientResult<TransportStatus>>;
  onEvent(listener: (event: TransportEvent) => void): Unsubscribe;
}

export interface IZaloClient {
  /** `authorized` chỉ được dùng khi cả A1 và A2 của docs/API_AUTHORIZATION_GAP.md đã mở. */
  readonly mode: 'mock' | 'authorized';
  readonly auth: AuthPort;
  readonly contacts: ContactsPort;
  readonly conversations: ConversationsPort;
  readonly messaging: MessagingPort;
  readonly media: MediaPort;
  readonly groups: GroupsPort;
  readonly calling: CallingPort;
  readonly sync: SyncPort;
  readonly notifications: NotificationsPort;
  readonly secureChannel: SecureChannelPort;
  readonly transport: TransportPort;
}
