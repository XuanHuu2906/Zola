/**
 * Chuyển `Sync2.Message.SyncChunk` sang model của repo.
 *
 * Thuần: không mạng, không DB, không zca-js. Nhờ vậy đây là chỗ kiểm chứng
 * được bằng byte khai báo — và cũng là chỗ dễ sai nhất, vì bốn thứ dưới đây
 * không hiển nhiên:
 *
 * 1. **`msgId` là `globalId`, không phải `clientId`.** `globalId` mới là id máy
 *    chủ cấp; `clientId` là id do thiết bị gửi sinh ra, trùng giữa hai thiết bị
 *    là chuyện có thể xảy ra. `LiveMessage.clientId` của repo mang đúng nghĩa
 *    "id tạm của thiết bị", nên đi vào `clientId`. Tin lịch sử không có
 *    `clientId` thì để `null`.
 * 2. **`from` suy từ `senderId` so với `ownId`**, không từ `msgStatus`.
 * 3. **`ts` là mili-giây** (`timestamp` của Sync2), khớp cột `ts` của DB, khớp
 *    `Date.now()`. Đổi sang giây ở đây sẽ làm tin lịch sử rơi xuống năm 1970
 *    sau khi chia đôi một lần nữa.
 * 4. **Phân vùng đặt tên `oneone/<id>` và `group/<id>`** — `SyncChunk` không
 *    mang cờ nhóm, nhưng tiền tố thì có. Phân vùng `metadata_...` bị bỏ: đó là
 *    bản ghi phiên, không phải tin.
 */
import type { LiveQuote, ThreadKind } from '../ipc-contract.js';
import type { StoreMessage } from './attachment.js';
import { mentionRangesOf } from './mentions.js';
import type { SyncChunk, SyncMessage, SyncQuote } from './sync-v2-proto.js';
import { attachmentsOf } from './attachment.js';

/** Một tin đã chuẩn hoá, kèm hội thoại nó thuộc về. */
export interface SyncedMessage {
  threadId: string;
  kind: ThreadKind;
  /**
   * `StoreMessage`, không phải `LiveMessage`: tệp đính kèm còn URL gốc của Zalo
   * ở đây, và main là nơi duy nhất được thấy URL đó (nó tải về đĩa). Ranh giới
   * bóc URL là `toIpcMessage` trong `attachment.ts`.
   */
  message: StoreMessage;
  /**
   * `senderId` đã so với `ownId` — **chỉ để chẩn đoán**, không ghi xuống DB.
   *
   * Tồn tại vì đo 2026-11-10: 81 624/81 626 tin trong cache có `from_me = 0`,
   * tức ta kết luận gần như mọi tin là của người khác. Hai giả thuyết dẫn tới
   * hai cách sửa khác hẳn nhau, và log hiện tại không phân biệt được:
   *
   * - `senderId` **rỗng** → gói tin không mang người gửi, phải lấy từ chỗ khác;
   * - `senderId` **có số nhưng khác `ownId`** → `ownId` ta dùng sai nguồn.
   *
   * Chỉ ghi **độ dài** và cờ khớp: chính `senderId` là id người dùng, ghi nguyên
   * giá trị vào log là đưa danh tính ra khỏi DB.
   */
  senderShape: { chars: number; isSelf: boolean };
}

/** Phân vùng không phải tin nhắn. */
const METADATA_PREFIX = 'metadata_';

/**
 * Nối không gian id nhiễu của Sync V2 về không gian uid của repo.
 *
 * Tồn tại vì Sync V2 **chỉ** nói bằng id nhiễu (`senderId`, `convId`,
 * `partition`), còn DB, `LiveThread` và mọi API khác của zca-js dùng uid số.
 * Zalo PC làm đúng việc này bằng `MessageTransformer` + `pcNoised2gNoisedMulti`
 * (tra theo lô qua máy chủ) và `resolveMyGlobalNoisedId` cho chính mình; ở đây
 * bảng ánh xạ đến từ `getAllFriends` (`profile.globalId`), tức cùng nguồn dữ
 * liệu nhưng không cần thêm lời gọi mạng.
 *
 * **Không tra được thì giữ nguyên id nhiễu**, không đoán: một hội thoại mang id
 * nhiễu vẫn hiện được tin, chỉ là tên sẽ là nhãn mặc định cho tới khi có
 * `globalId`; còn đoán bừa là gán tin của người này sang hội thoại người kia.
 */
export interface IdResolver {
  /** `globalId` → uid, hoặc `undefined` khi bảng chưa có người đó. */
  uidOf(globalId: string): string | undefined;
  /** Tên hiển thị đã biết của người gửi, nếu có trong danh sách liên hệ. */
  nameOf(senderId: string): string | undefined;
  /** `senderId` có phải của chính tài khoản đang đăng nhập không. */
  isSelf(senderId: string): boolean;
}

