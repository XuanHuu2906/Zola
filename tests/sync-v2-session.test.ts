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
  SyncV2Session, SyncPhase, SyncAct, SyncActType, SyncTransferStatus, SyncTransferDevice,
  parseControlEvents, pickTempKey, readBatchInfo, readMobileStatus, TEMP_KEY_MAX_AGE_MS,
} = await import('../electron/protocol/sync-v2-session.ts');
const { SyncBatchType } = await import('../electron/protocol/sync-v2-batch.ts');
const { SyncDatabaseType } = await import('../electron/protocol/sync-v2-request.ts');
const { SyncReleaseReason } = await import('../electron/protocol/dispose-session-ws.ts');
/**
 * State machine của một phiên Sync V2 — kiểm bằng **phiên dựng thật** trên wasm
 * của bản cài, không phải bằng stub.
 *
 * Ba nhóm dưới đây là ba chỗ đã từng đọc sai nguồn Zalo, và mỗi chỗ sai đều im
 * lặng: chọn sai `act_type` thì `temp_key` là `undefined`; chấp nhận khoá cũ quá
 * 600 s thì máy chủ coi phiên hết hạn; cho gói tin chạy trước gói metadata thì
 * mọi gói hỏng vì thiếu bản ghi phiên. Không có test nào ở đây chạm mạng hay DB.
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

/** Một `Sync2.Conversation.SyncChunk` — thân của database `conversation`. */
function conversationChunk(
  conversations: Array<{ convId: string; convType: number }>,
): Uint8Array {
  return new Uint8Array(concat(
    fieldVarint(1, 1n),
    ...conversations.map(item => fieldBytes(2, concat(
      fieldString(1, item.convId),
      fieldVarint(2, BigInt(item.convType)),
      fieldVarint(3, 1n),
      fieldVarint(4, 1731000000000n),
    ))),
  ));
}

/**
 * Một chunk một phân vùng, mỗi tin đủ bảy trường mà bộ map cần.
 *
 * `globalId` phải khác `0`: bộ map coi `0` là "chưa có id máy chủ" và bỏ tin —
 * một tin như vậy không kiểm được đường ghi.
 */
function messageChunk(
  partition: string,
  messages: Array<{ content: string; globalId?: bigint; senderId?: string }>,
): Uint8Array {
  const wire = messages.map((message) => fieldBytes(2, concat(
    fieldString(1, message.senderId ?? '999'),
    fieldVarint(2, 0n),
    fieldVarint(3, 0n),
    fieldVarint(4, 1n),
    fieldVarint(5, 1731000000000n),
    fieldVarint(6, message.globalId ?? 111n),
    fieldString(7, message.content),
  )));
  return new Uint8Array(concat(fieldBytes(2, concat(fieldString(1, partition), ...wire))));
}

/** Đóng gói chunk thành file batch: zstd → mã hoá → khung `[u32][khối]`. */
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

const OWN = '1234567890';
const IMEI = 'imei-cua-may-nay';

/**
 * Dựng một phiên thật: PC có cặp định danh + tạm, điện thoại niêm phong gói.
 *
 * `sealMetadata` **bắt lấy** bản ghi phiên của lần niêm phong đầu — mọi gói tin
 * phải mã hoá bằng đúng bản ghi đó, nếu không chúng hỏng ở AEAD.
 */
async function harness() {
  const crypto = await cryptoPromise;
  const identity = crypto.generateKeyPair();
  const ephemeral = crypto.generateKeyPair();
  const phone = crypto.generateKeyPair();

  const batches = new Map<string, Uint8Array>();
  const emitted: Array<{ threadId: string; text: string }> = [];
  const phases: string[] = [];
  const progress: Array<{ received: number; total: number; written: number; skipped: number }> = [];
  const debug: Array<Record<string, unknown>> = [];
  const downloads: string[] = [];

  let sessionRecord: Uint8Array | null = null;
  const sealMetadata = (compressed: Uint8Array): Uint8Array => {
    const sealed = crypto.createMetadataCipher(
      compressed, phone.publicKey, phone.privateKey, identity.publicKey, ephemeral.publicKey,
    );
    sessionRecord ??= sealed.sessionRecord;
    return new Uint8Array(sealed.ciphertext);
  };
  const sealMessage = (compressed: Uint8Array): Uint8Array => {
    if (!sessionRecord) throw new Error('test dựng sai: chưa có bản ghi phiên');
    return new Uint8Array(crypto.encryptMessage(compressed, sessionRecord).ciphertext);
  };

  /** Gói metadata luôn là `idx 0` — Zalo đẩy nó trước để mở khoá. */
  const addMetadataBatch = (url = 'https://files.test/meta.bin'): string => {
    batches.set(url, buildBatch(
      [new Uint8Array(concat(fieldBytes(2, fieldString(1, 'metadata_sync-1'))))],
      sealMetadata,
    ));
    return url;
  };
  const addMessageBatch = (url: string, chunks: Uint8Array[], seal = sealMessage): string => {
    batches.set(url, buildBatch(chunks, seal));
    return url;
  };

  const deps = {
    crypto,
    request: async () => ({ ok: true as const }),
    download: async (url: string) => {
      downloads.push(url);
      const bytes = batches.get(url);
      if (!bytes) throw new Error(`không có gói cho ${url}`);
      return bytes;
    },
    onMessages: (messages: Array<{ threadId: string; message: { text: string } }>) => {
      for (const item of messages) emitted.push({ threadId: item.threadId, text: item.message.text });
    },
    onPhase: (phase: string) => { phases.push(phase); },
    onProgress: (stats: { received: number; total: number; written: number; skipped: number }) => {
      progress.push({ ...stats });
    },
    onDebug: (event: string, data: Record<string, unknown>) => { debug.push({ event, ...data }); },
  };

  const sessionOptions = {
    ownId: OWN,
    syncId: 'sync-1',
    tempKey: 'temp-key-abc',
    deviceName: 'pc-test',
    identity,
    ephemeral,
    ussidx: 0,
  };

  return {
    crypto, identity, ephemeral, phone, deps, sessionOptions,
    batches, emitted, phases, progress, debug, downloads,
    addMetadataBatch, addMessageBatch, sealMetadata, sealMessage,
    get sessionRecord() { return sessionRecord; },
  };
}

/**
 * Dựng sự kiện điều khiển qua **chính bộ phân tích** của sản phẩm.
 *
 * Đặt `act`/`act_type` thẳng vào object sẽ bỏ qua bước chuẩn hoá — và khi đó
 * test tự dựng một hình dạng mà `SyncV2Session` không hề nhận. Lọc một sự kiện
 * qua `parseControlEvents` giữ test trung thực với frame thật.
 */
