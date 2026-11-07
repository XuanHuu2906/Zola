import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiBridge, type DeliveryPhase, type InboundDelivery } from '../src/composition/ui-bridge.ts';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('a plain send goes pending once and then sent', async () => {
  const bridge = createUiBridge({ sendLatencyMs: 0 });
  const phases: DeliveryPhase[] = [];
  bridge.onDelivery(update => phases.push(update.phase));

  const accepted = bridge.send('c-anh', '  xin chào  ');
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  assert.equal(bridge.entryState(accepted.value.clientMessageId), 'pending');

  await settle();
  assert.deepEqual(phases, ['pending', 'sent']);
  assert.equal(bridge.entryState(accepted.value.clientMessageId), 'sent');
  bridge.reset();
});

test('an armed failure is reported failed, and retry re-sends the same message', async () => {
  const bridge = createUiBridge({ sendLatencyMs: 0 });
  const phases: DeliveryPhase[] = [];
  bridge.onDelivery(update => phases.push(update.phase));

  bridge.armFailure(true);
  const accepted = bridge.send('c-anh', 'a');
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  const { clientMessageId } = accepted.value;

  await settle();
  assert.deepEqual(phases, ['pending', 'failed']);
  assert.equal(bridge.entryState(clientMessageId), 'failed');

  assert.equal(bridge.retry(clientMessageId).ok, true);
  await settle();
  // Retry không phát lại "sending": UI đã tự đưa bong bóng về pending trước khi gọi.
  assert.deepEqual(phases, ['pending', 'failed', 'sent']);
  assert.equal(bridge.entryState(clientMessageId), 'sent');
  bridge.reset();
});

test('arming is one-shot: the next send after a failure succeeds', async () => {
  const bridge = createUiBridge({ sendLatencyMs: 0 });
  const phases: DeliveryPhase[] = [];
  bridge.onDelivery(update => phases.push(update.phase));

  bridge.armFailure(true);
  const first = bridge.send('c-anh', 'a');
  assert.equal(first.ok, true);
  await settle();

  const second = bridge.send('c-anh', 'b');
  assert.equal(second.ok, true);
  await settle();
  assert.deepEqual(phases, ['pending', 'failed', 'pending', 'sent']);
  bridge.reset();
});

test('empty text is refused before it becomes an outbox entry', () => {
  const bridge = createUiBridge({ sendLatencyMs: 0 });
  const phases: DeliveryPhase[] = [];
  bridge.onDelivery(update => phases.push(update.phase));

  const result = bridge.send('c-anh', '   ');
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.error.kind, 'invalid');
  assert.deepEqual(phases, []);
  bridge.reset();
});

test('incoming push is forwarded once with its conversation and text', () => {
  const bridge = createUiBridge({ sendLatencyMs: 0 });
  const seen: InboundDelivery[] = [];
  bridge.onInbound(message => seen.push(message));

  bridge.simulateIncoming('c-nhom', 'u-anh', 'Tin nhắn mẫu vừa đến, không đi qua mạng.');
  assert.deepEqual(seen, [{ conversationId: 'c-nhom', text: 'Tin nhắn mẫu vừa đến, không đi qua mạng.' }]);
  bridge.reset();
});

test('reset drops outbox state, so an old id is no longer known', async () => {
  const bridge = createUiBridge({ sendLatencyMs: 0 });
  const accepted = bridge.send('c-anh', 'a');
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  const { clientMessageId } = accepted.value;
  await settle();

  bridge.reset();
  assert.equal(bridge.entryState(clientMessageId), null);
});