/** Bộ nối dựa trên bảng tĩnh; dùng cho test và cho đường chưa có bảng. */
export function makeIdResolver(input: {
  globalIds?: ReadonlyMap<string, string>;
  globalNames?: ReadonlyMap<string, string>;
  ownNoisedId?: string;
  /** Dự phòng khi thiếu `globalId`: so thẳng, đúng như hành vi cũ. */
  ownId?: string;
}): IdResolver {
  const ids = input.globalIds;
  return {
    uidOf: (globalId) => ids?.get(globalId),
    nameOf: (senderId) => input.globalNames?.get(senderId),
    isSelf: (senderId) => {
      if (senderId.length === 0) return false;
      if (input.ownNoisedId) return senderId === input.ownNoisedId;
      // Chưa biết id nhiễu của mình: so thẳng với uid. Sai không gian id nên
      // gần như luôn `false`, nhưng đó là hành vi cũ và không tệ hơn.
      return input.ownId ? senderId === input.ownId : false;
    },
  };
}

/** Tách `oneone/<id>` / `group/<id>` thành hội thoại. `null` nếu không nhận ra. */
export function parsePartition(partition: string): { threadId: string; kind: ThreadKind } | null {
  if (partition.startsWith(METADATA_PREFIX)) return null;
  const slash = partition.indexOf('/');
  if (slash <= 0 || slash === partition.length - 1) return null;
  const prefix = partition.slice(0, slash);
  const threadId = partition.slice(slash + 1);
  if (prefix === 'oneone') return { threadId, kind: 'user' };
  if (prefix === 'group') return { threadId, kind: 'group' };
  return null;
}

/**
 * Nội dung text của một tin lịch sử.
 *
 * Zalo đặt text thẳng trong `content`; ảnh/tệp/sticker để `content` rỗng và mô
 * tả nằm ở `meta.attachs`. Ở đây chỉ lấy text — không hàm nào tự dựng chuỗi thay
 * thế ("[Hình ảnh]") vì làm vậy là ghi vào DB một câu người dùng không hề gửi,
 * và lần đồng bộ sau nó sẽ thành nội dung thật. Tệp đi qua `attachmentsOf`.
 */
export function textOfSyncMessage(message: SyncMessage): string {
  return message.content.slice(0, 2000);
}

/**
 * Vì sao một tin bị bỏ. Chỉ còn **một** lý do: không có chữ **và** không có tệp.
 *
 * `'no-id'` từng là lý do thứ hai và đã bị bỏ 2026-11-11 — nó là nguyên nhân
 * làm mất 37 955 tin của chính chủ tài khoản mỗi lượt. Xem `localKey`.
 *
 * `'empty'` từng bao gồm cả tin ảnh/tệp, và đó là lý do toàn bộ phương tiện
 * trong lịch sử đồng bộ biến mất: 2026-11-11 đo được 0 hàng có `attachments`
 * trên 211 283 tin. Giờ `empty` chỉ còn nghĩa "không chữ, không tệp".
 */
export type SkipReason = 'empty';

export interface ChunkResult {
  messages: SyncedMessage[];
  /** Số tin bị bỏ, gộp mọi lý do. Giữ tên cũ để phía gọi không phải đổi hết. */
  skipped: number;
  /** Số **phân vùng** không tra được id nhiễu → id thật. */
  unresolved: number;
  /** Số tin bị bỏ theo từng lý do. */
  skipReasons: Record<SkipReason, number>;
  /** Số tin của chính mình đã bị bỏ, theo lý do — đây là chỗ "tin của tôi thiếu" ẩn. */
  selfSkipped: Record<SkipReason, number>;
  /**
   * Số tin thiếu `globalId` đã được **cấp khoá cục bộ** thay vì bỏ.
   *
   * Đây là cách chữa "tin của tôi thiếu": xem `localKey`.
   */
  locallyKeyed: number;
}

