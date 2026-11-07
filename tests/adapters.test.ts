import test from 'node:test';
import assert from 'node:assert/strict';
import { MockZaloClient } from '../src/adapters/mock.ts';
import type { IZaloClient } from '../src/adapters/types.ts';

const client = () => new MockZaloClient();

test('auth: happy path signs in, failure path reports unsupported', async () => {
  const c = client();
  assert.deepEqual((await c.auth.getSession()).ok && (await c.auth.getSession()), { ok: true, value: { state: 'signed-out' } });

  const signedIn = await c.auth.signIn({ method: 'qr' });
  assert.equal(signedIn.ok, true);

  const off = new MockZaloClient({ disabled: ['auth'] });
  const denied = await off.auth.signIn({ method: 'qr' });
  assert.equal(denied.ok, false);
  assert.equal(denied.ok === false && denied.error.kind, 'unsupported');
  assert.equal(off.auth.capability, 'unavailable');
});

test('contacts: list filters, failure path returns invalid for unknown conversation', async () => {
  const c = client();
  const all = await c.contacts.list();
  assert.equal(all.ok && all.value.length, 2);
  const hit = await c.contacts.list('ánh');
  assert.deepEqual(hit.ok && hit.value.map(x => x.id), ['u-anh']);

  const missing = await c.conversations.get('c-khong-ton-tai');
  assert.equal(missing.ok, false);
  assert.equal(missing.ok === false && missing.error.kind, 'invalid');
});

test('conversations: markRead clears unread and notifies subscribers', async () => {
  const c = client();
  const seen: number[] = [];
  const stop = c.conversations.onChanged(conv => seen.push(conv.unreadCount));
  const result = await c.conversations.markRead('c-anh');
  assert.equal(result.ok, true);
  assert.deepEqual(seen, [0]);
  stop();
  await c.conversations.markRead('c-anh');
  assert.deepEqual(seen, [0]);
});

test('messaging: send appends, echoes clientMessageId, and rejects empty text', async () => {
  const c = client();
  const sent = await c.messaging.send({ conversationId: 'c-anh', clientMessageId: 'cm-1', text: '  xin chào  ', replyTo: null });
  assert.equal(sent.ok, true);
  assert.equal(sent.ok && sent.value.message.text, 'xin chào');
  assert.equal(sent.ok && sent.value.clientMessageId, 'cm-1');

  const page = await c.messaging.history('c-anh');
  assert.equal(page.ok && page.value.items.length, 3);

  const empty = await c.messaging.send({ conversationId: 'c-anh', clientMessageId: 'cm-2', text: '   ', replyTo: null });
  assert.equal(empty.ok, false);
  assert.equal(empty.ok === false && empty.error.kind, 'invalid');
});

test('messaging: simulated network failure is retryable and does not append', async () => {
  const c = new MockZaloClient({ failNextSend: true });
  const failed = await c.messaging.send({ conversationId: 'c-anh', clientMessageId: 'cm-f', text: 'a', replyTo: null });
  assert.equal(failed.ok, false);
  assert.equal(failed.ok === false && failed.error.kind, 'network');
  assert.equal(failed.ok === false && failed.error.retryable, true);

  const page = await c.messaging.history('c-anh');
  assert.equal(page.ok && page.value.items.length, 2);

  const retried = await c.messaging.send({ conversationId: 'c-anh', clientMessageId: 'cm-f', text: 'a', replyTo: null });
  assert.equal(retried.ok, true);
});

test('messaging: aborted signal yields cancelled and does not append', async () => {
  const c = client();
  const controller = new AbortController();
  controller.abort();
  const result = await c.messaging.send(
    { conversationId: 'c-anh', clientMessageId: 'cm-abort', text: 'a', replyTo: null },
    { signal: controller.signal },
  );
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.error.kind, 'cancelled');
  const page = await c.messaging.history('c-anh');
  assert.equal(page.ok && page.value.items.length, 2);
});

test('media: upload reports progress per chunk; invalid size fails', async () => {
  const c = client();
  const progress: number[] = [];
  c.media.onUploadProgress(e => progress.push(e.uploadedChunks));

  const created = await c.media.createUpload({ name: 'a.pdf', byteSize: 600 * 1024, mimeType: 'application/pdf' });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.value.chunkCount, 3);

  for (let i = 0; i < created.value.chunkCount; i += 1) {
    const put = await c.media.putChunk(created.value, i, new Uint8Array(1));
    assert.equal(put.ok, true);
  }
  assert.deepEqual(progress, [1, 2, 3]);

  const completed = await c.media.complete(created.value);
  assert.equal(completed.ok && completed.value.name, 'a.pdf');

  const outOfRange = await c.media.putChunk(created.value, 9, new Uint8Array(1));
  assert.equal(outOfRange.ok, false);

  const bad = await c.media.createUpload({ name: 'x', byteSize: 0, mimeType: 'text/plain' });
  assert.equal(bad.ok, false);
});

test('groups: known group resolves, unknown fails, unsupported mutations are labelled', async () => {
  const c = client();
  const found = await c.groups.get('g-du-an');
  assert.equal(found.ok && found.value.members.length, 3);

  const missing = await c.groups.get('g-x');
  assert.equal(missing.ok, false);

  const add = await c.groups.addMembers('g-du-an', ['u-long']);
  assert.equal(add.ok, false);
  assert.equal(add.ok === false && add.error.kind, 'unsupported');
});

