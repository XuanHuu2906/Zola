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

const {
  generateSyncId, generateUserSyncSessionId, partitionOf, SyncDatabaseType,
  SyncDeviceType, SyncPriority, SYNC_MAX_QUERIES_PER_REQUEST, SYNC_UNLIMITED_LIMIT,
} = await import('../electron/protocol/sync-v2-request.ts');
const {
  buildRequestSyncFrame, buildRequestSyncPayload, parseRequestSyncReply,
  RequestSyncCmd, REQUEST_SYNC_REPLY_TIMEOUT_MS,
} = await import('../electron/protocol/request-sync-ws.ts');

/**
 * Hình dạng yêu cầu Sync V2 — kiểm trên giá trị thuần, không chạm mạng.
 *
 * Endpoint HTTP `/api/transfer-sync-v2/request-sync` đã bị **bỏ hẳn** khỏi đây:
 * nó không tồn tại trên máy chủ (`404 text/html` trên cả 46 origin service map,
 * đo 2026-11-10). Gửi qua WS `cmd 590` mới là đường Zalo PC đi thật.
 *
 * Thứ dễ sai ở đây là **hình dạng thân**: `590` bọc payload trong `data` và đặt
 * `reqId` ở **tầng ngoài** của `data` — hai tầng, khác `592` một tầng. Sai một
 * tầng thì máy chủ im 15 s (đo R12 2026-11-09). Không có lỗi nào để đọc, nên
 * chỉ test mới bắt được.
 */

const payload = {
  syncId: 'a'.repeat(32),
  syncType: 0,
  ek: 'ek-b64',
  ik: 'ik-b64',
  toDevice: 0,
  tempKey: '',
  deviceName: 'pc-test',
  req: { type: SyncDatabaseType.MESSAGE, priority: SyncPriority.NORMAL, queries: [], batchSize: 2000 },
  ver: 1,
  ussidx: 3,
};

test('mã đúng: 590 ở cmd, 0 ở subCmd, version 1', () => {
  const frame = buildRequestSyncFrame(payload, 'req-1');
  assert.equal(RequestSyncCmd.REQUEST, 590);
  assert.equal(frame.cmd, 590);
  assert.equal(frame.subCmd, 0);
  assert.equal(frame.version, 1);
});

/**
 * Lỗi chặn cả đường đồng bộ, khoá lại ở đây.
 *
 * `req.type` là **tên database**, không phải mã số. Ghép sai kiểu thì máy chủ
 * vẫn trả `code: 0` (nó chỉ kiểm phong bì) nhưng không có database nào để đẩy
 * dữ liệu — đúng hiện tượng "yêu cầu được nhận, không gói nào về".
 */
test('req.type là tên database dạng chuỗi, không phải mã số', () => {
  assert.equal(SyncDatabaseType.MESSAGE, 'message');
  assert.equal(SyncDatabaseType.CONVERSATION, 'conversation');
  const built = buildRequestSyncPayload({
    syncId: 's'.repeat(32), ek: 'e', ik: 'i', tempKey: '', deviceName: 'pc',
    type: SyncDatabaseType.MESSAGE, priority: SyncPriority.NORMAL,
    queries: [], batchSize: 2000, ussidx: 0,
  });
  assert.equal(typeof built.req.type, 'string');
  assert.equal(JSON.stringify(built).includes('"type":"message"'), true);
});

test('phân vùng hội thoại: oneone/<id> và group/<id>, với global noised id', () => {
  assert.equal(partitionOf(false, 'abc123'), 'oneone/abc123');
  assert.equal(partitionOf(true, 'abc123'), 'group/abc123');
});

test('`limit` vô hạn là 2147483647, không phải 0', () => {
  // `yo.a` trong `/sYZ`. `0` là "xin 0 dòng" — cùng một chỗ sai với `req.type`:
  // máy chủ nhận yêu cầu và trả về rỗng, không có lỗi nào để đọc.
  assert.equal(SYNC_UNLIMITED_LIMIT, 2147483647);
});

test('hai tầng: payload nằm trong `data`, `reqId` ở tầng ngoài của `data`', () => {
  const frame = buildRequestSyncFrame(payload, 'req-1');
  // `requestAsyncV2` → `addCommonParams`: `data = { ...e.data, reqId }` mà
  // `e.data` là `{ data: payload }` từ `requestSyncMessage`.
  assert.deepEqual(Object.keys(frame.data).sort(), ['data', 'reqId']);
  assert.equal(frame.data.reqId, 'req-1');
  assert.deepEqual(frame.data.data, payload, 'payload nguyên vẹn, không đổi tầng');
});

test('`592` truyền `data` phẳng, `590` bọc hai tầng — không chép nhầm', () => {
  const frame = buildRequestSyncFrame(payload, 'r');
  // Khẳng định điểm khác: không có trường nào của payload nằm ngang tầng `reqId`.
  assert.equal('syncId' in frame.data, false);
  assert.equal('ek' in frame.data, false);
  assert.equal(frame.data.data.syncId, payload.syncId);
});

