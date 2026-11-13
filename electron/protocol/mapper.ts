import type { LiveMessage, LiveQuote, LiveThread, ThreadKind } from '../ipc-contract.js';
import { attachmentsOf, previewOfMessage, type AttachmentKind, type RawAttachment, type StoreMessage, type StoredAttachment } from './attachment.js';
import { mentionRangesOf } from './mentions.js';

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
  mentions?: unknown;
}

export interface StickerContent {
  id: number;
  catId?: number;
  type?: number;
}

export function stickerContentOf(raw: RawMessage): StickerContent | null {
  if (raw.msgType !== 'chat.sticker' && raw.msgType !== '10') return null;
  let content: unknown = raw.content;
  if (typeof content === 'string') {
    try { content = JSON.parse(content); } catch { return null; }
  }
  if (!content || typeof content !== 'object' || Array.isArray(content)) return null;
  const body = content as Record<string, unknown>;
  const id = body.id;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return null;
  const catId = body.catId;
  const type = body.type;
  return {
    id,
    ...(typeof catId === 'number' && Number.isSafeInteger(catId) && catId >= 0 ? { catId } : {}),
    ...(typeof type === 'number' && Number.isSafeInteger(type) && type >= 0 ? { type } : {}),
  };
}

function stickerMetadataAttachment(sticker: StickerContent): StoredAttachment[] {
  return attachmentsOf('chat.sticker', [{
    type: 'chat.sticker',
    params: JSON.stringify(sticker),
  }]);
}

export interface RawUser {
  userId: string;
  displayName: string;
  zaloName: string;
  avatar: string;
  /**
   * URL ảnh đại diện đầy đủ do `zca-js` trả về (`getAllFriends`/
   * `getGroupInfo`). Không đi lên renderer: main tải nó về đĩa một lần rồi
   * phục vụ qua `glass://app/avatars/<id>.png` (`electron/avatars.ts`), nên CSP
   * không phải nới host nào.
   *
   * Tách khỏi `avatar` vì `avatar` hiện chỉ được khai báo là `string` và có
   * đường dựng cũ (test, cache) điền `''`; trường này là **nguồn** để tải, không
   * phải giá trị hiển thị.
   */
  avatarSource?: string;
  /**
   * Tuỳ chọn vì đây là bản `User` của zca-js cắt lại, và không phải mọi đường
   * dựng `RawUser` (test, cache cũ) đều có nó.
   *
   * **Đây là `globalId`, không gian id thứ hai của Zalo.** Sync V2 chỉ nói
   * chuyện bằng id này: `Sync2.Message.senderId` và `convId` của hội thoại đều
   * là id nhiễu hoá (`lazy/main-startup…`: `_getGlobalIdsFromUserIds` lấy
   * `profile.globalId`), trong khi uid bạn bè là số thập phân. So `senderId` với
   * uid là so hai không gian khác nhau — đo 2026-11-10: 0/4 768 tin khớp, nên
   * mọi tin lịch sử đều thành "của người khác".
   */
  globalId?: string;
}

export interface RawThread {
  id: string;
  kind: ThreadKind;
  name: string;
  avatar: string | null;
  lastTs: number;
  lastPreview: string;
  unread: number;
  pinned: boolean;
  online: boolean;
  /**
   * Id nhiễu (`profile.globalId`) của người hoặc nhóm. Xem `RawUser.globalId`:
   * Sync V2 gọi mọi thứ bằng id này, còn `LiveThread.id` là uid số.
   */
  globalId?: string;
}

/** Một hội thoại dựng xong, kèm ánh xạ uid → `globalId` tách riêng. */
export interface BuiltThreads {
  threads: LiveThread[];
  /**
   * `globalId` → uid, cho mọi hội thoại một-một biết `globalId`.
   *
   * Sync V2 chỉ trả `senderId` dạng nhiễu. Bảng này là thứ duy nhất nối được nó
   * về một người trong danh sách bạn bè, và nó đến từ `getAllFriends` — cùng
   * nguồn mà Zalo PC dùng (`_getGlobalIdsFromUserIds` đọc `profile.globalId`);
   * chỉ khác là Zalo PC có thêm endpoint tra theo lô, còn ta dùng bản đã tải.
   */
  globalIds: Map<string, string>;
  /** uid và `globalId` → tên liên hệ đã biết. */
  globalNames: Map<string, string>;
  /** groupId → member UIDs used for resolving Sync V2 sender globalIds. */
  groupMemberIds: Map<string, string[]>;
  /**
   * Số dòng **đã nhận** theo từng loại, kể cả dòng thiếu `globalId`.
   *
   * `globalIds.size` một mình không phân biệt được hai ca hỏng rất khác nhau:
   * danh sách nhóm rỗng (lời gọi mạng hỏng, đã bị `.catch` nuốt) so với danh
   * sách nhóm đầy nhưng `globalId` rỗng. Đo 2026-11-10: thêm nhóm vào bảng mà
   * số vẫn đúng bằng số bạn bè — cần con số này để biết vì sao.
   */
  counts: { friends: number; groups: number; groupIds: number };
  /**
   * `threadId` → URL avatar từ xa, cho những hội thoại có ảnh.
   *
   * Không đặt vào `LiveThread.avatar`: trường đó là đường dẫn **cục bộ** đã có
   * trên đĩa. Đây là nguồn để main tải về (`electron/avatars.ts`), và nó phải
   * tách khỏi model đi qua IPC — renderer không bao giờ thấy một `.zadn.vn`.
   */
  avatars: Map<string, string>;
}