const controlEvent = (over: Record<string, unknown> = {}, data: Record<string, unknown> = {}) => {
  const [event] = parseControlEvents({
    data: { controls: [{ content: { act: SyncAct.UPLOAD_BATCH, act_type: SyncActType.SYNC_2, data, ...over } }] },
  });
  return event;
};

const statusEvent = (data: Record<string, unknown>) => controlEvent({ act: SyncAct.TRANSFER_STATUS, data });

/**
 * `transfer_after_login` của đường **Sync 1** — đường duy nhất mang `temp_key`.
 *
 * `ts` đi ở tầng sự kiện (content), không phải trong `data`: đó chính là mốc mà
 * phép kiểm 600 s của Zalo đọc.
 */
const tempKeyEvent = (data: Record<string, unknown>, over: Record<string, unknown> = {}) =>
  controlEvent({ act: SyncAct.TRANSFER_AFTER_LOGIN, act_type: SyncActType.SYNC_1, ...over }, data);

const batchEvent = (over: Record<string, unknown> = {}) => controlEvent({}, {
  syncId: 'sync-1', idx: 0, isLast: false, err: 0,
  msgUrl: '', batchType: SyncBatchType.MESSAGE, scopes: [{ partition: 'oneone/1', from: 0, to: 0 }],
  ...over,
});

// --------------------------------------------------- đọc sự kiện điều khiển

test('parseControlEvents: bỏ qua sự kiện không có act/act_type, giữ phần còn lại', () => {
  const events = parseControlEvents({
    data: {
      controls: [
        { content: { act: 'upload_batch', act_type: 'transfer_sync2', data: { idx: 3 }, ts: 100 } },
        { content: { act: 'typing' } },                    // thiếu act_type
        { controlId: 7 },                                   // thiếu content
        { content: { act: 'transfer_status', act_type: 'transfer_sync2', data: '{"status":4}' } },
      ],
    },
  });

  assert.equal(events.length, 2);
  assert.equal(events[0].ts, 100);
  assert.deepEqual(events[0].data, { idx: 3 });
  // `data` gửi dạng chuỗi JSON phải được parse — Zalo làm đúng vậy.
  assert.deepEqual(events[1].data, { status: 4 });
  // Không có `ts` thì là 0, không phải `Date.now()`: sự kiện không mốc không
  // được phép tự nhận mình là mới.
  assert.equal(events[1].ts, 0);
});

test('parseControlEvents: payload lạ trả mảng rỗng thay vì ném', () => {
  for (const payload of [null, undefined, {}, { data: null }, { data: { controls: 'x' } }]) {
    assert.deepEqual(parseControlEvents(payload), []);
  }
});

test('pickTempKey: chỉ nhận act_type transfer_msg, không nhận transfer_sync2', () => {
  const now = 1_000_000;
  const good = tempKeyEvent({ temp_key: 'k-1', imei: IMEI }, { ts: now - 1_000 });

  assert.deepEqual(
    pickTempKey([good], { imei: IMEI, now }),
    { tempKey: 'k-1', ts: now - 1_000 },
  );
  // Cùng dữ liệu, sai act_type: đây là `transfer_after_login` của đường Sync V2,
  // nơi `temp_key` là `undefined` trên frame thật.
  assert.equal(pickTempKey([{ ...good, actType: SyncActType.SYNC_2 }], { imei: IMEI, now }), null);
});

test('pickTempKey: sai imei thì không nhận — khoá của máy khác', () => {
  const event = tempKeyEvent({ temp_key: 'k-1', imei: 'may-khac' }, { ts: 1_000 });
  assert.equal(pickTempKey([event], { imei: IMEI, now: 2_000 }), null);
});

test('pickTempKey: khoá quá 600 s bị từ chối, đúng biên', () => {
  const make = (ts: number) => tempKeyEvent({ temp_key: `k-${ts}`, imei: IMEI }, { ts });
  const now = 10_000_000;

  assert.equal(pickTempKey([make(now - TEMP_KEY_MAX_AGE_MS)], { imei: IMEI, now })?.tempKey,
    `k-${now - TEMP_KEY_MAX_AGE_MS}`, 'đúng 600 s vẫn dùng được');
  assert.equal(pickTempKey([make(now - TEMP_KEY_MAX_AGE_MS - 1)], { imei: IMEI, now }), null);
});

test('pickTempKey: nhiều khoá hợp lệ thì khoá mới nhất thắng', () => {
  const make = (ts: number, key: string) => tempKeyEvent({ temp_key: key, imei: IMEI }, { ts });
  const now = 5_000_000;
  const picked = pickTempKey(
    [make(now - 5_000, 'cu'), make(now - 10, 'moi'), make(now - 2_000, 'giua')],
    { imei: IMEI, now },
  );
  assert.equal(picked?.tempKey, 'moi');
});

test('pickTempKey: temp_key rỗng không phải khoá', () => {
  const event = tempKeyEvent({ temp_key: '', imei: IMEI }, { ts: 1_000 });
  assert.equal(pickTempKey([event], { imei: IMEI, now: 2_000 }), null);
});

test('readBatchInfo: err khác 0 vẫn trả thông tin, không nuốt thành null', () => {
  const info = readBatchInfo(batchEvent({ err: 5, msgUrl: '' }));
  assert.equal(info?.err, 5);
  assert.equal(info?.msgUrl, '');
});

test('readBatchInfo: hình dạng thiếu thì trả null', () => {
  assert.equal(readBatchInfo(batchEvent({ syncId: '' })), null);
  assert.equal(readBatchInfo(batchEvent({ idx: -1 })), null);
  assert.equal(readBatchInfo(batchEvent({ batchType: 'message' })), null);
  // `act` khác `upload_batch` không phải gói.
  assert.equal(readBatchInfo(controlEvent({ act: SyncAct.TRANSFER_STATUS },
    { syncId: 'sync-1', idx: 0, batchType: 1 })), null);
});

test('readMobileStatus: chỉ đọc từ transfer_status', () => {
  const status = readMobileStatus(statusEvent({
    status: SyncTransferStatus.CONFIRMED, fromDevice: SyncTransferDevice.MOBILE,
  }));
  assert.deepEqual(status, { status: 4, fromDevice: 0 });
  assert.equal(readMobileStatus(batchEvent()), null);
});

// ------------------------------------------------------------ payload yêu cầu

