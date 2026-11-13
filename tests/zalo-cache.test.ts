import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LiveMessage, LiveThread } from '../electron/ipc-contract.ts';
import { openDb, type Db } from '../electron/db/schema.ts';
import { countMessages, listThreads, pageMessages, readCatchUpCursor, upsertMessages } from '../electron/db/messages.ts';
import type { CacheOptions, ZaloEvents } from '../electron/protocol/zalo-client.ts';
import { connectorFor, createFakeServer, fakeApi, rawUserMessage, type FakeServer } from './fake-zalo.ts';

/**
 * `electron/` được biên dịch sang CommonJS cho Electron, nên mọi import nội bộ
 * ghi `./mapper.js` — đúng tên file **sau** khi build, không phải tên trước.
 * Chạy thẳng `.ts` bằng node thì `./mapper.js` không tồn tại.
 *
 * Hook dưới đây chỉ đổi phần đuôi của đường dẫn tương đối khi file `.ts` tương
 * ứng có thật, nên test chạy được trên mã nguồn mà không phải build trước (một
 * `dist-electron` cũ sẽ làm test xanh trên mã đã lỗi thời).
 */
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

// Kiểu lấy bằng `import type` (bị xoá lúc chạy); giá trị phải import động để
// hook ở trên kịp đăng ký trước khi module graph của `zalo-client.ts` được nạp.
const { createZaloClient } = await import('../electron/protocol/zalo-client.ts');

/**
 * Tích hợp **phần nối cache** vào `zalo-client.ts` (plan §6, §10 "Tích hợp (DB)").
 *
 * `FakeZaloClient` thay cho `new Zalo(...)`, nên toàn bộ đường realtime, gửi, và
 * tải lịch sử chạy thật; chỉ máy chủ Zalo là giả. Đây là thứ chứng minh phần nối
 * hoạt động — kiểu TypeScript không nói được gì về một lời gọi DB bị bỏ sót.
 */

const session = {
  cookie: [{ name: 'zpsid', value: 'x' }] as never,
  imei: 'imei-1', userAgent: 'UA', language: 'vi',
};

const scratch = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'glass-cache-'));
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
};

interface Harness {
  events: {
    messages: LiveMessage[]; threads: LiveThread[];
    avatars: { threadId: string; remote: string; current: string | null }[];
    catchUp: { phase: string; received: number }[];
    catchUpListeners: Set<(progress: { phase: string; received: number }) => void>;
    log: { event: string; data: Record<string, unknown> }[];
  };
  opened: string[];
  openDbAt: (dataRoot: string) => (ownId: string) => Db | null;
}

function harness(): Harness {
  return {
    events: { messages: [], threads: [], avatars: [], catchUp: [], catchUpListeners: new Set(), log: [] },
    opened: [],
    openDbAt: dataRoot => ownId => {
      const db = openDb(dataRoot, ownId);
      return db;
    },
  };
}

const zaloEvents = (h: Harness): ZaloEvents => ({
  login: () => undefined,
  connection: () => undefined,
  catchUp: progress => {
    h.events.catchUp.push(progress);
    for (const listener of h.events.catchUpListeners) listener(progress);
  },
  message: message => h.events.messages.push(message),
  thread: thread => h.events.threads.push(thread),
  avatar: (threadId, remote, current) => h.events.avatars.push({ threadId, remote, current }),
  debug: (event, data) => h.events.log.push({ event, data }),
});

/** Phiên đã có sẵn: `login()` đi thẳng vào `restore()` → `activate()`. */
const savedStore = () => ({
  load: async () => session,
  save: async () => undefined,
  clear: async () => undefined,
});

const emptyServer = (overrides: Partial<FakeServer> = {}) => createFakeServer(overrides);

test('existing account receives no first-install sync invitation on upgrade', async () => {
  const s = scratch();
  const warm = openDb(s.dir, 'own-1');
  warm.handle.prepare("INSERT INTO threads (id, kind, updated_at) VALUES (?, 'group', ?)").run('legacy-group', 1);
  warm.close();
  const states: Array<{ status: string; phoneSyncSetupRequired?: boolean; phoneSyncComplete?: boolean }> = [];
  const h = harness();
  const client = createZaloClient(savedStore(), { ...zaloEvents(h), login: state => states.push(state) }, {
    cache: { open: ownId => openDb(s.dir, ownId) },
    connect: () => connectorFor(fakeApi(emptyServer())),
  });
  try {
    await client.login();
    const loggedIn = states.find(state => state.status === 'logged-in');
    assert.equal(loggedIn?.phoneSyncSetupRequired, false);
    assert.equal(loggedIn?.phoneSyncComplete, false);
  } finally { client.dispose(); s.done(); }
});

test('mở app lần hai: hội thoại đọc từ cache trước khi mạng trả lời', async () => {
  const s = scratch();
  try {
    // Lần đầu: máy chủ có một người bạn, danh sách được ghi vào cache.
    const first = emptyServer();
    const api1 = fakeApi(first, {
      getAllFriends: async () => [{ userId: 'u-1', displayName: 'Minh Anh', zaloName: 'ma', avatar: '' }],
    });
    const cache1: CacheOptions = { open: ownId => openDb(s.dir, ownId) };
    const client1 = createZaloClient(savedStore(), zaloEvents(harness()),
      { cache: cache1, connect: () => connectorFor(api1) });
    await client1.login();
    assert.deepEqual((await client1.listConversations()).map(t => t.id), ['u-1']);
    client1.dispose();

    // Lần hai: máy chủ im lặng hoàn toàn. Cache phải đỡ được.
    const h = harness();
    const dead = emptyServer();
    const silent = fakeApi(dead, {
      getAllFriends: async () => { throw new Error('mất mạng'); },
      getAllGroups: async () => { throw new Error('mất mạng'); },
      getPinConversations: async () => { throw new Error('mất mạng'); },
      getUnreadMark: async () => { throw new Error('mất mạng'); },
    });
    const client2 = createZaloClient(savedStore(), zaloEvents(h),
      { cache: { open: ownId => openDb(s.dir, ownId) }, connect: () => connectorFor(silent) });
    await client2.login();
    assert.deepEqual((await client2.listConversations()).map(t => t.id), ['u-1'],
      'danh sách của tài khoản không được biến mất vì một lần mạng hỏng');
    assert.ok(h.events.threads.some(t => t.id === 'u-1'), 'UI phải nhận thread trước khi mạng xong');
    client2.dispose();
  } finally { s.done(); }
});

test('tin đến được ghi vào DB trước khi phát lên UI', async () => {
  const s = scratch();
  const opened: Db[] = [];
  try {
    const h = harness();
    const server = emptyServer();
    const api = fakeApi(server);
    const client = createZaloClient(savedStore(), zaloEvents(h), {
      cache: { open: ownId => { const db = openDb(s.dir, ownId); opened.push(db); return db; } },
      connect: () => connectorFor(api),
    });

    await client.login();
    h.events.messages.length = 0;

    server.listener.emit('message', {
      type: 'user', threadId: 'u-1', isSelf: false,
      data: { ...rawUserMessage({ msgId: '77', content: 'tin thật', ts: '1700000005000' }), at: 0 },
    });

    assert.equal(h.events.messages.length, 1, 'tin vẫn được phát lên UI');
    assert.equal(h.events.messages[0].text, 'tin thật');
    const page = pageMessages(opened[0], 'u-1', 'user', 10);
    assert.deepEqual(page.messages.map(m => m.msgId), ['77'], 'và đã nằm trong DB ngay');
    client.dispose();
  } finally { s.done(); }
});

