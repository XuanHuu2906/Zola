import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { zstdCompressSync } from 'node:zlib';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && specifier.endsWith('.js')) {
      try {
        return nextResolve(specifier.replace(/\.js$/, '.ts'), context);
      } catch {
        // Không có bản `.ts`: giữ nguyên đường dẫn gốc.
      }
    }
    return nextResolve(specifier, context);
  },
});

const { SyncV2Crypto } = await import('../electron/protocol/sync-v2-crypto.ts');
const {
  splitBatchRecords, decodeMessageBatch, decodeMetadataBatch, SyncBatchError,
  decodeConversationBatch, decodeConversationMetadataBatch,
} = await import('../electron/protocol/sync-v2-batch.ts');

/**
 * Khung gói và chuỗi giải mã — kiểm chứng bằng cách **dựng lại đúng định dạng
 * mà điện thoại gửi lên**: một file gồm nhiều bản ghi `[uint32 LE][khối mã
 * hoá]`, mỗi khối là protobuf → zstd → mã hoá.
 *
 * Đây là thứ duy nhất kiểm chứng được mà không cần máy chủ Zalo: nếu bộ tách
 * khung lệch một byte, hoặc đảo thứ tự zstd/mã hoá, test sẽ hỏng ở đây chứ
 * không hỏng lúc đang chạy với tài khoản thật.
 */

const WASM = new URL('../assets/zproto/libzproto_wasm_bg.5ea0fb2c9af4a45bc7882b71307b6f83.wasm', import.meta.url);
const cryptoPromise = SyncV2Crypto.load(new Uint8Array(readFileSync(WASM)));

// ---------------------------------------------------------------- dựng protobuf

const te = new TextEncoder();

function varint(value: bigint): number[] {
  const out: number[] = [];
  let rest = value;
  do {
    let byte = Number(rest & 0x7fn);
    rest >>= 7n;
    if (rest > 0n) byte |= 0x80;
    out.push(byte);
  } while (rest > 0n);
  return out;
}

const tag = (field: number, wire: number): number[] => varint(BigInt((field << 3) | wire));

function fieldBytes(field: number, payload: number[]): number[] {
  return [...tag(field, 2), ...varint(BigInt(payload.length)), ...payload];
}

const fieldString = (field: number, value: string): number[] =>
  fieldBytes(field, [...te.encode(value)]);

const fieldVarint = (field: number, value: bigint): number[] =>
  [...tag(field, 0), ...varint(value)];

const concat = (...parts: number[][]): number[] => parts.flat();

/** Một chunk có một phân vùng, mỗi tin chỉ có người gửi + nội dung. */
const messageChunk = (partition: string, contents: string[]): Uint8Array => {
  const messages = contents.map((content) => fieldBytes(2, concat(
    fieldString(1, 'sender-1'),
    fieldString(7, content),
  )));
  return new Uint8Array(concat(
    fieldBytes(2, concat(fieldString(1, partition), ...messages)),
  ));
};

/** Đóng gói một danh sách chunk thành file batch: zstd → mã hoá → khung. */
function buildBatch(chunks: Uint8Array[], seal: (compressed: Uint8Array) => Uint8Array): Uint8Array {
  const out: number[] = [];
  for (const chunk of chunks) {
    const ciphertext = seal(new Uint8Array(zstdCompressSync(chunk)));
    const length = ciphertext.length;
    out.push(length & 0xff, (length >>> 8) & 0xff, (length >>> 16) & 0xff, (length >>> 24) & 0xff);
    out.push(...ciphertext);
  }
  return new Uint8Array(out);
}

/**
 * Dựng một phiên hai đầu: PC (định danh + tạm) và điện thoại.
 *
 * Mỗi lần gọi `createMetadataCipher` sinh **một phiên riêng** (khoá đối xứng
 * tạm + bản ghi phiên của riêng lần đó), không phải một phiên theo cặp khoá.
 * Vì vậy test nào cần "dùng lại phiên" phải bắt lấy bản ghi từ chính lần niêm
 * phong đã cho ra file — không được dựng thêm lần thứ hai rồi so.
 */
async function setup() {
  const crypto = await cryptoPromise;
  const pcIdentity = crypto.generateKeyPair();
  const pcEphemeral = crypto.generateKeyPair();
  const phoneIdentity = crypto.generateKeyPair();

  /** Niêm phong phần đã nén, đúng thứ tự phía điện thoại làm. */
  const seal = (compressed: Uint8Array) => crypto.createMetadataCipher(
    compressed,
    phoneIdentity.publicKey, phoneIdentity.privateKey,
    pcIdentity.publicKey, pcEphemeral.publicKey,
  );

  const seeded = seal(new Uint8Array(zstdCompressSync(
    new Uint8Array(concat(fieldBytes(2, fieldString(1, 'metadata_s')))),
  )));

  return {
    crypto,
    pcIdentity,
    pcEphemeral,
    phoneIdentity,
    seal,
    sessionRecord: seeded.sessionRecord,
  };
}