test('payload: hai khoá công khai base64, đúng thứ tự trường của Zalo', async () => {
  const h = await harness();
  const session = new SyncV2Session(h.deps, h.sessionOptions);
  const payload = session.requestPayload();

  assert.equal(payload.syncType, 0);
  assert.equal(payload.toDevice, 0, 'luôn xin từ điện thoại');
  assert.equal(payload.ver, 1);
  assert.equal(payload.syncId, 'sync-1');
  assert.equal(payload.tempKey, 'temp-key-abc');
  assert.deepEqual(
    Buffer.from(payload.ek, 'base64'),
    Buffer.from(h.ephemeral.publicKey),
    'ek là khoá công khai tạm của phiên, không phải khoá định danh',
  );
  assert.deepEqual(
    Buffer.from(payload.ik, 'base64'),
    Buffer.from(h.identity.publicKey),
    'ik là khoá công khai định danh',
  );
  assert.equal(payload.req.type, SyncDatabaseType.MESSAGE);
  assert.equal(payload.req.batchSize, 2000);
  // Không có `queries` thì Zalo PC không gửi yêu cầu nào (`this.requests` luôn
  // có ít nhất một phần tử). Mặc định phải là một query có thật, không phải `[]`.
  assert.equal(payload.req.queries.length, 1);
  assert.equal(payload.req.queries[0].limit, 2147483647);
  session.dispose();
});

// ------------------------------------------------------------- cả phiên

test('cả phiên: metadata trước, tin sau — tin vào đúng hội thoại', async () => {
  const h = await harness();
  h.addMetadataBatch();
  h.addMessageBatch('https://files.test/msg-1.bin', [
    messageChunk('oneone/42', [{ content: 'xin chào' }]),
  ]);

  const session = new SyncV2Session(h.deps, h.sessionOptions);
  assert.deepEqual(await session.start('req-1'), { ok: true });
  assert.equal(session.currentPhase, SyncPhase.RECEIVING);

  session.handleControlEvents([batchEvent({
    idx: 0, isLast: false, batchType: SyncBatchType.METADATA_EMBEDDED,
    msgUrl: 'https://files.test/meta.bin',
  })]);
  session.handleControlEvents([batchEvent({
    idx: 1, isLast: true, msgUrl: 'https://files.test/msg-1.bin',
  })]);
  await session.drain();

  assert.deepEqual(h.emitted, [{ threadId: '42', text: 'xin chào' }]);
  assert.equal(session.currentPhase, SyncPhase.DONE);
  assert.deepEqual(session.stats, { received: 2, total: 2, written: 1, skipped: 0 });
  session.dispose();
});

// ------------------------------------------- giải phóng phiên phía máy chủ

/**
 * Zalo PC luôn giải phóng phiên khi `sync-full` xong (`disposeSync` trong cả
 * `handleSuccess` lẫn `handleFailure`). Repo từng không gửi `cmd 591`, nên mỗi
 * lần bấm đồng bộ lại để lại một phiên mở bên máy chủ.
 */
test('phiên xong: gửi `591` đúng một lần với lý do SyncSuccess', async () => {
  const h = await harness();
  const disposed: Array<{ syncId: string; reason: number }> = [];
  h.addMetadataBatch();
  h.addMessageBatch('https://files.test/msg-1.bin', [
    messageChunk('oneone/42', [{ content: 'xin chào' }]),
  ]);

  const session = new SyncV2Session({
    ...h.deps,
    disposeSession: async (syncId: string, reason: number) => {
      disposed.push({ syncId, reason });
      return { ok: true as const };
    },
  }, h.sessionOptions);
  await session.start('req-1');
  session.handleControlEvents([batchEvent({
    idx: 0, isLast: true, batchType: SyncBatchType.METADATA_EMBEDDED,
    msgUrl: 'https://files.test/meta.bin',
  })]);
  await session.drain();
  // `releaseOnServer` chạy ngoài chuỗi chờ; nhường một vòng microtask.
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(disposed, [{ syncId: 'sync-1', reason: SyncReleaseReason.SYNC_SUCCESS }]);
});

test('phiên hỏng: giải phóng với lý do Error, không phải SyncSuccess', async () => {
  const h = await harness();
  const reasons: number[] = [];
  h.addMetadataBatch();

  const session = new SyncV2Session({
    ...h.deps,
    request: async () => ({ ok: false as const, code: 'no-reply', message: 'hết hạn' }),
    disposeSession: async (_syncId: string, reason: number) => {
      reasons.push(reason);
      return { ok: true as const };
    },
  }, h.sessionOptions);
  await session.start('req-1');
  await Promise.resolve();

  assert.equal(session.currentPhase, SyncPhase.FAILED);
  assert.deepEqual(reasons, [SyncReleaseReason.ERROR]);
});

test('`closed` chờ `591` có câu trả lời, không chỉ chờ gói cuối', async () => {
  // Đo thật 2026-11-10 14:26:28: nhóm 3 xong (`done`, 7959 tin), nhóm 4 gửi
  // `590` sau **0 ms** vì `settled` đã resolve, socket đóng `1006` sau **11 ms**,
  // và nhóm 4 mất hẳn. `closed` là nhịp phải chờ giữa hai nhóm.
  const h = await harness();
  let releaseDispose: (() => void) | null = null;
  const session = new SyncV2Session({
    ...h.deps,
    disposeSession: (_syncId: string, _reason: number) => new Promise((resolve) => {
      releaseDispose = () => resolve({ ok: true as const });
    }),
  }, h.sessionOptions);
  await session.start('req-1');
  h.addMetadataBatch();
  session.handleControlEvents([batchEvent({
    idx: 0, isLast: true, batchType: SyncBatchType.METADATA_EMBEDDED,
    msgUrl: 'https://files.test/meta.bin',
  })]);
  await session.drain();

  let closed = false;
  void session.closed.then(() => { closed = true; });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(closed, false, '`591` chưa trả lời thì `closed` chưa mở');

  releaseDispose?.();
  await session.closed;
  assert.equal(closed, true);
});

test('`closed` vẫn mở khi `591` hỏng — đó là nhịp, không phải điều kiện', async () => {
  const h = await harness();
  const session = new SyncV2Session({
    ...h.deps,
    disposeSession: async () => ({ ok: false as const, code: 'no-reply', message: '' }),
  }, h.sessionOptions);
  await session.start('req-1');
  // Phiên chưa có gói nào nên chưa chạm trạng thái cuối; `cancel()` là đường
  // ngắn nhất tới một lần `591`, và cũng là đường bị hỏng ở đây.
  session.cancel();
  await session.closed;
});