/**
 * Khoá cục bộ cho tin mà máy chủ **không** cấp `globalId`.
 *
 * Vì sao cần: đo 2026-11-11, Zalo PC trên cùng máy có 35 780 tin của chính chủ
 * tài khoản, còn DB của repo chỉ có 5 892 — và log đồng bộ cho thấy **37 955**
 * tin bị bỏ mỗi lượt vì `globalId === '0'`, trong đó **37 955/37 955 đều là tin
 * của mình**. `0` là chỗ giữ của "chính mình" trong Sync V2: tin do thiết bị
 * này gửi lên lịch sử không mang id máy chủ.
 *
 * Zalo PC không bỏ chúng: nó tự sinh khoá dạng `<id>_<000|001|002…>` cho đúng
 * 30 150 tin như vậy trong `ftsm_*.db`. Ở đây làm cùng nguyên tắc nhưng **tiền
 * định**: `syncv2:<ts>:<số thứ tự trong cùng giây>`. Chỉ đọc dữ kiện có sẵn
 * trong gói tin (không đụng DB), nên cùng một tin luôn ra cùng một khoá và
 * lượt đồng bộ lặp lại ghi vào **đúng dòng cũ** thay vì tạo bản sao.
 *
 * Vì sao không dùng `clientId`: đo trên 134 477 tin có mặt ở cả hai nơi,
 * `clientId` của ta **không** xuất hiện trong `msgKey` của Zalo PC (0/134 477) —
 * nó là id cục bộ của thiết bị gửi, không dùng chung được.
 *
 * Tiền tố `syncv2:` giữ khoá này **không thể đụng** id máy chủ (thuần chữ số),
 * nên không bao giờ ghi đè lên một tin thật.
 */
export function localKey(timestamp: string, ordinal: number): string {
  return `syncv2:${timestamp}:${ordinal}`;
}

/**
 * `msgId` do **máy chủ** cấp: chuỗi toàn chữ số.
 *
 * Sống cạnh `localKey` vì đây là hai nửa của cùng một quy tắc: khoá cục bộ chỉ
 * để **đọc** DB, không bao giờ được gửi lên máy chủ. Mọi chỗ đẩy `msgId` ra
 * ngoài (con trỏ `cmd 510`, `requestCloudPage`) phải lọc qua hàm này.
 *
 * Đo 2026-11-11 18:29: một khoá cục bộ lọt vào con trỏ phân trang, sinh ra
 * `history-cursor asked "syncv2:…"` rồi nổ `Cannot read properties of undefined
 * (reading 'map')` và treo mọi lần xin lịch sử.
 */
export function isServerMsgId(id: string | null): id is string {
  return !!id && /^[0-9]+$/.test(id);
}

const clientIdOf = (message: SyncMessage): string | null =>
  message.clientId && message.clientId !== '0' ? message.clientId : null;

/**
 * Chuyển một chunk thành danh sách tin đã chuẩn hoá.
 *
 * Tin không phải text bị **bỏ**, không phải ghi rỗng: `upsertMessages` coi
 * chuỗi rỗng là nội dung hợp lệ và sẽ tạo một bong bóng trống cho mỗi ảnh trong
 * lịch sử. Số tin bị bỏ được trả lại để phía gọi ghi log — im lặng bỏ qua sẽ
 * khiến "đồng bộ xong 0 tin" trông như một lỗi mạng.
 *
 * `resolve` nối hai không gian id: `partition` (`oneone/<id>`) và `senderId`
 * đều là id **nhiễu hoá**, còn DB của repo khoá hội thoại bằng uid số. Xem
 * `SyncedMessage.senderShape` để biết vì sao đây không phải chi tiết nhỏ.
 */
/**
 * `SyncQuote` của proto → `LiveQuote`.
 *
 * `ownerId` ở đây là id **nhiễu hoá** (cùng không gian với `senderId`), nên nó
 * không tự nói được "của mình hay của người khác"; `resolve.isSelf` mới là chỗ
 * biết. `fromD` là tên hiển thị Zalo gửi kèm và chỉ có nghĩa trong nhóm.
 */
function quoteOfSync(quote: SyncQuote | undefined, resolve: IdResolver): LiveQuote | undefined {
  if (!quote) return undefined;
  const text = quote.msg.replace(/\s+/g, ' ').trim().slice(0, 300);
  const attachmentKind = quote.attach
    ? attachmentsOf(quote.cliMsgType || 0, [{ type: quote.attach }])[0]?.kind
    : undefined;
  if (!text && !attachmentKind) return undefined;
  const msgId = quote.globalMsgId && quote.globalMsgId !== '0' ? quote.globalMsgId : null;
  const ts = Number(quote.ts);
  const fromName = quote.fromD.trim().slice(0, 120);
  return {
    msgId,
    from: quote.ownerId && resolve.isSelf(quote.ownerId) ? 'me' : 'them',
    text,
    ...(fromName ? { fromName } : {}),
    ...(attachmentKind ? { attachmentKind } : {}),
    ...(Number.isFinite(ts) && ts > 0 ? { ts } : {}),
  };
}