test('kết nối lại bắt kịp tin mới từ checkpoint bền vững và khử trùng', async () => {
  const s = scratch();
  const opened: Db[] = [];
  try {
    const h = harness();
    const firstServer = emptyServer();
    const firstClient = createZaloClient(savedStore(), zaloEvents(h), {
      cache: { open: ownId => { const db = openDb(s.dir, ownId); opened.push(db); return db; } },
      connect: () => connectorFor(fakeApi(firstServer)),
    });
    await firstClient.login();
    firstServer.listener.emit('message', {
      type: 'user', threadId: 'u-1', isSelf: false,
      data: { ...rawUserMessage({ msgId: '500', content: 'đã nhận trước đó', ts: '1700000005000' }), at: 0 },
    });
    assert.equal(readCatchUpCursor(opened[0]), '500');
    upsertMessages(opened[0], 'u-1', [{
      threadId: 'u-1', kind: 'user', msgId: 'syncv2:1700000007000:0', clientId: null,
      from: 'them', text: 'tin đã đồng bộ từ điện thoại', ts: 1_700_000_007_000,
    }]);
    assert.equal(readCatchUpCursor(opened[0]), '500',
      'ID Sync V2 không được thay thế con trỏ dùng để gọi cmd 510');
    firstClient.dispose();

    const secondServer = emptyServer();
    const secondApi = fakeApi(secondServer);
    const secondClient = createZaloClient(savedStore(), zaloEvents(h), {
      cache: { open: ownId => { const db = openDb(s.dir, ownId); opened.push(db); return db; } },
      connect: () => connectorFor(secondApi),
    });
    await secondClient.login();

    const settled = new Promise<{ phase: string; received: number }>(resolve => {
      const onCatchUp = (progress: { phase: string; received: number }) => {
        if (progress.phase === 'checking') return;
        h.events.catchUpListeners.delete(onCatchUp);
        resolve(progress);
      };
      h.events.catchUpListeners.add(onCatchUp);
    });
    const emit = secondServer.listener.emit as unknown as (event: string, ...args: unknown[]) => void;
    secondApi.listener.requestOldMessages = function (type: unknown, cursor: string | null) {
      secondServer.requests.push({ method: 'requestOldMessages', args: [type, cursor] });
      const page = type === 0 ? [{
          data: rawUserMessage({
            msgId: '900', msgType: 'chat.undo',
            content: { globalMsgId: '500', cliMsgId: '0', deleteMsg: 1 },
            ts: '1700000008000',
          }),
          threadId: 'u-1', isSelf: true,
        },
        { data: rawUserMessage({ msgId: '500', content: 'lặp', ts: '1700000005000' }), threadId: 'u-1', isSelf: false },
        { data: rawUserMessage({ msgId: '501', content: 'tin mới 1', ts: '1700000006000' }), threadId: 'u-1', isSelf: false },
        { data: rawUserMessage({ msgId: '502', content: 'tin mới 2', ts: '1700000007000' }), threadId: 'u-2', isSelf: false },
      ] : [];
      queueMicrotask(() => emit('old_messages', page, type));
    };
    secondServer.listener.emit('connected');
    const progress = await settled;

    assert.equal(secondServer.requests.find(item => item.method === 'requestOldMessages')?.args[1], '500');
    assert.equal(progress.phase, 'updated');
    assert.equal(progress.received, 2);
    assert.ok(h.events.messages.filter(message => ['501', '502'].includes(message.msgId ?? '')).every(message => message.backfill), 'offline catch-up must not replay individual notifications');
    assert.deepEqual(h.events.messages.filter(message => ['501', '502'].includes(message.msgId ?? '')).map(message => message.msgId), ['501', '502']);
    assert.equal(countMessages(opened[1], 'u-1'), 3,
      'tin Sync V2 cục bộ và tin 1-1 mới đều phải được giữ trong cache');
    assert.equal(pageMessages(opened[1], 'u-1', 'user', 10).messages
      .find(message => message.msgId === '500')?.recalled, true,
    'sự kiện thu hồi trong trang catch-up phải được áp dụng thay vì bị map như tin thường');
    assert.equal(countMessages(opened[1], 'u-2'), 1);
    assert.equal(readCatchUpCursor(opened[1]), '502');
    assert.ok(secondServer.requests.some(item => item.method === 'requestOldMessages'
      && item.args[0] === 1), 'kết nối lại phải hỏi cả hàng đợi tin nhóm (cmd 511)');
    secondClient.dispose();
  } finally { s.done(); }
});

test('catch-up nhóm ghi tin vào đúng hội thoại và checkpoint riêng', async () => {
  const s = scratch();
  const opened: Db[] = [];
  try {
    const h = harness();
    const server = emptyServer();
    const api = fakeApi(server);
    api.listener.requestOldMessages = function (type: unknown, cursor: string | null) {
      server.requests.push({ method: 'requestOldMessages', args: [type, cursor] });
      const page = type === 1
        ? [{
          data: rawUserMessage({
            msgId: '700', content: 'tin nhóm bị lỡ', ts: '1700000007000',
          }),
          threadId: 'g-1', isSelf: false, type: 1,
        }]
        : [];
      queueMicrotask(() => server.listener.emit('old_messages', page, type));
    };
    const client = createZaloClient(savedStore(), zaloEvents(h), {
      cache: { open: ownId => { const db = openDb(s.dir, ownId); opened.push(db); return db; } },
      connect: () => connectorFor(api),
    });
    await client.login();

    const settled = new Promise<{ phase: string; received: number }>(resolve => {
      const onCatchUp = (progress: { phase: string; received: number }) => {
        if (progress.phase === 'checking') return;
        h.events.catchUpListeners.delete(onCatchUp);
        resolve(progress);
      };
      h.events.catchUpListeners.add(onCatchUp);
    });
    server.listener.emit('connected');
    assert.deepEqual(await settled, { phase: 'updated', received: 1 });
    assert.equal(server.requests.find(item => item.method === 'requestOldMessages' && item.args[0] === 1)?.args[1], null);
    assert.equal(pageMessages(opened[0], 'g-1', 'group', 10).messages[0]?.text, 'tin nhóm bị lỡ');
    assert.equal(readCatchUpCursor(opened[0], 'group'), '700');
    assert.equal(readCatchUpCursor(opened[0], 'user'), null);
    client.dispose();
  } finally { s.done(); }
});