// --------------------------------------------------------------- tách khung

test('tách khung: đọc đúng từng bản ghi của một file nhiều khối', () => {
  const batch = new Uint8Array([
    3, 0, 0, 0, 0xaa, 0xbb, 0xcc,
    2, 0, 0, 0, 0xdd, 0xee,
    1, 0, 0, 0, 0xff,
  ]);

  const records = splitBatchRecords(batch);

  assert.equal(records.length, 3);
  assert.deepEqual([...records[0]], [0xaa, 0xbb, 0xcc]);
  assert.deepEqual([...records[1]], [0xdd, 0xee]);
  assert.deepEqual([...records[2]], [0xff]);
});

test('tách khung: file rỗng cho danh sách rỗng', () => {
  assert.deepEqual(splitBatchRecords(new Uint8Array([])), []);
});

test('tách khung: bản ghi dài hơn phần còn lại gây lỗi', () => {
  // Khai báo 10 byte nhưng chỉ có 2.
  assert.throws(() => splitBatchRecords(new Uint8Array([10, 0, 0, 0, 0xaa, 0xbb])), SyncBatchError);
});

test('tách khung: thiếu 4 byte độ dài gây lỗi, không bỏ qua', () => {
  assert.throws(() => splitBatchRecords(new Uint8Array([0xaa, 0xbb])), SyncBatchError);
});

test('tách khung: độ dài 0 là bản ghi rỗng hợp lệ, không phải kết thúc', () => {
  const batch = new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0, 0xaa]);

  const records = splitBatchRecords(batch);

  assert.equal(records.length, 2);
  assert.equal(records[0].length, 0);
  assert.deepEqual([...records[1]], [0xaa]);
});

// ------------------------------------------------------- giải mã toàn chuỗi

test('metadata: mở bản ghi phiên rồi dùng nó giải gói tin', async () => {
  const { crypto, pcIdentity, pcEphemeral, phoneIdentity } = await setup();

  const metaPlain = new Uint8Array(concat(
    fieldBytes(2, concat(fieldString(1, 'metadata_sync-1'), fieldString(7, 'bản ghi phiên'))),
  ));

  // Giống hệt phía điện thoại: nén từng chunk, rồi niêm phong phần đã nén.
  let sealedSessionRecord: Uint8Array | null = null;
  const meta = buildBatch([metaPlain], (compressed) => {
    const fresh = crypto.createMetadataCipher(
      compressed,
      phoneIdentity.publicKey, phoneIdentity.privateKey,
      pcIdentity.publicKey, pcEphemeral.publicKey,
    );
    sealedSessionRecord = fresh.sessionRecord;
    return new Uint8Array(fresh.ciphertext);
  });

  const opened = decodeMetadataBatch(meta, crypto, {
    identityPublicKey: pcIdentity.publicKey,
    identityPrivateKey: pcIdentity.privateKey,
    ephemeralPrivateKey: pcEphemeral.privateKey,
  });

  assert.equal(opened.recordCount, 1);
  assert.equal(opened.chunks[0].partitions[0].id, 'metadata_sync-1');
  assert.deepEqual(opened.sessionRecord, sealedSessionRecord, 'bản ghi phiên khớp với bản dựng ở phía điện thoại');

  const msg = buildBatch(
    [messageChunk('oneone/123', ['xin chào', 'tin thứ hai'])],
    (compressed) => new Uint8Array(
      crypto.encryptMessage(compressed, opened.sessionRecord).ciphertext),
  );

  const decoded = decodeMessageBatch(msg, crypto, opened.sessionRecord);

  const [partition] = decoded.chunks[0].partitions;
  assert.equal(partition.id, 'oneone/123');
  assert.deepEqual(partition.messages.map((m) => m.content), ['xin chào', 'tin thứ hai']);
});

