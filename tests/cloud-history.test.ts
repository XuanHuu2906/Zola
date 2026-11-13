import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { registerHooks } from 'node:module';

// `electron/` biên dịch sang CommonJS nên import nội bộ ghi `./mapper.js`; chạy
// thẳng `.ts` thì đuôi đó không tồn tại. Cùng hook với `tests/zalo-cache.test.ts`.
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

const { encryptAes, decryptAes } = await import('../electron/protocol/cloud-crypto.ts');
const { fetchCloudHistory } = await import('../electron/protocol/cloud-history.ts');

/**
 * Đường HTTP `/api/cm/getoldv2` — phép đo 2026-11-08. zca-js 2.2.0 không có API
 * lịch sử 1-1, và `cmd 510` là hàng đợi catch-up (đọc từ mã Zalo PC), nên phần
 * giao thức phải tự viết. Test ở đây khoá **hình dạng** cuộc gọi và cách đọc
 * response, không khoá việc máy chủ có chấp nhận hội thoại 1-1 hay không — đó là
 * thứ chỉ một lần chạy thật mới trả lời được.
 */

/** Giải AES-CBC IV=0 bằng chính hàm của module, để test không tự dựng lại chuỗi ống. */
const decrypt = (secretKey: string, base64: string): string => decryptAes(secretKey, base64);

const KEY = randomBytes(32).toString('base64');

test('mã hoá params đối xứng và URL-safe theo đúng kiểu zca-js', () => {
  const encrypted = encryptAes(KEY, JSON.stringify({ groupId: '123', count: 15 }));
  assert.equal(JSON.parse(decrypt(KEY, encrypted)).groupId, '123',
    'giải lại phải ra đúng dữ liệu vào — sai IV hay sai mode là hỏng ngay');
});

test('khoá 16 byte dùng AES-128, khoá 24 byte dùng AES-192 — như CryptoJS', () => {
  // Lỗi thật đo được 2026-11-08: `zpw_enk` của phiên phụ không phải 32 byte, và
  // ép cứng aes-256-cbc làm request đầu tiên ném `RangeError: Invalid key length`.
  // CryptoJS chọn biến thể theo độ dài khoá, nên phần này phải làm y hệt.
  for (const bytes of [16, 24]) {
    const key = randomBytes(bytes).toString('base64');
    const encrypted = encryptAes(key, '{"a":1}');
    assert.equal(decrypt(key, encrypted), '{"a":1}');
  }
});

test('độ dài khoá lạ bị từ chối rõ ràng, không lặng lẽ nắn thành AES-256', () => {
  assert.throws(() => encryptAes(randomBytes(20).toString('base64'), 'x'), /16, 24 hoặc 32/);
});

interface Captured {
  url: URL;
  headers: Record<string, string>;
}

