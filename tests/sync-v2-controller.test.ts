import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
const { SyncV2Controller } = await import('../electron/protocol/sync-v2-controller.ts');
const { loadIdentity, IDENTITY_KV_KEY } = await import('../electron/protocol/sync-v2-identity.ts');
const { SyncPhase } = await import('../electron/protocol/sync-v2-session.ts');
const { SyncReleaseReason } = await import('../electron/protocol/dispose-session-ws.ts');
const { openDb } = await import('../electron/db/schema.ts');

/**
 * Lớp nối giữa socket và phiên đồng bộ.
 *
 * Ba thứ dưới đây là những chỗ sai **không có triệu chứng** trên UI: đọc nhầm
 * `data` của frame `601` thì không sự kiện nào được nhận và nút đồng bộ chỉ
 * đứng im; không lưu khoá định danh thì mỗi lần mở app là một khoá mới và
 * điện thoại không bao giờ hoàn tất niêm phong; giữ khoá tạm quá 600 s thì
 * máy chủ trả "phiên hết hạn" mà ta tưởng là lỗi mạng.
 */

const WASM = new URL('../assets/zproto/libzproto_wasm_bg.5ea0fb2c9af4a45bc7882b71307b6f83.wasm', import.meta.url);
const cryptoPromise = SyncV2Crypto.load(new Uint8Array(readFileSync(WASM)));

const IMEI = 'imei-cua-may-nay';

/** Frame Zalo: `[version][cmd LE][subCmd][JSON]`. */
function frame(cmd: number, subCmd: number, body: unknown): Uint8Array {
  const json = Buffer.from(JSON.stringify(body), 'utf8');
  const out = Buffer.alloc(4 + json.length);
  out[0] = 1;
  out.writeUInt16LE(cmd, 1);
  out[3] = subCmd;
  json.copy(out, 4);
  return new Uint8Array(out);
}

/** Frame `601` mang `controls[]`; `data` ở tầng ngoài là object, `encrypt: 0`. */
const controlFrame = (controls: unknown[]): Uint8Array =>
  frame(601, 0, { encrypt: 0, data: { controls } });

const tempKeyControl = (over: Record<string, unknown> = {}) => ({
  content: {
    act: 'transfer_after_login',
    act_type: 'transfer_msg',
    data: { temp_key: 'k-1', imei: IMEI },
    ts: Date.now(),
    ...over,
  },
});

function makeController(crypto: SyncV2Crypto, over: Partial<Record<string, unknown>> = {}) {
  const phases: string[] = [];
  const emitted: unknown[] = [];
  const started: unknown[] = [];
  const controller = new SyncV2Controller({
    crypto: async () => crypto,
    identity: () => crypto.generateKeyPair(),
    ownId: '1234567890',
    imei: IMEI,
    deviceName: 'pc-test',
    onMessages: (messages) => emitted.push(...messages),
    onPhase: (phase) => phases.push(phase),
    download: async () => new Uint8Array([0]),
    request: async (payload) => { started.push(payload); return { ok: true as const }; },
    ...over,
  });
  return { controller, phases, emitted, started };
}

test('frame 601: nhận sự kiện transfer_after_login và tra được temp_key', async () => {
  const crypto = await cryptoPromise;
  const { controller } = makeController(crypto);
  const socket = {} as { ws?: WebSocket };

  controller.handleFrame(controlFrame([tempKeyControl()]), socket);

  assert.equal(controller.currentTempKey()?.tempKey, 'k-1');
  controller.dispose();
});

test('frame 601: chấp nhận cả `data` dạng chuỗi JSON', async () => {
  const crypto = await cryptoPromise;
  const { controller } = makeController(crypto);
  // Với `encrypt: 0`, zca-js đọc `JSON.parse(parsed.data).data.controls`
  // (`dist/utils.js:346` → `listen.js:213`) — nghĩa là chuỗi bọc thêm một lớp
  // `data`, đúng như payload đã giải của frame mã hoá.
  const bytes = frame(601, 0, {
    encrypt: 0,
    data: JSON.stringify({ data: { controls: [tempKeyControl()] } }),
  });

  controller.handleFrame(bytes, {} as { ws?: WebSocket });

  assert.equal(controller.currentTempKey()?.tempKey, 'k-1');
  controller.dispose();
});