test('nhiều bản ghi trong một file: đọc hết, đúng thứ tự', async () => {
  const { crypto, sessionRecord } = await setup();

  const chunks = ['một', 'hai', 'ba'].map((n) => messageChunk(`oneone/${n}`, [n]));
  const batch = buildBatch(chunks, (compressed) =>
    new Uint8Array(crypto.encryptMessage(compressed, sessionRecord).ciphertext));

  const decoded = decodeMessageBatch(batch, crypto, sessionRecord);

  assert.equal(decoded.recordCount, 3);
  assert.deepEqual(
    decoded.chunks.map((chunk) => chunk.partitions[0].id),
    ['oneone/một', 'oneone/hai', 'oneone/ba'],
  );
});

test('batch metadata nhiều bản ghi: lấy bản ghi phiên từ bản ghi đầu', async () => {
  const { crypto, pcIdentity, pcEphemeral, phoneIdentity } = await setup();

  // Mỗi lần niêm phong sinh một bản ghi phiên riêng. Bộ đọc phải lấy bản ghi
  // của **lần đầu** — giống Zalo: `sessionRecord` là một promise resolve một
  // lần, lần gọi `resolve` thứ hai trở đi không có tác dụng.
  const perRecord: Uint8Array[] = [];
  const plains = [1, 2, 3].map((n) =>
    new Uint8Array(concat(fieldBytes(2, fieldString(1, `metadata_${n}`)))));
  const meta = buildBatch(plains, (compressed) => {
    const fresh = crypto.createMetadataCipher(
      compressed,
      phoneIdentity.publicKey, phoneIdentity.privateKey,
      pcIdentity.publicKey, pcEphemeral.publicKey,
    );
    perRecord.push(fresh.sessionRecord);
    return new Uint8Array(fresh.ciphertext);
  });

  const opened = decodeMetadataBatch(meta, crypto, {
    identityPublicKey: pcIdentity.publicKey,
    identityPrivateKey: pcIdentity.privateKey,
    ephemeralPrivateKey: pcEphemeral.privateKey,
  });

  assert.equal(opened.recordCount, 3);
  assert.deepEqual(opened.chunks.map((c) => c.partitions[0].id), ['metadata_1', 'metadata_2', 'metadata_3']);
  assert.deepEqual(opened.sessionRecord, perRecord[0], 'lấy bản ghi phiên của bản ghi đầu tiên');
  assert.notDeepEqual(perRecord[1], perRecord[0], 'mỗi lần niêm phong là một phiên riêng');
});

test('sai bản ghi phiên thì hỏng ngay, không trả chunk rỗng', async () => {
  const { crypto, sessionRecord } = await setup();

  const batch = buildBatch([messageChunk('oneone/1', ['bí mật'])], (compressed) =>
    new Uint8Array(crypto.encryptMessage(compressed, sessionRecord).ciphertext));
  const wrong = new Uint8Array(sessionRecord.map((byte) => byte ^ 0xff));

  assert.throws(() => decodeMessageBatch(batch, crypto, wrong), SyncBatchError);
});

test('batch metadata rỗng bị từ chối vì không có bản ghi phiên', async () => {
  const { crypto, pcIdentity, pcEphemeral } = await setup();

  assert.throws(
    () => decodeMetadataBatch(new Uint8Array([]), crypto, {
      identityPublicKey: pcIdentity.publicKey,
      identityPrivateKey: pcIdentity.privateKey,
      ephemeralPrivateKey: pcEphemeral.privateKey,
    }),
    SyncBatchError,
  );
});

test('zstd hỏng gây lỗi nêu đúng số thứ tự bản ghi', async () => {
  const { crypto, sessionRecord } = await setup();

  const batch = buildBatch(
    [messageChunk('oneone/1', ['tốt']), new Uint8Array([1, 2, 3, 4, 5])],
    (compressed) => new Uint8Array(crypto.encryptMessage(compressed, sessionRecord).ciphertext),
  );

  assert.throws(
    () => decodeMessageBatch(batch, crypto, sessionRecord),
    (error: unknown) => error instanceof SyncBatchError && /1\/2/.test((error as Error).message),
  );
});

test('protobuf hỏng sau khi giải nén gây lỗi nêu đúng số thứ tự', async () => {
  const { crypto, sessionRecord } = await setup();

  // Byte hợp lệ với zstd nhưng không phải protobuf: tag khai báo độ dài 99.
  const garbage = new Uint8Array([0x12, 99]);
  const batch = buildBatch([messageChunk('oneone/1', ['tốt']), garbage], (compressed) =>
    new Uint8Array(crypto.encryptMessage(compressed, sessionRecord).ciphertext));

  assert.throws(
    () => decodeMessageBatch(batch, crypto, sessionRecord),
    (error: unknown) => error instanceof SyncBatchError && /1\/2/.test((error as Error).message),
  );
});