test('`closed` vẫn mở khi bỏ phiên giữa đường', async () => {
  const h = await harness();
  const session = new SyncV2Session({ ...h.deps }, h.sessionOptions);
  await session.start('req-1');
  session.dispose();
  await session.closed;
});

test('huỷ giữa đường: `591` với UserCancel, không ném khi chưa từng xin', async () => {
  const h = await harness();
  const reasons: number[] = [];
  const session = new SyncV2Session({
    ...h.deps,
    disposeSession: async (_syncId: string, reason: number) => {
      reasons.push(reason);
      return { ok: true as const };
    },
  }, h.sessionOptions);
  session.cancel();
  await Promise.resolve();

  assert.deepEqual(reasons, [SyncReleaseReason.USER_CANCEL]);
});

test('giải phóng chỉ một lần, dù phiên hỏng rồi bị huỷ', async () => {
  const h = await harness();
  const reasons: number[] = [];
  const session = new SyncV2Session({
    ...h.deps,
    request: async () => ({ ok: false as const, code: 'x', message: 'x' }),
    disposeSession: async (_syncId: string, reason: number) => {
      reasons.push(reason);
      return { ok: true as const };
    },
  }, h.sessionOptions);
  await session.start('req-1');
  session.cancel();
  await Promise.resolve();

  assert.deepEqual(reasons, [SyncReleaseReason.ERROR]);
});

test('đánh thức SAU khi xin, và bằng ĐÚNG syncId của phiên', async () => {
  // Thứ tự là hợp đồng, không phải chi tiết. `sessionManager.wakeup()` của Zalo
  // PC lấy `syncSessions[0]` (`CdmT.js:8779-8781`); phiên chỉ vào danh sách đó
  // trong `create()` sau `a.start()` tức sau `590` (`:8694`). Đo 2026-11-09:
  // `592` gửi trước `590` không nhận được phản hồi nào trong 3 s.
  const h = await harness();
  const order: string[] = [];
  const session = new SyncV2Session({
    ...h.deps,
    request: async () => { order.push('request'); return { ok: true as const }; },
    wake: async (syncId: string) => { order.push(`wake:${syncId}`); return { ok: true as const }; },
  }, h.sessionOptions);

  assert.deepEqual(await session.start('req-1'), { ok: true });
  assert.deepEqual(order, ['request', 'wake:sync-1'],
    'wake phải chạy sau request, và với chính syncId mà phiên đã dùng');
  session.dispose();
});

test('xin hỏng thì KHÔNG đánh thức — không mở phiên thì không có gì để đánh thức', async () => {
  const h = await harness();
  let woken = false;
  const session = new SyncV2Session({
    ...h.deps,
    request: async () => ({ ok: false as const, code: 12888, message: 'bị từ chối' }),
    wake: async () => { woken = true; return { ok: true as const }; },
  }, h.sessionOptions);

  const result = await session.start('req-1');
  assert.equal(result.ok, false);
  assert.equal(woken, false, 'không có phiên thì `592` chỉ là khung rơi vào khoảng không');
  assert.equal(session.currentPhase, SyncPhase.FAILED);
  session.dispose();
});

test('đánh thức hỏng KHÔNG làm phiên hỏng — `590` đã được nhận rồi', async () => {
  // `temp_key` đến trên `601`, không phải như câu trả lời của `592`. Mất một
  // bước đánh thức là chậm, không phải hỏng.
  const h = await harness();
  h.addMetadataBatch();
  const session = new SyncV2Session({
    ...h.deps,
    wake: async () => ({ ok: false as const, code: 'no-reply', message: 'không có phản hồi' }),
  }, h.sessionOptions);

  assert.deepEqual(await session.start('req-1'), { ok: true }, 'phiên vẫn phải chạy tiếp');
  assert.notEqual(session.currentPhase, SyncPhase.FAILED);
  session.dispose();
});

test('đánh thức ném ra ngoài cũng không làm phiên hỏng', async () => {
  const h = await harness();
  h.addMetadataBatch();
  const session = new SyncV2Session({
    ...h.deps,
    wake: async () => { throw new Error('socket đóng giữa chừng'); },
  }, h.sessionOptions);

  assert.deepEqual(await session.start('req-1'), { ok: true });
  assert.notEqual(session.currentPhase, SyncPhase.FAILED);
  session.dispose();
});

test('không có `wake` thì phiên vẫn chạy như trước — không phá đường cũ', async () => {
  const h = await harness();
  h.addMetadataBatch();
  const session = new SyncV2Session(h.deps, h.sessionOptions);
  assert.deepEqual(await session.start('req-1'), { ok: true });
  session.dispose();
});

test('onProgress báo số gói sau từng gói, kể cả khi chưa biết tổng', async () => {
  const h = await harness();
  h.addMetadataBatch();
  h.addMessageBatch('https://files.test/msg-1.bin', [
    messageChunk('oneone/42', [{ content: 'chào' }]),
  ]);
  const session = new SyncV2Session(h.deps, h.sessionOptions);
  await session.start('sync_sync-1');

  session.handleControlEvents([batchEvent({
    idx: 0, isLast: false, batchType: SyncBatchType.METADATA_EMBEDDED,
    msgUrl: 'https://files.test/meta.bin',
  })]);
  session.handleControlEvents([batchEvent({ idx: 1, isLast: true, msgUrl: 'https://files.test/msg-1.bin' })]);
  // Chỉ gói `isLast` mang `idx + 1` làm tổng; nhờ vậy gói đầu tới là có tiến
  // trình, chứ không phải một banner đứng ở 0 cho tới khi mọi thứ xong.
  assert.equal(h.progress[0].total, -1, 'chưa thấy gói cuối thì chưa biết tổng');
  assert.equal(h.progress[0].received, 1);
  await session.drain();
  assert.equal(h.progress.at(-1)?.total, 2);
  assert.equal(h.progress.at(-1)?.written, 1);
  session.dispose();
});

test('gói tin tới TRƯỚC gói metadata vẫn giải được — nhờ chờ bản ghi phiên', async () => {
  const h = await harness();
  h.addMetadataBatch();
  h.addMessageBatch('https://files.test/msg-1.bin', [
    messageChunk('group/77', [{ content: 'tin nhóm' }]),
  ]);

  const session = new SyncV2Session(h.deps, h.sessionOptions);
  await session.start('req-1');

  // Thứ tự ngược lại — đúng thứ Zalo có thể đẩy khi mạng chậm.
  session.handleControlEvents([batchEvent({
    idx: 0, isLast: false, msgUrl: 'https://files.test/msg-1.bin',
  })]);
  session.handleControlEvents([batchEvent({
    idx: 1, isLast: true, batchType: SyncBatchType.METADATA_EMBEDDED,
    msgUrl: 'https://files.test/meta.bin',
  })]);
  await session.drain();

  assert.deepEqual(h.emitted, [{ threadId: '77', text: 'tin nhóm' }]);
  assert.equal(session.currentPhase, SyncPhase.DONE);
  session.dispose();
});

