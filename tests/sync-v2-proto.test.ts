import test from 'node:test';
import assert from 'node:assert/strict';

const { decodeSyncChunk, decodeConversationChunk, SyncProtoError } =
  await import('../electron/protocol/sync-v2-proto.ts');

/**
 * Bộ mã hoá protobuf tối thiểu, viết riêng cho test.
 *
 * Cố ý **không** dùng lại bất cứ thứ gì từ `sync-v2-proto.ts`: nếu test dùng
 * chính bộ đọc để dựng dữ liệu thì một hiểu nhầm về `varint` hay kiểu dây sẽ
 * khớp cả hai phía và test vẫn xanh. Ở đây byte được dựng theo đặc tả, bằng tay.
 */

/** `varint` không dấu, dựng từ bit thấp lên. */
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

/** `varint` hai bù cho số âm (`int32`/`int64`). */
function signedVarint(value: bigint): number[] {
  return varint(BigInt.asUintN(64, value));
}

const tag = (field: number, wire: number): number[] => varint(BigInt((field << 3) | wire));

const fieldVarint = (field: number, value: bigint): number[] => [...tag(field, 0), ...varint(value)];
const fieldSigned = (field: number, value: bigint): number[] => [...tag(field, 0), ...signedVarint(value)];

function fieldBytes(field: number, payload: number[]): number[] {
  return [...tag(field, 2), ...varint(BigInt(payload.length)), ...payload];
}

const fieldString = (field: number, value: string): number[] =>
  fieldBytes(field, [...new TextEncoder().encode(value)]);

const concat = (...parts: number[][]): number[] => parts.flat();

const U = (bytes: number[]): Uint8Array => new Uint8Array(bytes);

test('đọc một SyncChunk tối thiểu: nền tảng + một phân vùng + một tin', () => {
  const message = concat(
    fieldString(1, 'sender-1'),
    fieldVarint(2, 9876543210123456789n),
    fieldVarint(3, 0n),
    fieldVarint(4, 1n),
    fieldVarint(5, 1731000000000n),
    fieldSigned(6, 5555555555555555555n),
    fieldString(7, 'xin chào'),
  );
  const partition = concat(fieldString(1, 'oneone/123'), fieldBytes(2, message));
  const chunk = concat(fieldVarint(1, 1n), fieldBytes(2, partition));

  const decoded = decodeSyncChunk(U(chunk));

  assert.equal(decoded.platform, 1, 'PlatformType MOBILE');
  assert.equal(decoded.partitions.length, 1);
  assert.equal(decoded.partitions[0].id, 'oneone/123');
  const [decodedMessage] = decoded.partitions[0].messages;
  assert.equal(decodedMessage.senderId, 'sender-1');
  assert.equal(decodedMessage.clientId, '9876543210123456789', 'uint64 giữ nguyên từng chữ số');
  assert.equal(decodedMessage.msgType, 1);
  assert.equal(decodedMessage.timestamp, '1731000000000');
  assert.equal(decodedMessage.globalId, '5555555555555555555');
  assert.equal(decodedMessage.content, 'xin chào');
});

test('uint64 vượt giới hạn an toàn của number vẫn đọc đúng từng chữ số', () => {
  // 2^64 - 1: giá trị lớn nhất của uint64. Đổi sang number sẽ mất chính xác.
  const max = '18446744073709551615';
  const chunk = concat(
    fieldString(1, 'oneone/1'),
    fieldBytes(2, concat(
      fieldString(1, 'a'),
      fieldVarint(2, 18446744073709551615n),
      fieldVarint(5, 18446744073709551615n),
    )),
  );

  const [message] = decodeSyncChunk(U(concat(fieldBytes(2, chunk)))).partitions[0].messages;

  assert.equal(message.clientId, max);
  assert.equal(message.timestamp, max);
});

test('int64 âm đọc thành chuỗi có dấu', () => {
  // globalId âm là chuyện có thật: Zalo dùng -1 cho tin chưa lên máy chủ.
  const chunk = fieldBytes(2, concat(
    fieldString(1, 'oneone/1'),
    fieldBytes(2, concat(fieldString(1, 'a'), fieldSigned(6, -1n))),
  ));

  const [message] = decodeSyncChunk(U(chunk)).partitions[0].messages;

  assert.equal(message.globalId, '-1');
});

test('MetaData: tệp đính kèm, nhắc tên, trích dẫn, thuộc tính, ttl', () => {
  const attach = concat(fieldString(1, 'image'), fieldString(5, 'ảnh.jpg'), fieldVarint(9, 2n));
  const mention = concat(fieldString(1, 'uid-9'), fieldVarint(2, 3n), fieldVarint(3, 5n), fieldVarint(4, 1n));
  const quote = concat(
    fieldString(1, 'q-attach'), fieldString(2, 'owner-9'), fieldVarint(3, 111n),
    fieldString(4, 'from-9'), fieldVarint(5, 222n), fieldSigned(6, 333n),
    fieldString(7, 'nội dung bị trích'), fieldVarint(8, 1n), fieldVarint(10, 1n),
  );
  const property = concat(fieldVarint(1, 1024n), fieldString(5, 'ext-json'));
  const meta = concat(
    fieldBytes(1, attach),
    fieldBytes(2, mention),
    fieldBytes(4, quote),
    fieldBytes(5, property),
    fieldVarint(6, 86400n),
  );
  const chunk = fieldBytes(2, concat(
    fieldString(1, 'group/42'),
    fieldBytes(2, concat(fieldString(1, 'a'), fieldBytes(8, meta))),
  ));

  const [message] = decodeSyncChunk(U(chunk)).partitions[0].messages;
  const decoded = message.meta;
  assert.ok(decoded);

  assert.equal(decoded.attachs.length, 1);
  assert.equal(decoded.attachs[0].type, 'image');
  assert.equal(decoded.attachs[0].title, 'ảnh.jpg');
  assert.equal(decoded.attachs[0].catId, 2);

  assert.equal(decoded.mentions.length, 1);
  assert.deepEqual(decoded.mentions[0], { uid: 'uid-9', pos: 3, len: 5, type: 1 });

  assert.ok(decoded.quote);
  assert.equal(decoded.quote.msg, 'nội dung bị trích');
  assert.equal(decoded.quote.ts, '111');
  assert.equal(decoded.quote.globalMsgId, '333');
  assert.equal(decoded.quote.partialQuote, true);

  assert.ok(decoded.property);
  assert.equal(decoded.property.size, 1024);
  assert.equal(decoded.property.ext, 'ext-json');

  assert.equal(decoded.ttl, '86400');
});

