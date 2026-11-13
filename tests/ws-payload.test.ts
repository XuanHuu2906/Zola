import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'node:crypto';
import { deflateSync, gzipSync } from 'node:zlib';
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

const { describeDecodedPayload, unwrapPayload } = await import('../electron/protocol/ws-payload.ts');

/**
 * Mở phong bì `encrypt: 2`.
 *
 * Lần đo `cmd 590` (2026-11-09 05:06) nhận phản hồi có `encrypt: 2` và **không**
 * `reqId` ở tầng ngoài. Đó là điều đúng theo thiết kế: `reqId` nằm *bên trong*
 * phần đã mã hoá, nên đọc tầng ngoài không bao giờ thấy nó. Không mở được phong
 * bì thì câu hỏi "máy chủ nhận hay từ chối" không có câu trả lời nào kiểm chứng
 * được — và mọi kết luận chỉ còn là suy đoán về kích thước.
 *
 * Bộ dựng phong bì ở đây cố ý viết lại theo bố cục của zca-js
 * (`dist/utils.js:348-374`) chứ không dùng lại code của ta: một test dùng chính
 * bộ mã hoá của mình để kiểm bộ giải mã của mình sẽ xanh kể cả khi cả hai cùng
 * sai bố cục.
 */

const KEY_BYTES = 32;
const cipherKey = randomBytes(KEY_BYTES).toString('base64');

/** Dựng `[iv 16][aad 16][cipher..][tag 16]`, base64 + `encodeURIComponent`. */
function envelope(payload: unknown, key = cipherKey): string {
  const iv = randomBytes(16);
  const aad = randomBytes(16);
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const compressed = Buffer.from(deflateSync(body));
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();
  return encodeURIComponent(Buffer.concat([iv, aad, encrypted, tag]).toString('base64'));
}

test('mở được phong bì `encrypt: 2` — đúng hình dạng Zalo PC gửi', () => {
  const raw = envelope({ error_code: 0, data: { reqId: 'cmd_590', sync: [] } });
  const parsed = unwrapPayload(2, raw, cipherKey) as Record<string, unknown>;
  assert.equal(parsed.error_code, 0);
  assert.equal((parsed.data as Record<string, unknown>).reqId, 'cmd_590');
});

test('mô tả trả `reqId` và `error_code` **bên trong** — chỗ tầng ngoài không thấy', () => {
  const raw = envelope({ error_code: 0, data: { reqId: 'probe_1762664000000', data: '{"lastId":0}' } });
  const shape = describeDecodedPayload(2, raw, cipherKey);
  assert.equal(shape.ok, true);
  assert.equal(shape.reqIdChars, 'probe_1762664000000'.length);
  assert.equal(shape.innerDataChars, '{"lastId":0}'.length);
  assert.equal(shape.errorCode, 0);
  assert.deepEqual(shape.keys, ['data', 'error_code']);
});

test('**không** nội dung nào đi ra ngoài — chỉ khoá, độ dài, mã lỗi', () => {
  const secret = 'TIN-NHAN-CUA-NGUOI-DUNG';
  const raw = envelope({ error_code: 0, data: { reqId: 'cmd_590', msgs: [{ content: secret }] } });
  const serialised = JSON.stringify(describeDecodedPayload(2, raw, cipherKey));
  assert.doesNotMatch(serialised, new RegExp(secret));
  assert.doesNotMatch(serialised, /cmd_590/);
});

test('sai khoá thì báo `decrypt`, không im lặng trả rỗng', () => {
  // GCM có tag xác thực: sai khoá phải **ném**, không được trả rác. Nếu bộ giải mã
  // bỏ qua tag thì nó sẽ "thành công" với dữ liệu vô nghĩa và ta lại kết luận từ
  // một phép đo hỏng.
  const raw = envelope({ error_code: 0 }, randomBytes(KEY_BYTES).toString('base64'));
  assert.deepEqual(describeDecodedPayload(2, raw, cipherKey),
    { ok: false, reason: 'decrypt', keys: null, errorCode: null, reqIdChars: 0, innerDataChars: 0 });
});

