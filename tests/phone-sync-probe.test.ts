import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { registerHooks } from 'node:module';

// `electron/` biên dịch sang CommonJS nên import nội bộ ghi `./cloud-crypto.js`;
// chạy thẳng `.ts` thì đuôi đó không tồn tại. Cùng hook với hai test kia.
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

const { probePullMobileMsg, generateSyncPublicKey } =
  await import('../electron/protocol/phone-sync-probe.ts');
const { encryptAes, decryptAes } = await import('../electron/protocol/cloud-crypto.ts');

/**
 * Phép đo `pull_mobile_msg` — 2026-11-09.
 *
 * Test này khoá **hình dạng request**, không khoá việc máy chủ có nhận hay
 * không. Đó là chia đôi có chủ ý: nếu lần chạy thật trả `604` thì bằng chứng
 * "hình dạng đúng" phải đến từ đây, nếu không ta không phân biệt được "gọi sai"
 * với "máy chủ chặn" — và hai kết luận đó dẫn tới hai việc làm khác hẳn nhau.
 *
 * Lần chạy đầu (cùng ngày) trả `114` — nhưng vì test này chưa khoá hình dạng
 * `public_key`, lỗi nằm ở phía ta chứ không phải ở máy chủ. Hai test cuối là
 * phần bù cho đúng lỗ hổng đó.
 */

const KEY = randomBytes(32).toString('base64');

const base = {
  baseUrl: 'https://tt-files-wpa.chat.zalo.me',
  pcName: 'fedora-test',
  publicKey: generateSyncPublicKey(),
  fromSeqId: 0,
  tempKey: '',
  imei: 'imei-test',
  secretKey: KEY,
  cookie: 'zpw_sek=abc',
  userAgent: 'test-agent',
  apiVersion: 695,
  apiType: 30,
};

interface Captured { url: URL; headers: Record<string, string> }

