/**
 * Tệp đính kèm: `Sync2.Message.Attach` (đồng bộ điện thoại) và
 * `TAttachmentContent` của zca-js (tin realtime) đều là **cùng một hình dạng**
 * — mười hai trường chuỗi/số của `Attach` trong proto. File này là chỗ duy nhất
 * đổi hình dạng đó thành thứ repo dùng, nên ảnh đến từ hai đường khác nhau hiện
 * ra giống hệt nhau.
 *
 * Thuần: không mạng, không DB, không zca-js. `tests/attachment.test.ts` kiểm
 * được toàn bộ bảng phân loại bằng dữ liệu khai báo.
 *
 * ## Vì sao phải phân loại bằng `msgType` **số** trước
 *
 * `Attach.type` là một chuỗi, và chuỗi đó không phải lúc nào cũng có: bản ghi
 * đồng bộ từ điện thoại đôi khi để trống, còn tin realtime thì mang
 * `"chat.photo"`/`"share.file"`/… Trong bundle Zalo PC, chỗ duy nhất quyết định
 * cách đọc `attach` là `switch (msgType)` với enum `Ai` (`Text=0, Doodle=2,
 * Photo=3, Photo_V2=4, Voice=6, Sticker=10, Contact=12, OA=15, Location=18,
 * Video=19, ChatInfo=20, ECard=21, File=22, Gift=23, Webcontent=24,
 * VideoLive=25, Poll=26, PhotoV2=31, ChatDelete=33, Undo=36,
 * WebcontentV2=53`). Số đó **luôn** có mặt trên `SyncMessage`/`TMessage`, chuỗi
 * `type` thì không. Vì vậy số là nguồn chính, chuỗi chỉ là đường lùi.
 *
 * ## Hai hình dạng, một nguồn
 *
 * `StoredAttachment` là thứ nằm trong cột `messages.attachments` **và** là thứ
 * main dùng để tải nội dung: nó còn giữ URL gốc của Zalo (`remote`) cùng bản
 * `raw` để chẩn đoán. `LiveAttachment` (`ipc-contract`) là bản đi qua IPC: URL
 * của Zalo bị bóc ở `toIpc`, chỉ còn đường dẫn cục bộ `glass://app/media/…`.
 *
 * CSP của app là `default-src 'none'; img-src 'self' data:` (ADR-002), nên
 * renderer không vẽ được URL từ xa — và nếu thấy nó thì đó là một đích mạng do
 * renderer khởi phát. Cùng lý do với avatar (`electron/avatars.ts`).
 */
import type { LiveAttachment, LiveMessage } from '../ipc-contract.js';

/** Loại hiển thị. Mọi thứ không nhận ra rơi vào `other`, không bị bỏ. */
export type AttachmentKind =
  | 'photo' | 'video' | 'voice' | 'sticker' | 'doodle'
  | 'file' | 'link' | 'location' | 'contact' | 'gif' | 'other';

/** Hình dạng tối thiểu dùng chung cho `SyncAttach` và `TAttachmentContent`. */
export interface RawAttachment {
  type?: string;
  extInfo?: string;
  action?: string;
  params?: string;
  title?: string;
  href?: string;
  thumb?: string;
  description?: string;
  catId?: number;
  id?: number;
  childNumber?: number;
  remains?: string;
}

/**
 * Một tệp đính kèm như **được ghi xuống đĩa**.
 *
 * `remote`/`remoteThumb` là URL https trên CDN của Zalo; chúng không bao giờ ra
 * khỏi main. `src`/`thumb` là đường dẫn cục bộ, chỉ có sau khi tải xong — `null`
 * nghĩa là "chưa tải", không phải "không có".
 */
export interface StoredAttachment {
  kind: AttachmentKind;
  title?: string;
  description?: string;
  /** Đích của một liên kết (chỉ `kind === 'link'`). */
  url?: string;
  size?: number;
  /** Đuôi tệp, không có dấu chấm, chữ thường, tối đa 12 ký tự. */
  ext?: string;
  duration?: number;
  remote?: string;
  remoteThumb?: string;
  src?: string | null;
  thumb?: string | null;
  failed?: boolean;
  /** `Attach` gốc sau khi cắt, để lần sau đọc lại được mà không phải đồng bộ lại. */
  raw?: Record<string, string | number>;
}

