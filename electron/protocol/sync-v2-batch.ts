/**
 * Đọc một gói dữ liệu Sync V2: tách khung → giải mã → giải nén → protobuf.
 *
 * Một "batch" mà điện thoại gửi lên không phải một file protobuf. Nó là một
 * chuỗi bản ghi nối tiếp nhau, mỗi bản ghi:
 *
 * ```text
 * [độ dài: uint32 LE][khối mã hoá: đúng độ dài đó byte]
 * ```
 *
 * Mỗi khối mã hoá mở ra **một** khung zstd, và mỗi khung zstd nở ra **một**
 * `SyncChunk`. Vì vậy số bản ghi trong file bằng số chunk importer sẽ nhận —
 * một file 5 MB có thể là 40 tin hoặc 4.000 tin.
 *
 * Vì sao không gộp: Zalo tách như vậy để ghi từng khối xuống đĩa và giải nén
 * theo luồng, không phải giữ cả file trong RAM. Ở đây file đã nằm trong RAM
 * (tải bằng `fetch`), nên đọc tuần tự là đủ và vẫn giữ được biên bộ nhớ thấp.
 *
 * Hai loại gói, khác nhau ở khoá dùng để giải mã:
 *
 * - `MetadataEmbedded` (2): khoá là **khoá tạm của phiên** (`ek.privateKey`).
 *   Đây là gói mang bản ghi phiên, cả chuỗi sau phụ thuộc vào nó.
 * - `Message` (1): khoá là **bản ghi phiên** mà gói metadata vừa mở ra.
 */

import { zstdDecompressSync } from 'node:zlib';
import type { SyncV2Crypto } from './sync-v2-crypto.js';
import {
  decodeConversationChunk, decodeSyncChunk, SyncProtoError,
  type SyncChunk, type SyncConversationChunk,
} from './sync-v2-proto.js';

/** `PL82.a` — loại gói trong một batch. */
export const SyncBatchType = {
  MESSAGE: 1,
  METADATA_EMBEDDED: 2,
} as const;

/** Lỗi khi đọc gói: khung hỏng, giải mã hỏng, zstd hỏng, hoặc protobuf hỏng. */
export class SyncBatchError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SyncBatchError';
  }
}

/**
 * Tách một file batch thành các khối mã hoá.
 *
 * Không chấp nhận byte thừa: một file có đuôi lạc là file hỏng, và im lặng bỏ
 * qua phần thừa sẽ che mất lỗi truyền tải.
 */
export function splitBatchRecords(bytes: Uint8Array): Uint8Array[] {
  const records: Uint8Array[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + 4 > bytes.length) {
      throw new SyncBatchError(`bản ghi tại offset ${offset} thiếu 4 byte độ dài`);
    }
    const length = view.getUint32(offset, true);
    const start = offset + 4;
    if (start + length > bytes.length) {
      throw new SyncBatchError(
        `bản ghi tại offset ${offset} khai báo ${length} byte nhưng chỉ còn ${bytes.length - start}`,
      );
    }
    records.push(bytes.subarray(start, start + length));
    offset = start + length;
  }
  return records;
}

/** Khoá để giải mã một batch metadata. */
export interface MetadataBatchKey {
  kind: 'metadata';
  /** Khoá định danh của PC — cặp sống lâu, dùng lại qua các phiên. */
  identityPublicKey: Uint8Array;
  identityPrivateKey: Uint8Array;
  /** Khoá tạm của **phiên này**; bỏ đi sau khi phiên xong. */
  ephemeralPrivateKey: Uint8Array;
}

/** Khoá để giải mã một batch tin nhắn. */
export interface MessageBatchKey {
  kind: 'session';
  /** Bản ghi phiên do gói metadata đầu tiên sinh ra. */
  sessionRecord: Uint8Array;
}

export type BatchKey = MetadataBatchKey | MessageBatchKey;

