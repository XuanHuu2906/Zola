import type { Page } from '@playwright/test';

/** Every spec starts on the fake sign-in gate; this is the one way through it. */
export async function signIn(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Vào bản demo' }).click();
  await page.getByRole('textbox', { name: 'Nội dung tin nhắn demo' }).waitFor();
}
