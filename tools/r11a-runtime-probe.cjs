#!/usr/bin/env node
/**
 * R11A read-only probe over an ALREADY-EXTRACTED copy of Zalo PC app.asar.
 * Never touches the installed application; reads the REA extraction directory.
 * Emits counts + first N matched excerpts so OBSERVED vs INFERRED stays checkable.
 *
 * Usage:
 *   node tools/r11a-runtime-probe.cjs <extracted-root> [symbol-group]
 *   node tools/r11a-runtime-probe.cjs <extracted-root> --list-symbols
 */
'use strict';

const fs = require('fs');
const path = require('path');

const GROUPS = {
  window: [
    ['BrowserWindow', /new\s+[A-Za-z_$][\w$]*\.BrowserWindow\s*\(/g],
    ['webPreferences', /webPreferences\s*:/g],
    ['preload-prop', /preload\s*:/g],
    ['setWindowOpenHandler', /setWindowOpenHandler\s*\(/g],
    ['will-attach-webview', /will-attach-webview/g],
    ['web-contents-created', /web-contents-created/g],
  ],
  security: [
    ['nodeIntegration', /nodeIntegration\s*:/g],
    ['contextIsolation', /contextIsolation\s*:/g],
    ['sandbox', /sandbox\s*:/g],
    ['enableRemoteModule', /enableRemoteModule\s*:/g],
    ['webSecurity', /webSecurity\s*:/g],
    ['allowRunningInsecureContent', /allowRunningInsecureContent\s*:/g],
  ],
  debug: [
    ['appendSwitch', /appendSwitch\s*\(/g],
    ['commandLine', /commandLine\s*\./g],
    ['remote-debugging-port', /remote-debugging-port/g],
    ['--inspect', /--inspect(-brk)?\b/g],
    ['openDevTools', /openDevTools\s*\(/g],
    ['inspect-brk', /inspect-brk/g],
  ],
  ipc: [
    ['ipcMain.handle', /ipcMain\s*\.\s*handle\s*\(/g],
    ['ipcMain.on', /ipcMain\s*\.\s*on\s*\(/g],
    ['ipcMain.once', /ipcMain\s*\.\s*once\s*\(/g],
    ['webContents.send', /webContents\s*\.\s*send\s*\(/g],
    ['contextBridge.exposeInMainWorld', /contextBridge\s*\.\s*exposeInMainWorld\s*\(/g],
    ['executeJavaScript', /executeJavaScript\s*\(/g],
    ['insertCSS', /insertCSS\s*\(/g],
  ],
  lifecycle: [
    ['app.whenReady', /whenReady\s*\(/g],
    ['app.requestSingleInstanceLock', /requestSingleInstanceLock\s*\(/g],
    ['second-instance-event', /['"]second-instance['"]/g],
    ['setAsDefaultProtocolClient', /setAsDefaultProtocolClient\s*\(/g],
    ['open-url', /['"]open-url['"]/g],
    ['zalo-protocol', /zalo:\/\//g],
    ['launch-compact-app', /--launch-compact-app/g],
    ['before-quit', /['"]before-quit['"]/g],
  ],
  native: [
    ['child_process.spawn', /\.spawn\s*\(/g],
    ['child_process.execFile', /execFile\s*\(/g],
    ['child_process.fork', /\.fork\s*\(/g],
    ['ZaloCall', /ZaloCall/g],
    ['ZaviMeet', /ZaviMeet/g],
    ['ZaloCap', /ZaloCap/g],
    ['net.Socket', /net\s*\.\s*(connect|createConnection)\s*\(/g],
    ['named-pipe', /\\\\\.\\pipe\\/g],
    ['utilityProcess', /utilityProcess\s*\.\s*fork\s*\(/g],
  ],
};

function walkProbe(root, groups, opts) {
  const out = [];
  for (const [group, pats] of Object.entries(groups)) {
    for (const [name, re] of pats) {
      const row = { group, name, files: [], total: 0, excerpts: [] };
      for (const file of opts.files) {
        const abs = path.join(root, file);
        if (!fs.existsSync(abs)) continue;
        const text = fs.readFileSync(abs, 'utf8');
        const hits = text.match(re);
        if (!hits) continue;
        row.total += hits.length;
        row.files.push(file);
        if (opts.excerpts) {
          re.lastIndex = 0;
          let m;
          let taken = 0;
          while ((m = re.exec(text)) && taken < opts.excerptMax) {
            const a = Math.max(0, m.index - opts.pad);
            const b = Math.min(text.length, m.index + m[0].length + opts.pad);
            row.excerpts.push({
              file,
              at: m.index,
              text: text.slice(a, b).replace(/\s+/g, ' '),
            });
            taken++;
          }
        }
      }
      out.push(row);
    }
  }
  return out;
}

function main() {
  const root = process.argv[2];
  if (!root) {
    console.error('usage: node tools/r11a-runtime-probe.cjs <extracted-root> [group] [--excerpts]');
    process.exit(2);
  }
  if (process.argv.includes('--list-symbols')) {
    console.log(Object.keys(GROUPS).join('\n'));
    return;
  }
  const groupFilter = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : null;
  const wantExcerpts = process.argv.includes('--excerpts');
  const groups = groupFilter ? { [groupFilter]: GROUPS[groupFilter] } : GROUPS;
  if (groupFilter && !groups[groupFilter]) {
    console.error('unknown group: ' + groupFilter);
    process.exit(2);
  }

  const files = [
    'main-dist/main.js',
    'main-dist/compact-app.js',
    'main-dist/bootstrap.js',
    'main-dist/second-instance.js',
    'main-dist/migration.js',
    'main-dist/utility-process-media.js',
    'main-dist/utility-process-sqlite.js',
    'main-dist/mainless-worker.js',
    'main-dist/preload-render.js',
    'main-dist/preload-noti.js',
    'main-dist/preload-shared-worker.js',
    'main-dist/preload-sqlite.js',
    'main-dist/compact-app-preload.js',
  ];

  const rows = walkProbe(root, groups, {
    files,
    excerpts: wantExcerpts,
    excerptMax: 3,
    pad: 60,
  });

  const report = {
    root,
    generated_at: new Date().toISOString(),
    thresholds_note: 'counts are lexical matches in minified bundles, NOT call sites',
    rows: rows.map((r) => ({
      group: r.group,
      symbol: r.name,
      matches: r.total,
      files: r.files,
      ...(wantExcerpts ? { excerpts: r.excerpts } : {}),
    })),
  };
  console.log(JSON.stringify(report, null, 2));
}

main();
