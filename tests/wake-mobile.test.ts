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

const { buildWakeMobileFrame, buildWakeMobilePayload, parseWakeReply, WakeMobileCmd, WAKE_REPLY_TIMEOUT_MS, WAKE_SESSION_TIMEOUT_MS } =
  await import('../electron/protocol/wake-mobile.ts');

/**
 * Phép đo này khoá những chi tiết dễ chép sai: `requestMobileWakeUp` của Zalo PC
 * **không** bọc `data` như `requestSyncMessage` ngay cạnh nó, nhưng **có** mang
 * `reqId` — do `addCommonParams` chèn vào `data`, không phải `data.data`. Sai
 * một trong hai không làm gì ném lỗi: máy chủ chỉ im lặng, và một im lặng trông
 * giống hệt "đã đánh thức xong".
 */

test('mã đúng: 592, không phải 590 hay 592 ở subCmd', () => {
  const frame = buildWakeMobileFrame('a'.repeat(32), 'wake_1');
  assert.equal(frame.cmd, 592);
  assert.equal(WakeMobileCmd.REQUEST_MOBILE_WAKE_UP, 592);
  assert.equal(frame.subCmd, 0);
  assert.equal(frame.version, 1);
});

test('`data` KHÔNG bọc `{ data: … }` — khác `590` ở đúng điểm này', () => {
  const frame = buildWakeMobileFrame('sync-1', 'wake_1');
  assert.deepEqual(Object.keys(frame.data).sort(), ['reqId', 'syncId', 'toDevice'],
    'chỉ ba trường; thêm `data` lồng là hình dạng của `590`, không phải `592`');
  assert.equal('data' in frame.data, false);
});

test('`reqId` nằm ở `data.reqId` — một tầng, không phải `data.data.reqId`', () => {
  // `addCommonParams` của Zalo PC (`compact-app-pc:630522-630525`):
  //   { ...e, data: { ...e.data, reqId } }
  // `onData` tra `n.data.reqId` (`:630463`); sai tầng thì không ai nhận.
  const frame = buildWakeMobileFrame('sync-1', 'wake_abc');
  assert.equal(frame.data.reqId, 'wake_abc');
  assert.equal(JSON.stringify(frame).includes('data":{"data"'), false);
});

test('không mang khoá nào — đánh thức là bước TRƯỚC khi có khoá', () => {
  const serialised = JSON.stringify(buildWakeMobileFrame('sync-1', 'wake_1'));
  for (const field of ['tempKey', 'ek', 'ik', 'deviceName', 'ussidx']) {
    assert.equal(serialised.includes(field), false, `không được có \`${field}\` ở bước đánh thức`);
  }
});

test('toDevice mặc định là Mobile (0) — cùng enum với `590`', () => {
  assert.equal(buildWakeMobilePayload('s', 'r').toDevice, 0);
  assert.equal(buildWakeMobileFrame('s', 'r').data.toDevice, 0);
});

test('syncId đi nguyên vẹn: hai bước phải dùng CÙNG một chuỗi', () => {
  // Zalo PC ràng buộc `wakeup()` và request bằng chính `this.syncId`. Một
  // `syncId` khác ở `590` làm phiên đã đánh thức thành mồ côi.
  const syncId = 'x7Kq2mNp4Rt8vWbY1ZcD5fGh6JkL0aSe';
  assert.equal(buildWakeMobilePayload(syncId, 'r').syncId, syncId);
  assert.equal(buildWakeMobileFrame(syncId, 'r').data.syncId, syncId);
});

test('toDevice khác Mobile vẫn dựng được, không bị ép về 0', () => {
  assert.equal(buildWakeMobilePayload('s', 'r', 2).toDevice, 2, 'PC = 2 — hàm không được tự ý sửa tham số');
});

test('syncId rỗng: hàm không ném, nhưng hình dạng vẫn đúng để phía gọi tự kiểm', () => {
  // Không ném ở đây là cố ý: một hàm dựng payload không phải chỗ phán xét hợp
  // lệ. Ném sẽ biến một tham số sai thành ngoại lệ giữa luồng đồng bộ, khó lần
  // hơn là một khung bị máy chủ từ chối và ghi lại được.
  assert.deepEqual(buildWakeMobilePayload('', 'r'), { syncId: '', toDevice: 0, reqId: 'r' });
});

