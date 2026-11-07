export type Filter = 'all' | 'unread' | 'groups' | 'work';
export type View = 'chats' | 'contacts' | 'groups' | 'journal' | 'cloud' | 'tools';
export type DeliveryStatus = 'pending' | 'sent' | 'failed';
export type TransferKind = 'upload' | 'download';
export type ConnectionState = 'online' | 'offline' | 'syncing';
export interface Message {
  id: number; from: 'me' | 'them'; time: string; text?: string;
  attachment?: string; size?: string; reaction?: string;
  status?: DeliveryStatus; progress?: number; transfer?: TransferKind;
  /** Khoá gửi của chế độ thật; vắng ở bản demo. */
  clientId?: string;
  /** Id tin phía server, dùng để bỏ tin dội lại trùng. */
  msgId?: string;
}
export interface ChatMember { name: string; role: string }
export interface Chat {
  id: string; name: string; avatar: string | null;
  online?: boolean; verified?: boolean; pinned: boolean; unread: number;
  isGroup: boolean; isWork: boolean; time: string; preview: string; messages: Message[];
  members?: ChatMember[];
  /** Older messages this chat still has behind the loaded window. */
  historyRemaining: number;
}
export interface FileMetadata { name: string; size: number }
export interface Session { signedIn: true; label: string }
export interface DemoAdapter {
  readonly mode: 'offline-demo';
  list(): Chat[];
  search(chats: Chat[], query: string, filter: Filter): Chat[];
  send(chats: Chat[], chatId: string, text: string, now?: Date, status?: DeliveryStatus): Chat[];
  /** Move one outgoing message to a new delivery state; other chats keep identity. */
  settle(chats: Chat[], chatId: string, messageId: number, status: DeliveryStatus): Chat[];
  attach(chats: Chat[], chatId: string, files: FileMetadata[], now?: Date): Chat[];
  /** Set a transfer kind and/or advance one attachment's 0..100 progress. */
  setTransfer(chats: Chat[], chatId: string, messageId: number, patch: { transfer?: TransferKind; progress?: number }): Chat[];
  receive(chats: Chat[], chatId: string, text: string, now?: Date): Chat[];
  loadOlder(chats: Chat[], chatId: string, pageSize?: number): Chat[];
}
