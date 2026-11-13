/**
 * Bộ đọc `SyncChunk` của Sync V2 — protobuf thủ công, không phụ thuộc thư viện.
 *
 * Vì sao tự viết thay vì kéo `google-protobuf`: gói dữ liệu ở đây là **một**
 * message với cây con cố định, tám kiểu, tổng 47 trường. Bản `jspb` của Zalo là
 * 43 KB mã sinh tự động (`1y5R.js`) cộng runtime `hRO2` — cả hai chỉ để đọc một
 * hình dạng đã biết. Một bộ đọc 200 dòng thì test được bằng byte khai báo, và
 * không kéo thêm phụ thuộc vào main process.
 *
 * Định nghĩa lấy từ `1y5R.js` (proto `Sync2.Message.*`) và `Ho1Y.js`
 * (proto `Sync2.Conversation.*`):
 *
 * ```proto
 * message SyncChunk   { PlatformType platform = 1; repeated Partition partitions = 2; }
 * message Partition   { string id = 1; repeated Message messages = 2; }
 * message Message {
 *   string senderId = 1;  uint64 clientId = 2;  MessageStatus msgStatus = 3;
 *   int32  msgType  = 4;  uint64 timestamp = 5; int64 globalId = 6;
 *   string content  = 7;  MetaData meta = 8;
 * }
 * message MetaData {
 *   repeated Attach attachs = 1;  repeated Mention mentions = 2;
 *   Reference reference = 3;      Quote quote = 4;
 *   Properties property = 5;      uint64 ttl = 6;
 * }
 * ```
 *
 * `uint64`/`int64` được đọc bằng `BigInt` rồi trả **chuỗi thập phân**, không
 * trả `number`. `msgId` của Zalo vượt `Number.MAX_SAFE_INTEGER`; đổi sang
 * `number` sẽ làm tròn chữ số cuối và hai tin khác nhau thành cùng một id.
 */

/** `Sync2.Shared.PlatformType` — nguồn gửi gói dữ liệu. */
export const SyncPlatform = {
  UNSPECIFIED: 0,
  MOBILE: 1,
  WEB: 2,
  PC: 3,
  SYSTEM: 4,
} as const;

/** Một tệp đính kèm trong `MetaData`. Mọi trường là tuỳ chọn ở tầng proto. */
export interface SyncAttach {
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

/** Một lượt nhắc tên trong `MetaData`. */
export interface SyncMention {
  uid: string;
  pos: number;
  len: number;
  type: number;
}

/** Trích dẫn một tin khác. */
export interface SyncQuote {
  attach: string;
  ownerId: string;
  ts: string;
  fromD: string;
  cliMsgId: string;
  globalMsgId: string;
  msg: string;
  cliMsgType: number;
  ttl?: string;
  partialQuote?: boolean;
}

/** Tham chiếu tuỳ ý (dùng cho tin hệ thống). */
export interface SyncReference {
  type: number;
  data: string;
}

/** Thuộc tính hiển thị của tin. */
export interface SyncProperties {
  size?: number;
  color?: number;
  type?: number;
  subType?: number;
  ext?: string;
}

/** `MetaData` — mọi thứ ngoài text của một tin. */
export interface SyncMetaData {
  attachs: SyncAttach[];
  mentions: SyncMention[];
  reference?: SyncReference;
  quote?: SyncQuote;
  property?: SyncProperties;
  ttl?: string;
}

/** Một tin trong gói. */
export interface SyncMessage {
  senderId: string;
  /** `uint64` dạng chuỗi thập phân. */
  clientId: string;
  msgStatus: number;
  msgType: number;
  /** `uint64` mili-giây — giữ chuỗi vì lý do trên. */
  timestamp: string;
  /** `int64` dạng chuỗi thập phân; `"0"` khi vắng mặt. */
  globalId: string;
  content: string;
  meta?: SyncMetaData;
}

/** Một phân vùng dữ liệu: tên `oneone/<id>` hoặc `group/<id>`. */
export interface SyncPartition {
  id: string;
  messages: SyncMessage[];
}

/** Toàn bộ một gói đã giải nén. */
export interface SyncChunk {
  platform: number;
  partitions: SyncPartition[];
}

/** Lỗi định dạng: byte không phải protobuf hợp lệ theo schema trên. */
export class SyncProtoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncProtoError';
  }
}

