import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { callRequest } from '../electron/protocol/call-signaling.ts';
import { watchCallControls } from '../electron/calls/control.ts';
import { CallService } from '../electron/calls/service.ts';

test('1:1 signaling matches the observed wire field names, rather than engine names', () => {
  assert.deepEqual(callRequest(401, { calleeId: 'peer', callId: 42, type: 3 }, 'imei'), {
    endpoint: 'requestcall', params: { calleeId: 'peer', callId: 42, codec: '[]', typeRequest: 3, imei: 'imei' },
  });
  const answer = callRequest(402, { callerId: 'peer', callId: 42, status: 0, codec: 'opus', rtcpAddress: 'rtcp', rtpAddress: 'rtp', session: 'session', extendData: '{}' }, 'imei');
  assert.equal(answer.params.session_id, 'session');
  assert.equal(answer.params.session, undefined);
  assert.equal(answer.params.imei, undefined);
  assert.equal(answer.params.subCommand, 3);
  assert.deepEqual(callRequest(405, { toId: 'peer', callId: 42, callType: 1 }, 'imei'), {
    endpoint: 'cancel', params: { callerId: 'peer', callId: 42, callType: 1, status: 0, imei: 'imei' },
  });
  assert.equal(callRequest(409, { toId: 'peer', callId: 42 }, 'imei').params.uidTo, 'peer');
  assert.deepEqual(callRequest(406, { callId: 42, partnerId: 'peer', data: '{}', status: 50, duration: 5, role: 1 }, 'imei').params,
    { call_id: 42, partner_id: 'peer', logdata: '{}', status: 50, duration: 5, role: 1, imei: 'imei' });
  assert.throws(() => callRequest(12433, {}, 'imei'), /Unsupported/);
});

test('control watcher receives 601 and 603, drops stale/non-voip/group data, detaches', () => {
  const socket = new EventTarget();
  const received: Record<string, unknown>[] = [];
  const off = watchCallControls({ ws: socket as WebSocket }, c => received.push(c));
  const send = (cmd: number, content: unknown) => {
    const data = Buffer.from(JSON.stringify({ data: { controls: [{ content }] } }));
    const header = Buffer.from([1, cmd & 255, cmd >> 8, 0]);
    socket.dispatchEvent(new MessageEvent('message', { data: Buffer.concat([header, data]) }));
  };
  const good = { act_type: 'voip', act: 'answer', data: { callId: 42, ts: Date.now() } };
  send(601, good); send(603, { ...good, data: JSON.stringify(good.data) });
  send(601, { ...good, act_type: 'transfer_msg' });
  send(601, { ...good, act: 'group_request' });
  send(601, { ...good, data: { ts: Date.now() - 61000 } });
  send(601, { ...good, data: '{bad' });
  send(510, good);
  assert.equal(received.length, 2);
  assert.deepEqual(received[0].data, good.data);
  off(); send(601, good);
  assert.equal(received.length, 2);
});

test('call service rejects overlap, ignores late replies, and releases media on session end', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'zola-call-unit-'));
  mkdirSync(path.join(root, 'native-engine/backends'), { recursive: true });
  for (const f of ['engine-core.js', 'backends/zrtc-media.js', 'zcall-audio']) writeFileSync(path.join(root, 'native-engine', f), 'test-placeholder');
  type Data = Record<string, unknown>;
  let stopCount = 0;
  const replies: Array<{ resolve(value: unknown): void; reject(error: Error): void }> = [];
  let emitNative: ((frame: Data) => void) | undefined;
  const delivered: Data[] = [];
  class FakeMedia { stop() { stopCount++; } }
  class FakeEngine {
    call: { state: string } | null = null;
    emit: (frame: Data) => void;
    constructor(o: Data) { this.emit = o.emit as typeof this.emit; emitNative = this.emit; }
    onZaloFrame(frame: Data) {
      if (frame.command === 'makeCall') {
        this.call = { state: 'calling' };
        this.emit({ type: 'sendSignal', command: 401, data: { callId: 42 } });
      } else delivered.push(frame);
    }
    hangup() { this.call = null; }
  }
  const service = new CallService({
    runtime: root, signal: () => new Promise((resolve, reject) => replies.push({ resolve, reject })), push: () => undefined,
    peer: id => id === 'peer' ? { id, name: 'Peer' } : null,
    load: () => ({ core: { EngineCore: FakeEngine }, backend: { ZrtcMediaBackend: FakeMedia } }),
  });
  try {
    assert.throws(() => service.start('missing', false), /liên hệ/);
    service.start('peer', true);
    assert.throws(() => service.start('peer', false), /cuộc gọi/);
    emitNative!({ type: 'sendSignal', command: 12006, data: {} });
    replies[1].reject(new Error('conf rejected')); await Promise.resolve(); await Promise.resolve();
    assert.equal(service.active(), true, 'a camera-state request failure must not end a live call');
    service.dispose();
    replies[0].resolve({ servers: ['late'] }); await Promise.resolve();
    assert.equal(delivered.length, 0);
    assert.equal(stopCount, 1);
    assert.equal(service.active(), false);
    service.dispose(); assert.equal(stopCount, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