/**
 * Một tin **trước khi qua IPC**: như `LiveMessage` nhưng `attachments` là bản
 * có URL gốc. Đây là kiểu của `StoreMessage` (db), của `SyncedMessage`, và của
 * mọi thứ chạy bên trong main.
 */
export type StoreMessage = Omit<LiveMessage, 'attachments'> & {
  attachments?: StoredAttachment[];
  /** UID or Sync V2 globalId; main-only metadata, removed before IPC. */
  senderId?: string;
};

/** `Attach` của proto có 12 trường; giữ đủ để chẩn đoán, cắt mỗi trường 512. */
const RAW_FIELDS = ['type', 'action', 'title', 'href', 'thumb', 'description', 'params', 'remains'] as const;

/** `Attach.type` → loại. Chuỗi này đến từ `je`/`ji` của bundle Zalo PC. */
const BY_TYPE: Record<string, AttachmentKind> = {
  'chat.photo': 'photo',
  'chat.video.msg': 'video',
  'chat.video.live.msg': 'video',
  'chat.voice': 'voice',
  'chat.sticker': 'sticker',
  'chat.doodle': 'doodle',
  'share.file': 'file',
  'chat.webcontent': 'link',
  'chat.webcontent.v2': 'link',
  'chat.location.new': 'location',
  'chat.recommended': 'contact',
  'chat.list.action': 'contact',
  'chat.gif': 'gif',
};

/** `Sync2.Shared.MsgType` của bundle (`Ai`). */
export function kindOfMsgType(msgType: number): AttachmentKind | null {
  switch (msgType) {
    case 2: return 'doodle';
    case 3: case 4: case 31: return 'photo';
    case 6: return 'voice';
    case 10: return 'sticker';
    case 12: return 'contact';
    case 18: return 'location';
    case 19: case 25: return 'video';
    case 22: return 'file';
    case 23: return 'gif';
    case 24: case 53: return 'link';
    default: return null;
  }
}

const clip = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text) return undefined;
  return text.length > max ? text.slice(0, max) : text;
};

export const ATTACH_TEXT_MAX = 512;
export const ATTACH_URL_MAX = 2048;

/**
 * Chỉ giữ URL https tuyệt đối. `http:` trượt vì mọi CDN của Zalo đều https, và
 * một URL `ftp:`/`file:` trong cột này sẽ thành một lời gọi `fetch` kỳ lạ ở tầng
 * tải xuống. Host **không** kiểm ở đây: hàm này thuần và không biết chính sách;
 * `media.parseMediaUrl` mới là chỗ quyết định host nào được tải.
 */
const httpsUrl = (value: unknown): string | undefined => {
  const text = clip(value, ATTACH_URL_MAX);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    return url.toString();
  } catch { return undefined; }
};

/** Đọc JSON mà không ném; `null` cho mọi thứ không phải object. */
function parseObject(text: unknown): Record<string, unknown> | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

