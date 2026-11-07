#!/usr/bin/env node
/**
 * R11A read-only: verify every offset and identifier the reports are about to
 * cite. Prints PASS/FAIL per claim so a stale citation cannot slip in.
 *
 * Usage: node tools/r11a-verify-citations.cjs <root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-verify-citations.cjs <root>');
  process.exit(2);
}

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
const files = new Map();
function t(rel) {
  if (!files.has(rel)) files.set(rel, read(rel));
  return files.get(rel);
}

function find(rel, needle) {
  const s = t(rel);
  const i = s.indexOf(needle);
  return i < 0 ? null : i;
}

function claim(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  :: ' + detail : ''}`);
  return ok;
}

const MAIN = 'main-dist/main.js';
const COMPACT = 'main-dist/compact-app.js';

console.log('=== main.js citations ===');
for (const [label, needle] of [
  ['checkStartupOpenConvReq drain', 'checkStartupOpenConvReq:function(){Qe&&(Ce.webContents.send("z-uri-open-conv"'],
  ['check-arg-link handler', '.on("check-arg-link"'],
  ['Hn shape (FIRST hit may be lodash — see exact-offset block)', 'function Hn(e){'],
  ['process.argv[1]&&Hn', 'process.argv[1]&&Hn(process.argv)'],
  ['second-instance', '.on("second-instance"'],
  ['main window preload', 'preload:c.join(__dirname,"preload-render.js")'],
  ['actually load main App', '["actually load main App","d98nxB"]'],
]) {
  const i = find(MAIN, needle);
  claim(`${label}`, i !== null, i === null ? 'NOT FOUND' : `@${i}`);
}

console.log('\n=== compact-app.js citations ===');
for (const [label, needle] of [
  ['conversation drain (Je/Ze)', 'checkStartupOpenConvReq:function(){Je&&(Ae.webContents.send("z-uri-open-conv"'],
  ['Hn function', 'function Hn(e){'],
  ['process.argv[1]&&Hn', 'process.argv[1]&&Hn(process.argv)'],
  ['compact preload', 'preload:v.a.join(__dirname,"compact-app-preload.js")'],
  ['compact partition', 'session:u.session.fromPartition("compact-app")'],
  ['CompactAppWindowLoader.load', 'Object(f.getHtml)("compact-app.html")'],
  ['actually load main App', '["actually load main App","d98nxB"]'],
]) {
  const i = find(COMPACT, needle);
  claim(`${label}`, i !== null, i === null ? 'NOT FOUND' : `@${i}`);
}

console.log('\n=== absence claims (must all be 0) ===');
for (const [label, rel, needle] of [
  ['compact second-instance', COMPACT, '"second-instance"'],
  ['preload-render $zsub', 'main-dist/preload-render.js', '$zsub'],
  ['compact-preload $zuri', 'main-dist/compact-app-preload.js', '$zuri'],
  ['compact-preload $zsub', 'main-dist/compact-app-preload.js', '$zsub'],
  ['compact-preload z-uri-open-conv', 'main-dist/compact-app-preload.js', 'z-uri-open-conv'],
  ['compact bundle aa2b4a7e', 'pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js', 'aa2b4a7e'],
  ['compact bundle $zsub.$zuri', 'pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js', '$zsub.$zuri'],
  ['compact bundle z-uri-open-conv', 'pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js', 'z-uri-open-conv'],
  ['compact bundle onRequestOpenConv', 'pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js', 'onRequestOpenConv'],
  ['onCheckStartupOpenConvRequest (all files)', null, 'onCheckStartupOpenConvRequest'],
]) {
  if (rel) {
    const n = t(rel).split(needle).length - 1;
    claim(`${label} == 0`, n === 0, `count=${n}`);
  } else {
    let total = 0;
    for (const f of ['main-dist/main.js', 'main-dist/compact-app.js', 'main-dist/preload-render.js',
                     'main-dist/compact-app-preload.js', 'pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js']) {
      total += t(f).split(needle).length - 1;
    }
    claim(`${label} == 0`, total === 0, `count=${total}`);
  }
}

console.log('\n=== compact bundle presence (must be > 0) ===');
for (const [label, needle] of [
  ['bare $zuri.checkOpenConvReq', '$zuri.checkOpenConvReq'],
  ['bare $zuri.checkArgvLink', '$zuri.checkArgvLink'],
  ['$zsub reads', '$zsub.'],
]) {
  const n = t('pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js').split(needle).length - 1;
  claim(`${label} > 0`, n > 0, `count=${n}`);
}

console.log('\n=== compact trigger ===');
{
  const s = t(MAIN);
  const i = s.indexOf('isDriveBlockedAndStartCompactApp()');
  claim('isDriveBlockedAndStartCompactApp called in main startup', i !== -1, i === -1 ? 'NOT FOUND' : `@${i}`);
  const j = s.indexOf('launchCompactApp({InaccessibleDrive:{}}');
  claim('launchCompactApp(InaccessibleDrive)', j !== -1, j === -1 ? 'NOT FOUND' : `@${j}`);
}

// ---------------------------------------------------------------------------
// Exact-offset assertions: every offset the reports now cite literally.
// A match anywhere else is a FAIL — same-named symbols (Hn, launchCompactApp)
// are reused by lodash/moment in the same bundle.
// ---------------------------------------------------------------------------
console.log('\n=== exact offsets cited in the reports ===');
{
  const BUNDLE = 'pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js';
  const WIRING = 'pc-dist/lazy/default-login-startup-main-startup-shared-worker-znotification.aa2b4a7eeda68a9f5e59.js';
  const CASES = [
    [MAIN, 3565789, '.on("second-instance"'],
    [MAIN, 2714883, 'process.argv[1]&&Hn(process.argv)'],
    [MAIN, 2724854, 'checkStartupOpenConvReq:function(){Qe&&(Ce.webContents.send("z-uri-open-conv"'],
    [MAIN, 2703712, '.on("check-arg-link"'],
    [MAIN, 2711169, 'Fe===be'],
    [MAIN, 2710764, 'function Hn(e){'],
    [MAIN, 1503927, 'launchCompactApp({InaccessibleDrive:{}}'],
    [MAIN, 3566533, 'isDriveBlockedAndStartCompactApp()'],
    [MAIN, 904015, 'isCompactApp(){return process.argv.some('],
    [MAIN, 2715144, 'start up'],
    [COMPACT, 2703739, 'checkStartupOpenConvReq:function(){Je&&(Ae.webContents.send("z-uri-open-conv"'],
    [COMPACT, 2689649, 'function Hn(e){'],
    [COMPACT, 2693768, 'process.argv[1]&&Hn(process.argv)'],
    [BUNDLE, 1309090, 'InaccessibleDrive'],
    [BUNDLE, 1304243, 'migrate-compact-app-container'],
    [BUNDLE, 1308061, 'inaccessible-drive-app-container'],
    [BUNDLE, 1309773, 'super("compact-app"'],
    [BUNDLE, 1309830, 'getElementById("app")'],
    [BUNDLE, 15499634, '$zuri.checkOpenConvReq'],
    [BUNDLE, 15501983, '$zuri.checkArgvLink'],
    [WIRING, 37920, 'globalThis.$zsub'],
    [WIRING, 39082, 'Ke("$zuri"'],
    [WIRING, 38742, 'function Ke(e,E,t){'],
    // §7.3 call-site table — four bundles, same component
    ['pc-dist/search-worker.f32c58b63b6f4273a8a4.js', 15729390, '$zuri.checkOpenConvReq'],
    ['pc-dist/search-worker.f32c58b63b6f4273a8a4.js', 15731739, '$zuri.checkArgvLink'],
    ['pc-dist/sync-v2-sub-worker.f32c58b63b6f4273a8a4.js', 15754446, '$zuri.checkOpenConvReq'],
    ['pc-dist/sync-v2-sub-worker.f32c58b63b6f4273a8a4.js', 15756795, '$zuri.checkArgvLink'],
    ['pc-dist/lazy/default-login-main-startup-shared-worker-znotification.aafd08147de6e983b76f.js', 13086649, '$zuri.checkOpenConvReq'],
    ['pc-dist/lazy/default-login-main-startup-shared-worker-znotification.aafd08147de6e983b76f.js', 13088998, '$zuri.checkArgvLink'],
    // §7.4 renderer handler block
    ['pc-dist/lazy/default-login-startup-main-startup.ec73261654e4ce9540ac.js', 18350, 'n=(t,r)=>{const i=k.default.getFriendsSync()'],
    ['pc-dist/lazy/default-login-startup-main-startup.ec73261654e4ce9540ac.js', 18423, 's=(t,{term:r,data:i})=>'],
    ['pc-dist/lazy/default-login-startup-main-startup.ec73261654e4ce9540ac.js', 18922, '$zsub.$zuri.onNewRequest(n)'],
    ['pc-dist/lazy/default-login-startup-main-startup.ec73261654e4ce9540ac.js', 18466, 'L.a.autoOpenConversationById(i,e)'],
    ['pc-dist/lazy/default-login-startup-main-startup.ec73261654e4ce9540ac.js', 18950, '$zsub.$zuri.onRequestOpenConv(s)'],
    // §3.1 / §7.6 preload namespaces
    ['main-dist/compact-app-preload.js', 72851, '$inaccessibleDrive'],
    ['main-dist/compact-app-preload.js', 1164302, '$migration'],
    // §7.7 / §3 webPreferences blocks
    [MAIN, 311443, 'function(e,t,n){const r=n("Qs2e")'],
    [COMPACT, 941546, 'launchCompactApp(e,t,n){const o=Object(d.a)()'],
    [COMPACT, 2020730, 'launchCompactApp(e,t,n),o=e=>r.default.getRelaunchState(e)'],
    [MAIN, 1077098, 'webSecurity:!0,devTools:!1},useContentSize:!0,width:800'],
    [MAIN, 3110359, 'webSecurity:!0,devTools:!1},useContentSize:!0,width:1250'],
    [MAIN, 1194719, 'allowRunningInsecureContent:!1,webgl:!0,devTools:!1,partition:'],
    [MAIN, 2218293, ' d=!1,u=!d,p=n("oyvS")'],
    [MAIN, 2696852, 'webSecurity:!oe(),allowRunningInsecureContent:oe(),devTools:!0'],
    [MAIN, 2711202, 'z-uri-open-conv",{term:t[1],data:e}):(Qe=e,Ze=t[1])'],
    [MAIN, 2726412, 'isDev:f}=n("ZQzv"),m=!1,_=352'],
    [MAIN, 4154303, 'allowRunningInsecureContent:!1,webgl:!0,devTools:!0,partition:'],
  ];
  for (const [rel, off, needle] of CASES) {
    const s = t(rel);
    const ok = s.startsWith(needle, off);
    claim(`${path.basename(rel).slice(0, 28)} @${off}`, ok, ok ? JSON.stringify(needle) : `got ${JSON.stringify(s.slice(off, off + needle.length))}`);
  }
}
