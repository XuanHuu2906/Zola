export type Filter = 'all' | 'unread' | 'groups';
export type DeliveryStatus = 'pending' | 'sent' | 'failed';

export interface MessageAttachment {
  kind: 'photo' | 'video' | 'voice' | 'sticker' | 'doodle'
    | 'file' | 'link' | 'location' | 'contact' | 'gif' | 'other';
  title?: string;
  description?: string;
  /** Đích của liên kết; hiển thị dạng chữ, không tự mở. */
  url?: string;
  size?: number;
  ext?: string;
  duration?: number;
  /** `glass://app/media/…`, `null` khi chưa tải xong. */
  src: string | null;
  thumb: string | null;
  failed?: boolean;
}

export interface Message {
  id: number; from: 'me' | 'them'; time: string; text?: string; fromName?: string;
  senderAvatar?: string;
  mentions?: Array<{ pos: number; len: number }>;
  status?: DeliveryStatus;
  clientId?: string;
  attachments?: MessageAttachment[];
  /** Id tin phía server, dùng để bỏ tin dội lại trùng. */
  msgId?: string;
  /** Tin đã bị thu hồi: `text` rỗng, UI hiện "Tin nhắn đã thu hồi". */
  recalled?: boolean;
  /**
   * Tin này trả lời một tin khác. `msgId` của bản chụp cho phép bấm vào mũi
   * trích dẫn để nhảy tới tin gốc; `text` giữ bản chụp để mũi vẫn đọc được khi
   * tin gốc không còn trong máy.
   */
  quote?: MessageQuote;
  /**
   * Cảm xúc đã thả lên tin, một phần tử cho mỗi **loại** biểu tượng.
   *
   * `icon` là `rIcon` của Zalo (`"/-heart"`), không phải emoji: emoji là bản dịch
   * của UI (`REACTION_EMOJI` trong `shared/logic.ts`), còn `rIcon` là thứ máy chủ
   * gửi và là khoá để gọi `chat:react`.
   */
  reactions?: MessageReaction[];
  /**
   * Id phía máy khách của tin. Có nó mới thả được cảm xúc: Zalo đòi cả id máy
   * chủ lẫn id máy khách.
   */
  cliMsgId?: string;
  /**
   * Thời điểm thật của tin (mili-giây). Chỉ tin lịch sử mang trường này: chúng
   * được chèn theo thứ tự thời gian chứ không nối vào cuối, nên cần con số để so
   * — `time` chỉ là chuỗi `HH:mm` đã mất ngày tháng.
   */
  ts?: number;
}

/** Một loại cảm xúc đã gộp; bản sao của `LiveReaction` trong hợp đồng IPC. */
export interface MessageReaction {
  /** `rIcon` của Zalo, cũng là giá trị gửi lại khi bấm. */
  icon: string;
  count: number;
  /** Tôi có nằm trong số người đã thả cảm xúc này không. */
  mine: boolean;
}

/** Bản chụp tin được trả lời; xem `LiveQuote` trong hợp đồng IPC. */
export interface MessageQuote {
  msgId: string | null;
  from: 'me' | 'them';
  text: string;
  fromName?: string;
  attachmentKind?: MessageAttachment['kind'];
  ts?: number;
}
export interface ChatMember { name: string; role: string }
export interface Chat {
  id: string; name: string; avatar: string | null;
  pinned: boolean; unread: number;
  isGroup: boolean; time: string; preview: string; messages: Message[];
  /**
   * Mili-giây của tin cuối trong hội thoại — khoá sắp xếp của danh sách.
   *
   * `time` là chuỗi đã định dạng để hiển thị ("Hôm qua", "14:06") nên không so
   * được; sắp theo nó thì "Hôm qua" đứng trước "14:06" theo bảng chữ cái.
   */
  lastTs: number;
  members?: ChatMember[];
  /** Older messages this chat still has behind the loaded window. */
  historyRemaining: number;
}