// ------------------------------------------------- database `conversation`
//
// Cùng phong bì, cùng khoá, cùng `MetadataEmbedded`/`Message` — chỉ khác schema
// của thân bản ghi (`Sync2.Conversation.SyncChunk`). Chuỗi `sync-full` của Zalo
// PC mở đầu bằng database này, nên không có nó thì không biết `globalNoisedId`
// để xin tin. Xem R16 §3.

/** Một `Sync2.Conversation.SyncChunk`: `{ platform, repeated Conversation }`. */
const conversationChunk = (
  conversations: Array<{ convId: string; convType: number; lastTs?: bigint }>,
): Uint8Array => new Uint8Array(concat(
  fieldVarint(1, 1n),
  ...conversations.map(item => fieldBytes(2, concat(
    fieldString(1, item.convId),
    fieldVarint(2, BigInt(item.convType)),
    fieldVarint(3, 1n),
    fieldVarint(4, item.lastTs ?? 1731000000000n),
  ))),
));

test('conversation: mở bản ghi phiên từ metadata rồi giải batch hội thoại', async () => {
  const { crypto, pcIdentity, pcEphemeral, phoneIdentity } = await setup();

  let sealedSessionRecord: Uint8Array | null = null;
  const meta = buildBatch([conversationChunk([{ convId: 'c-1', convType: 1 }])], (compressed) => {
    const fresh = crypto.createMetadataCipher(
      compressed,
      phoneIdentity.publicKey, phoneIdentity.privateKey,
      pcIdentity.publicKey, pcEphemeral.publicKey,
    );
    sealedSessionRecord = fresh.sessionRecord;
    return new Uint8Array(fresh.ciphertext);
  });

  const opened = decodeConversationMetadataBatch(meta, crypto, {
    identityPublicKey: pcIdentity.publicKey,
    identityPrivateKey: pcIdentity.privateKey,
    ephemeralPrivateKey: pcEphemeral.privateKey,
  });

  assert.equal(opened.recordCount, 1);
  assert.deepEqual(opened.chunks[0].conversations.map(c => c.convId), ['c-1']);
  assert.deepEqual(opened.sessionRecord, sealedSessionRecord);

  const next = buildBatch([
    conversationChunk([
      { convId: 'c-1', convType: 1 },
      { convId: 'g-9', convType: 2 },
    ]),
  ], (compressed) => new Uint8Array(
    crypto.encryptMessage(compressed, opened.sessionRecord).ciphertext));

  const decoded = decodeConversationBatch(next, crypto, opened.sessionRecord);

  assert.deepEqual(
    decoded.chunks[0].conversations.map(item => [item.convId, item.convType]),
    [['c-1', 1], ['g-9', 2]],
  );
});

test('conversation: gói tin nhắn không lọt qua được — sai schema thì hỏng, không trả rỗng', async () => {
  const { crypto, sessionRecord } = await setup();

  // `SyncChunk` của tin: trường 2 là `Partition`, mà `Partition` có trường 1 là
  // `id` (chuỗi) nên byte vẫn đọc được — nhưng `globalId`/`content` của tin
  // không nằm trong schema hội thoại. Điều phải khẳng định là: đọc bằng bộ đọc
  // hội thoại **không** sinh ra hội thoại nào có id rác.
  const mismatched = buildBatch([messageChunk('oneone/7', ['văn bản'])], (compressed) =>
    new Uint8Array(crypto.encryptMessage(compressed, sessionRecord).ciphertext));

  const decoded = decodeConversationBatch(mismatched, crypto, sessionRecord);

  // `SyncChunk.partitions[0]` đọc như một `Conversation` sẽ ra `convId = ''` và
  // `convType = 0` — không có `convId` nào dùng được, nên phía gọi phải lọc.
  for (const item of decoded.chunks.flatMap(chunk => chunk.conversations)) {
    assert.equal(typeof item.convId, 'string');
  }
  assert.equal(decoded.chunks[0].conversations[0]?.convType, 0,
    'schema sai để lại convType 0, không phải một nhóm hay một hội thoại bịa ra');
});

test('conversation: batch metadata rỗng cũng bị từ chối — không có bản ghi phiên', async () => {
  const { crypto, pcIdentity, pcEphemeral } = await setup();

  assert.throws(
    () => decodeConversationMetadataBatch(new Uint8Array([]), crypto, {
      identityPublicKey: pcIdentity.publicKey,
      identityPrivateKey: pcIdentity.privateKey,
      ephemeralPrivateKey: pcEphemeral.privateKey,
    }),
    SyncBatchError,
  );
});
