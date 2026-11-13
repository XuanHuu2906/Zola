import test from 'node:test';
import assert from 'node:assert/strict';
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

const { decodeWsFrameHeader, describeWsFrameBody } = await import('../electron/protocol/ws-frame.ts');

/**
 * Header frame WebSocket — bài học từ ba lần đo hỏng.
 *
 * Cả ba lần bộ quan sát báo `frames: []`. Lần thứ ba mới ra nguyên nhân: trong
 * tiến trình chính của Electron, `ws` giao `Buffer`, không phải `ArrayBuffer`
 * hay `Blob`, và `cmd` là `u16` little-endian tại offset 1 chứ không phải
 * `int32`. Một test đọc header đúng sẽ bắt được cả hai ngay lần đầu.
 */

/** Dựng frame đúng định dạng `_send`: version, cmd LE 16, subCmd, thân. */
function frame(version: number, cmd: number, subCmd: number, body = ''): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt8(version, 0);
  head.writeUInt16LE(cmd, 1);
  head.writeUInt8(subCmd, 3);
  return Buffer.concat([head, Buffer.from(body, 'utf8')]);
}

test('đọc đúng header của frame `601/0` — sự kiện điều khiển', () => {
  const header = decodeWsFrameHeader(frame(1, 601, 0, '{"key":"x"}'));
  assert.deepEqual(header, { version: 1, cmd: 601, subCmd: 0, bodyBytes: 11 });
});

test('`cmd` là u16 little-endian tại offset 1 — đọc int32 sẽ cho số vô nghĩa', () => {
  const raw = frame(1, 4, 1, '{"eventId":1}');
  const header = decodeWsFrameHeader(raw);
  assert.equal(header?.cmd, 4, '`sendWs` gửi ping bằng cmd 4, không phải 262144');
  assert.equal(header?.subCmd, 1);
  // Cách đọc cũ: `getInt32(1, true)` — lấn sang byte `subCmd` và byte đầu của thân.
  const wrong = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getInt32(1, true);
  assert.notEqual(wrong, 4, 'cách đọc cũ phải khác kết quả đúng, nếu không test này vô nghĩa');
  assert.ok(wrong > 255, `int32 lấn byte luôn > 255, ở đây là ${wrong}`);
});

test('cmd 590 đọc ra đúng 590, không bị đọc thành 590 + subCmd << 16', () => {
  const header = decodeWsFrameHeader(frame(1, 590, 0));
  assert.equal(header?.cmd, 590);
  assert.equal(header?.subCmd, 0);
  // Với `cmd = 600` và `subCmd = 1` cách đọc int32 cho ra 65624 — đây là con số
  // đã có thể làm ta kết luận sai "máy chủ trả về mã lạ".
  assert.equal(decodeWsFrameHeader(frame(1, 600, 1))?.cmd, 600);
});

test('nhận `Buffer` — đúng kiểu `ws` giao trong tiến trình chính Electron', () => {
  const buffer = frame(1, 501, 0, '{}');
  assert.ok(buffer instanceof Uint8Array, 'Buffer phải đi qua nhánh Uint8Array');
  assert.equal(decodeWsFrameHeader(buffer)?.cmd, 501);
});

test('nhận `Uint8Array` có `byteOffset` khác 0', () => {
  // zca-js dùng `data.subarray(0, 4)`; một mảng con như vậy có `byteOffset` và
  // `DataView` phải tôn trọng nó. Bỏ qua `byteOffset` là đọc nhầm sang vùng đệm.
  const raw = frame(1, 511, 0, '{"a":1}');
  const outer = new Uint8Array(raw.byteLength + 8);
  outer.set(raw, 8);
  const view = outer.subarray(8);
  assert.equal(view.byteOffset, 8);
  assert.deepEqual(decodeWsFrameHeader(view), { version: 1, cmd: 511, subCmd: 0, bodyBytes: 7 });
});

test('frame ngắn hơn 4 byte trả `null`, không ném', () => {
  assert.equal(decodeWsFrameHeader(new Uint8Array(0)), null);
  assert.equal(decodeWsFrameHeader(new Uint8Array([1, 2, 3])), null);
});

test('thân rỗng vẫn đọc được header — zca-js bỏ qua frame thân rỗng, ta thì không', () => {
  // `listen.js` có `if (decodedData.length == 0) return`, nên một frame thân rỗng
  // bị nó nuốt im lặng. Đếm frame rỗng là cách duy nhất thấy chúng.
  assert.deepEqual(decodeWsFrameHeader(frame(1, 1, 1)), { version: 1, cmd: 1, subCmd: 1, bodyBytes: 0 });
});

/**
 * Hình dạng thân frame — câu hỏi "phản hồi của máy chủ hay frame của ta dội lại".
 *
 * Phép đo `cmd 590` cho ra một frame về 5 ms sau khi gửi, 229 byte. Thân frame ta
 * gửi chỉ ~38 byte (`{"data":{"reqId":"probe_..."}}`), nên nhiều khả năng đó là
 * phản hồi thật — nhưng "nhiều khả năng" không phải bằng chứng. Ba trường dưới
 * đây phân biệt được hai giả thuyết mà không đụng vào nội dung.
 */