/** Các kiểu dây của protobuf (wire type), đúng số trong đặc tả. */
const WIRE_VARINT = 0;
const WIRE_I64 = 1;
const WIRE_LEN = 2;
const WIRE_I32 = 5;

const LEN = WIRE_LEN;
const VARINT = WIRE_VARINT;

/** Một decoder dùng lại được: không streaming nên không giữ trạng thái. */
const UTF8 = new TextDecoder('utf-8', { fatal: true });

/**
 * Bộ đọc tuần tự trên một `Uint8Array`.
 *
 * Mọi `read*` đều kiểm tra biên trước khi đọc, để một gói hỏng gây
 * `SyncProtoError` chứ không gây đọc tràn bộ nhớ.
 */
class Reader {
  private offset = 0;
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  get done(): boolean {
    return this.offset >= this.bytes.length;
  }

  private ensure(count: number): void {
    if (this.offset + count > this.bytes.length) {
      throw new SyncProtoError(`hết dữ liệu: cần ${count} byte tại offset ${this.offset}`);
    }
  }

  /** `varint` 64-bit, trả `bigint` để không mất bit cao. */
  varint(): bigint {
    let result = 0n;
    let shift = 0n;
    for (let index = 0; index < 10; index += 1) {
      this.ensure(1);
      const byte = this.bytes[this.offset];
      this.offset += 1;
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7n;
    }
    throw new SyncProtoError('varint dài hơn 10 byte');
  }

  /** Mã trường + kiểu dây, đóng gói trong một `varint`. */
  tag(): { field: number; wire: number } {
    const raw = this.varint();
    return { field: Number(raw >> 3n), wire: Number(raw & 7n) };
  }

