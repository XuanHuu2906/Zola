import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LoopbackTransport, assertLoopback, DEFAULT_LOOPBACK } from '../src/transport/loopback.ts';

/**
 * Máy chủ thử nghiệm thật trên 127.0.0.1. Không liên quan Zalo: đây là server của chính
 * test này, trả lời bằng cờ `x-demo-*` do chúng ta tự định nghĩa.
 */
async function startServer(handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

const stop = async (server: Server) => {
  await new Promise<void>(resolve => server.close(() => resolve()));
};

const accept = (id: string | string[] | undefined) => id === 'sess-ok';

test('assertLoopback rejects non-loopback hosts and non-http schemes', () => {
  assert.doesNotThrow(() => assertLoopback('http://127.0.0.1:8080'));
  assert.doesNotThrow(() => assertLoopback('http://localhost:8080'));
  assert.doesNotThrow(() => assertLoopback('http://[::1]:8080'));
  assert.throws(() => assertLoopback('https://zalo.me/api'), /không phải loopback/);
  assert.throws(() => assertLoopback('http://192.168.1.10:8080'), /không phải loopback/);
  assert.throws(() => assertLoopback('ftp://127.0.0.1'), /http\(s\)/);
  assert.throws(() => assertLoopback('not a url'), /URL hợp lệ/);
});

test('connect performs a real HTTP handshake over a loopback socket', async () => {
  const seen: Array<string | undefined> = [];
  const { server, baseUrl } = await startServer((req, res) => {
    seen.push(req.headers['x-demo-session'] as string | undefined);
    if (req.url === '/session' && accept(req.headers['x-demo-session'])) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }
    res.writeHead(401).end();
  });
  try {
    const transport = new LoopbackTransport({ ...DEFAULT_LOOPBACK, baseUrl });
    const events: string[] = [];
    transport.onEvent(e => events.push(e.type));

    const connected = await transport.connect({ id: 'sess-ok' });
    assert.equal(connected.ok, true);
    assert.equal((await transport.status()).ok && (await transport.status()).ok, true);
    const status = await transport.status();
    assert.equal(status.ok && status.value, 'online');
    assert.deepEqual(events, ['connected']);
    assert.deepEqual(seen, ['sess-ok']);
  } finally {
    await stop(server);
  }
});

test('a 401 handshake is an unauthorized failure, not a retryable network error', async () => {
  const { server, baseUrl } = await startServer((_req, res) => { res.writeHead(401).end(); });
  try {
    const transport = new LoopbackTransport({ ...DEFAULT_LOOPBACK, baseUrl });
    const result = await transport.connect({ id: 'sess-bad' });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.error.kind, 'unauthorized');
    assert.equal(result.ok === false && result.error.retryable, false);
    assert.equal(result.ok === false && result.error.code, '401');
  } finally {
    await stop(server);
  }
});

test('an empty session handle is refused before any socket is opened', async () => {
  const transport = new LoopbackTransport({ ...DEFAULT_LOOPBACK, baseUrl: 'http://127.0.0.1:9' });
  const result = await transport.connect({ id: '' });
  assert.equal(result.ok === false && result.error.kind, 'unauthorized');
});

test('connection refused is a retryable network failure', async () => {
  // Cổng 9 trên loopback gần như chắc chắn đóng: đây là lỗi kết nối thật, không phải giả lập.
  const transport = new LoopbackTransport({ ...DEFAULT_LOOPBACK, baseUrl: 'http://127.0.0.1:9' });
  const result = await transport.connect({ id: 'sess-ok' });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.error.kind, 'network');
  assert.equal(result.ok === false && result.error.retryable, true);
});