test('reaction đến trước tin catch-up vẫn được lưu và phát cùng tin gốc', async () => {
  const s = scratch();
  const opened: Db[] = [];
  try {
    const h = harness();
    const server = emptyServer();
    const api = fakeApi(server);
    api.listener.requestOldReactions = function (type: unknown, cursor: string | null) {
      server.requests.push({ method: 'requestOldReactions', args: [type, cursor] });
      if (type !== 0) return;
      server.listener.emit('old_reactions', [{
        threadId: 'u-1', isGroup: false, isSelf: false,
        data: {
          uidFrom: 'u-2',
          content: JSON.stringify({ rMsg: [{ gMsgID: '501' }], rType: 1, rIcon: '/-heart' }),
        },
      }], false);
    };
    api.listener.requestOldMessages = function (type: unknown) {
      const page = type === 0
        ? [{
          data: rawUserMessage({ msgId: '501', content: 'tin có reaction', ts: '1700000005000' }),
          threadId: 'u-1', isSelf: false,
        }]
        : [];
      queueMicrotask(() => server.listener.emit('old_messages', page, type));
    };
    const client = createZaloClient(savedStore(), zaloEvents(h), {
      cache: { open: ownId => { const db = openDb(s.dir, ownId); opened.push(db); return db; } },
      connect: () => connectorFor(api),
    });
    await client.login();

    const settled = new Promise<void>(resolve => {
      const onCatchUp = (progress: { phase: string; received: number }) => {
        if (progress.phase === 'checking') return;
        h.events.catchUpListeners.delete(onCatchUp);
        resolve();
      };
      h.events.catchUpListeners.add(onCatchUp);
    });
    server.listener.emit('connected');
    await settled;

    assert.ok(server.requests.some(item => item.method === 'requestOldReactions'
      && item.args[0] === 0 && item.args[1] === null),
    'kết nối lại phải xin hàng đợi reaction riêng của Zalo');
    const liveMessage = h.events.messages.find(message => message.msgId === '501');
    assert.deepEqual(liveMessage?.reactions, [{ icon: '/-heart', count: 1, mine: false }]);
    const cachedMessage = pageMessages(opened[0], 'u-1', 'user', 10).messages
      .find(message => message.msgId === '501');
    assert.deepEqual(cachedMessage?.reactions, [{ icon: '/-heart', count: 1, mine: false }]);
    client.dispose();
  } finally { s.done(); }
});

test('hội thoại nhóm tiếp tục đọc các trang cache cũ khi offline', async () => {
  const s = scratch();
  const opened: Db[] = [];
  try {
    let historyRequests = 0;
    const server = emptyServer();
    const api = fakeApi(server, {
      getGroupChatHistory: async () => {
        historyRequests += 1;
        throw new Error('offline');
      },
    });
    const client = createZaloClient(savedStore(), zaloEvents(harness()), {
      cache: { open: ownId => { const db = openDb(s.dir, ownId); opened.push(db); return db; } },
      connect: () => connectorFor(api),
    });
    await client.login();
    upsertMessages(opened[0], 'g-1', Array.from({ length: 75 }, (_, index) => ({
      threadId: 'g-1', kind: 'group' as const, msgId: String(index + 1), clientId: null,
      from: 'them' as const, text: `cached-${index + 1}`, ts: (index + 1) * 1000,
    })));

    const latest = await client.getMessages('g-1', 'group');
    assert.deepEqual(latest.messages.map(message => message.msgId),
      Array.from({ length: 50 }, (_, index) => String(index + 26)));
    assert.equal(latest.hasMore, true);

    const older = await client.getMessages('g-1', 'group', latest.messages[0].msgId ?? undefined);
    assert.deepEqual(older.messages.map(message => message.msgId),
      Array.from({ length: 25 }, (_, index) => String(index + 1)));
    assert.equal(historyRequests, 0, 'cache phải được đọc trước khi gọi API đang offline');
    client.dispose();
  } finally { s.done(); }
});

test('catch-up phân giải sticker nhóm thành media có thể tải và lưu', async () => {
  const s = scratch();
  const opened: Db[] = [];
  try {
    const h = harness();
    const server = emptyServer();
    const api = fakeApi(server, {
      getStickersDetail: async (id: number) => [{
        id,
        stickerWebpUrl: 'https://stc.zdn.vn/stickers/123.webp',
        stickerUrl: 'https://stc.zdn.vn/stickers/123.gif',
      }],
    });
    api.listener.requestOldMessages = function (type: unknown, cursor: string | null) {
      server.requests.push({ method: 'requestOldMessages', args: [type, cursor] });
      const page = type === 1
        ? [{
          data: rawUserMessage({
            msgId: '701', msgType: 'chat.sticker',
            content: { id: 123, catId: 7, type: 1 }, ts: '1700000007000',
          }),
          threadId: 'g-1', isSelf: false, type: 1,
        }]
        : [];
      queueMicrotask(() => server.listener.emit('old_messages', page, type));
    };
    const client = createZaloClient(savedStore(), zaloEvents(h), {
      cache: { open: ownId => { const db = openDb(s.dir, ownId); opened.push(db); return db; } },
      connect: () => connectorFor(api),
    });
    await client.login();

    const settled = new Promise<{ phase: string; received: number }>(resolve => {
      const onCatchUp = (progress: { phase: string; received: number }) => {
        if (progress.phase === 'checking') return;
        h.events.catchUpListeners.delete(onCatchUp);
        resolve(progress);
      };
      h.events.catchUpListeners.add(onCatchUp);
    });
    server.listener.emit('connected');
    assert.deepEqual(await settled, { phase: 'updated', received: 1 });
    const stored = pageMessages(opened[0], 'g-1', 'group', 10).messages[0];
    assert.equal(stored?.attachments?.[0].kind, 'sticker');
    assert.equal(stored?.attachments?.[0].remote, 'https://stc.zdn.vn/stickers/123.webp');
    assert.ok(h.events.log.some(item => item.event === 'sticker-detail' && item.data.ok === true));
    assert.equal(readCatchUpCursor(opened[0], 'group'), '701');
    client.dispose();
  } finally { s.done(); }
});

test('catch-up báo chưa xác nhận khi listener từ chối yêu cầu', async () => {
  const s = scratch();
  try {
    const h = harness();
    const server = emptyServer();
    const api = fakeApi(server);
    api.listener.requestOldMessages = () => { throw new Error('socket chưa sẵn sàng'); };
    const client = createZaloClient(savedStore(), zaloEvents(h), {
      cache: { open: ownId => openDb(s.dir, ownId) },
      connect: () => connectorFor(api),
    });
    await client.login();

    const settled = new Promise<{ phase: string; received: number }>(resolve => {
      const onCatchUp = (progress: { phase: string; received: number }) => {
        if (progress.phase === 'checking') return;
        h.events.catchUpListeners.delete(onCatchUp);
        resolve(progress);
      };
      h.events.catchUpListeners.add(onCatchUp);
    });
    server.listener.emit('connected');
    assert.deepEqual(await settled, { phase: 'incomplete', received: 0 });
    assert.ok(h.events.log.some(item => item.event === 'catch-up' && item.data.reason === 'request-error'));
    client.dispose();
  } finally { s.done(); }
});