/** Bơm `fetch` giả, trả response đã mã hoá đúng hai lớp như máy chủ Zalo. */
function stubFetch(body: Record<string, unknown>, outerError = 0) {
  const captured: Captured[] = [];
  const fake = async (input: URL | string, init?: RequestInit): Promise<Response> => {
    captured.push({
      url: new URL(String(input)),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const inner = encryptAes(KEY, JSON.stringify({ error_code: 0, data: body }));
    return new Response(JSON.stringify({ error_code: outerError, data: inner }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { captured, fake };
}

const base = {
  baseUrl: 'https://group-cm.api.zalo.me',
  groupId: '1234567890',
  kind: 'group' as const,
  globalMsgId: '8465385707624',
  count: 15,
  imei: 'imei-test',
  secretKey: KEY,
  cookie: 'zpw_sek=abc',
  userAgent: 'test-agent',
  apiVersion: 695,
  apiType: 30,
};

test('gửi đúng endpoint, đúng tham số chung, và params giải ra đúng hình dạng getCM', async () => {
  const { captured, fake } = stubFetch({ groupMsgs: [], hasMore: false });
  const original = globalThis.fetch;
  globalThis.fetch = fake as unknown as typeof fetch;
  try {
    await fetchCloudHistory(base);
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(captured.length, 1);
  const { url, headers } = captured[0];
  assert.equal(url.pathname, '/api/cm/getoldv2');
  assert.equal(url.searchParams.get('zpw_ver'), '695');
  assert.equal(url.searchParams.get('zpw_type'), '30');
  const params = JSON.parse(decrypt(KEY, url.searchParams.get('params') ?? ''));
  assert.deepEqual(params, {
    groupId: '1234567890', globalMsgId: '8465385707624', count: 15, msgIds: [], imei: 'imei-test', src: -1,
  }, 'tên trường và giá trị mặc định phải khớp `getCM` của Zalo PC');
  assert.equal(headers.Cookie, 'zpw_sek=abc');
  assert.equal(headers.Origin, 'https://chat.zalo.me');
});

test('đọc được trường lastMsgId/hasMore để lật trang', async () => {
  const { fake } = stubFetch({
    groupMsgs: [
      { msgId: '100', cliMsgId: '1', uidFrom: '999', idTo: '1234567890', ts: '1700000000000', msgType: 1, content: 'cũ hơn' },
    ],
    hasMore: true,
    isOld: false,
    lastMsgId: '100',
  });
  const original = globalThis.fetch;
  globalThis.fetch = fake as unknown as typeof fetch;
  try {
    const page = await fetchCloudHistory(base);
    assert.equal(page.error, undefined);
    assert.equal(page.hasMore, true);
    assert.equal(page.lastMsgId, '100');
    assert.equal(page.messages.length, 1);
    assert.equal(page.messages[0].text, 'cũ hơn');
    assert.equal(page.messages[0].threadId, '1234567890');
  } finally {
    globalThis.fetch = original;
  }
});

test('uidFrom "0" là chính mình, không phải người khác', async () => {
  const { fake } = stubFetch({
    groupMsgs: [{ msgId: '101', cliMsgId: '2', uidFrom: '0', idTo: '1234567890', ts: '1700000000000', msgType: 1, content: 'của tôi' }],
    hasMore: false,
  });
  const original = globalThis.fetch;
  globalThis.fetch = fake as unknown as typeof fetch;
  try {
    const page = await fetchCloudHistory(base);
    assert.equal(page.messages[0].from, 'me');
  } finally {
    globalThis.fetch = original;
  }
});

test('máy chủ từ chối: giữ nguyên mã lỗi, không giả thành "hết lịch sử"', async () => {
  // Đây chính là câu hỏi của phép đo: nếu server chặn 1-1 thì phải thấy mã lỗi
  // thật trong log, không phải một trang rỗng trông như đã tải hết.
  const { fake } = stubFetch({}, 114);
  const original = globalThis.fetch;
  globalThis.fetch = fake as unknown as typeof fetch;
  try {
    const page = await fetchCloudHistory(base);
    assert.ok(page.error, 'phải có error');
    assert.equal(page.error.code, 114);
    assert.equal(page.messages.length, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test('lỗi mạng: trả error thay vì ném, để tầng trên còn ghi log', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
  try {
    const page = await fetchCloudHistory(base);
    assert.equal(page.error?.code, 'network');
    assert.match(page.error?.message ?? '', /ECONNREFUSED/);
  } finally {
    globalThis.fetch = original;
  }
});

test('khoá sai độ dài là lỗi `crypto`, không bị đọc nhầm thành máy chủ từ chối', async () => {
  // Nếu mã hoá hỏng mà trả `network` hay mã lỗi số, phép đo sẽ kết luận sai về
  // phía Zalo. Mã `crypto` tách bạch "lỗi của ta" khỏi "máy chủ nói gì".
  const page = await fetchCloudHistory({ ...base, secretKey: randomBytes(20).toString('base64') });
  assert.equal(page.error?.code, 'crypto');
  assert.equal(page.messages.length, 0);
});