test('tempKey rỗng được giữ nguyên là chuỗi rỗng, không bị bỏ hay thành undefined', () => {
  // `manualSync` của Zalo PC gửi không có `tempKey`; `initNewMachineInfo` biến
  // thiếu thành `""`. JSON.stringify bỏ `undefined` — trường mất hẳn trên dây.
  const frame = buildRequestSyncFrame(buildRequestSyncPayload({
    syncId: 'x'.repeat(32), ek: 'e', ik: 'i', tempKey: '', deviceName: 'pc',
    type: SyncDatabaseType.MESSAGE, priority: SyncPriority.NORMAL, queries: [], batchSize: 2000, ussidx: 0,
  }), 'r');
  assert.equal(frame.data.data.tempKey, '');
  assert.equal(JSON.stringify(frame.data.data).includes('"tempKey":""'), true);
});

test('payload: đủ trường, toDevice mặc định là Mobile', () => {
  const built = buildRequestSyncPayload({
    syncId: 's'.repeat(32), ek: 'e', ik: 'i', tempKey: 'k', deviceName: 'pc',
    type: SyncDatabaseType.CONVERSATION, priority: SyncPriority.HIGH,
    queries: [{ partition: 'p', from: 0, to: 0, limit: 0 }], batchSize: 500, ussidx: 7,
  });
  assert.deepEqual(Object.keys(built).sort(), [
    'deviceName', 'ek', 'ik', 'req', 'syncId', 'syncType', 'tempKey', 'toDevice', 'ussidx', 'ver',
  ]);
  assert.equal(built.toDevice, SyncDeviceType.MOBILE);
  assert.equal(built.req.type, SyncDatabaseType.CONVERSATION);
  assert.equal(built.req.type, 'conversation');
  assert.equal(built.req.priority, SyncPriority.HIGH);
  assert.equal(built.req.batchSize, 500);
  assert.equal(built.ver, 1);
  assert.equal(built.ussidx, 7);
});

test('phản hồi không mang reqId vẫn được coi là khớp', () => {
  // Đo 2026-11-09: `590` trả `errorCode: 0` với `innerDataChars: 0` — không dội
  // lại `reqId`. Đòi khớp sẽ biến phản hồi thật thành "không phải cho ta".
  const reply = parseRequestSyncReply({ error_code: 0, data: {} }, 'req-1');
  assert.equal(reply.matched, true);
  assert.equal(reply.code, 0);
});

test('phản hồi mang reqId khác thì không khớp', () => {
  const reply = parseRequestSyncReply({ error_code: 0, data: { reqId: 'khac' } }, 'req-1');
  assert.equal(reply.matched, false);
});

test('phản hồi mang reqId đúng ở cả hai tầng đều khớp', () => {
  assert.equal(parseRequestSyncReply({ data: { reqId: 'r' } }, 'r').matched, true);
  assert.equal(parseRequestSyncReply({ data: { data: { reqId: 'r' } } }, 'r').matched, true);
});

test('mã lỗi và thông điệp máy chủ được đọc ra, không bị nuốt', () => {
  const reply = parseRequestSyncReply({
    error_code: 604, error_message: 'session invalid', data: {},
  }, 'r');
  assert.equal(reply.code, 604);
  assert.equal(reply.message, 'session invalid');
});

test('phong bì rỗng hay không phải object: không khớp, không có mã, không ném', () => {
  assert.deepEqual(parseRequestSyncReply(null, 'r'), { matched: false, code: null, message: null });
  assert.deepEqual(parseRequestSyncReply('xu', 'r'), { matched: false, code: null, message: null });
});

test('thông điệp máy chủ bị cắt — log không mang câu dài tuỳ ý vào', () => {
  const reply = parseRequestSyncReply({ error_code: 1, error_message: 'x'.repeat(1000) }, 'r');
  assert.equal(reply.message?.length, 160);
});

test('hạn chờ phản hồi là 10 s — đúng `t = 1e4` của Zalo PC', () => {
  assert.equal(REQUEST_SYNC_REPLY_TIMEOUT_MS, 10_000);
});

test('tối đa 30 query mỗi yêu cầu — `getQueryCount()<30` trong `buildPrepareQuery`', () => {
  // Vượt 30 không bị từ chối bằng mã lỗi: máy chủ đóng kết nối `1009` (frame quá
  // lớn). Đo thật 2026-11-10 13:49:50 với 363 partition.
  assert.equal(SYNC_MAX_QUERIES_PER_REQUEST, 30);
});

test('syncId: 32 ký tự, chỉ chữ và số, dùng hết bảng chữ khi byte đều nhau', () => {
  // Toàn số 0 → mọi ký tự là 'A'; khẳng định bảng chữ và độ dài.
  const id = generateSyncId((size) => new Uint8Array(size));
  assert.equal(id.length, 32);
  assert.match(id, /^[A-Za-z0-9]+$/);
  assert.equal(id, 'A'.repeat(32));

  // Byte tăng dần → phải sinh 32 ký tự khác nhau, không lặp cùng một ký tự.
  const varied = generateSyncId((size) => Uint8Array.from({ length: size }, (_, i) => i * 2));
  assert.equal(new Set(varied).size > 1, true);
});

test('userSyncSessionId: 16 ký tự', () => {
  const id = generateUserSyncSessionId((size) => new Uint8Array(size).fill(1));
  assert.equal(id.length, 16);
});