test('catch-up chỉ nhận sự kiện thu hồi thì không báo đã bắt kịp', async () => {
  const s = scratch();
  try {
    const h = harness();
    const server = emptyServer();
    const api = fakeApi(server);
    api.listener.requestOldMessages = (type: unknown) => {
      queueMicrotask(() => server.listener.emit('old_messages', [{
        data: rawUserMessage({
          msgId: '900', msgType: 'chat.undo',
          content: { globalMsgId: '500', cliMsgId: '0', deleteMsg: 1 },
          ts: '1700000008000',
        }),
        threadId: 'u-1', isSelf: true,
      }], type));
    };
    const client = createZaloClient(savedStore(), zaloEvents(h), {
      cache: { open: ownId => openDb(s.dir, ownId) },
      connect: () => connectorFor(api),
    });
    await client.login();

    const settled = new Promise<{ phase: string; received: number }>(resolve => {
      const onCatchUp = (progress: { phase: string; received: number }) => {
        if (progress.phase === 'checking') return;
        h.events.catchUpListeners.delete(onCatchUp);
        resolve(progress);
      };
      h.events.catchUpListeners.add(onCatchUp);
    });
    server.listener.emit('connected');
    assert.deepEqual(await settled, { phase: 'incomplete', received: 0 });
    assert.ok(h.events.log.some(item =>
      item.event === 'catch-up' && item.data.reason === 'control-only-page'));
    client.dispose();
  } finally { s.done(); }
});

test('gửi thành công: bong bóng tạm gộp vào tin thật, không còn hai dòng', async () => {
  const s = scratch();
  const opened: Db[] = [];
  try {
    const server = emptyServer();
    const client = createZaloClient(savedStore(), zaloEvents(harness()), {
      cache: { open: ownId => { const db = openDb(s.dir, ownId); opened.push(db); return db; } },
      connect: () => connectorFor(fakeApi(server)),
    });
    await client.login();
    const result = await client.send({ threadId: 'u-1', kind: 'user', text: 'đi nhé', clientId: 'c-1' });
    assert.equal(result.ok, true);
    assert.equal(countMessages(opened[0], 'u-1'), 1, 'một dòng cho một tin');
    const page = pageMessages(opened[0], 'u-1', 'user', 10);
    assert.equal(page.messages[0].msgId, result.msgId);
    assert.equal(page.messages[0].text, 'đi nhé');
    client.dispose();
  } finally { s.done(); }
});

test('gửi hỏng: dòng tạm còn đó và ở trạng thái failed', async () => {
  const s = scratch();
  const opened: Db[] = [];
  try {
    const server = emptyServer({ failSend: true });
    const client = createZaloClient(savedStore(), zaloEvents(harness()), {
      cache: { open: ownId => { const db = openDb(s.dir, ownId); opened.push(db); return db; } },
      connect: () => connectorFor(fakeApi(server)),
    });
    await client.login();
    const result = await client.send({ threadId: 'u-1', kind: 'user', text: 'sẽ hỏng', clientId: 'c-2' });
    assert.equal(result.ok, false);
    const row = opened[0].handle.prepare(
      "SELECT status FROM messages WHERE client_id = 'c-2'").get() as { status: string } | undefined;
    assert.equal(row?.status, 'failed', 'mất mạng giữa chừng thì phải còn dấu để gửi lại');
    assert.equal(countMessages(opened[0], 'u-1'), 1);
    client.dispose();
  } finally { s.done(); }
});

test('gửi lại sau khi lỗi gộp vào đúng một dòng', async () => {
  const s = scratch();
  const opened: Db[] = [];
  try {
    const server = emptyServer({ failSend: true });
    const client = createZaloClient(savedStore(), zaloEvents(harness()), {
      cache: { open: ownId => { const db = openDb(s.dir, ownId); opened.push(db); return db; } },
      connect: () => connectorFor(fakeApi(server)),
    });
    await client.login();
    await client.send({ threadId: 'u-1', kind: 'user', text: 'thử', clientId: 'c-3' });
    server.failSend = false;
    const retry = await client.send({ threadId: 'u-1', kind: 'user', text: 'thử', clientId: 'c-3' });
    assert.equal(retry.ok, true);
    assert.equal(countMessages(opened[0], 'u-1'), 1, 'gửi lại không được tạo bong bóng thứ hai');
    client.dispose();
  } finally { s.done(); }
});

test('lịch sử nhóm lấy từ máy chủ được ghi cache, và lần mở đầu đọc từ cache', async () => {
  const s = scratch();
  const opened: Db[] = [];
  try {
    const server = emptyServer({
      groupMessages: [
        { isSelf: false, data: { ...rawUserMessage({ msgId: '3', content: 'ba', ts: '1700000003000' }), idTo: 'g-1' } },
        { isSelf: false, data: { ...rawUserMessage({ msgId: '2', content: 'hai', ts: '1700000002000' }), idTo: 'g-1' } },
      ],
      groupMore: 0,
    });
    const api = fakeApi(server);
    const client = createZaloClient(savedStore(), zaloEvents(harness()), {
      cache: { open: ownId => { const db = openDb(s.dir, ownId); opened.push(db); return db; } },
      connect: () => connectorFor(api),
    });
    await client.login();
    const first = await client.getMessages('g-1', 'group');
    assert.deepEqual(first.messages.map(m => m.msgId), ['2', '3'], 'cũ trước, mới sau');
    assert.equal(countMessages(opened[0], 'g-1'), 2, 'trang vừa nhận đã vào cache');

    // Lần mở thứ hai của cùng hội thoại trong phiên phải hỏi máy chủ, không
    // lặp lại đúng trang cache — nếu không nút tải không bao giờ đi xa hơn.
    const requestsBefore = server.requests.length;
    server.groupMessages = [];
    await client.getMessages('g-1', 'group');
    assert.equal(server.requests.filter(r => r.method === 'sendMessage').length, 0);
    assert.ok(server.requests.length >= requestsBefore, 'lần hai vẫn chạm máy chủ');
    client.dispose();
  } finally { s.done(); }
});

for (const invalidSmallAvatar of [false, true]) {
test(`avatar group info falls back from invalid small URL: ${invalidSmallAvatar}`, async () => {
  const s = scratch();
  try {
    const remote = 'https://s120-ava-talk.zadn.vn/member-700.jpg';
    const server = emptyServer({
      groupMessages: [{
        isSelf: false,
        data: { ...rawUserMessage({ msgId: '7', uidFrom: 'global-700', idTo: '900' }), idTo: '900' },
      }],
      groupMemberInfo: {
        '900': {
          groupId: '900', memberIds: ['700'],
          currentMems: [{
            id: '700', dName: 'Mai Anh', zaloName: 'Mai',
            avatar: invalidSmallAvatar ? remote : '', avatar_25: invalidSmallAvatar ? '/invalid-avatar' : remote,
          }],
        },
      },
    });
    const api = fakeApi(server, {
      getAllGroups: async () => ({ version: '1', gridVerMap: { '900': '1' } }),
      getGroupInfo: async () => ({
        gridInfoMap: {
          '900': {
            groupId: '900', name: 'Nhóm', avt: '', totalMember: 1,
            globalId: 'group-900', memberIds: [], currentMems: [],
          },
        },
      }),
      getUserInfo: async (ids: string[]) => ({
        changed_profiles: Object.fromEntries(ids.map(id => [id, {
          userId: id, displayName: 'Mai Anh', zaloName: 'Mai',
          globalId: 'global-700', avatar: remote,
        }])),
      }),
    });
    const h = harness();
    const client = createZaloClient(savedStore(), zaloEvents(h), {
      cache: { open: ownId => openDb(s.dir, ownId) },
      connect: () => connectorFor(api),
    });
    await client.login();
    server.listener.emit('connected');
    await client.getMessages('900', 'group');

    assert.deepEqual(h.events.avatars, [{ threadId: '700', remote, current: null }]);
    const request = server.requests.find(item => item.method === 'getGroupInfoForAvatars');
    assert.deepEqual(request?.args[0], {
      grid: '900', avatar_size: 100, member_avatar_size: 100,
    });
    client.setActiveThread('900');
    h.events.messages.length = 0;
    client.setAvatar('700', '700.png');
    assert.ok(h.events.messages.length > 0, 'avatar refresh republishes cached group messages');
    assert.ok(h.events.messages.every(message => message.backfill === true),
      'cached messages must remain history even when the renderer has not loaded their page yet');
    assert.ok(h.events.messages.some(message => message.senderAvatar === 'glass://app/avatars/700.png'));
    client.dispose();
  } finally { s.done(); }
});

}

