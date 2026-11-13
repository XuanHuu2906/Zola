const { _electron, expect } = require('@playwright/test');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  await mkdir('reports/screenshots', { recursive: true });
  const env = { ...process.env, GLASS_DEV: '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.argv[2]; // Optional unpacked or portable EXE; never an installer.
  const label = process.argv[3] || 'electron';
  assert.match(label, /^[a-z0-9-]+$/);
  const evidence = { date: new Date().toISOString(), executable: executablePath || 'development Electron / production renderer', runs: [] };
  for (let run = 0; run < 2; run++) {
    const app = await _electron.launch({ ...(executablePath ? { executablePath: path.resolve(executablePath), args: [] } : { args: [path.resolve('.')] }), env, timeout: 120_000 });
    try {
      const page = await app.firstWindow();
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await expect(page.locator('.window-shell')).toBeVisible();
      await expect(page.locator('.titlebar')).toBeVisible();
      await expect(page.locator('.live-login, .app-layout, .live-stage')).toHaveCount(1);
      assert.equal(await page.evaluate(() => window.open('https://example.invalid/')), null);
      assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
      assert.equal(await page.evaluate(async () => {
        try { await fetch('https://example.invalid/'); return 'unexpected success'; }
        catch { return 'blocked'; }
      }), 'blocked');
      assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
      const bridgeKeys = await page.evaluate(() => Object.keys(window.desktop).sort());
      assert.deepEqual(bridgeKeys, ['close', 'minimize', 'notify', 'toggleMaximize']);
      const preferences = await app.evaluate(({ BrowserWindow }) => {
        const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
        return { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration, webSecurity: p.webSecurity };
      });
      assert.deepEqual(preferences, { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true });
      const storage = await app.evaluate(({ app }) => ({ userData: app.getPath('userData'), sessionData: app.getPath('sessionData') }));
      assert.equal(storage.userData, storage.sessionData);
      assert.equal(path.basename(storage.sessionData), '.glass-demo-data');
      for (const [width, height] of [[1920, 1080], [1600, 900], [1366, 768]]) {
        await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), [width, height]);
        await page.screenshot({ path: `reports/screenshots/${label}-${run}-${width}x${height}.png` });
      }
      const frameTiming = await page.evaluate(() => new Promise(resolve => {
        const intervals = []; let previous = 0;
        function frame(now) {
          if (previous) intervals.push(now - previous);
          previous = now;
          if (intervals.length < 120) requestAnimationFrame(frame);
          else resolve({ samples: intervals.length, meanMs: intervals.reduce((a, b) => a + b, 0) / intervals.length,
            p95Ms: intervals.toSorted((a, b) => a - b)[Math.floor(intervals.length * .95)] });
        }
        requestAnimationFrame(frame);
      }));
      const processes = await app.evaluate(({ app }) => app.getAppMetrics().map(({ type, memory }) => ({ type, memory })));
      await page.getByRole('button', { name: 'Phóng to hoặc khôi phục cửa sổ' }).click();
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(true);
      await page.getByRole('button', { name: 'Phóng to hoặc khôi phục cửa sổ' }).click();
      await page.getByRole('button', { name: 'Thu nhỏ cửa sổ' }).click();
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(true);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
      assert.deepEqual(errors, []);
      evidence.runs.push({ run, preferences, bridgeKeys, storage, errors, frameTiming, processes,
        externalFetch: 'blocked', newWindow: 'denied', status: 'PASS' });
      const closed = app.waitForEvent('close');
      await page.getByRole('button', { name: 'Đóng cửa sổ' }).click();
      await closed;
    } finally { await app.close().catch(() => {}); }
  }
  await writeFile(`reports/${label}-smoke.json`, JSON.stringify(evidence, null, 2));
  console.log('PASS: two launches, live startup, window controls, renderer isolation, screenshots');
})().catch(error => { console.error(error); process.exitCode = 1; });