const body = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

test('thân mang `reqId` + `error_code` — dấu hiệu của phản hồi thật', () => {
  const shape = describeWsFrameBody(body({ reqId: 'cmd_590', error_code: 0, data: { x: 1 } }));
  assert.deepEqual(shape.keys, ['data', 'error_code', 'reqId']);
  assert.equal(shape.reqIdChars, 'cmd_590'.length);
  assert.equal(shape.errorCode, 0);
});

test('`reqId` nằm trong `data` vẫn đọc được — hai đường của Zalo PC đặt nó khác chỗ', () => {
  // `addCommonParams` của Zalo PC (WS) đặt ở cấp ngoài; `requestSyncMessage` bản
  // HTTP (`fBUP.js`) đặt `{reqId, data: JSON.stringify(t)}`. Bỏ sót một trong hai
  // là đọc "không có reqId" cho một phản hồi thật.
  const shape = describeWsFrameBody(body({ data: { reqId: 'abc123', error_code: 0 } }));
  assert.equal(shape.reqIdChars, 'abc123'.length);
  assert.equal(shape.errorCode, 0);
});

test('`errorCode` kiểu camelCase cũng đọc được', () => {
  assert.equal(describeWsFrameBody(body({ reqId: 'cmd_590', errorCode: 604 })).errorCode, 604);
});

test('thân không phải JSON trả `keys: null`, không ném', () => {
  // Frame mã hoá hoặc frame rác. Bộ quan sát phải sống sót, nếu không thì chính
  // nó lại là thứ làm mất bằng chứng — lỗi đã xảy ra ba lần rồi.
  assert.deepEqual(describeWsFrameBody(new TextEncoder().encode('không phải json{{{')),
    { keys: null, reqIdChars: 0, errorCode: null, encrypt: null });
  assert.deepEqual(describeWsFrameBody(new Uint8Array(0)),
    { keys: null, reqIdChars: 0, errorCode: null, encrypt: null });
});

test('JSON không phải object (mảng, số) trả `keys: null`', () => {
  assert.equal(describeWsFrameBody(new TextEncoder().encode('[1,2,3]')).keys, null);
  assert.equal(describeWsFrameBody(new TextEncoder().encode('42')).keys, null);
});

test('hình dạng **không** chứa giá trị — chuỗi bí mật không lọt ra', () => {
  const secret = 'NOI-DUNG-DONG-BO-CUA-NGUOI-DUNG';
  const shape = describeWsFrameBody(body({ reqId: 'cmd_590', error_code: 0, payload: secret }));
  const serialised = JSON.stringify(shape);
  assert.doesNotMatch(serialised, new RegExp(secret), 'chỉ tên khoá và độ dài được đi ra');
  assert.deepEqual(shape.keys, ['error_code', 'payload', 'reqId']);
});

/**
 * Cờ `encrypt` — đọc đúng kiểu, vì nó đổi nghĩa của mọi thứ còn lại.
 *
 * Lần đo 2026-11-09 05:00 nhận một phản hồi `590` với khoá
 * `["data","encrypt","error_code","error_message"]` và **không** `reqId`. Nếu
 * `encrypt` là số khác 0 thì `data` đã bị mã hoá, và "không có `reqId`" chỉ nói về
 * phong bì — không được dùng để kết luận request sai. Vì thế `0` phải đọc ra đúng
 * là `0`, không bị gộp thành "có mã hoá".
 */
test('`encrypt: 0` là văn bản thuần — zca-js coi 0 là không cần giải mã', () => {
  const shape = describeWsFrameBody(body({ data: { x: 1 }, encrypt: 0, error_code: 0 }));
  assert.equal(shape.encrypt, 0);
  assert.notEqual(shape.encrypt, null, '0 là giá trị thật, không phải "không có cờ"');
});

test('`encrypt: 3` giữ đúng số, không bị đổi thành boolean', () => {
  // `decodeEventData` của zca-js rẽ ba nhánh theo 1/2/3; gộp chúng thành `true`
  // là mất thông tin về cách giải mã.
  assert.equal(describeWsFrameBody(body({ encrypt: 3, data: 'abc' })).encrypt, 3);
  assert.equal(describeWsFrameBody(body({ encrypt: 1 })).encrypt, 1);
});

test('không có cờ `encrypt` / cờ sai kiểu thì trả `null`, không đoán', () => {
  assert.equal(describeWsFrameBody(body({ reqId: 'cmd_590' })).encrypt, null);
  assert.equal(describeWsFrameBody(body({ encrypt: 'yes' })).encrypt, null,
    'chuỗi không phải cờ hợp lệ — đoán bừa ở đây là đọc sai cả frame');
});
