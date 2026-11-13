import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';

test('live-only startup presents the Zalo sign-in screen without demo controls', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Đang kết nối Zalo' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Đăng nhập Zalo cần chạy ứng dụng desktop.');
  await expect(page.getByText('Dùng zca-js không chính thức')).toBeVisible();
  await expect(page.getByText(/demo|tin nhắn mẫu|dữ liệu mẫu/i)).toHaveCount(0);

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations.map(({ id }) => id)).toEqual([]);
});
