import test from 'node:test';
import assert from 'node:assert/strict';
import { MessagingService, type Scheduler } from '../src/services/messaging.ts';
import { MockZaloClient } from '../src/adapters/mock.ts';
import type { Message, MessagingPort } from '../src/adapters/types.ts';

/** Scheduler chạy ngay nhưng vẫn cho test tự quyết định thứ tự. */
function manualScheduler(): Scheduler & { flush(): void; size(): number } {
  const queue: Array<() => void> = [];
  return {
    schedule: (_delay, fn) => {
      queue.push(fn);
      return () => {
        const at = queue.indexOf(fn);
        if (at >= 0) queue.splice(at, 1);
      };
    },
    flush: () => { while (queue.length) queue.shift()!(); },
    size: () => queue.length,
  };
}

const ids = () => {
  let n = 0;
  return () => `cm-${++n}`;
};

test('sendText returns an optimistic bubble immediately and settles on ack', async () => {
  const client = new MockZaloClient();
  const scheduler = manualScheduler();
  const service = new MessagingService(client, { scheduler, newId: ids() });

  const events: string[] = [];
  service.onMessage(e => { if (e.type === 'upsert') events.push(`${e.type}:${e.message.status}`); });

  const sent = service.sendText('c-anh', '  xin chào  ');
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(sent.value.status, 'sending');
  assert.equal(sent.value.text, 'xin chào');
  assert.equal(service.pendingCount(), 1);

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(service.pendingCount(), 0);
  assert.deepEqual(events, ['upsert:sending', 'upsert:sent']);

  const entry = service.entry('cm-1');
  assert.equal(entry?.state, 'sent');
  assert.equal(entry?.attempts, 1);
  service.dispose();
});

test('empty text is rejected without creating an outbox entry', () => {
  const service = new MessagingService(new MockZaloClient(), { newId: ids() });
  const result = service.sendText('c-anh', '   ');
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.error.kind, 'invalid');
  assert.equal(service.pendingCount(), 0);
  service.dispose();
});

test('a retryable network failure is retried up to the attempt limit', async () => {
  const client = new MockZaloClient({ failNextSend: true });
  const scheduler = manualScheduler();
  const service = new MessagingService(client, {
    scheduler,
    newId: ids(),
    policy: { maxAttempts: 3, jitter: () => 0 },
  });

  const states: string[] = [];
  service.onOutbox(entry => states.push(`${entry.state}:${entry.attempts}`));

  service.sendText('c-anh', 'a');
  await new Promise(resolve => setImmediate(resolve));
  // Lần 1 lỗi mạng -> xếp lịch thử lại, bong bóng vẫn 'sending'.
  assert.deepEqual(states, ['sending:1', 'sending:1']);
  assert.equal(scheduler.size(), 1);
  assert.equal(service.pendingCount(), 1);

  scheduler.flush();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(states, ['sending:1', 'sending:1', 'sending:2', 'sent:2']);
  assert.equal(service.pendingCount(), 0);
  service.dispose();
});

test('exhausting maxAttempts lands in failed, and retry() starts over', async () => {
  const failing = new MockZaloClient({ failNextSend: true });
  const scheduler = manualScheduler();
  const service = new MessagingService(failing, {
    scheduler,
    newId: ids(),
    policy: { maxAttempts: 1, jitter: () => 0 },
  });
  const statuses: string[] = [];
  service.onMessage(e => { if (e.type === 'upsert') statuses.push(e.message.status); });

  service.sendText('c-anh', 'a');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(service.entry('cm-1')?.state, 'failed');
  assert.equal(statuses.at(-1), 'failed');
  assert.equal(scheduler.size(), 0);

  const retried = service.retry('cm-1');
  assert.equal(retried.ok, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(service.entry('cm-1')?.state, 'sent');
  assert.equal(service.entry('cm-1')?.attempts, 1);
  service.dispose();
});

test('a permanent error is never retried', async () => {
  const port: MessagingPort = {
    capability: 'mock',
    history: async () => ({ ok: true, value: { items: [], nextCursor: null } }),
    send: async () => ({ ok: false, error: { kind: 'invalid', message: 'bad', retryable: true } }),
    setReaction: async () => ({ ok: true, value: undefined }),
    onIncoming: () => () => {},
    onStatus: () => () => {},
  };
  const client = new MockZaloClient();
  Object.defineProperty(client, 'messaging', { value: port });
  const scheduler = manualScheduler();
  const service = new MessagingService(client, { scheduler, newId: ids() });

  service.sendText('c-anh', 'a');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(service.entry('cm-1')?.state, 'failed');
  assert.equal(scheduler.size(), 0, 'a permanent kind must not be rescheduled even if retryable=true');
  service.dispose();
});

test('a push echo with the same clientMessageId does not duplicate the bubble', async () => {
  const client = new MockZaloClient();
  const service = new MessagingService(client, { newId: ids() });

  const seen: Message[] = [];
  service.onMessage(e => { if (e.type === 'upsert') seen.push(e.message); });

  const sent = service.sendText('c-anh', 'xin chào');
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const clientMessageId = sent.value.clientMessageId;

  await new Promise(resolve => setImmediate(resolve));
  const sentBubble = seen.at(-1)!;
  assert.equal(sentBubble.status, 'sent');

  // Echo từ server: cùng clientMessageId, id thật khác.
  service.handleIncoming({
    ...sentBubble,
    id: 'server-1',
    senderId: 'u-me',
    status: 'delivered',
  });

  const upserts = seen.filter(m => m.clientMessageId === clientMessageId);
  assert.equal(upserts.length, 2, 'only the optimistic upsert and the settle, no third bubble');
  assert.equal(service.entry(clientMessageId)?.messageId, sentBubble.id);
  service.dispose();
});

test('an incoming message is delivered once and later status events update it', () => {
  const client = new MockZaloClient();
  const service = new MessagingService(client, { newId: ids() });
  const seen: Array<{ id: string; status: string }> = [];
  service.onMessage(e => { if (e.type === 'upsert') seen.push({ id: e.message.id, status: e.message.status }); });

  const incoming: Message = {
    id: 'm-99', conversationId: 'c-anh', clientMessageId: 'in-1', senderId: 'u-anh',
    kind: 'text', text: 'chào', attachment: null, sentAt: new Date().toISOString(),
    status: 'delivered', replyTo: null,
  };
  service.handleIncoming(incoming);
  service.handleIncoming(incoming);
  assert.deepEqual(seen, [{ id: 'm-99', status: 'delivered' }]);
  service.dispose();
});

test('dispose cancels scheduled retries and unsubscribes from the client', async () => {
  const client = new MockZaloClient({ failNextSend: true });
  const scheduler = manualScheduler();
  const service = new MessagingService(client, {
    scheduler, newId: ids(), policy: { maxAttempts: 3, jitter: () => 0 },
  });
  service.sendText('c-anh', 'a');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scheduler.size(), 1);

  service.dispose();
  assert.equal(scheduler.size(), 0);
  const late = service.sendText('c-anh', 'b');
  assert.equal(late.ok === false && late.error.kind, 'cancelled');
});