test('avatars resolve and refresh historical senders outside the current roster', async () => {
  const s = scratch();
  try {
    const warm = openDb(s.dir, 'own-1');
    warm.handle.prepare(
      `INSERT INTO messages (thread_id, msg_id, sender_id, sender_name, from_me, ts, text, status, recalled)
       VALUES ('900', '7', 'global-700', 'Mai Anh', 0, 1700000007000, 'cũ', 'sent', 0)`).run();
    warm.close();
    const remote = 'https://s120-ava-talk.zadn.vn/member-700.jpg';
    const server = emptyServer({
      globalIdMap: { 'global-700': '700' },
      groupMessages: [{ isSelf: false, data: {
        ...rawUserMessage({ msgId: '7', uidFrom: 'global-700', dName: 'Mai Anh' }), idTo: '900',
      } }],
    });
    const api = fakeApi(server, {
      getAllGroups: async () => ({ version: '1', gridVerMap: { '900': '1' } }),
      getGroupInfo: async () => ({ gridInfoMap: {
        '900': { groupId: '900', name: 'Nhóm', avt: '', totalMember: 0,
          memberIds: [], currentMems: [] },
      } }),
      getUserInfo: async () => ({ changed_profiles: {
        '700': { userId: '700', displayName: 'Mai Anh', zaloName: '',
          globalId: 'global-700', avatar: remote },
      } }),
    });
    const h = harness();
    const client = createZaloClient(savedStore(), zaloEvents(h), {
      cache: { open: ownId => openDb(s.dir, ownId) },
      connect: () => connectorFor(api),
    });
    await client.login();
    server.listener.emit('connected');
    await client.getMessages('900', 'group');
    assert.ok(h.events.avatars.some(job => job.threadId === '700' && job.remote === remote));
    client.setActiveThread('900');
    h.events.messages.length = 0;
    client.setAvatar('700', '700.jpg');
    assert.ok(h.events.messages.some(message => message.msgId === '7'
      && message.senderAvatar === 'glass://app/avatars/700.jpg' && message.backfill));
    const page = await client.getMessages('900', 'group');
    assert.equal(page.messages.find(message => message.msgId === '7')?.senderAvatar,
      'glass://app/avatars/700.jpg');
    client.dispose();
  } finally { s.done(); }
});

