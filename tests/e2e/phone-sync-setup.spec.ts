import { test, expect } from '@playwright/test';

for (const legacy of [false, true]) {
test(`phone-sync setup ${legacy ? 'stays hidden for a legacy account' : 'hides after full success and stays hidden on reopen'}`, async ({ page }) => {
  await page.addInitScript(({ legacy }) => {
    let login: (event: unknown) => void = () => {};
    let connection: (state: string) => void = () => {};
    let sync: (event: unknown) => void = () => {};
    const noop = () => () => {};
    // Stand in for the main process's per-account persistent completion flag.
    Object.defineProperty(window, '__finishPhoneSetup', { value: (complete: boolean) => {
      if (complete) localStorage.setItem('test-phone-setup', 'complete');
      sync({ phase: complete ? 'done' : 'failed', received: 1, total: 1, written: 3, skipped: 0, ...(complete ? { phoneSyncComplete: true } : {}) });
    } });
    Object.defineProperty(window, 'chat', { value: {
      login: async () => {
        login({ status: 'logged-in', label: 'Test', phoneSyncSetupRequired: !legacy, phoneSyncComplete: localStorage.getItem('test-phone-setup') === 'complete' });
        connection('connected');
      },
      onLoginState: (cb: typeof login) => { login = cb; return () => {}; },
      onConnection: (cb: typeof connection) => { connection = cb; return () => {}; },
      onSync: (cb: typeof sync) => { sync = cb; return () => {}; },
      onMessageUpsert: noop, onThreadUpsert: noop,
      listConversations: async () => [{ id: '123', kind: 'user', name: 'Setup test', avatar: null, pinned: false, unread: 0, lastText: '', lastTs: 0 }],
      getMessages: async () => ({ messages: [], hasMore: false }),
      markRead: async () => {},
      syncFromPhone: async () => {
        // A partition can finish before the overall sync finishes.
        sync({ phase: 'done', received: 1, total: 1, written: 3, skipped: 0 });
        return { ok: true };
      },
    } });
  }, { legacy });
  await page.goto('/');
  if (legacy) {
    await expect(page.getByRole('button', { name: 'Tài khoản Zalo', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Đồng bộ ngay', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Tài khoản Zalo', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Đồng bộ lịch sử từ điện thoại', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Tài khoản Zalo', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Đồng bộ ngay', exact: true })).toHaveCount(0);
    return;
  }
  await expect(page.getByRole('button', { name: 'Đồng bộ ngay', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Đồng bộ ngay', exact: true }).click();
  await page.getByRole('button', { name: 'Tài khoản Zalo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Đồng bộ lịch sử từ điện thoại', exact: true })).toBeVisible();
  await page.evaluate(() => (window as unknown as { __finishPhoneSetup(complete: boolean): void }).__finishPhoneSetup(false));
  await expect(page.getByRole('button', { name: 'Đồng bộ ngay', exact: true })).toBeVisible();
  await page.evaluate(() => (window as unknown as { __finishPhoneSetup(complete: boolean): void }).__finishPhoneSetup(true));
  await expect(page.getByRole('button', { name: 'Đồng bộ ngay', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Đồng bộ lịch sử từ điện thoại', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Tài khoản Zalo', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Tài khoản Zalo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Đồng bộ lịch sử từ điện thoại', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Đồng bộ ngay', exact: true })).toHaveCount(0);
});

}
