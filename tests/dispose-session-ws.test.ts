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
  buildDisposeSessionFrame, buildDisposeSessionPayload, parseDisposeSessionReply,
  DisposeSessionCmd, DISPOSE_REPLY_TIMEOUT_MS, SyncReleaseReason,
} = await import('../electron/protocol/dispose-session-ws.ts');

/**
 * `cmd 591` — `ACK_DELETE_SYNC_SESSION`, bước giải phóng phiên phía máy chủ.
 *
 * Zalo PC luôn gọi nó khi `sync-full` kết thúc (cả thành công lẫn hỏng). Repo
 * này trước đây không gửi, nên mỗi lần bấm đồng bộ lại để lại một phiên mở.
 */

test('mã đúng: 591 ở cmd, 0 ở subCmd, version 1', () => {
  const frame = buildDisposeSessionFrame('sync-1', SyncReleaseReason.SYNC_SUCCESS, 'req-1');
  assert.equal(DisposeSessionCmd.ACK_DELETE, 591);
  assert.equal(frame.cmd, 591);
  assert.equal(frame.subCmd, 0);
  assert.equal(frame.version, 1);
});

test('hai tầng như `590`: payload trong `data`, `reqId` ở tầng ngoài của `data`', () => {
  // `ackDeleteSyncSession` của Zalo PC: `data: { data: e }`, rồi
  // `addCommonParams` chèn `reqId` vào tầng ngoài. Khác `592` (phẳng).
  const frame = buildDisposeSessionFrame('sync-1', SyncReleaseReason.ERROR, 'req-1');
  assert.deepEqual(Object.keys(frame.data).sort(), ['data', 'reqId']);
  assert.equal(frame.data.reqId, 'req-1');
  assert.deepEqual(frame.data.data, { syncId: 'sync-1', toDevice: 0, reason: 2 });
});

test('payload: ba trường, đúng thứ tự {syncId, toDevice, reason}', () => {
  const payload = buildDisposeSessionPayload('sync-1', SyncReleaseReason.SYNC_SUCCESS);
  assert.deepEqual(payload, { syncId: 'sync-1', toDevice: 0, reason: 1 });
  // `reqId` không nằm trong payload — nó ở tầng ngoài.
  assert.equal('reqId' in payload, false);
});

test('lý do giải phóng: đúng bảng `Xde.a` của Zalo PC', () => {
  assert.deepEqual(SyncReleaseReason, {
    USER_CANCEL: 0, SYNC_SUCCESS: 1, ERROR: 2, OUT_DATED: 3,
  });
});

test('hạn chờ là 3 s — đúng `t = 3e3` của `ackDeleteSyncSession`, khác 590', () => {
  assert.equal(DISPOSE_REPLY_TIMEOUT_MS, 3_000);
});

test('phản hồi không mang reqId vẫn khớp', () => {
  const reply = parseDisposeSessionReply({ error_code: 0, data: {} }, 'req-1');
  assert.equal(reply.matched, true);
  assert.equal(reply.code, 0);
});

test('phản hồi mang reqId khác thì không khớp', () => {
  assert.equal(parseDisposeSessionReply({ data: { reqId: 'khac' } }, 'req-1').matched, false);
});

test('mã lỗi và thông điệp được đọc ra; phong bì rỗng không ném', () => {
  const reply = parseDisposeSessionReply({ error_code: 604, error_message: 'session invalid' }, 'r');
  assert.equal(reply.code, 604);
  assert.equal(reply.message, 'session invalid');
  assert.deepEqual(parseDisposeSessionReply(null, 'r'), { matched: false, code: null, message: null });
});