test('thiếu khoá phiên báo `cipher-key-missing`, không đoán', () => {
  const raw = envelope({ error_code: 0 });
  assert.equal(describeDecodedPayload(2, raw, null).reason, 'cipher-key-missing');
});

test('khoá sai độ dài báo `cipher-key-missing` thay vì ném từ crypto', () => {
  const raw = envelope({ error_code: 0 });
  assert.equal(describeDecodedPayload(2, raw, Buffer.alloc(20).toString('base64')).reason,
    'cipher-key-missing');
});

test('`encrypt: 0` là văn bản thuần, đọc thẳng không cần khoá', () => {
  const shape = describeDecodedPayload(0, JSON.stringify({ error_code: -1, data: { reqId: 'abc' } }), null);
  assert.equal(shape.ok, true);
  assert.equal(shape.errorCode, -1, 'mã âm là mã từ chối thật, không phải "không có mã"');
  assert.equal(shape.reqIdChars, 3);
});

test('`encrypt: 3` bỏ bước inflate nhưng vẫn giải AES', () => {
  const iv = randomBytes(16);
  const aad = randomBytes(16);
  const plain = Buffer.from(JSON.stringify({ error_code: 0, data: { reqId: 'cmd_590' } }), 'utf8');
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(cipherKey, 'base64'), iv);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  const raw = encodeURIComponent(Buffer.concat([iv, aad, encrypted, tag]).toString('base64'));
  assert.equal(describeDecodedPayload(3, raw, cipherKey).reqIdChars, 'cmd_590'.length);
});

test('kiểu mã hoá lạ trả `bad-type`, không ném', () => {
  assert.equal(describeDecodedPayload(9, 'x', cipherKey).reason, 'bad-type');
  assert.equal(describeDecodedPayload('2', 'x', cipherKey).reason, 'bad-type');
  assert.equal(describeDecodedPayload(2, 123, cipherKey).reason, 'bad-type');
});

test('phong bì quá ngắn trả `short`, không để crypto ném ra ngoài', () => {
  const tiny = encodeURIComponent(Buffer.alloc(20).toString('base64'));
  assert.equal(describeDecodedPayload(2, tiny, cipherKey).reason, 'short');
});

/**
 * `reason: 'inflate'` gộp ba khả năng rất khác nhau, và lần đo `cmd 603` thật
 * (2026-11-09) rơi đúng vào nhánh này. Ba khả năng dẫn tới ba cách sửa khác
 * nhau, nên phép đo phải phân biệt được chúng — nếu không thì vòng chạy sau lại
 * là một lần đoán.
 */
test('bản rõ không nén (JSON thẳng) được nhận ra là `json`, không chỉ "inflate"', () => {
  const iv = randomBytes(16);
  const aad = randomBytes(16);
  const plain = Buffer.from(JSON.stringify({ error_code: 0 }), 'utf8');
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(cipherKey, 'base64'), iv);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const raw = encodeURIComponent(Buffer.concat([iv, aad, encrypted, cipher.getAuthTag()]).toString('base64'));
  const shape = describeDecodedPayload(2, raw, cipherKey);
  assert.equal(shape.reason, 'inflate');
  assert.equal(shape.plainKind, 'json', 'bản rõ bắt đầu bằng `{` — đây là "quên inflate", không phải khoá sai');
  assert.equal(shape.plainChars, plain.length);
});

test('bản rõ là văn bản thường: phân biệt được với nhị phân', () => {
  const iv = randomBytes(16);
  const aad = randomBytes(16);
  const plain = Buffer.from('xin chào, đây là văn bản', 'utf8');
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(cipherKey, 'base64'), iv);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const raw = encodeURIComponent(Buffer.concat([iv, aad, encrypted, cipher.getAuthTag()]).toString('base64'));
  assert.equal(describeDecodedPayload(2, raw, cipherKey).plainKind, 'text');
});

