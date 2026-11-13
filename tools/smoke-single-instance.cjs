// Xác nhận `app.requestSingleInstanceLock()` thật sự chặn tiến trình thứ hai.
//
// Không dùng `_electron.launch` cho bản thứ hai: Playwright cần inspector của
// chính tiến trình đó, mà bản thứ hai chết ngay sau khi khoá bị từ chối — không có
// cửa sổ nào để bám vào. Vì vậy nó được `spawn` thô, và điều ta kiểm là nó **thoát**
// chứ không phải nó làm gì.
const { _electron, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

const SECOND_TIMEOUT_MS = 30_000;

(async () => {
  await mkdir('reports', { recursive: true });
  const env = { ...process.env, GLASS_DEV: '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  const project = path.resolve('.');
  const app = await _electron.launch({ args: [project], env, timeout: 120_000 });
  try {
    const page = await app.firstWindow();
    await page.locator('.window-shell').waitFor({ state: 'visible' });
    // Thu nhỏ trước để kiểm thêm nhánh `restore()` của `second-instance`.
    await page.getByRole('button', { name: 'Thu nhỏ cửa sổ' }).click();
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(true);

    const startedAt = Date.now();
    const second = spawn(path.join(project, 'node_modules/electron/dist/electron'), [project], {
      env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    second.stdout.on('data', chunk => { output += chunk; });
    second.stderr.on('data', chunk => { output += chunk; });
    const exit = await new Promise(resolve => {
      // Treo là hỏng nặng hơn thoát lỗi: nó nghĩa là hai listener cùng sống.
      const timer = setTimeout(() => { second.kill('SIGKILL'); resolve('timeout'); }, SECOND_TIMEOUT_MS);
      second.on('exit', (code, signal) => { clearTimeout(timer); resolve(signal ? `signal:${signal}` : code); });
    });
    const elapsedMs = Date.now() - startedAt;

    const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    // `second-instance` phải đánh thức cửa sổ đang thu nhỏ, không mở cửa sổ mới.
    const restored = await app.evaluate(({ BrowserWindow }) => {
      const only = BrowserWindow.getAllWindows()[0];
      return { count: BrowserWindow.getAllWindows().length, visible: only.isVisible(), minimized: only.isMinimized() };
    });

    const evidence = {
      date: new Date().toISOString(), second: { exit, elapsedMs, output: output.split('\n').filter(Boolean).slice(-5) },
      primary: { windows, ...restored }, status: 'PASS',
    };
    await writeFile('reports/single-instance-smoke.json', JSON.stringify(evidence, null, 2));

    assert.equal(exit, 0, `bản thứ hai phải thoát sạch, nhận: ${exit}\n${output}`);
    assert.equal(windows, 1, 'bản thứ hai không được mở cửa sổ thứ hai');
    assert.equal(restored.minimized, false, 'bản thứ hai phải đánh thức cửa sổ bản chính');
    assert.equal(restored.visible, true);
    console.log(`PASS: bản thứ hai thoát sau ${elapsedMs} ms, bản chính vẫn đúng một cửa sổ và đã được đánh thức`);
  } finally { await app.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