/** Trả `error_code: 0` ở lớp ngoài và một `data` đã mã hoá ở lớp trong. */
function stub(inner: Record<string, unknown>) {
  const captured: Captured[] = [];
  const fake = async (input: URL | string, init?: RequestInit): Promise<Response> => {
    captured.push({ url: new URL(String(input)), headers: (init?.headers ?? {}) as Record<string, string> });
    return new Response(JSON.stringify({
      error_code: 0,
      data: encryptAes(KEY, JSON.stringify(inner)),
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { captured, fake };
}

async function run(overrides: Record<string, unknown> = {}) {
  const { captured, fake } = stub(overrides.inner as Record<string, unknown> ?? { error_code: 0 });
  const original = globalThis.fetch;
  globalThis.fetch = fake as unknown as typeof fetch;
  try {
    const result = await probePullMobileMsg({ ...base, ...(overrides.base as object ?? {}) });
    return { captured, result };
  } finally { globalThis.fetch = original; }
}

test('gửi đúng endpoint, đúng params giải ra đúng hình dạng pullMobileMsg', async () => {
  const { captured } = await run();
  assert.equal(captured.length, 1);
  const { url, headers } = captured[0];
  assert.equal(url.pathname, '/api/message/pull_mobile_msg');
  // Chỉ hai trường này là `_getCommonParams()` của Zalo PC — không chữ ký, không
  // tầng nào khác. Thêm trường lạ vào đây là làm sai hình dạng.
  assert.deepEqual([...url.searchParams.keys()].sort(), ['params', 'zpw_type', 'zpw_ver']);
  assert.equal(url.searchParams.get('zpw_ver'), '695');
  assert.equal(url.searchParams.get('zpw_type'), '30');
  const params = JSON.parse(decryptAes(KEY, url.searchParams.get('params') ?? ''));
  assert.deepEqual(params, {
    pc_name: 'fedora-test',
    public_key: base.publicKey,
    from_seq_id: 0,
    is_retry: 0,
    min_seq_id: 0,
    temp_key: '',
    imei: 'imei-test',
  }, 'tên trường phải khớp `pullMobileMsg` của Zalo PC từng chữ');
  assert.equal(headers.Cookie, 'zpw_sek=abc');
  assert.equal(headers.Origin, 'https://chat.zalo.me');
});

test('`params` không bao giờ xuất hiện trong URL trả về — nó chứa IMEI và khoá', async () => {
  const { result } = await run({ inner: { error_code: 604 } });
  assert.ok(result.url.includes('pull_mobile_msg'));
  assert.match(result.url, /params=%3Credacted%3E|params=<redacted>/);
  // Không được là bản mã hoá: `params` là chỗ chứa IMEI, PC name và temp_key.
  assert.doesNotMatch(result.url, /params=[A-Za-z0-9%]{40,}/);
});

test('604 được giữ nguyên mã — đó là toàn bộ câu trả lời của phép đo', async () => {
  const { result } = await run({ inner: { error_code: 604, error_message: 'Lỗi không xác định' } });
  assert.equal(result.code, 604, '`604` phải đọc được là `604`, không bị gộp thành lỗi chung');
  assert.equal(result.code, 604);
});

test('mã lỗi lớp ngoài cũng được giữ, không bị lớp trong ghi đè', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ error_code: 604, error_message: 'outer' }),
    { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
  try {
    const result = await probePullMobileMsg(base);
    assert.equal(result.code, 604);
    assert.equal(result.message, 'outer');
  } finally { globalThis.fetch = original; }
});

test('lỗi mạng trả `network`, không bị đọc nhầm thành máy chủ từ chối', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
  try {
    const result = await probePullMobileMsg(base);
    assert.equal(result.code, 'network');
    assert.match(result.message, /ECONNREFUSED/);
  } finally { globalThis.fetch = original; }
});

test('khoá sai độ dài là lỗi `crypto` của ta, không phải câu trả lời của máy chủ', async () => {
  const result = await probePullMobileMsg({ ...base, secretKey: randomBytes(20).toString('base64') });
  assert.equal(result.code, 'crypto');
});

test('`publicKeyBytes` để đọc được "604 vì khoá sai hình dạng" hay "vì phiên"', async () => {
  const { result } = await run({ inner: { error_code: 604 } });
  assert.equal(result.publicKeyBytes, 294, '294 byte là DER của RSA-2048 spki');
});

/**
 * Hai test dưới đây là phần bù cho lần đo hỏng đầu tiên. Chúng khoá **định
 * dạng khoá**, thứ duy nhất phân biệt `114 vì ta gửi sai` với `114 vì máy chủ
 * từ chối`. Nếu thiếu chúng thì một lần nữa `114` lại không đọc được là gì.
 */

test('`public_key` đúng định dạng Zalo PC gửi: RSA-2048 spki/der base64', () => {
  const key = generateSyncPublicKey();
  const der = Buffer.from(key, 'base64');
  assert.equal(der.length, 294, 'RSA-2048 spki/der luôn 294 byte');
  // Tiền tố DER: SEQUENCE, len 0x0122, SEQUENCE, OID 1.2.840.113549.1.1.1 (rsaEncryption), NULL, BIT STRING.
  assert.equal(der.subarray(0, 20).toString('hex'),
    '30820122300d06092a864886f70d010101050003');
  assert.doesNotMatch(key, /BEGIN/, 'không phải PEM — Zalo PC xuất `{publicKey: "base64"}` không header');
  // Không phải X25519: khoá X25519 chỉ 32 byte, và đó chính là cái đã làm hỏng lần đo đầu.
  assert.notEqual(der.length, 32);
});

test('`from_seq_id` theo đúng phép lật dấu của `pullMobileMsg`', async () => {
  const cases: Array<[number, number]> = [
    [-1, 0],  // `t < 0` → log lỗi rồi `t = 0`
    [0, 0],   // `t` falsy → `t = 0`
    [7, 8],   // có mốc → `t += 1`
  ];
  for (const [input, expected] of cases) {
    const { captured } = await run({ base: { fromSeqId: input } });
    const params = JSON.parse(decryptAes(KEY, captured[0].url.searchParams.get('params') ?? ''));
    assert.equal(params.from_seq_id, expected, `fromSeqId ${input} phải thành ${expected}`);
  }
});

/**
 * Phép đo thứ hai. Lần đầu chỉ hỏi "máy chủ có nhận request không" và vứt bỏ
 * `data` — nên `code: 0` không phân biệt được "đồng bộ rỗng" với "máy chủ có
 * gói tin chờ". Ba test dưới đây khoá phần đọc `data` mà **không** đọc nội dung.
 */

test('`payload` ghi tên khoá và kích thước, không ghi giá trị', async () => {
  const secret = 'TIN-NHAN-BI-MAT-CUA-NGUOI-DUNG';
  const { result } = await run({ inner: { error_code: 0, data: { bundles: secret, seq: 12 } } });
  assert.deepEqual(result.payload.keys, ['bundles', 'seq']);
  assert.equal(result.payload.chars, secret.length);
  // Bằng chứng quan trọng nhất: chuỗi bí mật không xuất hiện ở đâu trong kết quả.
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
});

test('`nestedBytes` chỉ đếm base64 dài, để phân biệt gói rỗng với gói thật', async () => {
  const blob = Buffer.alloc(2048, 7).toString('base64');
  const { result } = await run({ inner: { error_code: 0, data: { blob, short: 'abc' } } });
  assert.equal(result.payload.nestedBytes, blob.length);
  assert.ok(result.payload.nestedBytes > 2048, 'gói 2 KB phải đọc ra là có dữ liệu');
});

test('`data` rỗng cho hình dạng rỗng, không phải lỗi', async () => {
  const { result } = await run({ inner: { error_code: 0, data: {} } });
  assert.equal(result.code, 0);
  assert.deepEqual(result.payload, { keys: [], chars: 0, nestedBytes: 0 });
});