test('bản rõ là nhị phân thật: `binary` — giả thuyết "khoá sai" chưa bị loại, nhưng đây không phải text', () => {
  const iv = randomBytes(16);
  const aad = randomBytes(16);
  const plain = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x80, 0x81]);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(cipherKey, 'base64'), iv);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const raw = encodeURIComponent(Buffer.concat([iv, aad, encrypted, cipher.getAuthTag()]).toString('base64'));
  assert.equal(describeDecodedPayload(2, raw, cipherKey).plainKind, 'binary');
});

test('`encrypt: 2` với thân **gzip** giải được — đúng hình dạng phản hồi thật của `590`/`603`', () => {
  // Đo ngày 2026-11-09: bản rõ của `cmd 590` (98 byte) và `cmd 603` (193 byte) là
  // gzip, không phải zlib. `inflateSync` ném trên cả hai, và lỗi đó từng bị đọc
  // thành "không giải được" — trong khi chỉ là chọn sai bộ giải. Test này khoá
  // đúng hình dạng đã đo, để lần sau không phải đo lại mới biết.
  const iv = randomBytes(16);
  const aad = randomBytes(16);
  const plain = gzipSync(Buffer.from(JSON.stringify({ error_code: 0, data: { reqId: 'cmd_603' } }), 'utf8'));
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(cipherKey, 'base64'), iv);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const raw = encodeURIComponent(Buffer.concat([iv, aad, encrypted, cipher.getAuthTag()]).toString('base64'));
  const shape = describeDecodedPayload(2, raw, cipherKey);
  assert.equal(shape.ok, true, 'gzip phải giải được, không rơi vào `reason: "inflate"`');
  assert.equal(shape.reqIdChars, 'cmd_603'.length);
  assert.equal(shape.errorCode, 0);
});

test('thân zlib vẫn giải được, không chỉ gzip — `unzipSync` nhận cả hai', () => {
  // Bản trước dùng `inflateSync`, chỉ nhận zlib; đổi sang `unzipSync` để nhận
  // gzip (hình dạng thật của `590`/`603`). Test này giữ phía còn lại: đừng đánh
  // đổi zlib lấy gzip. Cả hai đều là `encrypt: 2` hợp lệ.
  const iv = randomBytes(16);
  const aad = randomBytes(16);
  const deflated = deflateSync(Buffer.from(JSON.stringify({ error_code: 0 }), 'utf8'));
  assert.equal(deflated[0], 0x78, 'tiền đề của test: zlib bắt đầu bằng 0x78');
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(cipherKey, 'base64'), iv);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(deflated), cipher.final()]);
  const raw = encodeURIComponent(Buffer.concat([iv, aad, encrypted, cipher.getAuthTag()]).toString('base64'));
  assert.equal(describeDecodedPayload(2, raw, cipherKey).ok, true);
});

test('lỗi trước khi giải AES không mang `plainKind` — không có bản rõ nào để mô tả', () => {
  const raw = envelope({ error_code: 0 }, randomBytes(KEY_BYTES).toString('base64'));
  const shape = describeDecodedPayload(2, raw, cipherKey);
  assert.equal(shape.reason, 'decrypt');
  assert.equal(shape.plainKind, undefined);
});

test('giải ra nhưng không phải JSON trả `json`', () => {
  const iv = randomBytes(16);
  const aad = randomBytes(16);
  const plain = Buffer.from('không phải json', 'utf8');
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(cipherKey, 'base64'), iv);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const raw = encodeURIComponent(Buffer.concat([iv, aad, encrypted, cipher.getAuthTag()]).toString('base64'));
  // `encrypt: 3` để bỏ inflate — nội dung đưa vào vốn không nén.
  assert.equal(describeDecodedPayload(3, raw, cipherKey).reason, 'json');
});