export interface RawGroupInfo {
  groupId: string;
  name: string;
  avt: string;
  totalMember: number;
  /**
   * URL ảnh nhóm đầy đủ — cùng vai trò với `RawUser.avatarSource`.
   */
  avatarSource?: string;
  /**
   * Id nhiễu của nhóm — cùng vai trò với `RawUser.globalId`, và cũng là thứ
   * Sync V2 dùng cho `partition: "group/<id>"`. `GroupInfo.globalId` của zca-js.
   */
  globalId?: string;
  memberIds?: string[];
  members?: RawGroupMember[];
}

export interface RawGroupMember {
  id: string;
  dName: string;
  zaloName: string;
  avatarSource?: string;
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
 * Tệp đính kèm của một tin realtime.
 *
 * zca-js không chuẩn hoá loại tin: `content` là **chuỗi JSON** cho ảnh/tệp/nhãn
 * dán và là chuỗi thuần cho text. Tin đó mang sẵn `params`/`href`/`thumb`/
 * `title`, tức đúng hình dạng `TAttachmentContent` của zca-js và đúng hình dạng
 * `Attach` của proto — nên hình dạng hoá lại thành `RawAttachment` rồi dùng
 * chung `attachmentsOf` với đường đồng bộ. Một bảng phân loại, hai đường vào.
 *
 * Trả mảng rỗng khi không phải JSON, khi JSON không có `href`/`params`, hoặc khi
 * `msgType` khai là text — một `content` bắt đầu bằng `{` không tự động là tệp.
 */
function attachmentsOfRealtime(raw: RawMessage): StoredAttachment[] {
  const sticker = stickerContentOf(raw);

  if (typeof raw.content !== 'string') {
    // Một số bản zca-js trả object thay vì chuỗi; chấp nhận cả hai.
    if (!raw.content || typeof raw.content !== 'object') return [];
    const body = raw.content as RawAttachment;
    if (sticker && !body.href && !body.params && !body.thumb && !body.title) {
      return stickerMetadataAttachment(sticker);
    }
    // Cùng điều kiện với nhánh JSON bên dưới: không có gì để dựng thẻ thì không
    // có tệp. Một object rỗng trên tin loại 2 không phải là hình vẽ tay.
    if (!body.href && !body.params && !body.thumb && !body.title) return [];
    // `raw.msgType` của realtime là **tên chuỗi** (`"chat.photo"`), không phải
    // số của enum `Ai` — xem `attachmentsOf`. Truyền nguyên chuỗi, đừng ép số.
    return attachmentsOf(raw.msgType, [body]);
  }
  const trimmed = raw.content.trim();
  if (!trimmed.startsWith('{')) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(trimmed); } catch { return []; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const body = parsed as Record<string, unknown>;
  if (sticker && !body.href && !body.params && !body.thumb && !body.title) {
    return stickerMetadataAttachment(sticker);
  }
  // Hình dạng thật là `{ title, href, thumb, params, action, type, ... }`; một số
  // loại bọc trong `data`. Thử cả hai, ưu tiên dạng phẳng vì đó là dạng zca-js
  // ghi trong `TAttachmentContent`.
  const attach = (typeof body.href === 'string' || typeof body.params === 'string'
    ? body : (body.data && typeof body.data === 'object' ? body.data : body)) as RawAttachment;
  // Chỉ nhận nội dung **thật sự dựng được thẻ**: một URL tải được, một chuỗi
  // `params` để đọc, hoặc ít nhất một tiêu đề. `msgType` một mình không đủ —
  // một JSON bất kỳ trên tin loại 2 không phải là hình vẽ tay, và dựng thẻ cho
  // nó là bịa ra một tệp không tồn tại.
  if (!attach.href && !attach.params && !attach.thumb && !attach.title) return [];
  // Cùng lý do với nhánh trên: giữ nguyên `msgType` dạng chuỗi.
  return attachmentsOf(raw.msgType, [attach]);
}

/**
 * Trích dẫn của một tin realtime → `LiveQuote`, hoặc `undefined`.
 *
 * zca-js khai `TQuote` với đủ mười trường (`msg`, `globalMsgId`, `cliMsgId`,
 * `ownerId`, `fromD`, …). Trước đây `RawMessage.quote` được khai trong kiểu và
 * rồi không ai đọc — nghĩa là mọi tin trả lời hiện ra như tin thường, mất hẳn
 * mũi trích dẫn. Chỉ nhận khi thật sự có nội dung để hiện: một object rỗng
 * không phải một lời trả lời.
 */
export function quoteOf(value: unknown): LiveQuote | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const body = value as Record<string, unknown>;
  const msg = typeof body.msg === 'string' ? body.msg.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
  const attach = typeof body.attach === 'string' ? body.attach : '';
  // `globalMsgId` số 0 là "không có": cùng quy ước với `globalId` của Sync V2.
  const rawId = body.globalMsgId;
  const idText = typeof rawId === 'string' ? rawId : typeof rawId === 'number' ? String(rawId) : '';
  const msgId = idText && idText !== '0' ? idText : null;
  const attachmentKind = attach ? attachmentsOf(attach, [{ type: attach }])[0]?.kind : undefined;
  // Không có chữ lẫn tệp thì không có gì để vẽ — bỏ, thay vì một khung rỗng.
  if (!msg && !attachmentKind) return undefined;
  const owner = typeof body.ownerId === 'string' ? body.ownerId : '';
  const fromName = typeof body.fromD === 'string' ? body.fromD.trim().slice(0, 120) : '';
  const ts = Number(body.ts);
  return {
    msgId,
    // `ownerId === "0"` là chính mình — đúng quy ước `uidFrom` của zca-js.
    from: owner === '0' ? 'me' : 'them',
    text: msg,
    ...(fromName ? { fromName } : {}),
    ...(attachmentKind ? { attachmentKind } : {}),
    ...(Number.isFinite(ts) && ts > 0 ? { ts } : {}),
  };
}