test('calling and sync are unavailable, not mocked', async () => {
  const c = client();
  assert.equal(c.calling.capability, 'unavailable');
  assert.equal(c.sync.capability, 'unavailable');

  const call = await c.calling.start('c-anh', true);
  assert.equal(call.ok === false && call.error.kind, 'unsupported');
  const sync = await c.sync.pull(null);
  assert.equal(sync.ok === false && sync.error.kind, 'unsupported');
});

test('notifications: create returns a desktop notification; disabled port is unavailable', async () => {
  const c = client();
  const created = await c.notifications.create({
    conversationId: 'c-anh', title: 'Tin mới', body: 'Minh Ánh vừa nhắn', silent: false,
  });
  assert.equal(created.ok, true);
  assert.equal(created.ok && created.value.conversationId, 'c-anh');

  const off = new MockZaloClient({ disabled: ['notifications'] });
  assert.equal(off.notifications.capability, 'unavailable');
});

test('secureChannel: reflects conversation requirement without exposing crypto', async () => {
  const c = client();
  const plain = await c.secureChannel.state('c-anh');
  assert.equal(plain.ok && plain.value, 'none');
  const secure = await c.secureChannel.state('c-nhom');
  assert.equal(secure.ok && secure.value, 'pending');
  assert.equal('encrypt' in c.secureChannel, false);
  assert.equal('decrypt' in c.secureChannel, false);
});

test('transport: connect requires a handle, status transitions, events unsubscribe', async () => {
  const c = client();
  const events: string[] = [];
  const stop = c.transport.onEvent(e => events.push(e.type));

  const bad = await c.transport.connect({ id: '' });
  assert.equal(bad.ok === false && bad.error.kind, 'unauthorized');

  const good = await c.transport.connect({ id: 'mock-session' });
  assert.equal(good.ok, true);
  const status = await c.transport.status();
  assert.equal(status.ok && status.value, 'online');

  stop();
  await c.transport.disconnect();
  assert.deepEqual(events, ['connected']);
});

test('simulateIncoming: bumps unread, notifies conversation and incoming subscribers', () => {
  const c = client();
  const seenIncoming: string[] = [];
  const seenConversations: number[] = [];
  const stopIn = c.messaging.onIncoming(m => seenIncoming.push(m.id));
  const stopConv = c.conversations.onChanged(conv => seenConversations.push(conv.unreadCount));

  const message = c.simulateIncoming('c-anh', 'u-anh', 'Đến rồi nhé');
  assert.equal(message.conversationId, 'c-anh');
  assert.equal(message.status, 'delivered');
  assert.deepEqual(seenIncoming, [message.id]);
  assert.deepEqual(seenConversations, [3]);

  stopIn();
  stopConv();
  c.simulateIncoming('c-anh', 'u-anh', 'Lần nữa');
  assert.equal(seenIncoming.length, 1);
});

test('simulateDisconnect: flips to offline and emits a retryable event; connect restores', async () => {
  const c = client();
  const events: string[] = [];
  const stop = c.transport.onEvent(e => events.push(e.type));

  const status = async () => {
    const result = await c.transport.status();
    assert.equal(result.ok, true);
    return result.ok ? result.value : null;
  };

  await c.transport.connect({ id: 'mock-session' });
  assert.equal(await status(), 'online');

  c.simulateDisconnect();
  assert.equal(await status(), 'offline');
  assert.deepEqual(events, ['connected', 'disconnected']);

  await c.transport.connect({ id: 'mock-session' });
  assert.equal(await status(), 'online');
  assert.deepEqual(events, ['connected', 'disconnected', 'connected']);
  stop();
});

test('a disabled port refuses every method, not just its capability label', async () => {
  const prefixes = ['on'];
  const ports = ['contacts', 'conversations', 'messaging', 'media', 'groups',
    'notifications', 'secureChannel', 'transport'] as const;
  for (const name of ports) {
    const c = new MockZaloClient({ disabled: [name] });
    const port = c[name] as unknown as Record<string, unknown>;
    assert.equal(port.capability, 'unavailable', `${name} should report unavailable`);
    for (const key of Object.keys(port)) {
      const fn = port[key];
      if (typeof fn !== 'function' || key === 'capability' || prefixes.some(p => key.startsWith(p))) continue;
      const result = await (fn as () => Promise<unknown>).call(port);
      assert.equal(
        (result as { ok: boolean }).ok,
        false,
        `${name}.${key} must fail when the port is disabled`,
      );
      assert.equal((result as { error: { kind: string } }).error.kind, 'unsupported');
    }
  }
});

test('a disabled port still returns an unsubscribe function from listeners', () => {
  const c = new MockZaloClient({ disabled: ['messaging', 'conversations'] });
  assert.equal(typeof c.messaging.onIncoming(() => {}), 'function');
  assert.equal(typeof c.conversations.onChanged(() => {}), 'function');
});

test('mock client satisfies IZaloClient and never reports itself as authorized', () => {
  const c: IZaloClient = client();
  assert.equal(c.mode, 'mock');
  const ports = ['auth', 'contacts', 'conversations', 'messaging', 'media', 'groups',
    'calling', 'sync', 'notifications', 'secureChannel', 'transport'] as const;
  for (const name of ports) assert.ok(c[name], `missing port ${name}`);
  for (const name of ports) assert.notEqual(c[name].capability, 'authorized');
});