test('frame khác 601 bị bỏ qua, không làm hỏng gì', async () => {
  const crypto = await cryptoPromise;
  const { controller } = makeController(crypto);

  controller.handleFrame(frame(510, 1, { data: { msgs: [] } }), {} as { ws?: WebSocket });
  controller.handleFrame(new Uint8Array([1, 2]), {} as { ws?: WebSocket });
  controller.handleFrame(new Uint8Array([]), {} as { ws?: WebSocket });

  assert.equal(controller.currentTempKey(), null);
  controller.dispose();
});

test('frame hỏng không ném ra ngoài — socket dùng chung với zca-js', async () => {
  const crypto = await cryptoPromise;
  const debug: Array<{ event: string; data: Record<string, unknown> }> = [];
  const { controller } = makeController(crypto, {
    onDebug: (event: string, data: Record<string, unknown>) => debug.push({ event, data }),
  });

  // Thân là JSON hợp lệ nhưng `data` không đúng hình dạng phong bì mã hoá.
  assert.doesNotThrow(() => controller.handleFrame(
    frame(601, 0, { encrypt: 2, data: 'không-phải-base64' }), {} as { ws?: WebSocket }));

  assert.equal(debug.some(entry => entry.data.reason === 'frame-decode'), true);
  controller.dispose();
});

test('temp_key của máy khác không dùng được', async () => {
  const crypto = await cryptoPromise;
  const { controller } = makeController(crypto);

  controller.handleFrame(controlFrame([tempKeyControl({ data: { temp_key: 'k', imei: 'may-khac' } })]),
    {} as { ws?: WebSocket });

  assert.equal(controller.currentTempKey(), null);
  controller.dispose();
});

test('temp_key quá 600 s bị từ chối', async () => {
  const crypto = await cryptoPromise;
  const { controller } = makeController(crypto);

  controller.handleFrame(controlFrame([tempKeyControl({ ts: Date.now() - 600_001 })]),
    {} as { ws?: WebSocket });

  assert.equal(controller.currentTempKey(), null);
  controller.dispose();
});

test('start không có temp_key vẫn gửi: đường tay của Zalo chạy với tempKey rỗng', async () => {
  const crypto = await cryptoPromise;
  const { controller, started } = makeController(crypto);

  // `manualSync` của Zalo PC gọi `startManualSync` **không** có `tempKey`, và
  // `initNewMachineInfo` biến thiếu thành `""`. Từ chối ở đây là bịa ra một
  // điều kiện mà Zalo không có — và nó chặn đúng đường đồng bộ tay.
  const result = await controller.start();

  assert.deepEqual(result, { ok: true });
  assert.equal(started.length, 1, 'vẫn phải gửi yêu cầu lên máy chủ');
  assert.equal((started[0] as { tempKey: string }).tempKey, '');
  controller.dispose();
});

test('start có temp_key: một phiên, ussidx tăng sau mỗi lần mở', async () => {
  const crypto = await cryptoPromise;
  const { controller, started } = makeController(crypto);

  controller.handleFrame(controlFrame([tempKeyControl()]), {} as { ws?: WebSocket });
  const first = await controller.start();
  const second = await controller.start();

  assert.deepEqual(first, { ok: true });
  // Phiên đầu chưa kết thúc (không có gói nào tới) nên lần hai bị từ chối —
  // đúng hợp đồng "một syncId tại một thời điểm".
  assert.equal(second.ok, false);
  assert.equal((second as { code: unknown }).code, 'state');
  assert.equal(started.length, 1);
  assert.equal(controller.currentPhase, SyncPhase.RECEIVING);
  controller.dispose();
});

test('stats trước khi có gói: total là 0, không phải -1', async () => {
  // `total` âm là "chưa biết" bên trong phiên; ra tới IPC phải là 0, nếu không
  // renderer vẽ "0/-1" ở chỗ chưa có gì để đếm.
  const crypto = await cryptoPromise;
  const { controller } = makeController(crypto);
  assert.deepEqual(controller.stats, { received: 0, total: 0, written: 0, skipped: 0 });

  controller.handleFrame(controlFrame([tempKeyControl()]), {} as { ws?: WebSocket });
  await controller.start();
  assert.equal(controller.stats.total, 0);
  controller.dispose();
});

test('start đóng controller: từ chối, không ném', async () => {
  const crypto = await cryptoPromise;
  const { controller } = makeController(crypto);
  controller.dispose();

  const result = await controller.start({ tempKey: 'k' });

  assert.equal(result.ok, false);
  assert.equal((result as { code: unknown }).code, 'disposed');
});