/**
 * `threadId` và `self` do zca-js cung cấp: nó tính cả hai *trước* khi ghi đè
 * `uidFrom`/`idTo` trong payload, nên không thể suy lại từ `raw` được.
 *
 * Trả `null` khi tin **không có gì** để hiện: không chữ và không tệp. Đây là
 * cùng điều kiện với `chunkToMessages` bên đường đồng bộ — trước đây cả hai chỉ
 * xét chữ, và đó là lý do toàn bộ ảnh/tệp biến mất khỏi hội thoại.
 */
export function toLiveMessage(
  raw: RawMessage, threadId: string, kind: ThreadKind, self: boolean,
  resolveName?: (uid: string) => string | undefined,
): StoreMessage | null {
  const text = textOf(raw);
  const attachments = attachmentsOfRealtime(raw);
  if (!text.trim() && !attachments.length) return null;
  const mentions = mentionRangesOf(raw.mentions, text);
  const ts = Number(raw.ts);
  const quote = quoteOf(raw.quote);
  const resolvedName = kind === 'group' && !self
    ? resolveName?.(raw.uidFrom)?.trim() || (typeof raw.dName === 'string' ? raw.dName.trim() : '') : '';
  const fromName = resolvedName.slice(0, 120);
  return {
    threadId,
    kind,
    msgId: raw.msgId || null,
    clientId: null,
    from: self ? 'me' : 'them',
    ...(raw.uidFrom ? { senderId: raw.uidFrom } : {}),
    ...(fromName ? { fromName } : {}),
    text,
    ...(mentions ? { mentions } : {}),
    ts: Number.isFinite(ts) ? ts : Date.now(),
    ...(attachments.length ? { attachments } : {}),
    ...(quote ? { quote } : {}),
    // `cliMsgId` đi cùng mọi tin realtime. Không có nó thì không thả được cảm
    // xúc lên tin vừa nhận, vì Zalo đòi cả `gMsgID` lẫn `cMsgID`.
    ...(raw.cliMsgId && raw.cliMsgId !== '0' ? { cliMsgId: raw.cliMsgId } : {}),
  };
}

/**
 * Danh sách hội thoại: `getAllFriends` + `getAllGroups`→`getGroupInfo`.
 * Preview để trống vì zca-js không có API lấy tin cuối (xem §4 capabilities);
 * tin đầu tiên tới qua listener sẽ lấp vào.
 */