test('gói trùng idx chỉ xử lý một lần', async () => {
  const h = await harness();
  h.addMetadataBatch();
  h.addMessageBatch('https://files.test/msg-1.bin', [
    messageChunk('oneone/1', [{ content: 'một lần' }]),
  ]);

  const session = new SyncV2Session(h.deps, h.sessionOptions);
  await session.start('req-1');
  const metadata = batchEvent({
    idx: 0, isLast: false, batchType: SyncBatchType.METADATA_EMBEDDED,
    msgUrl: 'https://files.test/meta.bin',
  });
  session.handleControlEvents([metadata]);
  session.handleControlEvents([metadata]);
  session.handleControlEvents([batchEvent({ idx: 1, isLast: true, msgUrl: 'https://files.test/msg-1.bin' })]);
  session.handleControlEvents([batchEvent({ idx: 1, isLast: true, msgUrl: 'https://files.test/msg-1.bin' })]);
  await session.drain();

  assert.equal(h.emitted.length, 1);
  assert.equal(h.downloads.filter((url) => url.includes('msg-1')).length, 1);
  session.dispose();
});

test('gói err khác 0: ghi nhận hỏng, phiên kết thúc FAILED, không kẹt', async () => {
  const h = await harness();
  const session = new SyncV2Session(h.deps, h.sessionOptions);
  await session.start('req-1');

  session.handleControlEvents([batchEvent({ idx: 0, isLast: true, err: 7, msgUrl: '' })]);
  await session.drain();

  assert.equal(session.currentPhase, SyncPhase.FAILED);
  assert.equal(h.downloads.length, 0, 'gói hỏng thì không tải');
  session.dispose();
});

test('thiếu gói metadata: gói tin báo hỏng ngay, không chờ hết hạn 60 s', async () => {
  const h = await harness();
  // Không có gói metadata nào ⇒ không có bản ghi phiên, nên nội dung gói tin
  // không có nghĩa — nó còn không được tải về.
  h.addMessageBatch('https://files.test/msg-1.bin',
    [messageChunk('oneone/1', [{ content: 'không mở được' }])],
    () => new Uint8Array([1, 2, 3]));
  // Cắt hạn chờ xuống ngắn để test không phải chờ thật — nhưng điều đang kiểm
  // là gói tin phải **thất bại do thiếu bản ghi**, không phải do hết hạn.
  const session = new SyncV2Session(h.deps, { ...h.sessionOptions, sessionRecordTimeoutMs: 30 });
  await session.start('req-1');

  const started = Date.now();
  session.handleControlEvents([batchEvent({ idx: 1, isLast: true, msgUrl: 'https://files.test/msg-1.bin' })]);
  await session.drain();
  const elapsed = Date.now() - started;

  assert.equal(session.currentPhase, SyncPhase.FAILED);
  assert.ok(elapsed >= 25, 'phải chờ bản ghi phiên tới hạn — đó là bằng chứng nó đã thử chờ');
  assert.equal(h.downloads.length, 0, 'không có khoá thì không tải: tải về cũng không giải được');
  assert.equal(h.emitted.length, 0);
  session.dispose();
});

test('gói tin tới trước metadata: chờ bản ghi từ LÚC CÓ GÓI, không phải từ lúc mở phiên', async () => {
  // Ca thật, lượt 13:28:41 ngày 2026-11-10 (`syncId vf6DnY1U…`): điện thoại cần
  // 106 s mới bấm xác nhận, hai gói tới cùng lúc, gói tin chạy trước gói
  // metadata 33 ms. Hạn 60 s neo vào lúc mở phiên đã tự trả `null` từ giây 60,
  // nên phiên hỏng vì "thiếu bản ghi phiên" trong khi khoá đang trên đường.
  //
  // Dựng lại bằng hạn rất ngắn: mở phiên, chờ **quá** hạn (để hạn kiểu cũ chắc
  // chắn đã bắn), rồi mới đẩy gói tin + metadata. Bản ghi phải còn cứu được.
  const h = await harness();
  h.addMetadataBatch();
  h.addMessageBatch('https://files.test/msg-1.bin',
    [messageChunk('oneone/1', [{ content: 'tới trước metadata' }])]);
  const session = new SyncV2Session(h.deps, { ...h.sessionOptions, sessionRecordTimeoutMs: 300 });
  await session.start('req-1');

  // Lâu hơn hạn 300 ms — mốc cũ (neo vào lúc mở phiên) chắc chắn đã hết.
  await new Promise(resolve => setTimeout(resolve, 450));

  session.handleControlEvents([
    batchEvent({ idx: 1, isLast: true, msgUrl: 'https://files.test/msg-1.bin' }),
    batchEvent({
      idx: 0, isLast: true, batchType: SyncBatchType.METADATA_EMBEDDED,
      msgUrl: 'https://files.test/meta.bin',
    }),
  ]);
  await session.drain();

  assert.equal(session.currentPhase, SyncPhase.DONE, 'hạn phải tính từ lúc có gói cần bản ghi');
  assert.deepEqual(h.emitted, [{ threadId: '1', text: 'tới trước metadata' }]);
  session.dispose();
});

test('máy chủ từ chối yêu cầu: phiên FAILED, không xử lý gói nào', async () => {
  const h = await harness();
  const rejected = {
    ...h.deps,
    request: async () => ({ ok: false as const, code: 12888, message: 'Nope' }),
  };
  const session = new SyncV2Session(rejected, h.sessionOptions);

  const result = await session.start('req-1');

  assert.deepEqual(result, { ok: false, code: 12888, message: 'Nope' });
  assert.equal(session.currentPhase, SyncPhase.FAILED);
  assert.equal(h.downloads.length, 0);
  session.dispose();
});

test('start hai lần bị từ chối: một phiên ứng với một syncId', async () => {
  const h = await harness();
  const session = new SyncV2Session(h.deps, h.sessionOptions);
  await session.start('req-1');

  const second = await session.start('req-2');

  assert.equal(second.ok, false);
  assert.equal((second as { code: unknown }).code, 'state');
  session.dispose();
});

