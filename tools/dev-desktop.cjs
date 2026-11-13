// Starts only this project's Vite instance; refuses an occupied development port.
const { spawn } = require('node:child_process');
const path = require('node:path');
let server;
let electron;
let quitting = false;
async function stop(code = 0) {
  if (quitting) return;
  quitting = true;
  electron?.kill();
  await server?.close();
  process.exitCode = code;
}
process.on('SIGINT', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); });
(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ server: { host: '127.0.0.1', port: 5173, strictPort: true } });
  await server.listen();
  server.printUrls();
  const env = { ...process.env, GLASS_DEV: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  if (process.argv.includes('--smoke')) {
    const { _electron, expect } = require('@playwright/test');
    const { writeFile } = require('node:fs/promises');
    const app = await _electron.launch({ args: [path.resolve('.')], env });
    try {
      const page = await app.firstWindow();
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await expect(page.locator('.window-shell')).toBeVisible();
      await expect(page.locator('.live-login, .app-layout, .live-stage')).toHaveCount(1, { timeout: 20_000 });
      expect(errors).toEqual([]);
      await writeFile('reports/dev-desktop-smoke.json', JSON.stringify({ date: new Date().toISOString(), url: page.url(), errors, status: 'PASS' }, null, 2));
    } finally { await app.close(); await stop(); }
    return;
  }
  electron = spawn(require('electron'), [path.resolve('.')], { stdio: 'inherit', env, windowsHide: true });
  electron.on('error', error => { console.error(error); void stop(1); });
  electron.on('exit', code => { void stop(code || 0); });
})().catch(error => { console.error(error); void stop(1); });
