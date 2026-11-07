const { _electron } = require('@playwright/test');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

// Geometry, drag-region, DPI/zoom and accessibility-tree checks that can be
// asserted without a human at the mouse. Physical drag, OS IME and screen-reader
// output still require manual verification and are not claimed here.

(async () => {
  await mkdir('reports/screenshots', { recursive: true });
  const env = { ...process.env, GLASS_DEV: '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  const evidence = { date: new Date().toISOString(), checks: [] };
  const app = await _electron.launch({ args: [path.resolve('.')], env, timeout: 120_000 });
  try {
    const page = await app.firstWindow();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.getByRole('button', { name: 'Vào bản demo' }).click();
    await page.getByRole('textbox', { name: 'Nội dung tin nhắn demo' }).waitFor();

    // 1. Drag-region geometry and hit testing.
    const regions = await page.evaluate(() => {
      const region = el => getComputedStyle(el).webkitAppRegion;
      const bar = document.querySelector('.titlebar');
      const controls = document.querySelector('.window-controls');
      const buttons = [...document.querySelectorAll('.window-controls button')];
      const rail = document.querySelector('.rail');
      const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
      // Effective draggability: nearest self-or-ancestor that declares a value.
      const effective = el => {
        for (let node = el; node; node = node.parentElement) {
          const value = region(node);
          if (value && value !== 'no-drag') return { value, at: node.className || node.tagName };
          if (value === 'no-drag' && node.className && String(node.className).includes('window-controls')) return { value, at: node.className };
        }
        return { value: 'none', at: null };
      };
      const barRect = rect(bar), controlsRect = rect(controls);
      const y = Math.round(barRect.y + barRect.h / 2);
      const points = [];
      for (let x = Math.round(barRect.x) + 8; x < Math.round(controlsRect.x) - 4; x += 32) {
        const el = document.elementFromPoint(x, y);
        points.push({ x, el: el ? (el.className || el.tagName) : null, effective: el ? effective(el) : null });
      }
      const buttonPoints = buttons.map(b => {
        const r = b.getBoundingClientRect();
        const el = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
        return { label: b.getAttribute('aria-label'), computed: region(b), hit: el === b || b.contains(el) };
      });
      return { bar: rect(bar), controls: controlsRect, rail: rect(rail),
        barRegion: region(bar), controlsRegion: region(controls),
        dragPoints: points, buttonPoints,
        buttonsDraggable: buttons.filter(b => region(b) !== 'no-drag').map(b => b.getAttribute('aria-label')) };
    });
    assert.equal(regions.barRegion, 'drag', 'titlebar must declare -webkit-app-region: drag');
    assert.equal(regions.controlsRegion, 'no-drag', 'window controls must declare no-drag');
    assert.deepEqual(regions.buttonsDraggable, [], 'no window-control button may be draggable');
    assert.ok(regions.dragPoints.length >= 10, 'drag band should span the titlebar');
    const nonDraggable = regions.dragPoints.filter(p => !p.effective || p.effective.value !== 'drag');
    assert.deepEqual(nonDraggable, [], 'every sampled titlebar point must be part of the drag region');
    assert.ok(regions.buttonPoints.every(b => b.hit), 'window-control buttons must receive their own clicks');
    assert.ok(regions.bar.x >= regions.rail.x + regions.rail.w - 1,
      'drag band must start at or right of the rail edge, not cover navigation');
    evidence.checks.push({ name: 'drag-region', status: 'PASS', detail: {
      samples: regions.dragPoints.length, barWidth: regions.bar.w, barHeight: regions.bar.h, buttons: regions.buttonPoints } });

    // 2. Layout at minimum size, and no overflow.
    const layout = async (width, height, label) => {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), [width, height]);
      await page.waitForTimeout(250);
      return page.evaluate(l => {
        const doc = document.documentElement;
        const shell = document.querySelector('.window-shell').getBoundingClientRect();
        return { label: l, inner: [window.innerWidth, window.innerHeight],
          scrollOverflowX: doc.scrollWidth - doc.clientWidth,
          scrollOverflowY: doc.scrollHeight - doc.clientHeight,
          shellFits: shell.width <= window.innerWidth + 1 && shell.height <= window.innerHeight + 1,
          composerVisible: document.querySelector('.composer').getBoundingClientRect().height > 0,
          railVisible: document.querySelector('.rail').getBoundingClientRect().width > 0 };
      }, label);
    };
    const sizes = [];
    for (const [w, h] of [[1000, 700], [1366, 768], [1920, 1080]]) sizes.push(await layout(w, h, `${w}x${h}`));
    for (const s of sizes) {
      assert.equal(s.scrollOverflowX, 0, `${s.label}: no horizontal overflow`);
      assert.ok(s.shellFits, `${s.label}: shell must fit the viewport`);
      assert.ok(s.composerVisible && s.railVisible, `${s.label}: composer and rail must be laid out`);
    }
    evidence.checks.push({ name: 'layout-sizes', status: 'PASS', sizes });

    // 3. Device-pixel-ratio simulation at the same CSS size.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
    const cdp = await page.context().newCDPSession(page);
    const dsf = [];
    for (const scale of [1, 1.25, 1.5, 2]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: scale, mobile: false });
      await page.waitForTimeout(200);
      dsf.push(await page.evaluate(s => {
        const doc = document.documentElement;
        const bar = document.querySelector('.titlebar').getBoundingClientRect();
        const controls = document.querySelector('.window-controls').getBoundingClientRect();
        return { scale: s, devicePixelRatio: window.devicePixelRatio,
          overflowX: doc.scrollWidth - doc.clientWidth,
          barCssHeight: Math.round(bar.height),
          controlsInsideBar: controls.top >= bar.top - 1 && controls.bottom <= bar.bottom + 1,
          buttonTargets: [...document.querySelectorAll('.window-controls button')].map(b => {
            const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) };
          }) };
      }, scale));
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    for (const r of dsf) {
      assert.equal(r.overflowX, 0, `DSF ${r.scale}: no horizontal overflow`);
      assert.ok(r.controlsInsideBar, `DSF ${r.scale}: controls must stay inside the titlebar`);
      assert.equal(r.barCssHeight, 47, `DSF ${r.scale}: titlebar height must stay 47 CSS px`);
      // 46x47 CSS px is above the 44x44 pointer-target guidance at every scale.
      assert.ok(r.buttonTargets.every(b => b.w >= 44 && b.h >= 44), `DSF ${r.scale}: window buttons >= 44 CSS px`);
    }
    evidence.checks.push({ name: 'device-pixel-ratio', status: 'PASS', samples: dsf });

    // 4. Browser zoom, which exercises the same layout with fractional metrics.
    const zoom = [];
    for (const factor of [1, 1.25, 1.5, 2]) {
      await app.evaluate(({ BrowserWindow }, f) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(f), factor);
      await page.waitForTimeout(250);
      zoom.push(await page.evaluate(f => {
        const doc = document.documentElement;
        const bar = document.querySelector('.titlebar').getBoundingClientRect();
        const rail = document.querySelector('.rail').getBoundingClientRect();
        return { factor: f, zoom: window.devicePixelRatio, overflowX: doc.scrollWidth - doc.clientWidth,
          cssViewport: [window.innerWidth, window.innerHeight],
          titlebarLeft: Math.round(bar.x), railRight: Math.round(rail.x + rail.width),
          overlapsRail: bar.x < rail.x + rail.width - 1 };
      }, factor));
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
    for (const z of zoom) {
      assert.equal(z.overflowX, 0, `zoom ${z.factor}: no horizontal overflow`);
      assert.equal(z.overlapsRail, false, `zoom ${z.factor}: drag band must not overlap the navigation rail`);
    }
    evidence.checks.push({ name: 'browser-zoom', status: 'PASS', samples: zoom });

    // 5. The desktop window is full-bleed: no outer gutter, rounding or rim.
    // Window controls are excluded from the corner sample because they sit on
    // the titlebar and are legitimately painted on top of the surface.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 900));
    await page.waitForTimeout(300);
    const shell = await page.evaluate(() => {
      const app = document.getElementById('app');
      const shellEl = document.querySelector('.window-shell');
      const cs = getComputedStyle(app), ss = getComputedStyle(shellEl);
      const r = shellEl.getBoundingClientRect();
      const corners = [[1, 1], [innerWidth - 2, 1], [1, innerHeight - 2], [innerWidth - 2, innerHeight - 2]]
        .map(([x, y]) => {
          const el = document.elementFromPoint(x, y);
          return { x, y, insideShell: !!el && shellEl.contains(el),
            el: el ? (el.id ? `#${el.id}` : el.className || el.tagName) : null };
        });
      const doc = document.documentElement;
      return {
        viewport: [innerWidth, innerHeight],
        appPadding: cs.padding,
        shellRect: { x: r.x, y: r.y, w: r.width, h: r.height },
        radius: ss.borderTopLeftRadius,
        borderWidth: ss.borderTopWidth,
        boxShadow: ss.boxShadow,
        overflow: [doc.scrollWidth - doc.clientWidth, doc.scrollHeight - doc.clientHeight],
        corners,
      };
    });
    assert.equal(shell.appPadding, '0px', 'desktop shell: #app must have no outer gutter');
    assert.deepEqual([shell.shellRect.w, shell.shellRect.h], shell.viewport, 'desktop shell must equal the viewport');
    assert.deepEqual([shell.shellRect.x, shell.shellRect.y], [0, 0], 'desktop shell must start at the window origin');
    assert.equal(shell.radius, '0px', 'desktop shell must not round its corners');
    assert.equal(shell.borderWidth, '0px', 'desktop shell must not draw a rim');
    assert.equal(shell.boxShadow, 'none', 'desktop shell must not cast an outer shadow');
    assert.deepEqual(shell.overflow, [0, 0], 'desktop shell must not scroll');
    assert.ok(shell.corners.every(c => c.insideShell),
      `desktop shell must reach every window corner, got ${JSON.stringify(shell.corners)}`);
    evidence.checks.push({ name: 'window-shell-geometry', status: 'PASS', detail: shell });

    // 6. Accessibility tree: every interactive node must expose a name.
    await cdp.send('Accessibility.enable');
    const ax = [];
    for (const theme of ['dark', 'light']) {
      await page.getByRole('button', { name: 'Cài đặt', exact: true }).click();
      await page.getByRole('button', { name: theme === 'light' ? 'Giao diện sáng' : 'Giao diện tối' }).click();
      await page.waitForTimeout(250);
      const tree = await cdp.send('Accessibility.getFullAXTree');
      const interactive = new Set(['button', 'link', 'textbox', 'checkbox', 'radio', 'switch', 'combobox', 'menuitem', 'tab', 'slider']);
      const unnamed = tree.nodes.filter(n => !n.ignored && interactive.has(n.role?.value)
        && !(n.name?.value || '').trim()).map(n => ({ role: n.role.value, nodeId: n.nodeId }));
      const names = tree.nodes.filter(n => !n.ignored && interactive.has(n.role?.value))
        .map(n => ({ role: n.role.value, name: n.name.value }));
      ax.push({ theme, interactive: names.length, unnamed, sample: names.slice(0, 6) });
      assert.deepEqual(unnamed, [], `${theme}: every interactive element must expose an accessible name`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
    }
    evidence.checks.push({ name: 'accessibility-tree', status: 'PASS', themes: ax });

    // 7. Focus order reachability of the window controls from the document.
    await page.evaluate(() => document.querySelector('.prototype-tag')?.focus());
    const focusables = await page.evaluate(() => [...document.querySelectorAll('.window-controls button')].map(b => {
      b.focus(); return { label: b.getAttribute('aria-label'), focused: document.activeElement === b };
    }));
    assert.ok(focusables.every(f => f.focused), 'window-control buttons must be keyboard focusable');
    evidence.checks.push({ name: 'control-focusability', status: 'PASS', focusables });

    assert.deepEqual(errors, []);
    evidence.status = 'PASS';
    await cdp.detach();
    const closed = app.waitForEvent('close');
    await page.getByRole('button', { name: 'Đóng cửa sổ' }).click(); await closed;
    await writeFile('reports/desktop-extra-qa.json', JSON.stringify(evidence, null, 2));
    console.log('PASS: drag-region hit map, three window sizes, DSF 1/1.25/1.5/2, zoom 1/1.25/1.5/2, full-window shell geometry, AX names, control focus');
  } finally { await app.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
