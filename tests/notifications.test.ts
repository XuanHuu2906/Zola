import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotifications } from '../electron/notifications.ts';

function fixture() {
  const events: string[] = [];
  const callbacks: Array<Map<string, () => void>> = [];
  const notices = createNotifications({
    create: () => {
      const handlers = new Map<string, () => void>(); callbacks.push(handlers);
      return {
        on: (event: string, cb: () => void) => handlers.set(event, cb),
        show: () => events.push('notice-show'),
        close: () => { events.push('notice-close'); handlers.get('close')?.(); },
      };
    },
    window: () => ({
      isDestroyed: () => false, isMinimized: () => true,
      restore: () => events.push('restore'), show: () => events.push('show'),
      focus: () => events.push('focus'), openThread: id => events.push(`open:${id}`),
    }),
  });
  return { events, callbacks, notices };
}

test('clicking a notification restores and focuses Zola, then opens its conversation', () => {
  const f = fixture();
  f.notices.show({ title: 'Group', body: 'New message', threadId: 'g-123' });
  f.callbacks[0].get('click')?.();
  assert.deepEqual(f.events, ['notice-show', 'restore', 'show', 'focus', 'open:g-123', 'notice-close']);
  f.callbacks[0].get('click')?.();
  assert.equal(f.events.filter(e => e === 'open:g-123').length, 1);
});

test('logout closes notifications and invalidates stale click callbacks', () => {
  const f = fixture();
  f.notices.show({ title: 'Group', body: 'New message', threadId: 'g-123' });
  f.notices.clear(); f.callbacks[0].get('click')?.();
  assert.deepEqual(f.events, ['notice-show', 'notice-close']);
});

test('notification destinations must be conversation IDs, never URLs or objects', () => {
  const f = fixture();
  for (const threadId of [undefined, '', 'https://example.com', '../x', {}, 'x'.repeat(129)]) {
    f.notices.show({ title: 'Group', body: 'Text', threadId });
  }
  assert.deepEqual(f.events, []);
});