/** Số nguyên dương từ number/chuỗi số; `undefined` cho mọi thứ khác. */
function positive(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

/**
 * Đuôi tệp, ưu tiên tên tệp rồi tới URL.
 *
 * Không dùng `path.extname`: hàm này chạy trong main và cũng được test bằng
 * node, nhưng một chuỗi `"báo cáo (1).PDF"` không phải đường dẫn — cắt theo dấu
 * chấm cuối là đủ và không phụ thuộc dấu phân cách thư mục của hệ điều hành.
 */
export function extensionOf(title?: string, url?: string): string | undefined {
  const fromName = title ? /\.([A-Za-z0-9]{1,12})$/.exec(title.trim()) : null;
  if (fromName) return fromName[1].toLowerCase();
  if (!url) return undefined;
  try {
    const fromUrl = /\.([A-Za-z0-9]{1,12})(?:$|[?#])/.exec(new URL(url).pathname);
    return fromUrl ? fromUrl[1].toLowerCase() : undefined;
  } catch { return undefined; }
}

/**
 * Tìm đích của một liên kết trong `params`.
 *
 * Zalo gói thẻ liên kết của Zalo PC (`zinstant`) vào `params` dạng
 * `{"pcItem":{…},"data":{…}}`, và bản WebcontentV2 để nguyên chuỗi trong
 * `zinstantData`. Ba hình dạng đã gặp, thử lần lượt; không hình dạng nào khớp
 * thì trả object rỗng chứ không đoán một chuỗi trông giống URL.
 */
export function linkOf(params: unknown): { url?: string; title?: string; description?: string; thumb?: string } {
  const root = parseObject(params);
  if (!root) return {};
  const layers: Record<string, unknown>[] = [root];
  const asObject = (value: unknown): Record<string, unknown> | null =>
    parseObject(value) ?? (value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown> : null);
  // `zinstant_data` là JSON lồng trong JSON, và bản thân nó cũng có thể bọc
  // trong một chuỗi nữa. Đi sâu tối đa hai tầng: quá nữa là dữ liệu lạ.
  for (const key of ['data', 'pcItem', 'item']) {
    const nested = asObject(root[key]);
    if (nested) layers.push(nested);
  }
  for (const layer of [...layers]) {
    const nested = asObject(layer.zinstant_data) ?? asObject(layer.zinstantData);
    if (nested) layers.push(nested);
  }
  let url: string | undefined;
  let title: string | undefined;
  let description: string | undefined;
  let thumb: string | undefined;
  for (const layer of layers) {
    url ??= httpsUrl(layer.href) ?? httpsUrl(layer.link) ?? httpsUrl(layer.url);
    title ??= clip(layer.title, ATTACH_TEXT_MAX);
    description ??= clip(layer.description, ATTACH_TEXT_MAX) ?? clip(layer.desc, ATTACH_TEXT_MAX);
    thumb ??= httpsUrl(layer.thumb) ?? httpsUrl(layer.thumbnail);
  }
  return { url, title, description, thumb };
}

/**
 * Một chuỗi tệp đính kèm → danh sách đã chuẩn hoá.
 *
 * `msgType` quyết định cách đọc `attach` (xem đầu file); `attaches` có thể có
 * nhiều phần tử (một album ảnh gửi cùng lúc) và mọi phần tử đều được giữ. Trả
 * mảng rỗng khi tin không mang tệp nào — và đó là tín hiệu cho phía gọi biết
 * tin này chỉ có chữ.
 */
export function attachmentsOf(
  msgType: number | string, attaches: readonly RawAttachment[],
): StoredAttachment[] {
  if (!attaches.length) return [];
  // **Hai không gian `msgType`, cùng một bảng.** Đường đồng bộ (Sync V2) nói
  // bằng số của enum `Ai`; đường realtime (zca-js) nói bằng **tên chuỗi**
  // (`"chat.photo"`, `"share.file"`) — đo 2026-11-11 trên một ảnh vào lúc app
  // đang mở: `msgType:"chat.photo"`. Ép `Number()` vào đó ra `NaN`/0, tức là
  // "tin chữ", và mọi ảnh realtime bị danh sách loại-trừ bên dưới nuốt mất.
  //
  // Vì vậy phân giải số **trước** (đường đồng bộ), rồi tới tên (realtime), rồi
  // mới tới danh sách loại-trừ — danh sách đó chỉ đúng cho không gian số.
  const byNumberSpace = typeof msgType === 'number' ? msgType
    : /^[0-9]+$/.test(msgType.trim()) ? Number(msgType) : null;
  const byNameSpace = typeof msgType === 'string' && !byNumberSpace ? msgType.trim() : null;
  if (byNumberSpace !== null
    && (byNumberSpace === 0 || byNumberSpace === 1 || byNumberSpace === 20
      || byNumberSpace === 33 || byNumberSpace === 36)) return [];
  // Tin chắc chắn **không** mang tệp, dù có `attach`: chữ định dạng (`rtf` của
  // `Text`), tin hệ thống, tin đã xoá, tin thu hồi. Nhận `attach` của chúng là
  // dựng một thẻ "Tệp đính kèm" cho một tin chỉ có chữ. `webchat` là tên của
  // chính tin chữ trong không gian realtime (`getClientMessageType("webchat")`
  // trả 1), nên nó thuộc cùng danh sách.
  if (byNameSpace === 'webchat') return [];
  const byNumber = byNumberSpace !== null ? kindOfMsgType(byNumberSpace)
    : byNameSpace ? BY_TYPE[byNameSpace] ?? null : null;
  const out: StoredAttachment[] = [];
  for (const attach of attaches) {
    // `type` (chuỗi) cụ thể hơn số khi cả hai cùng có: `chat.sticker` nói rõ
    // hơn "loại 10". Số là đường lùi vì nó luôn có mặt, chuỗi thì không.
    const byString = attach.type ? BY_TYPE[attach.type] : undefined;
    const kind = byString ?? byNumber;
    if (!kind) {
      // Loại chưa biết nhưng có nội dung để tải: giữ lại, để một loại mới của
      // Zalo hiện ra như một tệp thay vì biến mất khỏi hội thoại.
      if (!attach.href && !attach.params) continue;
      out.push(shape('other', attach, msgType));
      continue;
    }
    out.push(shape(kind, attach, msgType));
  }
  return out;
}

function shape(
  kind: AttachmentKind, attach: RawAttachment, msgType: number | string,
): StoredAttachment {
  const params = parseObject(attach.params);
  const title = clip(attach.title, ATTACH_TEXT_MAX) || clip(params?.fileName, ATTACH_TEXT_MAX) || clip(params?.filename, ATTACH_TEXT_MAX);
  const description = clip(attach.description, ATTACH_TEXT_MAX);
  const remote = httpsUrl(attach.href);
  const remoteThumb = httpsUrl(attach.thumb);
  // `Attach.childNumber` là **số con** của một gói gửi nhiều tệp (bắt đầu từ
  // 0), không phải kích thước. `catId` là danh mục, không dùng để hiển thị.
  const size = positive(params?.fileSize) ?? positive(params?.size) ?? positive(params?.totalSize);
  const duration = positive(params?.duration) ?? positive(params?.durationMs);
  const raw: Record<string, string | number> = { msgType };
  for (const field of RAW_FIELDS) {
    const value = clip(attach[field], ATTACH_TEXT_MAX);
    if (value) raw[field] = value;
  }
  if (typeof attach.catId === 'number') raw.catId = attach.catId;
  if (typeof attach.id === 'number') raw.id = attach.id;

  const attachment: StoredAttachment = { kind, raw, src: null, thumb: null };
  if (title) attachment.title = title;
  if (description) attachment.description = description;
  if (remote) attachment.remote = remote;
  if (remoteThumb) attachment.remoteThumb = remoteThumb;
  if (size) attachment.size = size;
  if (duration) attachment.duration = duration;

  if (kind === 'link') {
    const link = linkOf(attach.params);
    // Một thẻ liên kết không có `href` thì `params` là nguồn duy nhất; cả hai
    // đều trống thì vẫn giữ mục (kèm `raw`) để không mất một tin có nội dung.
    const url = remote ?? link.url;
    if (url) attachment.url = url;
    // Ảnh xem trước của liên kết là thứ duy nhất tải được cho loại này; trang
    // đích không bao giờ được mở (không có `connect-src`, không có trình duyệt).
    if (!attachment.remote && link.thumb) attachment.remoteThumb = link.thumb;
    if (!attachment.title && link.title) attachment.title = link.title;
    if (!attachment.description && link.description) attachment.description = link.description;
    if (!attachment.remoteThumb && link.thumb) attachment.remoteThumb = link.thumb;
    return attachment;
  }

  const ext = extensionOf(attachment.title, remote ?? remoteThumb)
    || (typeof params?.fileExt === 'string' ? params.fileExt.replace(/^\./, '').toLowerCase().match(/^[a-z0-9]{1,12}$/)?.[0] : undefined);
  if (ext) attachment.ext = ext;
  return attachment;
}

/** Nhãn hiển thị khi không có gì khác để nói. Không bao giờ ghi vào cột `text`. */
export const ATTACHMENT_LABELS: Record<AttachmentKind, string> = {
  photo: 'Hình ảnh', video: 'Video', voice: 'Tin nhắn thoại', sticker: 'Nhãn dán',
  doodle: 'Hình vẽ tay', file: 'Tệp đính kèm', link: 'Liên kết',
  location: 'Vị trí', contact: 'Danh thiếp', gif: 'Ảnh động', other: 'Tệp đính kèm',
};

/**
 * Dòng preview của một hội thoại trong danh sách.
 *
 * Trước đây mọi chỗ đẩy preview đều dùng thẳng `message.text`, và tin **chỉ** có
 * ảnh/tệp có `text` rỗng — nên danh sách hội thoại hiện một dòng trống cho đúng
 * loại tin mà người dùng muốn thấy nhất ("An: Hình ảnh"). Nhãn loại là câu trả
 * lời trung thực; tên tệp cụ thể còn tốt hơn khi có.
 *
 * Trả chuỗi rỗng khi tin không có gì để nói, để chỗ gọi còn dùng được
 * `|| chat.preview` và không xoá preview cũ bằng chuỗi rỗng.
 */
export function previewOfMessage(
  message: Pick<StoreMessage, 'text'> & { attachments?: { kind: AttachmentKind; title?: string }[] },
): string {
  const first = message.attachments?.[0];
  const text = message.text.replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, 90);
  if (!first) return '';
  return (first.title || ATTACHMENT_LABELS[first.kind]).slice(0, 90);
}

/**
 * Bản đi qua IPC: bóc `remote`/`remoteThumb`/`raw`, chỉ còn đường dẫn cục bộ.
 *
 * Đây là ranh giới duy nhất giữa "URL của Zalo" và renderer, nên nó là một hàm
 * chứ không phải một quy ước: mọi đường phát tin đều gọi nó, và test khẳng định
 * không chuỗi `http` nào sống sót.
 */
export function toIpcAttachments(items: readonly StoredAttachment[] | undefined): LiveAttachment[] | undefined {
  if (!items?.length) return undefined;
  return items.map(item => {
    const wire: LiveAttachment = {
      kind: item.kind,
      src: item.src ?? null,
      thumb: item.thumb ?? null,
    };
    if (item.failed) wire.failed = true;
    if (item.title) wire.title = item.title;
    if (item.description) wire.description = item.description;
    if (item.url) wire.url = item.url;
    if (item.size) wire.size = item.size;
    if (item.ext) wire.ext = item.ext;
    if (item.duration) wire.duration = item.duration;
    return wire;
  });
}

/** Một tin đã bóc URL xa, sẵn sàng cho `ev:messageUpsert`/`getMessages`. */
export function toIpcMessage(message: StoreMessage): LiveMessage {
  const { attachments, ...rest } = message;
  delete rest.senderId;
  const wire = toIpcAttachments(attachments);
  return wire ? { ...rest, attachments: wire } : rest;
}

/**
 * Dấu nhận dạng của một tệp đính kèm, **không** gồm đường dẫn cục bộ.
 *
 * Cần vì một lần đồng bộ lại mang `src: null` (mapper không biết gì về đĩa) cho
 * một tệp đã tải xong từ lần trước. So JSON nguyên khối sẽ thấy khác và coi tin
 * là "đã đổi", rồi ghi `null` đè lên đường dẫn — ảnh biến mất khỏi hội thoại dù
 * tệp vẫn nằm trên đĩa.
 */
function fingerprint(item: StoredAttachment): string {
  return [item.kind, item.remote ?? '', item.remoteThumb ?? '', item.url ?? '',
    item.title ?? '', item.description ?? '', item.size ?? '', item.ext ?? '', item.duration ?? ''].join('\u0001');
}

/**
 * Giữ `src`/`thumb` đã tải qua một lần đồng bộ lại.
 *
 * Ghép theo **vị trí**, có kiểm dấu nhận dạng: `attaches` của cùng một tin quay
 * lại theo đúng thứ tự, nên vị trí là khoá ổn định; còn nếu dấu lệch thì đây
 * không phải cùng một tệp và đường dẫn cũ chỉ vào sai nội dung — bỏ, không đoán.
 */
export function keepLocalPaths(
  incoming: readonly StoredAttachment[],
  stored: readonly StoredAttachment[] | undefined,
): StoredAttachment[] {
  if (!stored?.length) return incoming.map(item => ({ ...item }));
  return incoming.map((item, index) => {
    const previous = stored[index];
    if (!previous || previous.src == null || fingerprint(previous) !== fingerprint(item)) return { ...item };
    return { ...item, src: previous.src, thumb: previous.thumb ?? null };
  });
}