test('gói của syncId khác bị bỏ qua', async () => {
  const h = await harness();
  h.addMetadataBatch();
  h.addMessageBatch('https://files.test/msg-1.bin', [
    messageChunk('oneone/1', [{ content: 'lạc phiên' }]),
  ]);

  const session = new SyncV2Session(h.deps, h.sessionOptions);
  await session.start('req-1');
  session.handleControlEvents([batchEvent({
    idx: 0, isLast: true, syncId: 'sync-khac', msgUrl: 'https://files.test/msg-1.bin',
  })]);
  await session.drain();

  assert.equal(h.downloads.length, 0);
  assert.equal(session.currentPhase, SyncPhase.RECEIVING, 'phiên này vẫn đang chờ gói của nó');
  session.dispose();
});

test('trạng thái điện thoại: chỉ báo khi gửi từ MOBILE', async () => {
  const h = await harness();
  const statuses: Array<{ status: number; fromDevice: number }> = [];
  const session = new SyncV2Session({ ...h.deps, onStatus: (s) => statuses.push(s) }, h.sessionOptions);
  await session.start('req-1');

  session.handleControlEvents([statusEvent({
    status: SyncTransferStatus.WAITING_CONFIRM, fromDevice: SyncTransferDevice.MOBILE,
  })]);
  session.handleControlEvents([statusEvent({
    // PC báo trạng thái: không phải tiến trình của điện thoại, bỏ qua.
    status: SyncTransferStatus.CONFIRMED, fromDevice: SyncTransferDevice.PC,
  })]);

  assert.deepEqual(statuses, [{ status: 3, fromDevice: 0 }]);
  session.dispose();
});

test('transfer_error làm phiên hỏng', async () => {
  const h = await harness();
  const session = new SyncV2Session(h.deps, h.sessionOptions);
  await session.start('req-1');

  session.handleControlEvents([controlEvent({ act: SyncAct.TRANSFER_ERROR }, { errorCode: 105 })]);

  assert.equal(session.currentPhase, SyncPhase.FAILED);
  session.dispose();
});

test('gói tin mã hoá bằng bản ghi phiên khác: hỏng, không ghi tin rỗng', async () => {
  const h = await harness();
  h.addMetadataBatch();
  // Mỗi lần `createMetadataCipher` sinh **một phiên riêng**, nên chỉ cần gọi
  // thêm một lần là có bản ghi phiên khác — đúng lỗi khi hai phiên chồng nhau.
  const stray = h.crypto.createMetadataCipher(
    new Uint8Array([0]),
    h.phone.publicKey, h.phone.privateKey, h.identity.publicKey, h.ephemeral.publicKey,
  ).sessionRecord;
  h.addMessageBatch('https://files.test/msg-1.bin',
    [messageChunk('oneone/1', [{ content: 'sai phiên' }])],
    (compressed) => new Uint8Array(h.crypto.encryptMessage(compressed, stray).ciphertext));

  const session = new SyncV2Session(h.deps, h.sessionOptions);
  await session.start('req-1');
  session.handleControlEvents([batchEvent({
    idx: 0, isLast: false, batchType: SyncBatchType.METADATA_EMBEDDED,
    msgUrl: 'https://files.test/meta.bin',
  })]);
  session.handleControlEvents([batchEvent({ idx: 1, isLast: true, msgUrl: 'https://files.test/msg-1.bin' })]);
  await session.drain();

  assert.equal(h.emitted.length, 0);
  assert.equal(session.currentPhase, SyncPhase.FAILED);
  session.dispose();
});

test('phân vùng metadata trong gói tin bị bỏ, tin thật vẫn đi qua', async () => {
  const h = await harness();
  h.addMetadataBatch();
  h.addMessageBatch('https://files.test/msg-1.bin', [
    messageChunk('oneone/5', [{ content: 'giữ' }]),
    messageChunk('metadata_sync-1', [{ content: 'bản ghi phiên' }]),
  ]);

  const session = new SyncV2Session(h.deps, h.sessionOptions);
  await session.start('req-1');
  session.handleControlEvents([batchEvent({
    idx: 0, isLast: false, batchType: SyncBatchType.METADATA_EMBEDDED,
    msgUrl: 'https://files.test/meta.bin',
  })]);
  session.handleControlEvents([batchEvent({ idx: 1, isLast: true, msgUrl: 'https://files.test/msg-1.bin' })]);
  await session.drain();

  assert.deepEqual(h.emitted, [{ threadId: '5', text: 'giữ' }]);
  assert.equal(session.stats.skipped, 1);
  session.dispose();
});

// ------------------------------------------------- database `conversation`

/**
 * Bước đầu của chuỗi `sync-full`: database `conversation` trả `convId`, và
 * `convId` **chính là** `globalNoisedId` dùng trong `partition`
 * (`normalizeConversations`: `globalNoisedId: e.convId`). Không có bước này thì
 * không có id để xin tin — xem R16 §3.
 */
test('conversation: gói hội thoại đi qua onConversations, không sinh tin nào', async () => {
  const h = await harness();
  const conversations: Array<{ convId: string; convType: number }> = [];
  // Gói metadata **của database hội thoại**: cùng phong bì, cùng khoá, chỉ khác
  // schema thân bản ghi.
  h.batches.set('https://files.test/convs.bin', buildBatch(
    [conversationChunk([{ convId: 'c-1', convType: 1 }, { convId: 'g-2', convType: 2 }])],
    h.sealMetadata,
  ));

  const session = new SyncV2Session({
    ...h.deps,
    onConversations: (list: Array<{ convId: string; convType: number }>) => conversations.push(...list),
  }, { ...h.sessionOptions, database: SyncDatabaseType.CONVERSATION });
  await session.start('req-1');
  session.handleControlEvents([batchEvent({
    idx: 0, isLast: true, batchType: SyncBatchType.METADATA_EMBEDDED,
    msgUrl: 'https://files.test/convs.bin',
  })]);
  await session.drain();

  assert.deepEqual(conversations.map(item => [item.convId, item.convType]), [['c-1', 1], ['g-2', 2]]);
  assert.equal(h.emitted.length, 0, 'hội thoại không phải tin: không được gọi onMessages');
  assert.equal(session.conversationCount, 2);
  assert.equal(session.currentPhase, SyncPhase.DONE);
  assert.equal(
    h.debug.some(entry => entry.step === 'conversation-batch' && entry.conversations === 2), true,
  );
  session.dispose();
});

