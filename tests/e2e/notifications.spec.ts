import { test, expect } from '@playwright/test';

test('opening group history stays silent and notification activation selects the right group', async ({ page }) => {
  await page.addInitScript(() => {
    let login: (value: unknown) => void = () => {};
    let connection: (value: string) => void = () => {};
    let message: (value: unknown) => void = () => {};
    let open: (id: string) => void = () => {};
    const notices: unknown[] = [];
    const noop = () => () => {};
    Object.defineProperty(window, '__notices', { value: notices });
    Object.defineProperty(window, '__openNotice', { value: (id: string) => open(id) });
    Object.defineProperty(window, 'desktop', { value: {
      minimize: () => {}, toggleMaximize: () => {}, close: () => {},
      notify: (...args: unknown[]) => notices.push(args),
      onOpenThread: (cb: typeof open) => { open = cb; return () => {}; },
    } });
    Object.defineProperty(window, 'chat', { value: {
      login: async () => { login({ status: 'logged-in', label: 'Test' }); connection('connected'); },
      onLoginState: (cb: typeof login) => { login = cb; return () => {}; },
      onConnection: (cb: typeof connection) => { connection = cb; return () => {}; },
      onMessageUpsert: (cb: typeof message) => { message = cb; return () => {}; },
      onThreadUpsert: noop,
      listConversations: async () => ['one', 'two'].map(id => ({ id: `g-${id}`, kind: 'group', name: `Group ${id}`, avatar: null, pinned: false, unread: 0, lastText: '', lastTs: 0 })),
      getMessages: async (id: string) => {
        if (id === 'g-two') message({ threadId: id, kind: 'group', msgId: 'old', clientId: null, from: 'them', text: 'Cached group history', ts: 1, backfill: true });
        return { messages: [], hasMore: false };
      },
      markRead: async () => {},
    } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Group two', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Các tin nhắn' }).getByText('Cached group history', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __notices: unknown[] }).__notices)).toEqual([]);
  await page.getByRole('button', { name: 'Group one', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mở thông tin hội thoại' })).toContainText('Group one');
  await page.evaluate(() => (window as unknown as { __openNotice(id: string): void }).__openNotice('g-two'));
  await expect(page.getByRole('button', { name: 'Mở thông tin hội thoại' })).toContainText('Group two');
});
