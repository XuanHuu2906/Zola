import type { LiveMessage, LiveThread, ThreadKind } from '../ipc-contract.js';

/**
 * Mapper thuần: zca-js → model của repo. Không I/O, không giữ state, để test
 * được bằng dữ liệu khai báo. Mọi giá trị ra ngoài đều là kiểu nguyên thuỷ —
 * không object zca-js nào được đi qua IPC.
 */

/** TMessage/GroupMessage tối thiểu mà mapper cần; giữ tách khỏi kiểu zca-js. */
export interface RawMessage {
  msgId: string;
  cliMsgId: string;
  uidFrom: string;
  idTo: string;
  dName: string;
  ts: string;
  msgType: string;
  content: unknown;
  quote?: unknown;
}

export interface RawUser {
  userId: string;
  displayName: string;
  zaloName: string;
  avatar: string;
}

export interface RawGroupInfo {
  groupId: string;
  name: string;
  avt: string;
  totalMember: number;
}

/** `content` là chuỗi với tin text; object hoặc JSON attachment — MVP chỉ đọc text. */
export function textOf(raw: RawMessage): string {
  if (typeof raw.content !== 'string') return '';
  const trimmed = raw.content.trimStart();
  if (trimmed.startsWith('{')) return '';
  return raw.content.slice(0, 2000);
}

/**
 * Tin text được khai báo là `msgType` = 1 nhưng chưa đối chiếu payload thật
 * (xem §10 zca-capabilities). Các loại khác (ảnh, tệp, sticker…) mang `content`
 * là JSON object, nên chuỗi thuần không bắt đầu bằng `{` được coi là text.
 */
export function isTextMessage(raw: RawMessage): boolean {
  if (raw.msgType === '1') return true;
  return typeof raw.content === 'string' && raw.content.trim() !== '' && !raw.content.trimStart().startsWith('{');
}

/**
 * `threadId` và `self` do zca-js cung cấp: nó tính cả hai *trước* khi ghi đè
 * `uidFrom`/`idTo` trong payload, nên không thể suy lại từ `raw` được.
 */
export function toLiveMessage(
  raw: RawMessage, threadId: string, kind: ThreadKind, self: boolean,
): LiveMessage | null {
  if (!isTextMessage(raw)) return null;
  const text = textOf(raw);
  if (!text.trim()) return null;
  const ts = Number(raw.ts);
  return {
    threadId,
    kind,
    msgId: raw.msgId || null,
    clientId: null,
    from: self ? 'me' : 'them',
    text,
    ts: Number.isFinite(ts) ? ts : Date.now(),
  };
}

/**
 * Danh sách hội thoại: `getAllFriends` + `getAllGroups`→`getGroupInfo`.
 * Preview để trống vì zca-js không có API lấy tin cuối (xem §4 capabilities);
 * tin đầu tiên tới qua listener sẽ lấp vào.
 */
export function buildThreads(
  friends: RawUser[], groups: RawGroupInfo[],
  pinned: string[], unreadUser: string[], unreadGroup: string[],
): LiveThread[] {
  const pinnedSet = new Set(pinned);
  const unreadUserSet = new Set(unreadUser);
  const unreadGroupSet = new Set(unreadGroup);
  const threads: LiveThread[] = [
    ...friends.map<LiveThread>(friend => ({
      id: friend.userId, kind: 'user',
      name: (friend.displayName || friend.zaloName || 'Người dùng Zalo').slice(0, 120),
      avatar: null, pinned: pinnedSet.has(friend.userId),
      unread: unreadUserSet.has(friend.userId) ? 1 : 0,
      lastText: '', lastTs: 0,
    })),
    ...groups.map<LiveThread>(group => ({
      id: group.groupId, kind: 'group',
      name: (group.name || 'Nhóm Zalo').slice(0, 120),
      avatar: null, pinned: pinnedSet.has(group.groupId),
      unread: unreadGroupSet.has(group.groupId) ? 1 : 0,
      lastText: '', lastTs: 0,
    })),
  ];
  return threads.sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

/** Ghép sự kiện realtime vào danh sách: tạo thread nếu chưa có, cập nhật preview. */
export function applyMessage(threads: LiveThread[], message: LiveMessage, activeId: string | null): LiveThread[] {
  const index = threads.findIndex(t => t.id === message.threadId && t.kind === message.kind);
  if (index < 0) {
    const created: LiveThread = {
      id: message.threadId, kind: message.kind,
      name: message.kind === 'group' ? 'Nhóm Zalo' : 'Người dùng Zalo',
      avatar: null, pinned: false, unread: 0, lastText: message.text, lastTs: message.ts,
    };
    return [created, ...threads];
  }
  const current = threads[index];
  const next: LiveThread = {
    ...current,
    lastText: message.text,
    lastTs: Math.max(current.lastTs, message.ts),
    unread: message.from === 'them' && message.threadId !== activeId ? current.unread + 1 : current.unread,
  };
  const rest = threads.filter((_, i) => i !== index);
  return [next, ...rest];
}