/** Kết quả đọc một batch. */
export interface DecodedBatch {
  /** Các chunk theo thứ tự trong file. */
  chunks: SyncChunk[];
  /** Số bản ghi đã đọc — đối chiếu được với số khối máy chủ báo. */
  recordCount: number;
}

/** Kết quả đọc một batch metadata: có thêm bản ghi phiên. */
export interface DecodedMetadataBatch extends DecodedBatch {
  /**
   * Bản ghi phiên để giải mã các gói tin tiếp theo.
   *
   * Chỉ lấy từ bản ghi **đầu**: mọi bản ghi trong cùng batch sinh ra cùng một
   * bản ghi phiên (cùng khoá tạm, cùng hai bên), nhưng nếu batch rỗng thì không
   * có gì để lấy — trường hợp đó là lỗi, không phải "phiên chưa có khoá".
   */
  sessionRecord: Uint8Array;
}

/** Kết quả đọc một batch của database `conversation`. */
export interface DecodedConversationBatch {
  /** Các gói hội thoại theo thứ tự trong file. */
  chunks: SyncConversationChunk[];
  recordCount: number;
}

/** Kết quả đọc một batch metadata của database `conversation`. */
export interface DecodedConversationMetadataBatch extends DecodedConversationBatch {
  sessionRecord: Uint8Array;
}

/**
 * Một bản ghi đã mở khoá: zstd rồi protobuf, và protobuf ấy là **loại nào** thì
 * do database đang xin quyết định.
 *
 * `Message` và `Conversation` dùng chung phong bì, chung khoá, chung
 * `MetadataEmbedded`/`Message` — chỉ khác schema của thân. Vì vậy chọn bộ đọc
 * là tham số, không phải một nhánh thứ hai của cả ống dẫn.
 */
export type ChunkReader<C> = (plain: Uint8Array) => C;

/**
 * Đọc một batch metadata.
 *
 * Tách riêng khỏi `decodeMessageBatch` vì đây là bước mở khoá: nó cần ba khoá
 * và **sinh ra** khoá cho các bước sau, thay vì chỉ tiêu thụ một khoá.
 */
export function decodeMetadataBatch(
  bytes: Uint8Array,
  crypto: SyncV2Crypto,
  key: Omit<MetadataBatchKey, 'kind'>,
  readChunk: ChunkReader<SyncChunk> = decodeSyncChunk,
): DecodedMetadataBatch {
  const { plains, sessionRecord } = decryptMetadataRecords(bytes, crypto, key);
  return {
    chunks: plains.map((plain, index) => decodeRecord(plain, index, plains.length, readChunk)),
    recordCount: plains.length,
    sessionRecord,
  };
}

/**
 * Đọc một batch tin nhắn.
 *
 * Không sinh khoá: bản ghi phiên phải đến từ `decodeMetadataBatch` của cùng
 * phiên. Sai bản ghi phiên sẽ hỏng bằng `aead::Error` ở bản ghi đầu tiên.
 */
export function decodeMessageBatch(
  bytes: Uint8Array,
  crypto: SyncV2Crypto,
  sessionRecord: Uint8Array,
  readChunk: ChunkReader<SyncChunk> = decodeSyncChunk,
): DecodedBatch {
  const plains = decryptMessageRecords(bytes, crypto, sessionRecord);
  return {
    chunks: plains.map((plain, index) => decodeRecord(plain, index, plains.length, readChunk)),
    recordCount: plains.length,
  };
}

/**
 * Đọc batch metadata của database `conversation`.
 *
 * Cùng phong bì và cùng khoá với `decodeMetadataBatch`; khác duy nhất ở thân
 * bản ghi. Tách hàm thay vì tham số hoá để cả hai phía giữ kiểu cụ thể — một
 * `SyncConversationChunk` không lọt được vào đường tin nhắn và ngược lại.
 */