  bytesOfLength(length: number): Uint8Array {
    this.ensure(length);
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  lengthDelimited(): Uint8Array {
    return this.bytesOfLength(Number(this.varint()));
  }

  string(): string {
    const raw = this.lengthDelimited();
    try {
      return UTF8.decode(raw);
    } catch {
      throw new SyncProtoError('chuỗi không phải UTF-8 hợp lệ');
    }
  }

  /** `uint64`/`uint32` thành chuỗi thập phân. */
  uint64String(): string {
    return this.varint().toString(10);
  }

  /** `int64` hai bù thành chuỗi thập phân. */
  int64String(): string {
    return BigInt.asIntN(64, this.varint()).toString(10);
  }

  /** Số nhỏ, an toàn để trả `number`: `int32`/`enum`/`uint32`. */
  number(): number {
    return Number(BigInt.asIntN(64, this.varint()));
  }

  bool(): boolean {
    return this.varint() !== 0n;
  }

  /** Bỏ qua một trường chưa biết — bắt buộc để gói mới hơn vẫn đọc được. */
  skip(wire: number): void {
    switch (wire) {
      case WIRE_VARINT: this.varint(); return;
      case WIRE_I64: this.ensure(8); this.offset += 8; return;
      case WIRE_LEN: this.lengthDelimited(); return;
      case WIRE_I32: this.ensure(4); this.offset += 4; return;
      default: throw new SyncProtoError(`kiểu dây không hỗ trợ: ${wire}`);
    }
  }
}

/**
 * Đọc lặp các trường của một message con.
 *
 * `onField` trả `false` nghĩa là "đã xử lý"; trả `true` nghĩa là "bỏ qua".
 * Mỗi `case` tự kiểm tra kiểu dây trước khi đọc: gặp sai kiểu thì bỏ qua thay
 * vì đọc nhầm — một trường `string` đọc bằng `number()` sẽ nuốt nhầm độ dài và
 * làm lệch toàn bộ phần còn lại của message.
 */
function readFields(bytes: Uint8Array, onField: (field: number, wire: number, reader: Reader) => boolean): void {
  const reader = new Reader(bytes);
  while (!reader.done) {
    const { field, wire } = reader.tag();
    if (onField(field, wire, reader)) reader.skip(wire);
  }
}

const readAttach = (bytes: Uint8Array): SyncAttach => {
  const attach: SyncAttach = {};
  readFields(bytes, (field, wire, reader) => {
    switch (field) {
      case 1: if (wire !== LEN) return true; attach.type = reader.string(); return false;
      case 2: if (wire !== LEN) return true; attach.extInfo = reader.string(); return false;
      case 3: if (wire !== LEN) return true; attach.action = reader.string(); return false;
      case 4: if (wire !== LEN) return true; attach.params = reader.string(); return false;
      case 5: if (wire !== LEN) return true; attach.title = reader.string(); return false;
      case 6: if (wire !== LEN) return true; attach.href = reader.string(); return false;
      case 7: if (wire !== LEN) return true; attach.thumb = reader.string(); return false;
      case 8: if (wire !== LEN) return true; attach.description = reader.string(); return false;
      case 9: if (wire !== VARINT) return true; attach.catId = reader.number(); return false;
      case 10: if (wire !== VARINT) return true; attach.id = reader.number(); return false;
      case 11: if (wire !== VARINT) return true; attach.childNumber = reader.number(); return false;
      case 12: if (wire !== LEN) return true; attach.remains = reader.string(); return false;
      default: return true;
    }
  });
  return attach;
};

const readMention = (bytes: Uint8Array): SyncMention => {
  const mention: SyncMention = { uid: '', pos: 0, len: 0, type: 0 };
  readFields(bytes, (field, wire, reader) => {
    switch (field) {
      case 1: if (wire !== LEN) return true; mention.uid = reader.string(); return false;
      case 2: if (wire !== VARINT) return true; mention.pos = reader.number(); return false;
      case 3: if (wire !== VARINT) return true; mention.len = reader.number(); return false;
      case 4: if (wire !== VARINT) return true; mention.type = reader.number(); return false;
      default: return true;
    }
  });
  return mention;
};

const readReference = (bytes: Uint8Array): SyncReference => {
  const reference: SyncReference = { type: 0, data: '' };
  readFields(bytes, (field, wire, reader) => {
    switch (field) {
      case 1: if (wire !== VARINT) return true; reference.type = reader.number(); return false;
      case 2: if (wire !== LEN) return true; reference.data = reader.string(); return false;
      default: return true;
    }
  });
  return reference;
};

const readQuote = (bytes: Uint8Array): SyncQuote => {
  const quote: SyncQuote = {
    attach: '', ownerId: '', ts: '0', fromD: '', cliMsgId: '0',
    globalMsgId: '0', msg: '', cliMsgType: 0,
  };
  readFields(bytes, (field, wire, reader) => {
    switch (field) {
      case 1: if (wire !== LEN) return true; quote.attach = reader.string(); return false;
      case 2: if (wire !== LEN) return true; quote.ownerId = reader.string(); return false;
      case 3: if (wire !== VARINT) return true; quote.ts = reader.uint64String(); return false;
      case 4: if (wire !== LEN) return true; quote.fromD = reader.string(); return false;
      case 5: if (wire !== VARINT) return true; quote.cliMsgId = reader.uint64String(); return false;
      case 6: if (wire !== VARINT) return true; quote.globalMsgId = reader.int64String(); return false;
      case 7: if (wire !== LEN) return true; quote.msg = reader.string(); return false;
      case 8: if (wire !== VARINT) return true; quote.cliMsgType = reader.number(); return false;
      case 9: if (wire !== VARINT) return true; quote.ttl = reader.uint64String(); return false;
      case 10: if (wire !== VARINT) return true; quote.partialQuote = reader.bool(); return false;
      default: return true;
    }
  });
  return quote;
};

const readProperties = (bytes: Uint8Array): SyncProperties => {
  const property: SyncProperties = {};
  readFields(bytes, (field, wire, reader) => {
    switch (field) {
      case 1: if (wire !== VARINT) return true; property.size = reader.number(); return false;
      case 2: if (wire !== VARINT) return true; property.color = reader.number(); return false;
      case 3: if (wire !== VARINT) return true; property.type = reader.number(); return false;
      case 4: if (wire !== VARINT) return true; property.subType = reader.number(); return false;
      case 5: if (wire !== LEN) return true; property.ext = reader.string(); return false;
      default: return true;
    }
  });
  return property;
};

const readMetaData = (bytes: Uint8Array): SyncMetaData => {
  const meta: SyncMetaData = { attachs: [], mentions: [] };
  readFields(bytes, (field, wire, reader) => {
    switch (field) {
      case 1: if (wire !== LEN) return true; meta.attachs.push(readAttach(reader.lengthDelimited())); return false;
      case 2: if (wire !== LEN) return true; meta.mentions.push(readMention(reader.lengthDelimited())); return false;
      case 3: if (wire !== LEN) return true; meta.reference = readReference(reader.lengthDelimited()); return false;
      case 4: if (wire !== LEN) return true; meta.quote = readQuote(reader.lengthDelimited()); return false;
      case 5: if (wire !== LEN) return true; meta.property = readProperties(reader.lengthDelimited()); return false;
      case 6: if (wire !== VARINT) return true; meta.ttl = reader.uint64String(); return false;
      default: return true;
    }
  });
  return meta;
};

const readMessage = (bytes: Uint8Array): SyncMessage => {
  const message: SyncMessage = {
    senderId: '', clientId: '0', msgStatus: 0, msgType: 0,
    timestamp: '0', globalId: '0', content: '',
  };
  readFields(bytes, (field, wire, reader) => {
    switch (field) {
      case 1: if (wire !== LEN) return true; message.senderId = reader.string(); return false;
      case 2: if (wire !== VARINT) return true; message.clientId = reader.uint64String(); return false;
      case 3: if (wire !== VARINT) return true; message.msgStatus = reader.number(); return false;
      case 4: if (wire !== VARINT) return true; message.msgType = reader.number(); return false;
      case 5: if (wire !== VARINT) return true; message.timestamp = reader.uint64String(); return false;
      case 6: if (wire !== VARINT) return true; message.globalId = reader.int64String(); return false;
      case 7: if (wire !== LEN) return true; message.content = reader.string(); return false;
      case 8: if (wire !== LEN) return true; message.meta = readMetaData(reader.lengthDelimited()); return false;
      default: return true;
    }
  });
  return message;
};

const readPartition = (bytes: Uint8Array): SyncPartition => {
  const partition: SyncPartition = { id: '', messages: [] };
  readFields(bytes, (field, wire, reader) => {
    switch (field) {
      case 1: if (wire !== LEN) return true; partition.id = reader.string(); return false;
      case 2: if (wire !== LEN) return true; partition.messages.push(readMessage(reader.lengthDelimited())); return false;
      default: return true;
    }
  });
  return partition;
};

/**
 * Đọc một `SyncChunk` từ byte protobuf.
 *
 * Ném `SyncProtoError` khi byte không khớp schema. Không bao giờ trả nửa vời:
 * hoặc là chunk đầy đủ, hoặc là lỗi.
 */
export function decodeSyncChunk(bytes: Uint8Array): SyncChunk {
  const chunk: SyncChunk = { platform: 0, partitions: [] };
  readFields(bytes, (field, wire, reader) => {
    switch (field) {
      case 1: if (wire !== VARINT) return true; chunk.platform = reader.number(); return false;
      case 2: if (wire !== LEN) return true; chunk.partitions.push(readPartition(reader.lengthDelimited())); return false;
      default: return true;
    }
  });
  return chunk;
}

/** Một hội thoại trong gói `conversation` — dùng khi muốn lấy danh sách trước. */
export interface SyncConversation {
  convId: string;
  convType: number;
  respondedByMe: boolean;
  lastTs: string;
  lastGlobalId: string;
  lastClientId: string;
}

const readConversation = (bytes: Uint8Array): SyncConversation => {
  const conversation: SyncConversation = {
    convId: '', convType: 0, respondedByMe: false, lastTs: '0', lastGlobalId: '0', lastClientId: '0',
  };
  readFields(bytes, (field, wire, reader) => {
    switch (field) {
      case 1: if (wire !== LEN) return true; conversation.convId = reader.string(); return false;
      case 2: if (wire !== VARINT) return true; conversation.convType = reader.number(); return false;
      case 3: if (wire !== VARINT) return true; conversation.respondedByMe = reader.bool(); return false;
      case 4: if (wire !== VARINT) return true; conversation.lastTs = reader.uint64String(); return false;
      case 5: if (wire !== VARINT) return true; conversation.lastGlobalId = reader.int64String(); return false;
      case 6: if (wire !== VARINT) return true; conversation.lastClientId = reader.uint64String(); return false;
      default: return true;
    }
  });
  return conversation;
};

/** Một gói của database `conversation`. */
export interface SyncConversationChunk {
  platform: number;
  conversations: SyncConversation[];
}

/** Đọc một `Sync2.Conversation.SyncChunk`. */
export function decodeConversationChunk(bytes: Uint8Array): SyncConversationChunk {
  const chunk: SyncConversationChunk = { platform: 0, conversations: [] };
  readFields(bytes, (field, wire, reader) => {
    switch (field) {
      case 1: if (wire !== VARINT) return true; chunk.platform = reader.number(); return false;
      case 2: if (wire !== LEN) return true; chunk.conversations.push(readConversation(reader.lengthDelimited())); return false;
      default: return true;
    }
  });
  return chunk;
}
