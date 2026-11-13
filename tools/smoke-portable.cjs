// Exercise the self-extracting portable wrapper. Its NSIS launcher does not pipe
// the child Electron inspector output required by Playwright's _electron.launch.
// On Linux the equivalent artifact is an AppImage, whose launcher has the same
// property; Fedora ships no libfuse2, so the AppImage is told to extract and run
// itself rather than require FUSE.
const { chromium, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const { createServer } = require('node:net');
const { mkdir, writeFile, stat } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function availablePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

const version = require('../package.json').version;
const isAppImage = process.platform === 'linux';
const executable = path.resolve(process.argv[2] || (isAppImage
  ? `release/Zola-${version}-x86_64.AppImage`
  : `release/Zola-${version}-x64.exe`));

(async () => {
  const file = await stat(executable);
  await mkdir('reports/screenshots', { recursive: true });
  const evidence = { date: new Date().toISOString(), executable, bytes: file.size, runs: [] };
  for (let run = 0; run < 2; run++) {
    const port = await availablePort();
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    if (isAppImage) {
      // AppImage's runtime flags must precede our own; extract-and-run removes
      // the libfuse2 requirement on distributions that do not ship it.
      env.APPIMAGE_EXTRACT_AND_RUN = '1';
      env.ELECTRON_DISABLE_SECURITY_WARNINGS = '1';
    }
    const child = spawn(executable, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'],
      { env, windowsHide: true, stdio: 'ignore' });
    let childError; child.on('error', error => { childError = error; });
    const exited = new Promise(resolve => child.on('exit', (code, signal) => resolve({ code, signal })));
    let browser;
    try {
      const endpoint = `http://127.0.0.1:${port}`;
      const deadline = Date.now() + 90_000;
      while (true) {
        if (childError) throw childError;
        try { const response = await fetch(`${endpoint}/json/version`); if (response.ok) break; } catch { /* extracting / starting */ }
        if (Date.now() > deadline) throw new Error('Portable renderer debugging endpoint did not become ready');
        await delay(250);
      }
      browser = await chromium.connectOverCDP(endpoint, { timeout: 20_000 });
      const context = browser.contexts()[0];
      // The window can exist before it has navigated, so a page event may already
      // have fired; poll the existing pages instead of waiting for a new one.
      let page;
      const pageDeadline = Date.now() + 20_000;
      while (!page) {
        page = context.pages().find(candidate => candidate.url().startsWith('glass://app'));
        if (page) break;
        if (Date.now() > pageDeadline) throw new Error('Portable window never navigated to glass://app');
        await delay(250);
      }
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await expect(page.locator('.window-shell')).toBeVisible();
      await expect(page.locator('.live-login, .app-layout, .live-stage')).toHaveCount(1);
      assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
      assert.deepEqual(await page.evaluate(() => Object.keys(window.desktop).sort()), ['close', 'minimize', 'notify', 'toggleMaximize']);
      await page.screenshot({ path: `reports/screenshots/portable-${run}.png` });
      assert.deepEqual(errors, []);
      const disconnected = new Promise(resolve => browser.once('disconnected', resolve));
      await page.getByRole('button', { name: 'Đóng cửa sổ' }).click();
      await Promise.race([disconnected, delay(15_000).then(() => { throw new Error('Portable window did not close'); })]);
      const exit = await Promise.race([exited, delay(15_000).then(() => { throw new Error('Portable wrapper did not exit'); })]);
      assert.equal(exit.code, 0);
      evidence.runs.push({ run, url: 'glass://app/index.html', errors, exit, status: 'PASS' });
    } finally {
      if (browser?.isConnected()) {
        await browser.contexts()[0]?.pages()[0]?.evaluate(() => window.desktop?.close()).catch(() => {});
        await browser.close().catch(() => {});
      }
      if (child.exitCode === null) child.kill();
    }
  }
  await writeFile('reports/portable-smoke.json', JSON.stringify(evidence, null, 2));
  console.log('PASS: portable wrapper extracted, launched and closed cleanly twice');
})().catch(error => { console.error(error); process.exitCode = 1; });