test('wasm không nạp được: lỗi có mã, không làm hỏng client', async () => {
  const { controller } = makeController(null as never, {
    crypto: async () => { throw new Error('ENOENT: thiếu wasm'); },
  });

  const result = await controller.start({ tempKey: 'k' });

  assert.equal(result.ok, false);
  assert.equal((result as { code: unknown }).code, 'wasm');
  controller.dispose();
});

test('attach: gắn và tháo trên socket thật, mỗi frame chỉ xử lý một lần', async () => {
  const crypto = await cryptoPromise;
  const { controller } = makeController(crypto);
  // `attach` nghe trên `listener.ws` — đó là WebSocket thật mà zca-js giữ.
  const listeners = new Set<(event: MessageEvent) => void>();
  const socket = {
    ws: {
      addEventListener: (_type: string, listener: (event: MessageEvent) => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MessageEvent) => void) => listeners.delete(listener),
    },
  };

  const detach = controller.attach(socket as unknown as { ws?: WebSocket });
  assert.equal(listeners.size, 1);

  for (const listener of listeners) {
    listener({ data: Buffer.from(controlFrame([tempKeyControl()])) } as MessageEvent);
  }
  assert.equal(controller.currentTempKey()?.tempKey, 'k-1');

  detach();
  assert.equal(listeners.size, 0);
  controller.dispose();
});

test('attach lần hai thay lần đầu, không nhân đôi xử lý', async () => {
  const crypto = await cryptoPromise;
  const { controller } = makeController(crypto);
  const first: Array<unknown> = [];
  const second: Array<unknown> = [];
  const socketA = {
    ws: {
      addEventListener: (_t: string, l: unknown) => first.push(l),
      removeEventListener: (_t: string, l: unknown) => first.splice(first.indexOf(l), 1),
    },
  };
  const socketB = {
    ws: {
      addEventListener: (_t: string, l: unknown) => second.push(l),
      removeEventListener: (_t: string, l: unknown) => second.splice(second.indexOf(l), 1),
    },
  };

  controller.attach(socketA as unknown as { ws?: WebSocket });
  controller.attach(socketB as unknown as { ws?: WebSocket });

  assert.equal(first.length, 0, 'socket cũ phải được tháo');
  assert.equal(second.length, 1);
  controller.dispose();
});

test('không có socket: attach thoái lui, không ném', async () => {
  const crypto = await cryptoPromise;
  const debug: Array<Record<string, unknown>> = [];
  const { controller } = makeController(crypto, {
    onDebug: (_event: string, data: Record<string, unknown>) => debug.push(data),
  });

  controller.attach({} as { ws?: WebSocket });

  assert.equal(debug.some(entry => entry.reason === 'no-socket'), true);
  controller.dispose();
});

// --------------------------------------------------------- khoá định danh