export function chunkToMessages(chunk: SyncChunk, resolve: IdResolver): ChunkResult {
  const messages: SyncedMessage[] = [];
  let skipped = 0;
  const skipReasons: Record<SkipReason, number> = { empty: 0 };
  const selfSkipped: Record<SkipReason, number> = { empty: 0 };
  let locallyKeyed = 0;
  // Số thứ tự trong **một** gói, theo `timestamp`. Cùng một tin luôn nằm trong
  // cùng gói (máy chủ gửi theo khoảng thời gian), nên cặp (gói, thứ tự) ổn định
  // giữa các lượt — xem `localKey`.
  const ordinals = new Map<string, number>();
  // Số **phân vùng** không tra được id nhiễu → id thật. Đây là con số duy nhất
  // trả lời được "còn tin nào rơi vào hội thoại ma không": `partition` trong log
  // là id gốc, nên nó giống nhau dù tin về đúng chỗ hay không.
  let unresolved = 0;

  for (const partition of chunk.partitions) {
    const target = parsePartition(partition.id);
    if (!target) {
      skipped += partition.messages.length;
      continue;
    }
    // Cả hai loại đều tra: `partition` giữ id nhiễu của người (hoặc nhóm), còn
    // `threads` khoá bằng uid/groupId số. Không tra được thì **giữ nguyên** id
    // nhiễu — xem `IdResolver`; tin vẫn về đúng chỗ cũ, chỉ là hội thoại đó
    // mang tên mặc định cho tới khi có `globalId`.
    const mapped = resolve.uidOf(target.threadId);
    if (mapped === undefined) unresolved += 1;
    const threadId = mapped ?? target.threadId;
    for (const message of partition.messages) {
      const text = textOfSyncMessage(message);
      // Tệp đính kèm **không** phải text. Chúng đi vào trường riêng, và sự tồn
      // tại của chúng là điều kiện thứ hai để tin được giữ — trước đây thiếu
      // điều kiện này nên mọi ảnh/tệp trong lịch sử bị đếm vào `empty` rồi bỏ.
      const attachments = attachmentsOf(message.msgType, message.meta?.attachs ?? []);
      // `globalId === '0'` không còn là lý do bỏ — xem `localKey`: tin đó là tin
      // của chính mình và Zalo PC vẫn giữ chúng bằng khoá tự sinh.
      if (!text.trim() && !attachments.length) {
        skipped += 1;
        skipReasons.empty += 1;
        if (resolve.isSelf(message.senderId)) selfSkipped.empty += 1;
        continue;
      }
      const isSelf = resolve.isSelf(message.senderId);
      const fromName = target.kind === 'group' && !isSelf
        ? resolve.nameOf(message.senderId)?.trim().slice(0, 120) : undefined;
      const ts = Number(message.timestamp);
      let msgId = message.globalId;
      if (msgId === '0' || msgId === '') {
        const ordinal = ordinals.get(message.timestamp) ?? 0;
        ordinals.set(message.timestamp, ordinal + 1);
        msgId = localKey(message.timestamp, ordinal);
        locallyKeyed += 1;
      }
      const quote = quoteOfSync(message.meta?.quote, resolve);
      const mentions = mentionRangesOf(message.meta?.mentions, text);
      const clientId = clientIdOf(message);
      messages.push({
        threadId,
        kind: target.kind,
        senderShape: { chars: message.senderId.length, isSelf },
        message: {
          threadId,
          kind: target.kind,
          msgId,
          clientId,
          // Cùng giá trị với `clientId`, và đó là chủ ý: Sync V2 gửi id máy khách
          // dưới dạng chuỗi thập phân, còn `addReaction` cần đúng con số đó ở
          // trường `cMsgID` để thả cảm xúc. `LiveMessage.clientId` mang nghĩa "id
          // tạm của thiết bị gửi" — đúng cùng một thứ, hai cái tên. Chỉ điền khi
          // thật sự có: `"0"` là chỗ giữ, không phải id.
          ...(clientId ? { cliMsgId: clientId } : {}),
          ...(message.senderId ? { senderId: message.senderId } : {}),
          from: isSelf ? 'me' : 'them',
          ...(fromName ? { fromName } : {}),
          text,
          ...(mentions ? { mentions } : {}),
          ts: Number.isFinite(ts) ? ts : Date.now(),
          // `src`/`thumb` bắt đầu bằng `null`: chưa có gì trên đĩa. Main tải về
          // sau, theo hàng đợi riêng, rồi phát lại tin với đường dẫn đã điền.
          ...(attachments.length ? { attachments: attachments.map(item => ({ ...item, src: null, thumb: null })) } : {}),
          // Trích dẫn: `meta.quote` đã được `readQuote` giải mã từ proto từ lâu,
          // nhưng chưa từng được ghi đi đâu — mọi tin trả lời trong lịch sử hiện
          // ra như tin thường.
          ...(quote ? { quote } : {}),
          // Đánh dấu ở đây, nơi duy nhất biết tin này đến từ lịch sử: renderer
          // dùng cờ để chèn theo thời điểm thay vì nối vào cuối hội thoại.
          backfill: true,
        },
      });
    }
  }

  return { messages, skipped, unresolved, skipReasons, selfSkipped, locallyKeyed };
}