test('nhiều phân vùng và nhiều tin giữ đúng thứ tự', () => {
  const message = (content: string): number[] =>
    fieldBytes(2, concat(fieldString(1, 'a'), fieldString(7, content)));
  const chunk = concat(
    fieldBytes(2, concat(fieldString(1, 'oneone/1'), message('một'), message('hai'), message('ba'))),
    fieldBytes(2, concat(fieldString(1, 'group/2'), message('bốn'))),
  );

  const decoded = decodeSyncChunk(U(chunk));

  assert.deepEqual(decoded.partitions.map((partition) => partition.id), ['oneone/1', 'group/2']);
  assert.deepEqual(
    decoded.partitions[0].messages.map((entry) => entry.content),
    ['một', 'hai', 'ba'],
  );
  assert.deepEqual(decoded.partitions[1].messages.map((entry) => entry.content), ['bốn']);
});

test('trường lạ bị bỏ qua thay vì làm hỏng phần còn lại', () => {
  // Gói mới hơn của Zalo có thể thêm trường. Phải đọc được và giữ dữ liệu đã biết.
  const unknownVarint = fieldVarint(99, 7n);
  const unknownBytes = fieldString(100, 'thêm sau này');
  const chunk = fieldBytes(2, concat(
    fieldString(1, 'oneone/1'),
    unknownVarint,
    fieldBytes(2, concat(fieldString(1, 'a'), fieldString(7, 'vẫn đọc được'), unknownBytes)),
  ));

  const [message] = decodeSyncChunk(U(chunk)).partitions[0].messages;

  assert.equal(message.content, 'vẫn đọc được');
});

test('sai kiểu dây ở một trường thì bỏ qua trường đó, không đọc nhầm', () => {
  // Trường 7 (`content`) là string; gửi nó dưới dạng varint. Bộ đọc phải bỏ
  // qua, và trường 1 phía sau vẫn phải đọc đúng.
  const chunk = fieldBytes(2, concat(
    fieldString(1, 'oneone/1'),
    fieldBytes(2, concat(fieldVarint(7, 12345n), fieldString(1, 'vẫn còn'))),
  ));

  const [message] = decodeSyncChunk(U(chunk)).partitions[0].messages;

  assert.equal(message.content, '');
  assert.equal(message.senderId, 'vẫn còn');
});

test('dữ liệu cắt cụt gây SyncProtoError, không trả kết quả nửa vời', () => {
  const full = fieldBytes(2, concat(fieldString(1, 'oneone/1'), fieldString(7, 'nội dung dài')));
  const truncated = full.slice(0, full.length - 4);

  assert.throws(() => decodeSyncChunk(U(truncated)), SyncProtoError);
});

test('độ dài trường vượt quá phần còn lại gây SyncProtoError', () => {
  // Khai báo độ dài 100 byte nhưng chỉ có 3 byte theo sau.
  const chunk = [...tag(2, 2), ...varint(100n), 1, 2, 3];

  assert.throws(() => decodeSyncChunk(U(chunk)), SyncProtoError);
});

test('byte không phải UTF-8 gây SyncProtoError', () => {
  const chunk = fieldBytes(2, concat(
    fieldString(1, 'oneone/1'),
    fieldBytes(2, fieldBytes(7, [0xff, 0xfe])),
  ));

  assert.throws(() => decodeSyncChunk(U(chunk)), SyncProtoError);
});

test('kiểu dây không hỗ trợ (3, 4, 6, 7) gây SyncProtoError', () => {
  for (const wire of [3, 4, 6, 7]) {
    assert.throws(
      () => decodeSyncChunk(U([...tag(50, wire)])),
      SyncProtoError,
      `kiểu dây ${wire} phải bị từ chối`,
    );
  }
});

test('byte rỗng là một chunk rỗng hợp lệ', () => {
  const decoded = decodeSyncChunk(U([]));

  assert.equal(decoded.platform, 0);
  assert.deepEqual(decoded.partitions, []);
});

test('đọc được SyncChunk của gói hội thoại', () => {
  const conversation = concat(
    fieldString(1, 'conv-1'),
    fieldVarint(2, 1n),
    fieldVarint(3, 1n),
    fieldVarint(4, 1731000000000n),
    fieldSigned(5, 42n),
    fieldVarint(6, 4242n),
  );
  const chunk = concat(fieldVarint(1, 1n), fieldBytes(2, conversation));

  const decoded = decodeConversationChunk(U(chunk));

  assert.equal(decoded.platform, 1);
  assert.equal(decoded.conversations.length, 1);
  assert.deepEqual(decoded.conversations[0], {
    convId: 'conv-1',
    convType: 1,
    respondedByMe: true,
    lastTs: '1731000000000',
    lastGlobalId: '42',
    lastClientId: '4242',
  });
});