/**
 * `parseWakeReply` — đọc phản hồi. `wakeup()` của Zalo PC chỉ hẹn giờ nhận gói
 * khi `0 == e.code`, nên "khớp reqId" và "code bằng 0" là hai điều kiện khác
 * nhau, và cả hai đều phải đúng trước khi coi là đã đánh thức.
 */

test('khớp `reqId` và `code: 0` là lời xác nhận duy nhất được coi là thành công', () => {
  assert.deepEqual(parseWakeReply({ error_code: 0, data: { reqId: 'wake_1' } }, 'wake_1'),
    { matched: true, code: 0 });
});

test('`reqId` khác thì không khớp — phản hồi của lần gọi khác không được nhận', () => {
  assert.equal(parseWakeReply({ data: { reqId: 'wake_2' } }, 'wake_1').matched, false);
});

test('`reqId` lồng sâu ở `data.data.reqId` KHÔNG khớp — đúng cái bẫy sẽ làm hỏng bước này', () => {
  // Đây là hình dạng của `590`; `592` không dùng tầng đó.
  assert.equal(parseWakeReply({ data: { data: { reqId: 'wake_1' } } }, 'wake_1').matched, false);
});

test('không có `code` thì trả `null`, không đoán `0` — phong bì câm không phải lời xác nhận', () => {
  assert.deepEqual(parseWakeReply({ data: { reqId: 'wake_1' } }, 'wake_1'), { matched: true, code: null });
});

test('`error_code` cũng là mã — cùng hình dạng với `590`, không phải trường lạ', () => {
  assert.equal(parseWakeReply({ error_code: 12888, data: { reqId: 'wake_1' } }, 'wake_1').code, 12888);
});

test('mã lỗi *vẫn* khớp `reqId` — phía gọi phải tự đọc cả hai, không được suy ra từ một cái', () => {
  // Một phản hồi từ chối là câu trả lời thật cho lần gọi này. Gộp "khớp" với
  // "thành công" sẽ biến lời từ chối thành im lặng, và im lặng thì không nói
  // được gì về việc điện thoại có nhận lệnh hay không.
  const answer = parseWakeReply({ error_code: -1, data: { reqId: 'wake_1' } }, 'wake_1');
  assert.equal(answer.matched, true);
  assert.equal(answer.code, -1);
});

test('payload không phải object: không khớp, không ném', () => {
  for (const bad of [null, undefined, 'x', 42, []]) {
    assert.deepEqual(parseWakeReply(bad, 'wake_1'), { matched: false, code: null });
  }
});

test('hạn chờ đúng con số của Zalo PC: 3 000 ms', () => {
  // `requestMobileWakeUp(e, t = 3e3)` — `compact-app-pc:630619`. Một hạn dài
  // hơn biến "máy chủ không trả lời" thành một lần chờ dài trước khi phiên
  // hỏng; ngắn hơn thì cắt ngang phản hồi hợp lệ trên mạng chậm.
  assert.equal(WAKE_REPLY_TIMEOUT_MS, 3_000);
});

test('hạn của PHIÊN là 180 s, tách hẳn khỏi hạn phản hồi 592', () => {
  // Hai con số này từng bị dùng lẫn, và đó là lỗi của R17: `592` im lặng 3 s bị
  // coi là phiên hỏng, trong khi điện thoại vẫn thức và trả lời ở giây thứ 104.
  // `180e3` là `SessionManager.options.wakeupTimeout` của Zalo PC.
  assert.equal(WAKE_SESSION_TIMEOUT_MS, 180_000);
  assert.notEqual(WAKE_SESSION_TIMEOUT_MS, WAKE_REPLY_TIMEOUT_MS);
  assert.ok(WAKE_SESSION_TIMEOUT_MS > 104_000,
    'phải rộng hơn 104 s mà điện thoại thật cần để xác nhận (R17 §1)');
});
