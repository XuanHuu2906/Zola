const fs = require('fs');
const path = require('path');
const ROOT = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6';
const out = [];
const log = (...a) => out.push(a.join(' '));
const findAll = (s, n, max = 20) => { const h = []; let i = 0; while ((i = s.indexOf(n, i)) !== -1) { h.push(i); i += n.length; if (h.length >= max) break; } return h; };
const count = (s, n) => findAll(s, n, Infinity).length;
const main = fs.readFileSync(path.join(ROOT, 'main-dist/main.js'), 'utf8');

log('=== window-chrome / material options (main.js) ===');
for (const v of ['nativeTheme', 'shouldUseDarkColors', 'themeSource', 'setBackgroundMaterial', 'backgroundMaterial',
  'vibrancy', 'visualEffectState', 'titleBarOverlay', 'trafficLightPosition', 'roundedCorners', 'hasShadow',
  'transparent:!0', 'thickFrame', 'setOpacity', 'rgba(0,0,0,0)']) {
  log('  ' + v + ' = ' + count(main, v));
}
log('');

log('=== auto-update ===');
for (const off of findAll(main, 'updateMode', 4)) log('  updateMode @' + off + ' :: ' + JSON.stringify(main.slice(off - 200, off + 160)));
for (const off of findAll(main, 'autoUpdater', 6)) log('  autoUpdater @' + off + ' :: ' + JSON.stringify(main.slice(off - 120, off + 160)));
log('  checkForUpdates = ' + count(main, 'checkForUpdates'));
log('  quitAndInstall = ' + count(main, 'quitAndInstall'));
log('  ASAR integrity / signed = ' + count(main, 'asarIntegrity'));
log('');

log('=== theme config channel ===');
for (const v of ['update-theme-conf', 'get-theme-conf', 'app_theme', 'za_theme']) log('  ' + v + ' = ' + count(main, v));
log('');

log('=== developer / debugging surfaces (main.js) ===');
for (const v of ['--remote-debugging-port', 'remote-debugging', 'openDevTools', 'devTools:!0', 'devTools:!1',
  '--inspect', 'ELECTRON_ENABLE_LOGGING', 'setDevToolsWebContents']) {
  log('  ' + v + ' = ' + count(main, v));
}
log('');

log('=== CSP monitor: note it is subFrame-only, read-only ===');
const off = main.indexOf('setupCSPMonitor');
log('  setupCSPMonitor @' + off);
log('');

fs.writeFileSync(path.join(__dirname, '_r5_census5.txt'), out.join('\n') + '\n');
console.log(out.join('\n'));