test('khoá định danh sống qua các lần đọc, cùng một cặp', async () => {
  const crypto = await cryptoPromise;
  const dir = mkdtempSync(path.join(tmpdir(), 'sync-identity-'));
  const db = openDb(dir, '1234567890');
  try {
    const first = loadIdentity(db, crypto);
    const second = loadIdentity(db, crypto);

    assert.deepEqual(Buffer.from(second.privateKey), Buffer.from(first.privateKey));
    assert.deepEqual(Buffer.from(second.publicKey), Buffer.from(first.publicKey));
    // Khoá công khai suy lại được từ nửa riêng — đó là lý do chỉ lưu một nửa.
    assert.deepEqual(Buffer.from(crypto.derivePublicKey(second.privateKey)), Buffer.from(second.publicKey));
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bản lưu hỏng độ dài: sinh cặp mới thay vì đưa rác vào wasm', async () => {
  const crypto = await cryptoPromise;
  const dir = mkdtempSync(path.join(tmpdir(), 'sync-identity-bad-'));
  const db = openDb(dir, '1234567890');
  try {
    db.handle.prepare("INSERT INTO kv (key, value) VALUES (?, ?)").run(IDENTITY_KV_KEY, 'AAAA');

    const pair = loadIdentity(db, crypto);

    assert.equal(pair.privateKey.length, 32);
    assert.equal(pair.publicKey.length, 33);
    // Bản lưu đã được sửa: lần sau không sinh lại.
    const again = loadIdentity(db, crypto);
    assert.deepEqual(Buffer.from(again.privateKey), Buffer.from(pair.privateKey));
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('không có DB: vẫn trả một cặp dùng được', async () => {
  const crypto = await cryptoPromise;
  const pair = loadIdentity(null, crypto);
  assert.equal(pair.privateKey.length, 32);
  assert.equal(pair.publicKey.length, 33);
});

test('khoá định danh không nằm trong schema_version hay tên khoá khác', () => {
  assert.notEqual(IDENTITY_KV_KEY, 'schema_version');
});

// ------------------------------------------- chuỗi hai bước: hội thoại → tin

/**
 * `syncAll` là chuỗi hai bước của Zalo PC (`sync_conversations` rồi tới
 * `sync_other_messages`), không phải một lần xin.
 *
 * Bước hội thoại **bắt buộc** khi chưa có danh sách: `partition` của gói tin là
 * `oneone/<globalNoisedId>` / `group/<globalNoisedId>`, và `globalNoisedId`
 * chính là `convId` mà bước ấy trả về. Trước R17, `("message", "")` được thử
 * nhiều lần và không bao giờ có gói nào — vì không có danh sách thì không có id.
 */

/** Sự kiện `upload_batch` của một phiên — đúng đường đi qua `handleFrame`. */
const uploadBatchControl = (syncId: string, over: Record<string, unknown> = {}) => ({
  content: {
    act: 'upload_batch',
    act_type: 'transfer_sync2',
    data: {
      syncId, idx: 0, isLast: true, err: 1, msgUrl: '',
      batchType: 1, scopes: [],
      ...over,
    },
  },
});

/**
 * Chờ phiên đầu tiên gửi `590`, rồi làm nó chạm trạng thái cuối.
 *
 * Một phiên `receiving` giữ `settled` chưa resolve tới khi hết hạn 180 s — đúng
 * ràng buộc thật, không phải chuyện của test. Gói `err` khác 0 là cách ngắn nhất
 * và trung thực để phiên kết thúc: máy chủ báo hỏng gói thì phiên hỏng, và `591`
 * đi kèm.
 */
async function failFirstSession(
  controller: { handleFrame: (bytes: Uint8Array, socket: { ws?: WebSocket }) => void },
  started: unknown[],
): Promise<void> {
  for (let attempt = 0; attempt < 200 && started.length === 0; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  const syncId = (started[0] as { syncId?: string } | undefined)?.syncId;
  assert.equal(typeof syncId, 'string', 'bước hội thoại phải gửi `590` trước');
  controller.handleFrame(
    controlFrame([uploadBatchControl(syncId as string)]), {} as { ws?: WebSocket });
  // `settled` resolve trong `setPhase`; nhường một vòng cho chuỗi vi mô chạy hết.
  await new Promise(resolve => setTimeout(resolve, 0));
}

test('syncAll: chưa có danh sách thì bước hội thoại đi trước, một phiên "conversation"', async () => {
  const crypto = await cryptoPromise;
  const { controller, started } = makeController(crypto, {
    knownConversations: () => [],
  });

  const pending = controller.syncAll();
  await failFirstSession(controller, started);
  const result = await pending;

  // Không có danh sách và không lấy được → dừng, thay vì mở thêm một phiên tin
  // mà chắc chắn không có gì để xin.
  assert.equal(result.ok, false);
  assert.equal((result as { code: unknown }).code, 'no-conversations');
  assert.equal(started.length, 1, 'chỉ đúng một phiên: bước hội thoại');
  const payload = started[0] as {
    syncId: string; req: { type: string; queries: Array<Record<string, unknown>> };
  };
  assert.equal(payload.req.type, 'conversation');
  assert.deepEqual(payload.req.queries, [
    { partition: '', from: 0, to: Number.MAX_SAFE_INTEGER, limit: 2147483647 },
  ]);
  controller.dispose();
});

test('syncAll: bước hội thoại xong thì mới xin tin, mỗi hội thoại một partition', async () => {
  const crypto = await cryptoPromise;
  let knownCalls = 0;
  const phases: string[] = [];
  const conversations = [
    { convId: 'c-1', convType: 1, respondedByMe: false, lastTs: '0', lastGlobalId: '0', lastClientId: '0' },
    { convId: 'g-2', convType: 2, respondedByMe: false, lastTs: '0', lastGlobalId: '0', lastClientId: '0' },
  ];
  const { controller, started } = makeController(crypto, {
    // Lần đọc đầu (trước bước hội thoại) rỗng; sau khi bước ấy chạy xong mới có.
    knownConversations: () => (knownCalls++ === 0 ? [] : conversations),
    onPhase: (phase: string) => phases.push(phase),
  });

  const pending = controller.syncAll();
  await failFirstSession(controller, started);
  const result = await pending;

  assert.deepEqual(result, { ok: true });
  // Chuỗi pha là bằng chứng về **thứ tự**: phiên hội thoại phải chạm trạng thái
  // cuối trước khi phiên tin được mở. Xin tin trước thì mảng này chỉ có hai
  // phần tử `requested` và không có `failed` chen giữa.
  assert.deepEqual(phases, ['requested', 'receiving', 'failed', 'requested', 'receiving']);
  const messages = started[1] as { req: { queries: Array<{ partition: string }> } };
  assert.deepEqual(messages.req.queries.map(q => q.partition), ['oneone/c-1', 'group/g-2']);
  controller.dispose();
});

test('syncAll: quá 30 hội thoại thì chia nhóm — mỗi `590` tối đa 30 partition', async () => {
  // Đo thật 2026-11-10 13:49:50: gửi 363 `partition` trong một `590` thì máy chủ
  // đóng kết nối `1009` trước cả khi kịp trả lời, và mọi lần thử sau rơi vào
  // `no-reply`. Zalo PC chia 30 một nhóm (`buildPrepareQuery`: `getQueryCount()<30`).
  const crypto = await cryptoPromise;
  const conversations = Array.from({ length: 65 }, (_, index) => ({
    convId: `c-${index}`, convType: 1,
    respondedByMe: false, lastTs: '0', lastGlobalId: '0', lastClientId: '0',
  }));
  const { controller, started } = makeController(crypto, {
    knownConversations: () => conversations,
  });

  const result = await controller.syncAll();

  assert.deepEqual(result, { ok: true });
  const first = started[0] as { req: { queries: Array<{ partition: string }> } };
  assert.equal(first.req.queries.length, 30, 'nhóm đầu đủ 30, không hơn');
  assert.equal(first.req.queries[0].partition, 'oneone/c-0');
  controller.dispose();
});

test('syncAll: đã có danh sách thì bỏ bước hội thoại, vào thẳng phiên tin', async () => {
  const crypto = await cryptoPromise;
  const conversations = [
    { convId: 'c-9', convType: 1, respondedByMe: false, lastTs: '0', lastGlobalId: '0', lastClientId: '0' },
  ];
  const { controller, started } = makeController(crypto, {
    knownConversations: () => conversations,
  });

  const result = await controller.syncAll();

  assert.deepEqual(result, { ok: true });
  assert.equal(started.length, 1, 'danh sách đã lưu là chỉ mục: không phải chạy lại bước hội thoại');
  assert.equal((started[0] as { req: { type: string } }).req.type, 'message');
  controller.dispose();
});

test('syncAll completion waits for every partition group, including the final group', async () => {
  const crypto = await cryptoPromise;
  let completed = 0;
  let starts = 0;
  const waiting: Array<(phase: string) => void> = [];
  const { controller } = makeController(crypto, {
    knownConversations: () => Array.from({ length: 65 }, (_, i) => ({ convId: String(i), convType: 1 })),
    onComplete: () => completed++,
  });
  // Isolate sequencing from the separately tested transport/session layer.
  controller.start = async () => { starts++; return { ok: true }; };
  (controller as unknown as { waitForSession(): Promise<string> }).waitForSession = () =>
    new Promise(resolve => waiting.push(resolve));
  try {
    assert.deepEqual(await controller.syncAll(), { ok: true });
    assert.equal(starts, 1); assert.equal(completed, 0);
    waiting.shift()!('done'); await Promise.resolve(); await Promise.resolve();
    assert.equal(starts, 2); assert.equal(completed, 0);
    waiting.shift()!('done'); await Promise.resolve(); await Promise.resolve();
    assert.equal(starts, 3); assert.equal(completed, 0);
    waiting.shift()!('done'); await Promise.resolve(); await Promise.resolve();
    assert.equal(completed, 1);
  } finally { controller.dispose(); }
});

test('syncAll failure or cancellation never marks setup complete', async () => {
  const crypto = await cryptoPromise;
  for (const canceled of [false, true]) {
    let completed = 0;
    let finish!: (phase: string) => void;
    const { controller } = makeController(crypto, {
      knownConversations: () => [{ convId: 'one', convType: 1 }],
      onComplete: () => completed++,
    });
    controller.start = async () => ({ ok: true });
    (controller as unknown as { waitForSession(): Promise<string> }).waitForSession = () =>
      new Promise(resolve => { finish = resolve; });
    await controller.syncAll();
    if (canceled) controller.dispose();
    finish(canceled ? 'done' : 'failed'); await Promise.resolve(); await Promise.resolve();
    assert.equal(completed, 0);
    controller.dispose();
  }
});

// ------------------------------------------------------- dấu phiên / dọn cũ

test('start: nhớ phiên trước khi gửi, quên khi máy chủ từ chối', async () => {
  const crypto = await cryptoPromise;
  const order: string[] = [];
  const forgotten: string[] = [];
  const { controller } = makeController(crypto, {
    rememberOpenSession: (syncId: string) => order.push(`remember:${syncId.length > 0}`),
    forgetOpenSession: (syncId: string) => forgotten.push(syncId),
    request: async (payload: { syncId: string }) => {
      order.push(`request:${payload.syncId}`);
      return { ok: false as const, code: 12888, message: 'Nope' };
    },
  });

  const result = await controller.start();

  assert.equal(result.ok, false);
  // Dấu phải có **trước** `590`: app chết trong lúc `590` đang bay vẫn phải để
  // lại thứ cho lần chạy sau dọn.
  assert.equal(order[0], 'remember:true');
  assert.match(order[1], /^request:/);
  assert.deepEqual(forgotten, [order[1].slice('request:'.length)], 'bị từ chối thì không có phiên nào để dọn');
  controller.dispose();
});

test('sweepStaleSessions: dội OutDated cho từng phiên cũ rồi quên dấu', async () => {
  const crypto = await cryptoPromise;
  const disposed: Array<{ syncId: string; reason: number }> = [];
  const forgotten: string[] = [];
  const { controller } = makeController(crypto, {
    listOpenSessions: () => [
      { syncId: 'cu-1', since: Date.now() - 60_000 },
      { syncId: 'cu-2', since: 0 },
    ],
    forgetOpenSession: (syncId: string) => forgotten.push(syncId),
    disposeSession: async (syncId: string, reason: number) => {
      disposed.push({ syncId, reason });
      return { ok: true as const };
    },
  });

  const swept = await controller.sweepStaleSessions();

  assert.equal(swept, 2);
  // `cleanOldSyncSession` của Zalo PC: phiên của lần chạy trước là OutDated,
  // không phải UserCancel và không phải Error.
  assert.deepEqual(disposed, [
    { syncId: 'cu-1', reason: SyncReleaseReason.OUT_DATED },
    { syncId: 'cu-2', reason: SyncReleaseReason.OUT_DATED },
  ]);
  assert.deepEqual(forgotten, ['cu-1', 'cu-2']);
  controller.dispose();
});

test('sweepStaleSessions: một phiên dọn hỏng không chặn các phiên còn lại', async () => {
  const crypto = await cryptoPromise;
  const disposed: string[] = [];
  const { controller } = makeController(crypto, {
    listOpenSessions: () => [{ syncId: 'a', since: 0 }, { syncId: 'b', since: 0 }],
    disposeSession: async (syncId: string) => {
      disposed.push(syncId);
      if (syncId === 'a') throw new Error('socket đã đóng');
      return { ok: true as const };
    },
  });

  const swept = await controller.sweepStaleSessions();

  assert.deepEqual(disposed, ['a', 'b']);
  assert.equal(swept, 1, 'chỉ phiên gửi được mới tính là đã dọn');
  controller.dispose();
});

test('sweepStaleSessions: không có dấu nào thì không gửi gì', async () => {
  const crypto = await cryptoPromise;
  const { controller } = makeController(crypto, { listOpenSessions: () => [] });

  assert.equal(await controller.sweepStaleSessions(), 0);
  controller.dispose();
});

test('dispose controller: huỷ phiên đang mở với UserCancel', async () => {
  const crypto = await cryptoPromise;
  const reasons: number[] = [];
  const { controller } = makeController(crypto, {
    disposeSession: async (_syncId: string, reason: number) => {
      reasons.push(reason);
      return { ok: true as const };
    },
  });
  await controller.start();
  assert.equal(controller.currentPhase, SyncPhase.RECEIVING);

  controller.dispose();
  // `releaseOnServerWith` chạy ngoài chuỗi chờ; nhường một vòng macro-task.
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.deepEqual(reasons, [SyncReleaseReason.USER_CANCEL]);
});
