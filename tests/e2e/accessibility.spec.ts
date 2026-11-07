import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { sampleTextContrast } from './contrast';
import { signIn } from './signIn';

for (const theme of ['dark', 'light']) {
  test(`accessibility: ${theme} chat and settings`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/');
    await signIn(page);
    await page.getByRole('button', { name: 'Cài đặt', exact: true }).click();
    await page.getByRole('button', { name: theme === 'light' ? 'Giao diện sáng' : 'Giao diện tối' }).click();
    await page.getByRole('button', { name: 'Hoàn tất' }).click();
    await mkdir('reports/accessibility', { recursive: true });
    for (const state of ['chat', 'settings']) {
      if (state === 'settings') await page.getByRole('button', { name: 'Cài đặt', exact: true }).click();
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      await writeFile(`reports/accessibility/${theme}-${state}.json`, JSON.stringify(results, null, 2));
      await page.screenshot({ path: `reports/screenshots/accessibility-${theme}-${state}.png` });
      expect.soft(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(n => ({ target: n.target, summary: n.failureSummary })) }))).toEqual([]);
      const contrast = await sampleTextContrast(page);
      await writeFile(`reports/accessibility/contrast-${theme}-${state}.json`, JSON.stringify(contrast, null, 2));
      expect.soft(contrast.filter(result => result.minimumRatio < result.required)).toEqual([]);
    }
  });
}