export function buildThreadsWithIds(
  friends: RawUser[], groups: RawGroupInfo[],
  pinned: string[], unreadUser: string[], unreadGroup: string[],
): BuiltThreads {
  const threads = buildThreads(friends, groups, pinned, unreadUser, unreadGroup);
  const globalIds = new Map<string, string>();
  const globalNames = new Map<string, string>();
  const groupMemberIds = new Map<string, string[]>();
  for (const friend of friends) {
    const name = (friend.displayName || friend.zaloName).trim().slice(0, 120);
    if (name) globalNames.set(friend.userId, name);
    // Bỏ giá trị rỗng và `"0"`: `"0"` là chỗ giữ của "chính mình" ở phía Zalo
    // PC (xem `Sync2` trong bundle), không phải id của một người.
    if (friend.globalId && friend.globalId !== '0') {
      globalIds.set(friend.globalId, friend.userId);
      if (name) globalNames.set(friend.globalId, name);
    }
  }
  for (const group of groups) {
    const memberIds = [...new Set([
      ...(group.memberIds ?? []),
      ...(group.members ?? []).map(member => member.id),
    ].filter(Boolean))];
    if (memberIds.length) groupMemberIds.set(group.groupId, memberIds);
    for (const member of group.members ?? []) {
      const name = (member.dName || member.zaloName).trim().slice(0, 120);
      if (name && !globalNames.has(member.id)) globalNames.set(member.id, name);
    }
  }
  // Nhóm cũng phải vào cùng bảng: `partition` của tin nhóm là
  // `group/<globalId nhóm>`, còn `threads` khoá bằng `groupId` số. Thiếu nửa
  // này thì tin nhóm rơi vào hội thoại ma tên "Nhóm Zalo" (đo 2026-11-10:
  // 35 nhóm, 81 619 tin nằm sai chỗ).
  for (const group of groups) {
    if (group.globalId && group.globalId !== '0') globalIds.set(group.globalId, group.groupId);
  }
  // Ảnh đại diện: **nguồn tải**, không phải giá trị hiển thị. Chỉ giữ URL https
  // mà main nhận sẽ tải; việc kiểm host nằm ở `avatars.parseAvatarUrl`, chỗ duy
  // nhất thật sự gọi mạng.
  const avatars = new Map<string, string>();
  for (const friend of friends) {
    if (friend.avatarSource) avatars.set(friend.userId, friend.avatarSource);
  }
  for (const group of groups) {
    if (group.avatarSource) avatars.set(group.groupId, group.avatarSource);
    for (const member of group.members ?? []) {
      if (member.avatarSource && !avatars.has(member.id)) avatars.set(member.id, member.avatarSource);
    }
  }
  return {
    threads, globalIds, globalNames, groupMemberIds, avatars,
    counts: { friends: friends.length, groups: groups.length, groupIds: globalIds.size },
  };
}

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

/**
 * Ghép sự kiện realtime vào danh sách: tạo thread nếu chưa có, cập nhật preview.
 *
 * `lastText` là **preview**, không phải `text`: tin chỉ có ảnh/tệp có `text`
 * rỗng, và danh sách hội thoại hiện một dòng trống cho đúng những tin người
 * dùng muốn thấy nhất. `StoreMessage` thoả kiểu này vì nó chỉ hẹp hơn
 * `LiveMessage` ở hình dạng `attachments`.
 */
export function applyMessage(
  threads: LiveThread[],
  message: Pick<LiveMessage, 'threadId' | 'kind' | 'from' | 'ts'> & {
    text: string; attachments?: { kind: AttachmentKind; title?: string }[];
  },
  activeId: string | null,
): LiveThread[] {
  const preview = previewOfMessage(message);
  const index = threads.findIndex(t => t.id === message.threadId && t.kind === message.kind);
  if (index < 0) {
    const created: LiveThread = {
      id: message.threadId, kind: message.kind,
      name: message.kind === 'group' ? 'Nhóm Zalo' : 'Người dùng Zalo',
      avatar: null, pinned: false, unread: 0, lastText: preview, lastTs: message.ts,
    };
    return [created, ...threads];
  }
  const current = threads[index];
  const next: LiveThread = {
    ...current,
    lastText: preview || current.lastText,
    lastTs: Math.max(current.lastTs, message.ts),
    unread: message.from === 'them' && message.threadId !== activeId ? current.unread + 1 : current.unread,
  };
  const rest = threads.filter((_, i) => i !== index);
  return [next, ...rest];
}