test('pumpPush counts real SSE frames delivered by the loopback server', async () => {
  const { server, baseUrl } = await startServer((req, res) => {
    if (req.url === '/session') { res.writeHead(200).end('{}'); return; }
    if (req.url === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end('event: message\ndata: {}\n\nevent: status\ndata: {}\n\n');
      return;
    }
    res.writeHead(404).end();
  });
  try {
    const transport = new LoopbackTransport({ ...DEFAULT_LOOPBACK, baseUrl });
    await transport.connect({ id: 'sess-ok' });
    const pumped = await transport.pumpPush();
    assert.equal(pumped.ok, true);
    assert.equal(pumped.ok && pumped.value, 2);
  } finally {
    await stop(server);
  }
});

test('reconnectOnce backs off and succeeds once the server accepts again', async () => {
  let up = false;
  const { server, baseUrl } = await startServer((req, res) => {
    if (!up) { res.writeHead(503).end(); return; }
    if (req.url === '/session' && accept(req.headers['x-demo-session'])) res.writeHead(200).end('{}');
    else res.writeHead(401).end();
  });
  const delays: number[] = [];
  try {
    const transport = new LoopbackTransport({ ...DEFAULT_LOOPBACK, baseUrl }, {
      sleep: async ms => { delays.push(ms); },
    });

    // Phiên đã biết nhưng server đang lỗi.
    const first = await transport.connect({ id: 'sess-ok' });
    assert.equal(first.ok, false);

    up = true;
    const retried = await transport.reconnectOnce();
    assert.equal(retried.ok, true);
    assert.deepEqual(delays, [DEFAULT_LOOPBACK.backoff.baseMs]);
    assert.equal((await transport.status()).ok, true);
  } finally {
    await stop(server);
  }
});

test('reconnect stops after maxRetries instead of looping forever', async () => {
  const { server, baseUrl } = await startServer((_req, res) => { res.writeHead(503).end(); });
  try {
    const transport = new LoopbackTransport({ ...DEFAULT_LOOPBACK, baseUrl }, { sleep: async () => {} });
    await transport.connect({ id: 'sess-ok' });

    for (let i = 0; i < DEFAULT_LOOPBACK.backoff.maxRetries; i += 1) {
      const result = await transport.reconnectOnce();
      assert.equal(result.ok, false);
    }
    const exhausted = await transport.reconnectOnce();
    assert.equal(exhausted.ok, false);
    assert.equal(exhausted.ok === false && exhausted.error.retryable, false);
    assert.equal(exhausted.ok === false && exhausted.error.message, 'Đã hết số lần thử kết nối lại.');
  } finally {
    await stop(server);
  }
});

test('disconnect aborts and emits one disconnected event', async () => {
  let open = true;
  const pending: Array<() => void> = [];
  const { server, baseUrl } = await startServer((req, res) => {
    if (req.url === '/session') { res.writeHead(200).end('{}'); return; }
    // Giữ kết nối mở để chứng minh abort thật sự đóng nó.
    if (open) pending.push(() => res.writeHead(200).end('{}'));
  });
  try {
    const transport = new LoopbackTransport({ ...DEFAULT_LOOPBACK, baseUrl });
    const events: string[] = [];
    transport.onEvent(e => events.push(e.type));

    await transport.connect({ id: 'sess-ok' });
    const status = await transport.disconnect();
    assert.equal(status.ok, true);
    assert.equal((await transport.status()).ok && (await transport.status()).ok, true);
    const after = await transport.status();
    assert.equal(after.ok && after.value, 'idle');
    assert.deepEqual(events, ['connected', 'disconnected']);

    open = false;
    for (const finish of pending) finish();
  } finally {
    await stop(server);
  }
});

test('a signal aborted before connect yields cancelled and opens no socket', async () => {
  const transport = new LoopbackTransport({ ...DEFAULT_LOOPBACK, baseUrl: 'http://127.0.0.1:9' });
  const controller = new AbortController();
  controller.abort();
  const result = await transport.connect({ id: 'sess-ok' }, { signal: controller.signal });
  assert.equal(result.ok === false && result.error.kind, 'cancelled');
});
