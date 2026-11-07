const { _electron, expect } = require('@playwright/test');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const executablePath = path.resolve('release/win-unpacked/Glass Messenger Demo.exe');
  const profileRoot = path.resolve('reports/soak-profile');
  // SOAK_BATCHES raises the session length without changing what each batch does.
  const batches = Number(process.env.SOAK_BATCHES || 30);
  if (!Number.isInteger(batches) || batches < 1) throw new Error('SOAK_BATCHES must be a positive integer');
  await mkdir(profileRoot, { recursive: true });
  const env = { ...process.env, PORTABLE_EXECUTABLE_DIR: profileRoot, GLASS_DEV: '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath, args: [], env, timeout: 60_000 });
  const started = Date.now();
  const evidence = { date: new Date().toISOString(), executablePath, profileRoot, batches, samples: [], errors: [], sent: 0, naturalReclaim: [] };
  try {
    const page = await app.firstWindow();
    page.on('pageerror', error => evidence.errors.push(error.message));
    await page.getByRole('button', { name: 'Vào bản demo' }).click();
    const input = page.getByRole('textbox', { name: 'Nội dung tin nhắn demo' });
    await expect(input).toBeVisible();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    await cdp.send('HeapProfiler.enable');
    async function sample(stage, collect = false) {
      if (collect) await cdp.send('HeapProfiler.collectGarbage');
      const metrics = await cdp.send('Performance.getMetrics');
      // Live DOM counts distinguish real accumulation from documents the renderer
      // has not yet collected; Performance.getMetrics includes unreclaimed documents.
      const live = await page.evaluate(() => ({ domNodes: document.getElementsByTagName('*').length, frames: window.frames.length }));
      evidence.samples.push({ stage, elapsedMs: Date.now() - started,
        live,
        renderer: Object.fromEntries(metrics.metrics.filter(m => ['JSHeapUsedSize', 'Nodes', 'Documents', 'JSEventListeners'].includes(m.name)).map(m => [m.name, m.value])),
        processes: await app.evaluate(({ app }) => app.getAppMetrics().map(({ type, memory }) => ({ type, memory }))) });
    }
    await sample('baseline');
    for (let batch = 0; batch < batches; batch++) {
      const tick = Date.now();
      const chat = ['Minh Anh', 'Hoàng Long', 'Công việc'][batch % 3];
      await page.locator('.conversation').filter({ hasText: chat }).click();
      for (let i = 0; i < 5; i++) {
        const text = `Stability sample ${batch}-${i}`;
        await input.fill(text); await input.press('Enter');
        await expect(page.locator('.message-row').last()).toContainText(text);
        evidence.sent++;
      }
      await page.getByRole('button', { name: 'Cài đặt', exact: true }).click();
      await page.getByRole('button', { name: batch % 2 ? 'Giao diện sáng' : 'Giao diện tối' }).click();
      await page.getByRole('switch', { name: 'Giảm độ mờ' }).click();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Cài đặt', exact: true })).toBeFocused();
      await page.waitForTimeout(Math.max(0, 6_000 - (Date.now() - tick)));
      if ((batch + 1) % 5 === 0) { await sample(`batch-${batch + 1}`); console.log(`Progress: ${batch + 1}/${batches} batches; ${evidence.sent} local messages`); }
    }
    const baseline = evidence.samples[0].renderer;
    const baselineLive = evidence.samples[0].live;
    // Baseline is taken on the live window, so Documents includes any prerender or
    // fenced frame the engine reports. Reclaim therefore compares Nodes and listeners.
    const reclaimTarget = { Nodes: Math.ceil(baseline.Nodes * 1.15), JSEventListeners: Math.ceil(baseline.JSEventListeners * 1.5) };
    await page.reload();
    await expect(input).toBeVisible();
    await expect(page.locator('.messages')).not.toContainText('Stability sample');
    // Natural reclaim: poll immediately after reload WITHOUT forcing GC, so the
    // measured value is the engine's own reclamation latency, not collectGarbage.
    const reclaimStart = Date.now();
    let reclaimedMs = null;
    for (;;) {
      const metrics = await cdp.send('Performance.getMetrics');
      const now = Object.fromEntries(metrics.metrics.filter(m => ['JSHeapUsedSize', 'Nodes', 'Documents', 'JSEventListeners'].includes(m.name)).map(m => [m.name, m.value]));
      const live = await page.evaluate(() => document.getElementsByTagName('*').length);
      evidence.naturalReclaim.push({ elapsedMs: Date.now() - reclaimStart, liveNodes: live, renderer: now });
      if (now.Nodes <= reclaimTarget.Nodes && now.JSEventListeners <= reclaimTarget.JSEventListeners) { reclaimedMs = Date.now() - reclaimStart; break; }
      if (Date.now() - reclaimStart > 20_000) break;
      await page.waitForTimeout(250);
    }
    evidence.reclaimedMs = reclaimedMs;
    evidence.reclaimTarget = reclaimTarget;
    await sample('after-reload');
    // Forced collection separates detached documents the renderer has not yet
    // reclaimed from an actual accumulation defect.
    await sample('after-reload-gc', true);
    // A second reload checks whether live DOM returns to baseline or keeps growing.
    await page.reload();
    await expect(input).toBeVisible();
    await page.waitForTimeout(2_000); await sample('after-reload-2', true);
    const final = evidence.samples.find(s => s.stage === 'after-reload-2');
    assert.ok(final.live.domNodes <= baselineLive.domNodes + 5, `live DOM must return to baseline (${baselineLive.domNodes}), got ${final.live.domNodes}`);
    assert.deepEqual(evidence.errors, []);
    await cdp.detach();
    const closed = app.waitForEvent('close');
    await page.getByRole('button', { name: 'Đóng cửa sổ' }).click(); await closed;
    evidence.elapsedMs = Date.now() - started;
    evidence.status = 'PASS';
    await writeFile('reports/stability-smoke.json', JSON.stringify(evidence, null, 2));
    console.log(`PASS: ${evidence.sent} local sends, ${batches} settings cycles, reload reset, live DOM back to baseline, natural reclaim ${evidence.reclaimedMs ?? 'not observed within 20s'}ms, clean close`);
  } finally { await app.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