test('refresh group cache resolves Sync V2 sender IDs without a member roster', async () => {
  const s = scratch();
  const opened: Db[] = [];
  try {
    const warm = openDb(s.dir, 'own-1');
    warm.handle.prepare(
      `INSERT INTO messages (thread_id, msg_id, sender_id, from_me, ts, text, status, recalled)
       VALUES ('g-1', '7', 'global-member-1', 0, 1700000007000, 'cũ', 'sent', 0)`).run();
    warm.close();

    const server = emptyServer({
      groupMessages: [{
        isSelf: false,
        data: {
          ...rawUserMessage({ msgId: '7', content: 'cũ', ts: '1700000007000',
            uidFrom: 'member-1', dName: '' }),
          idTo: 'g-1',
        },
      }],
      globalIdMap: { 'global-member-1': 'member-1' },
    });
    const requested: string[][] = [];
    let historyCalls = 0;
    const api = fakeApi(server, {
      getAllGroups: async () => ({ version: '1', gridVerMap: { 'g-1': '1' } }),
      getGroupInfo: async () => ({
        gridInfoMap: {
          'g-1': {
            groupId: 'g-1', name: 'Lớp', avt: '', totalMember: 1,
            memberIds: [], currentMems: [],
          },
        },
      }),
      getUserInfo: async (ids: string[]) => {
        requested.push(ids);
        return {
          changed_profiles: {
            'member-1': {
              userId: 'member-1', displayName: 'Mai Anh', zaloName: '', globalId: 'global-member-1',
            },
          },
        };
      },
      getGroupChatHistory: async () => {
        historyCalls += 1;
        return { groupMsgs: server.groupMessages, more: server.groupMore };
      },
    });
    api.listener.requestOldMessages = function (type: unknown) {
      const emit = api.listener.emit as unknown as (event: string, ...args: unknown[]) => void;
      queueMicrotask(() => emit.call(api.listener, 'old_messages', [], type));
    };
    const h = harness();
    const client = createZaloClient(savedStore(), zaloEvents(h), {
      cache: { open: ownId => { const db = openDb(s.dir, ownId); opened.push(db); return db; } },
      connect: () => connectorFor(api),
    });
    await client.login();
    client.setActiveThread('g-1');

    const page = await client.getMessages('g-1', 'group');
    assert.equal(page.messages[0].fromName, undefined, 'offline cache is returned immediately');
    assert.equal(requested.length, 0, 'profile API is not called before connection');
    const emit = api.listener.emit as unknown as (event: string, ...args: unknown[]) => void;
    emit.call(api.listener, 'connected');
    const deadline = Date.now() + 10_000;
    while (!h.events.log.some(item =>
      item.event === 'group-name-refresh' && item.data.step === 'complete') && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    assert.ok(h.events.log.some(item =>
      item.event === 'group-name-refresh' && item.data.step === 'complete'),
    `connecting after loading cached chat must refresh that active group; events=${JSON.stringify(
      h.events.log.filter(item => ['connection', 'global-id-resolver', 'group-profiles', 'group-name-refresh'].includes(item.event)))}, historyCalls=${historyCalls}`);
    assert.deepEqual(server.requests.find(request =>
      request.method === 'getUserIdsFromGlobalNoiseId')?.args[0], ['global-member-1']);
    assert.equal(requested[0]?.[0], 'member-1');
    assert.ok(h.events.messages.some(message => message.msgId === '7' && message.fromName === 'Mai Anh'),
      'renderer receives a backfill for the already loaded message');
    const stored = pageMessages(opened[0], 'g-1', 'group', 10).messages[0];
    assert.equal(stored.senderId, 'member-1');
    assert.equal(stored.fromName, 'Mai Anh');
    client.dispose();
  } finally { s.done(); }
});

test('trang đọc từ cache không được tuyên bố "đã hết lịch sử"', async () => {
  const s = scratch();
  try {
    // Nạp sẵn cache như thể một phiên trước đã tải.
    const warm = openDb(s.dir, 'own-1');
    warm.handle.prepare(
      `INSERT INTO messages (thread_id, msg_id, sender_id, from_me, ts, text, status, recalled)
       VALUES ('u-1', '5', 'x', 0, 1000, 'cũ', 'sent', 0)`).run();
    warm.close();

    const server = emptyServer();
    const client = createZaloClient(savedStore(), zaloEvents(harness()), {
      cache: { open: ownId => openDb(s.dir, ownId) },
      connect: () => connectorFor(fakeApi(server)),
    });
    await client.login();
    const page = await client.getMessages('u-1', 'user');
    assert.deepEqual(page.messages.map(m => m.msgId), ['5']);
    assert.equal(page.hasMore, true,
      'cache hết tin không có nghĩa Zalo hết; báo false sẽ tắt nút tải vĩnh viễn');
    client.dispose();
  } finally { s.done(); }
});

test('hội thoại trống không được tuyên bố "đã hết lịch sử"', async () => {
  const s = scratch();
  try {
    // Đo thật 2026-11-08 12:34: bấm tải cho một hội thoại chưa có tin, `cmd 510`
    // trả 12 tin của **hội thoại khác**; ta không có gì để hiện. Bản cũ báo
    // `hasMore: false` ⇒ UI ghi "Đã hết lịch sử Zalo" và tắt nút, một khẳng định
    // về máy chủ cho hội thoại chưa hề được hỏi tới.
    const server = emptyServer();
    const api = fakeApi(server);
    const h = harness();
    const client = createZaloClient(savedStore(), zaloEvents(h), {
      cache: { open: ownId => openDb(s.dir, ownId) },
      connect: () => connectorFor(api),
    });
    await client.login();
    // Máy chủ trả đúng một trang toàn tin của hội thoại khác, rồi im lặng.
    let asked = 0;
    const original = api.listener.requestOldMessages.bind(api.listener);
    api.listener.requestOldMessages = function (type: unknown, lastId: string | null) {
      asked += 1;
      if (asked === 1) {
        // `emit` khai kiểu theo payload thật của zca-js; test chỉ cần đúng phần
        // `data`/`threadId`/`isSelf` mà mapper đọc, nên ép kiểu ở đúng một chỗ.
        const emit = api.listener.emit as unknown as (event: string, ...args: unknown[]) => void;
        emit.call(api.listener, 'old_messages', [
          { data: rawUserMessage({ msgId: '900', content: 'của người khác', ts: '1700000900000', idTo: 'u-9' }), threadId: 'u-9', isSelf: false },
        ], type);
      }
      original(type as never, lastId);
    };
    const page = await client.getMessages('u-empty', 'user');
    assert.deepEqual(page.messages, [], 'không có tin nào của hội thoại này');
    assert.equal(page.hasMore, true,
      'không thấy tin không có nghĩa là hết lịch sử; báo false sẽ khoá nút vĩnh viễn');
    client.dispose();
  } finally { s.done(); }
});

test('1-1 lùi trang bằng cache cục bộ, không gọi endpoint cloud — như Zalo PC', async () => {
  const s = scratch();
  try {
    // Dựng cache như thể một phiên trước đã tải về 3 tin.
    const warm = openDb(s.dir, 'own-1');
    const insert = warm.handle.prepare(
      `INSERT INTO messages (thread_id, msg_id, sender_id, from_me, ts, text, status, recalled)
       VALUES (?, ?, 'x', 0, ?, ?, 'sent', 0)`);
    insert.run('u-1', '3', 3000, 'ba');
    insert.run('u-1', '2', 2000, 'hai');
    insert.run('u-1', '1', 1000, 'một');
    warm.close();

    const h = harness();
    const server = emptyServer();
    const api = fakeApi(server);
    // `fetch` là đường duy nhất ra cloud. Nếu nó bị chạm thì nhánh 1-1 đã đi
    // sai đường — đây chính là điều `apiEnable` của Zalo PC ngăn.
    const originalFetch = globalThis.fetch;
    let fetched = 0;
    globalThis.fetch = (async () => {
      fetched += 1;
      throw new Error('nhánh 1-1 không được gọi cloud');
    }) as unknown as typeof fetch;
    try {
      const client = createZaloClient(savedStore(), zaloEvents(h), {
        cache: { open: ownId => openDb(s.dir, ownId) },
        connect: () => connectorFor(api),
      });
      await client.login();
      // Trang đầu: cả 3 tin từ cache (`HISTORY_PAGE` = 50 nên không cắt).
      const first = await client.getMessages('u-1', 'user');
      assert.deepEqual(first.messages.map(m => m.msgId), ['1', '2', '3']);
      // Trang lùi: mốc là tin cũ nhất đang có. Zalo PC đọc SQLite rồi trả về
      // trước khi chạm cloud, nên trang này phải tới từ cache.
      const older = await client.getMessages('u-1', 'user', '2');
      assert.deepEqual(older.messages.map(m => m.msgId), ['1'],
        'trang lùi 1-1 phải đến từ cache cục bộ');
      assert.equal(older.hasMore, false,
        '`hasMore` phản ánh DB: hết phần đã cache, không phải "Zalo hết tin"');
      assert.equal(fetched, 0, 'nhánh 1-1 không được gọi /api/cm/getoldv2');
      client.dispose();
    } finally { globalThis.fetch = originalFetch; }
  } finally { s.done(); }
});

test('cache mở hỏng thì chat vẫn chạy như trước khi có giai đoạn 6', async () => {
  const s = scratch();
  try {
    const h = harness();
    const server = emptyServer();
    const client = createZaloClient(savedStore(), zaloEvents(h), {
      cache: { open: () => { throw new Error('đĩa đầy'); } },
      connect: () => connectorFor(fakeApi(server, {
        getAllFriends: async () => [{ userId: 'u-1', displayName: 'Minh Anh', zaloName: 'ma', avatar: '' }],
      })),
    });
    await client.login();
    server.listener.emit('message', {
      type: 'user', threadId: 'u-1', isSelf: false,
      data: { ...rawUserMessage({ msgId: '9', content: 'vẫn chạy', ts: '1700000009000' }), at: 0 },
    });
    assert.deepEqual((await client.listConversations()).map(t => t.id), ['u-1']);
    assert.equal(h.events.messages.at(-1)?.text, 'vẫn chạy');
    assert.ok(h.events.log.some(l => l.event === 'cache' && l.data.ok === false),
      'lỗi cache phải để lại dấu trong log, không im lặng');
    const sent = await client.send({ threadId: 'u-1', kind: 'user', text: 'gửi được', clientId: 'c-9' });
    assert.equal(sent.ok, true, 'gửi tin không được phụ thuộc cache');
    client.dispose();
  } finally { s.done(); }
});

test('đổi tài khoản: mỗi ownId một file DB, không trộn dữ liệu', async () => {
  const s = scratch();
  try {
    const opened: string[] = [];
    const open = (ownId: string) => { opened.push(ownId); return openDb(s.dir, ownId); };

    const a = createZaloClient(savedStore(), zaloEvents(harness()), {
      cache: { open },
      connect: () => connectorFor(fakeApi(emptyServer(), { getOwnId: () => 'acc-a' })),
    });
    await a.login();
    await a.send({ threadId: 'u-a', kind: 'user', text: 'của A', clientId: 'c-a' });
    a.dispose();

    const b = createZaloClient(savedStore(), zaloEvents(harness()), {
      cache: { open },
      connect: () => connectorFor(fakeApi(emptyServer(), { getOwnId: () => 'acc-b' })),
    });
    await b.login();
    b.dispose();

    assert.deepEqual(opened, ['acc-a', 'acc-b']);
    const dbA = openDb(s.dir, 'acc-a');
    const dbB = openDb(s.dir, 'acc-b');
    assert.equal(countMessages(dbA, 'u-a'), 1, 'A giữ tin của A');
    assert.equal(countMessages(dbB, 'u-a'), 0, 'B không thấy tin của A');
    assert.notEqual(dbA.path, dbB.path);
    dbA.close(); dbB.close();
  } finally { s.done(); }
});

test('đăng xuất đóng cache nhưng không xoá dữ liệu cục bộ', async () => {
  const s = scratch();
  try {
    const client = createZaloClient(savedStore(), zaloEvents(harness()), {
      cache: { open: ownId => openDb(s.dir, ownId) },
      connect: () => connectorFor(fakeApi(emptyServer())),
    });
    await client.login();
    await client.send({ threadId: 'u-1', kind: 'user', text: 'còn lại', clientId: 'c-x' });
    await client.logout();
    const db = openDb(s.dir, 'own-1');
    assert.equal(countMessages(db, 'u-1'), 1, 'đăng xuất không phải lệnh xoá dữ liệu');
    db.close();
  } finally { s.done(); }
});

test('hội thoại lạ vẫn ghi được tin trước khi metadata hội thoại về', async () => {
  const s = scratch();
  const opened: Db[] = [];
  try {
    const server = emptyServer();
    const client = createZaloClient(savedStore(), zaloEvents(harness()), {
      cache: { open: ownId => { const db = openDb(s.dir, ownId); opened.push(db); return db; } },
      connect: () => connectorFor(fakeApi(server)),
    });
    await client.login();
    // Không có `getAllFriends` nào trả về `u-new`: tin phải tới trước metadata.
    server.listener.emit('message', {
      type: 'user', threadId: 'u-new', isSelf: false,
      data: { ...rawUserMessage({ msgId: '404', content: 'từ hội thoại mới', ts: '1700000100000' }), at: 0 },
    });
    assert.equal(countMessages(opened[0], 'u-new'), 1, 'khoá ngoại tắt có chủ ý: tin không bị rơi');
    const threads = listThreads(opened[0]);
    assert.ok(threads.some(t => t.id === 'u-new'), 'và hội thoại được tạo từ tin đầu tiên');
    client.dispose();
  } finally { s.done(); }
});

/** Một sự kiện `undo` như zca-js dựng nó: `data` là payload gốc của tin bị thu hồi. */
const undoEvent = (over: { threadId?: string; msgId?: string; isGroup?: boolean; isSelf?: boolean; ts?: string } = {}) => ({
  threadId: over.threadId ?? 'u-1',
  isSelf: over.isSelf ?? false,
  isGroup: over.isGroup ?? false,
  data: { msgId: over.msgId ?? '77', ts: over.ts ?? '1700000009000', content: { deleteMsg: 1 } },
});

test('thu hồi: tin trong cache mất nội dung, dòng vẫn còn, UI nhận đúng một event', async () => {
  const s = scratch();
  const opened: Db[] = [];
  try {
    const h = harness();
    const server = emptyServer();
    const client = createZaloClient(savedStore(), zaloEvents(h), {
      cache: { open: ownId => { const db = openDb(s.dir, ownId); opened.push(db); return db; } },
      connect: () => connectorFor(fakeApi(server)),
    });
    await client.login();
    server.listener.emit('message', {
      type: 'user', threadId: 'u-1', isSelf: false,
      data: { ...rawUserMessage({ msgId: '77', content: 'tin thật', ts: '1700000005000' }), at: 0 },
    });
    h.events.messages.length = 0;

    server.listener.emit('undo', undoEvent({ msgId: '77' }));

    assert.equal(h.events.messages.length, 1, 'không được phát thêm bong bóng, chỉ sửa cái đang có');
    assert.equal(h.events.messages[0].recalled, true);
    assert.equal(h.events.messages[0].msgId, '77');
    assert.equal(h.events.messages[0].text, '', 'nội dung đã rút thì không được đi lên UI');
    const page = pageMessages(opened[0], 'u-1', 'user', 10);
    assert.equal(page.messages.length, 1, 'dòng được giữ: tin không biến mất khỏi chỗ cũ');
    assert.equal(page.messages[0].recalled, true);
    assert.equal(page.messages[0].ts, 1_700_000_005_000, 'ts gốc được giữ để bong bóng không nhảy chỗ');
    client.dispose();
  } finally { s.done(); }
});

test('thu hồi tới trước tin gốc: trang lịch sử về sau không hồi sinh nội dung', async () => {
  const s = scratch();
  const opened: Db[] = [];
  try {
    const h = harness();
    const server = emptyServer();
    const client = createZaloClient(savedStore(), zaloEvents(h), {
      cache: { open: ownId => { const db = openDb(s.dir, ownId); opened.push(db); return db; } },
      connect: () => connectorFor(fakeApi(server)),
    });
    await client.login();

    // Sự kiện thu hồi của một tin ta chưa tải lần nào.
    server.listener.emit('undo', undoEvent({ msgId: '88' }));
    assert.equal(countMessages(opened[0], 'u-1'), 0, 'không dựng dòng chỉ có msg_id');
    assert.equal(h.events.messages.at(-1)?.recalled, true, 'nhưng UI vẫn biết để tải về không có nội dung');

    // Giờ một trang lịch sử mang đúng tin đó, kèm nội dung gốc.
    server.listener.emit('message', {
      type: 'user', threadId: 'u-1', isSelf: false,
      data: { ...rawUserMessage({ msgId: '88', content: 'lẽ ra không hiện', ts: '1700000002000' }), at: 0 },
    });
    const page = pageMessages(opened[0], 'u-1', 'user', 10);
    assert.equal(page.messages.length, 1);
    assert.equal(page.messages[0].recalled, true);
    assert.equal(page.messages[0].text, '', 'nội dung của tin đã rút không được hồi sinh');
    client.dispose();
  } finally { s.done(); }
});

test('thu hồi trong nhóm dùng đúng kind của sự kiện', async () => {
  const s = scratch();
  const opened: Db[] = [];
  try {
    const h = harness();
    const server = emptyServer();
    const client = createZaloClient(savedStore(), zaloEvents(h), {
      cache: { open: ownId => { const db = openDb(s.dir, ownId); opened.push(db); return db; } },
      connect: () => connectorFor(fakeApi(server)),
    });
    await client.login();
    server.listener.emit('undo', undoEvent({ threadId: 'g-1', msgId: '5', isGroup: true, isSelf: true }));
    assert.equal(h.events.messages.at(-1)?.kind, 'group');
    assert.equal(h.events.messages.at(-1)?.threadId, 'g-1');
    assert.equal(h.events.messages.at(-1)?.from, 'me', 'thu hồi tin mình gửi phải là bong bóng bên phải');
    client.dispose();
  } finally { s.done(); }
});

test('sự kiện thu hồi thiếu msgId bị bỏ, không làm hỏng hàng đợi', async () => {
  const s = scratch();
  const opened: Db[] = [];
  try {
    const h = harness();
    const server = emptyServer();
    const client = createZaloClient(savedStore(), zaloEvents(h), {
      cache: { open: ownId => { const db = openDb(s.dir, ownId); opened.push(db); return db; } },
      connect: () => connectorFor(fakeApi(server)),
    });
    await client.login();
    h.events.messages.length = 0;
    server.listener.emit('undo', {
      threadId: 'u-1', isSelf: false, isGroup: false, data: { content: { deleteMsg: 1 } },
    });
    assert.equal(h.events.messages.length, 0, 'không có id thì không có gì để thu hồi');
    // Vẫn còn sống: tin kế tiếp đi qua bình thường.
    server.listener.emit('message', {
      type: 'user', threadId: 'u-1', isSelf: false,
      data: { ...rawUserMessage({ msgId: '90', content: 'vẫn chạy', ts: '1700000010000' }), at: 0 },
    });
    assert.equal(h.events.messages.at(-1)?.text, 'vẫn chạy');
    client.dispose();
  } finally { s.done(); }
});

test('thu hồi khi cache mở hỏng: UI vẫn nhận event, không ném lỗi', async () => {
  const h = harness();
  const server = emptyServer();
  const client = createZaloClient(savedStore(), zaloEvents(h), {
    cache: { open: () => { throw new Error('đĩa đầy'); } },
    connect: () => connectorFor(fakeApi(server)),
  });
  await client.login();
  server.listener.emit('undo', undoEvent({ msgId: '91' }));
  assert.equal(h.events.messages.at(-1)?.recalled, true, 'thu hồi không được phụ thuộc vào cache');
  client.dispose();
});

test('opening a cached Sync sticker resolves its saved ID into a download job', async () => {
  const s = scratch();
  try {
    const warm = openDb(s.dir, 'own-1');
    upsertMessages(warm, 'g-1', [{ threadId: 'g-1', kind: 'group', msgId: '7', clientId: null,
      from: 'them', senderId: '700', text: '', ts: 1700000007000,
      attachments: [{ kind: 'sticker', src: null, raw: { id: 45417, catId: 11906, msgType: 10 } }],
    }]);
    warm.close();
    const server = emptyServer();
    const remote = 'https://zalo-api.zadn.vn/sticker/45417.webp';
    const api = fakeApi(server, {
      getStickersDetail: async () => [{ id: 45417, stickerWebpUrl: remote, stickerUrl: remote }],
    });
    const client = createZaloClient(savedStore(), zaloEvents(harness()), {
      cache: { open: ownId => openDb(s.dir, ownId) }, connect: () => connectorFor(api),
    });
    await client.login();
    await client.getMessages('g-1', 'group');
    assert.equal((await client.mediaJobs('g-1', '7', 'group'))[0]?.remote, remote);
    client.dispose();
  } finally { s.done(); }
});

 test('legacy Sync sticker recovers the exact ID from its content token', async () => {
  const s = scratch();
  try {
    const warm = openDb(s.dir, 'own-1');
    upsertMessages(warm, 'g-1', [{ threadId: 'g-1', kind: 'group', msgId: '8', clientId: null,
      from: 'them', senderId: '700', text: '[^61900,98936^]', ts: 1700000007000,
      attachments: [{ kind: 'sticker', src: null, raw: { catId: 61900, msgType: 10 } }],
    }]);
    warm.close();
    const ids: number[] = [];
    const remote = 'https://zalo-api.zadn.vn/sticker/98936.webp';
    const api = fakeApi(emptyServer(), { getStickersDetail: async (id: number) => {
      ids.push(id); return [{ id, stickerWebpUrl: remote, stickerUrl: remote }];
    } });
    const client = createZaloClient(savedStore(), zaloEvents(harness()), {
      cache: { open: ownId => openDb(s.dir, ownId) }, connect: () => connectorFor(api),
    });
    await client.login();
    const jobs = await client.mediaJobs('g-1', '8', 'group');
    assert.deepEqual(ids, [98936]);
    assert.equal(jobs[0]?.remote, remote);
    client.dispose();
  } finally { s.done(); }
});


test('temporary restore failures keep the saved session and retry cookies without QR', async () => {
  const server = emptyServer();
  const api = fakeApi(server);
  let attempts = 0;
  let qrCalls = 0;
  let clears = 0;
  const states: Array<{ status: string; sessionRetained?: boolean }> = [];
  const client = createZaloClient({ ...savedStore(), clear: async () => { clears += 1; } },
    { ...zaloEvents(harness()), login: state => states.push(state) }, {
      connect: () => ({
        login: async (credentials: typeof session) => {
          attempts += 1;
          assert.equal(credentials.imei, session.imei);
          if (attempts === 1) throw new Error('fetch failed');
          return api;
        },
        loginQR: async () => { qrCalls += 1; return api; },
      }) as unknown as ReturnType<typeof connectorFor>,
    });
  try {
    await client.login();
    assert.equal(states.at(-1)?.status, 'error');
    assert.equal(states.at(-1)?.sessionRetained, true);
    assert.equal(clears, 0);
    assert.equal(qrCalls, 0);
    await client.login();
    assert.equal(states.at(-1)?.status, 'logged-in');
    assert.equal(attempts, 2);
    assert.equal(qrCalls, 0);
  } finally { client.dispose(); }
});

test('locked session storage never silently starts QR authentication', async () => {
  let qrCalls = 0;
  let clears = 0;
  const api = fakeApi(emptyServer());
  const client = createZaloClient({ ...savedStore(), load: async () => { throw new Error('keyring locked'); }, clear: async () => { clears += 1; } },
    zaloEvents(harness()), { connect: () => ({ ...connectorFor(api), loginQR: async () => { qrCalls += 1; return api; } }) as unknown as ReturnType<typeof connectorFor> });
  try {
    await client.login(); await client.login();
    assert.equal(qrCalls, 0);
    assert.equal(clears, 0);
  } finally { client.dispose(); }
});

test('restored login refreshes rotated cookies while retaining device identity', async () => {
  const api = fakeApi(emptyServer());
  const rotated = [{ key: 'zpsid', value: 'rotated' }] as never;
  Object.assign(api, { getCookie: () => ({ serializeSync: () => ({ cookies: rotated }) }) });
  const saved: typeof session[] = [];
  const client = createZaloClient({ ...savedStore(), save: async value => { saved.push(value as typeof session); } },
    zaloEvents(harness()), { connect: () => connectorFor(api) });
  try {
    await client.login();
    assert.equal(saved.length, 1);
    assert.equal(saved[0].cookie, rotated);
    assert.equal(saved[0].imei, session.imei);
    assert.equal(saved[0].userAgent, session.userAgent);
  } finally { client.dispose(); }
});

test('parallel login requests share a single restore attempt', async () => {
  let attempts = 0;
  const api = fakeApi(emptyServer());
  const client = createZaloClient(savedStore(), zaloEvents(harness()), {
    connect: () => ({ ...connectorFor(api), login: async () => { attempts += 1; await new Promise(resolve => setTimeout(resolve, 10)); return api; } }) as unknown as ReturnType<typeof connectorFor>,
  });
  try {
    await Promise.all([client.login(), client.login(), client.login()]);
    assert.equal(attempts, 1);
  } finally { client.dispose(); }
});