export function decodeConversationMetadataBatch(
  bytes: Uint8Array,
  crypto: SyncV2Crypto,
  key: Omit<MetadataBatchKey, 'kind'>,
): DecodedConversationMetadataBatch {
  const { plains, sessionRecord } = decryptMetadataRecords(bytes, crypto, key);
  return {
    chunks: plains.map((plain, index) => decodeRecord(plain, index, plains.length, decodeConversationChunk)),
    recordCount: plains.length,
    sessionRecord,
  };
}

/** Đọc batch `conversation` thường (khoá là bản ghi phiên đã có). */
export function decodeConversationBatch(
  bytes: Uint8Array,
  crypto: SyncV2Crypto,
  sessionRecord: Uint8Array,
): DecodedConversationBatch {
  const plains = decryptMessageRecords(bytes, crypto, sessionRecord);
  return {
    chunks: plains.map((plain, index) => decodeRecord(plain, index, plains.length, decodeConversationChunk)),
    recordCount: plains.length,
  };
}

/**
 * Mở khoá mọi bản ghi của một batch metadata.
 *
 * Bản ghi đầu tiên định nghĩa phiên; các bản ghi sau dùng lại đúng bản ghi đó,
 * nên chỉ lấy của bản ghi 0 (khớp `resolve` một lần của Zalo).
 */
function decryptMetadataRecords(
  bytes: Uint8Array,
  crypto: SyncV2Crypto,
  key: Omit<MetadataBatchKey, 'kind'>,
): { plains: Uint8Array[]; sessionRecord: Uint8Array } {
  const records = splitBatchRecords(bytes);
  if (records.length === 0) {
    throw new SyncBatchError('batch metadata rỗng: không có bản ghi phiên để mở khoá');
  }

  const plains: Uint8Array[] = [];
  let sessionRecord: Uint8Array | null = null;
  for (let index = 0; index < records.length; index += 1) {
    let opened;
    try {
      opened = crypto.decryptMetadata(
        records[index],
        key.identityPublicKey,
        key.identityPrivateKey,
        key.ephemeralPrivateKey,
      );
    } catch (error) {
      throw new SyncBatchError(`giải mã metadata bản ghi ${index}/${records.length} hỏng`, { cause: error });
    }
    if (index === 0) sessionRecord = opened.sessionRecord;
    plains.push(opened.plaintext);
  }

  if (!sessionRecord) {
    throw new SyncBatchError('batch metadata không sinh ra bản ghi phiên');
  }
  return { plains, sessionRecord };
}

/** Mở khoá mọi bản ghi của một batch thường bằng bản ghi phiên. */
function decryptMessageRecords(
  bytes: Uint8Array,
  crypto: SyncV2Crypto,
  sessionRecord: Uint8Array,
): Uint8Array[] {
  const records = splitBatchRecords(bytes);
  const plains: Uint8Array[] = [];
  for (let index = 0; index < records.length; index += 1) {
    try {
      plains.push(crypto.decryptMessage(records[index], sessionRecord).plaintext);
    } catch (error) {
      throw new SyncBatchError(`giải mã tin bản ghi ${index}/${records.length} hỏng`, { cause: error });
    }
  }
  return plains;
}

/** Một bản ghi: zstd, rồi một trong hai schema protobuf. */
function decodeRecord<C>(
  compressed: Uint8Array, index: number, total: number, readChunk: ChunkReader<C>,
): C {
  let plain: Uint8Array;
  try {
    plain = new Uint8Array(zstdDecompressSync(compressed));
  } catch (error) {
    throw new SyncBatchError(`giải nén bản ghi ${index}/${total} hỏng`, { cause: error });
  }
  try {
    return readChunk(plain);
  } catch (error) {
    if (error instanceof SyncProtoError) {
      throw new SyncBatchError(`protobuf của bản ghi ${index}/${total} hỏng: ${error.message}`, { cause: error });
    }
    throw error;
  }
}
