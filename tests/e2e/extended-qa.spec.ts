import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { sampleTextContrast } from './contrast';
import { signIn } from './signIn';

for (const theme of ['dark', 'light']) {
  test(`text contrast at glass endpoints and blur modes: ${theme}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/');
    await signIn(page);
    await mkdir('reports/accessibility-extended', { recursive: true });
    for (const glass of [15, 95]) {
      for (const lowBlur of [false, true]) {
        await page.getByRole('button', { name: 'Cài đặt', exact: true }).click();
        await page.getByRole('button', { name: theme === 'light' ? 'Giao diện sáng' : 'Giao diện tối' }).click();
        const slider = page.getByRole('slider', { name: 'Sắc độ kính' });
        await slider.focus(); await slider.press(glass === 15 ? 'Home' : 'End');
        await expect(slider).toHaveValue(String(glass));
        const toggle = page.getByRole('switch', { name: 'Giảm độ mờ' });
        if ((await toggle.getAttribute('aria-checked') === 'true') !== lowBlur) await toggle.click();
        for (const state of ['settings', 'chat']) {
          if (state === 'chat') await page.getByRole('button', { name: 'Hoàn tất' }).click();
          const results = await sampleTextContrast(page);
          await writeFile(`reports/accessibility-extended/${theme}-${glass}-${lowBlur ? 'low' : 'normal'}-${state}.json`, JSON.stringify(results, null, 2));
          expect.soft(results.filter(result => result.minimumRatio < result.required)).toEqual([]);
        }
      }
    }
  });
}

test('Enter during browser IME composition does not send; committed Vietnamese text sends once', async ({ page }) => {
  await page.goto('/');
  await signIn(page);
  const input = page.getByRole('textbox', { name: 'Nội dung tin nhắn demo' });
  const messages = page.locator('.message-row');
  const before = await messages.count();
  await input.focus();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: 'Tiếng Việt đang soạn', selectionStart: 19, selectionEnd: 19 });
  await expect(input).toHaveValue('Tiếng Việt đang soạn');
  // Exercise the browser's composition event path; this does not automate an OS IME.
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true });
  await expect(messages).toHaveCount(before);
  await cdp.send('Input.insertText', { text: 'Tiếng Việt đã hoàn tất' });
  await expect(input).toHaveValue('Tiếng Việt đã hoàn tất');
  await input.press('Enter');
  await expect(messages).toHaveCount(before + 1);
  await expect(messages.last()).toContainText('Tiếng Việt đã hoàn tất');
  await expect(input).toHaveValue('');
  await cdp.detach();
});