test('conversation: yêu cầu trên dây mang database "conversation"', async () => {
  const h = await harness();
  const session = new SyncV2Session(h.deps, {
    ...h.sessionOptions, database: SyncDatabaseType.CONVERSATION,
  });

  const payload = session.requestPayload();

  assert.equal(payload.req.type, 'conversation');
  // `createConversationQuery` của Zalo PC: `partition ""`, `limit` vô hạn.
  assert.equal(payload.req.queries[0].partition, '');
  assert.equal(payload.req.queries[0].limit, 2147483647);
  session.dispose();
});

// --------------------------------------------- hạn chờ gói đầu tiên / 591

/**
 * R17 đo được: `session-disposed` = 0 trên toàn log vì phiên nằm `receiving`
 * mãi, mà `591` chỉ nổ ở `DONE`/`FAILED`. Hạn `wakeupTimeoutMs` là thứ chuyển
 * "không có gì tới" thành một trạng thái cuối — có lý do, và có `591`.
 */
test('không có gói nào trong hạn: phiên FAILED và gửi `591` lý do Error', async () => {
  const h = await harness();
  const reasons: number[] = [];
  const session = new SyncV2Session({
    ...h.deps,
    disposeSession: async (_syncId: string, reason: number) => {
      reasons.push(reason);
      return { ok: true as const };
    },
  }, { ...h.sessionOptions, wakeupTimeoutMs: 20 });
  await session.start('req-1');
  assert.equal(session.currentPhase, SyncPhase.RECEIVING);

  await new Promise(resolve => setTimeout(resolve, 60));

  assert.equal(session.currentPhase, SyncPhase.FAILED);
  // `releaseOnServer` chạy ngoài chuỗi chờ; nhường một vòng microtask.
  await Promise.resolve();
  assert.deepEqual(reasons, [SyncReleaseReason.ERROR]);
  session.dispose();
});

test('phiên đã xong thì hạn bị huỷ — không lật một phiên DONE thành hỏng', async () => {
  const h = await harness();
  h.addMetadataBatch();
  const session = new SyncV2Session(h.deps, { ...h.sessionOptions, wakeupTimeoutMs: 20 });
  await session.start('req-1');

  session.handleControlEvents([batchEvent({
    idx: 0, isLast: true, batchType: SyncBatchType.METADATA_EMBEDDED,
    msgUrl: 'https://files.test/meta.bin',
  })]);
  await session.drain();
  await new Promise(resolve => setTimeout(resolve, 60));

  assert.equal(session.currentPhase, SyncPhase.DONE, 'hạn không được lật một phiên đã xong');
  session.dispose();
});

/**
 * Hạn là **watchdog im lặng**, không phải đồng hồ một lần. Zalo PC:
 *
 * ```js
 * case WaitingConfirm: startTimeoutReceiveBatch(connectTimeout)  // chờ NGƯỜI bấm
 * case Confirmed:      startTimeoutReceiveBatch(batchTimeout)
 * ```
 *
 * nên thời gian người dùng cầm điện thoại bấm thông báo không bị tính vào hạn.
 * Đây chính là ca hỏng của bản R18 đầu tiên: hạn một lần bắn đúng 180 s trong
 * khi R17 đo được điện thoại cần 104 s *chỉ để hiện* thông báo, rồi còn phải
 * bấm — phiên đã chết trước khi ngón tay chạm màn hình ("bấm vào chả thấy gì").
 */
test('`transfer_status` hẹn lại hạn: chờ người bấm không bị tính là im lặng', async () => {
  const h = await harness();
  const session = new SyncV2Session(h.deps, { ...h.sessionOptions, wakeupTimeoutMs: 60 });
  await session.start('req-1');

  await new Promise(resolve => setTimeout(resolve, 40));
  session.handleControlEvents([statusEvent({
    status: SyncTransferStatus.WAITING_CONFIRM, fromDevice: SyncTransferDevice.MOBILE,
  })]);
  await new Promise(resolve => setTimeout(resolve, 40));

  assert.equal(session.currentPhase, SyncPhase.RECEIVING,
    'hơn 60 ms kể từ lúc mở phiên, nhưng chỉ 40 ms kể từ dấu hiệu sống cuối');

  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(session.currentPhase, SyncPhase.FAILED, 'im lặng trọn một hạn thì vẫn hỏng');
  session.dispose();
});

test('gói hỏng cũng là dấu hiệu sống: hẹn lại hạn, không đóng phiên', async () => {
  // Máy chủ báo `err` một gói thì phiên vẫn đang chạy các gói khác; cắt nó vì
  // "không có gì tới" là bỏ dở một lần đồng bộ đang tiến triển.
  const h = await harness();
  const session = new SyncV2Session(h.deps, { ...h.sessionOptions, wakeupTimeoutMs: 60 });
  await session.start('req-1');

  await new Promise(resolve => setTimeout(resolve, 40));
  session.handleControlEvents([batchEvent({ idx: 0, err: 5 })]);
  await new Promise(resolve => setTimeout(resolve, 40));

  assert.equal(session.currentPhase, SyncPhase.RECEIVING, 'gói hỏng vẫn là gói đã tới');
  session.dispose();
});

/**
 * Hai hạn, hai ý nghĩa — `SessionManager.options` của Zalo PC:
 * `{connectTimeout:1e4, batchTimeout:1e4, wakeupTimeout:18e4}`.
 *
 * `wakeupTimeout` (180 s) chỉ dùng cho khoảng **chưa có gì**: điện thoại cần
 * 104 s để hiện thông báo (R17) và còn phải chờ người bấm. Khi gói đầu đã tới
 * thì câu hỏi đổi: "gói kế tiếp có về không", và Zalo PC trả lời bằng 10 s.
 */
test('hạn giữa hai gói là `batchTimeoutMs`, không phải 180 s', async () => {
  const h = await harness();
  h.addMetadataBatch();
  const session = new SyncV2Session(h.deps, {
    ...h.sessionOptions, wakeupTimeoutMs: 5_000, batchTimeoutMs: 40,
  });
  await session.start('req-1');
  // `start()` hẹn bằng hạn **phiên** (5 s): chưa có gói nào.
  assert.equal(session.currentPhase, SyncPhase.RECEIVING);

  session.handleControlEvents([batchEvent({
    idx: 0, isLast: true, batchType: SyncBatchType.METADATA_EMBEDDED,
    msgUrl: 'https://files.test/meta.bin',
  })]);
  await session.drain();

  // Gói đã tới ⇒ hạn đổi sang `batchTimeoutMs` (40 ms); 5 s của hạn phiên không
  // được dùng nữa. `isLast` ở đây làm phiên DONE, nên chờ đúng hạn gói thứ hai.
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(session.currentPhase, SyncPhase.DONE, 'metadata giải xong rồi — không có gói tiếp');
  session.dispose();
});

