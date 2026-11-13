import { test, expect } from '@playwright/test';

test('call UI starts a 1:1 call, blocks overlap, and routes mute/hangup through the bridge', async ({ page }) => {
  await page.addInitScript(() => {
    let login: (value: unknown) => void = () => {};
    let connection: (value: string) => void = () => {};
    const events = new Set<(event: Record<string, unknown>) => void>();
    const emit = (event: Record<string, unknown>) => events.forEach(cb => cb(event));
    const actions: string[] = [];
    Object.defineProperty(window, '__callActions', { value: actions });
    const noop = () => () => {};
    Object.defineProperty(window, 'chat', { value: {
      login: async () => { login({ status: 'logged-in', label: 'Test' }); connection('connected'); },
      onLoginState: (cb: typeof login) => { login = cb; return () => {}; },
      onConnection: (cb: typeof connection) => { connection = cb; return () => {}; }, onMessageUpsert: noop, onThreadUpsert: noop,
      listConversations: async () => [{ id: '123', kind: 'user', name: 'Call test peer', avatar: null, pinned: false, unread: 0, lastText: '', lastTs: 0 }],
      getMessages: async () => ({ messages: [], hasMore: false }),
      markRead: async () => {},
    } });
    Object.defineProperty(window, 'calls', { value: {
      status: async () => ({ available: true, state: null }),
      onEvent: (cb: (event: Record<string, unknown>) => void) => { events.add(cb); return () => events.delete(cb); },
      start: async (id: string, video: boolean) => {
        actions.push(`start:${id}:${video}`);
        emit({ type: 'state', phase: 'outgoing', name: 'Call test peer', text: 'Đang gọi…', video });
        return { ok: true };
      },
      action: (action: string) => {
        actions.push(action);
        if (action === 'hangup') emit({ type: 'state', phase: 'ended', name: 'Call test peer', text: 'Đã kết thúc', video: false });
      },
    } });
  });
  await page.goto('/');
  await page.getByText('Call test peer', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Gọi thoại', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Call test peer' });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gọi video', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Tắt micro', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Bật micro', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Kết thúc', exact: true }).click();
  await expect(dialog).toContainText('Đã kết thúc');
  await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __callActions: string[] }).__callActions)).toEqual(['start:123:false', 'mute', 'hangup']);
});
