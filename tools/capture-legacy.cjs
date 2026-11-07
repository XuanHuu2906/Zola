const { chromium } = require('@playwright/test');
const { mkdir } = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch();
  try {
    await mkdir('reports/screenshots', { recursive: true });
    for (const [width, height] of [[1920, 1080], [1366, 768]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.goto(pathToFileURL(path.resolve('legacy/index.html')).href);
      await page.getByRole('textbox', { name: 'Nội dung tin nhắn demo' }).waitFor();
      await page.screenshot({ path: `reports/screenshots/legacy-${width}x${height}.png` });
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