test('`isLast` dạng số vẫn tính là gói cuối — máy chủ không gửi `true`', async () => {
  // Đo 2026-11-10 14:03: 39 gói của một phiên thật, `idx` đủ `0..38`, dữ liệu
  // đúng, mà **không gói nào** mang `isLast === true`. Zalo PC đọc cờ bằng
  // truthiness (`e.isLast && (this.totalBatch=e.idx+1)`), không bằng `=== true`.
  const h = await harness();
  h.addMetadataBatch();
  const session = new SyncV2Session(h.deps, h.sessionOptions);
  await session.start('req-1');

  session.handleControlEvents([batchEvent({
    idx: 0, isLast: 1, batchType: SyncBatchType.METADATA_EMBEDDED,
    msgUrl: 'https://files.test/meta.bin',
  })]);
  await session.drain();

  assert.equal(session.currentPhase, SyncPhase.DONE, '`1` phải là gói cuối');
  assert.equal(session.stats.total, 1);
  session.dispose();
});

test('`isLast` dạng chuỗi "true" cũng tính — hình dạng protobuf-JSON', async () => {
  const h = await harness();
  h.addMetadataBatch();
  const session = new SyncV2Session(h.deps, h.sessionOptions);
  await session.start('req-1');

  session.handleControlEvents([batchEvent({
    idx: 0, isLast: 'true', batchType: SyncBatchType.METADATA_EMBEDDED,
    msgUrl: 'https://files.test/meta.bin',
  })]);
  await session.drain();

  assert.equal(session.currentPhase, SyncPhase.DONE);
  session.dispose();
});

test('bỏ phiên giữa đường (`dispose`) không gửi `591` — `cancel` mới là đường huỷ', async () => {
  // `dispose()` là dọn tài nguyên; `cancel()` mới là quyết định huỷ phiên phía
  // máy chủ. Controller gọi `cancel()`, nên nhánh này phải tách bạch.
  const h = await harness();
  const reasons: number[] = [];
  const session = new SyncV2Session({
    ...h.deps,
    disposeSession: async (_syncId: string, reason: number) => {
      reasons.push(reason);
      return { ok: true as const };
    },
  }, h.sessionOptions);
  await session.start('req-1');

  session.dispose();
  await Promise.resolve();

  assert.deepEqual(reasons, []);
});

// ---------------------------------------------------------- đánh thức 592

/**
 * R17 §2: `592` im lặng suốt 3 s, nhưng điện thoại **vẫn thức** — hai khung
 * `601` `transfer_status` tới sau 104 s. Vì vậy `start()` không được chờ phản
 * hồi của `592`: chờ nó là chặn cả phiên bằng một cổng không phải của máy chủ.
 */
test('không chờ phản hồi 592: start() trả về trong khi wake vẫn đang bay', async () => {
  const h = await harness();
  type WakeResult = { ok: true } | { ok: false; code: number | string; message: string };
  let resolveWake: (() => void) | null = null;
  const session = new SyncV2Session({
    ...h.deps,
    wake: () => new Promise<WakeResult>((resolve) => {
      resolveWake = () => resolve({ ok: false, code: 'no-reply', message: 'chưa trả lời' });
    }),
  }, h.sessionOptions);

  const startedAt = Date.now();
  const result = await session.start('req-1');
  const elapsed = Date.now() - startedAt;

  assert.deepEqual(result, { ok: true });
  assert.equal(session.currentPhase, SyncPhase.RECEIVING, 'phiên đã vào nhận gói dù 592 chưa trả lời');
  assert.ok(elapsed < 500, `start() phải trả về ngay, không chờ 592 (đo được ${elapsed} ms)`);
  assert.equal(typeof resolveWake, 'function');
  resolveWake?.();
  await Promise.resolve();
  session.dispose();
});

/**
 * `Idle` là **dấu hiệu sống nhưng không phải lời hứa**. Zalo PC làm
 * `case Idle: this.pauseBatchWait() || this.clearTimeoutReceiveBatch()` — vế
 * phải luôn chạy vì `pauseBatchWait()` trả `undefined`, nên Zalo PC xoá hạn và
 * chờ vô hạn tới khi điện thoại báo `Active` lại.
 *
 * Ta cố ý đi lệch: xoá hạn chính là lỗi R17 ("receiving forever, no `591`").
 * Ở đây `Idle` chỉ **không đặt lại** hạn, nên hạn cũ vẫn đếm tiếp và phiên
 * đóng đúng lúc. Đo 2026-11-10 15:49: `status:5` rồi `status:2` cách nhau
 * 20 ms rồi không gói nào — chuỗi đó phải kết thúc.
 */
test('`Idle` không hẹn lại hạn, nhưng cũng không giết phiên ngay', async () => {
  const h = await harness();
  const session = new SyncV2Session(h.deps, { ...h.sessionOptions, wakeupTimeoutMs: 120 });
  await session.start('req-1');

  await new Promise(resolve => setTimeout(resolve, 80));
  session.handleControlEvents([statusEvent({
    status: SyncTransferStatus.IDLE, fromDevice: SyncTransferDevice.MOBILE,
  })]);
  // Nếu `Idle` có hẹn lại như các trạng thái khác, hạn sẽ chạy tới 80+120 ms.
  await new Promise(resolve => setTimeout(resolve, 60));

  assert.equal(session.currentPhase, SyncPhase.FAILED,
    '120 ms kể từ lúc mở phiên là hạn gốc — `Idle` không được cộng thêm một cửa sổ');
  session.dispose();
});

test('`Active` hẹn lại hạn như mọi trạng thái khác', async () => {
  const h = await harness();
  const session = new SyncV2Session(h.deps, { ...h.sessionOptions, wakeupTimeoutMs: 120 });
  await session.start('req-1');

  await new Promise(resolve => setTimeout(resolve, 80));
  session.handleControlEvents([statusEvent({
    status: SyncTransferStatus.ACTIVE, fromDevice: SyncTransferDevice.MOBILE,
  })]);
  await new Promise(resolve => setTimeout(resolve, 60));

  assert.equal(session.currentPhase, SyncPhase.RECEIVING,
    'chỉ 60 ms kể từ `Active`, dù đã 140 ms kể từ lúc mở phiên');
  session.dispose();
});
