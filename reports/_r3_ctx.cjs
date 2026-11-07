// R3: quotable render context for each surface + state-layer detection + boundary facts.
const fs = require('fs');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const css = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.css', 'latin1');
const LOG = 'D:/Zalo/reports/_r3_ctx.txt';
fs.writeFileSync(LOG, '');
const log = (...a) => { const l = a.map(String).join(' '); console.log(l); fs.appendFileSync(LOG, l + '\n'); };

const SHOW = 260;
function ctx(off, needle) {
  const at = js.indexOf(needle, off);
  if (at < 0) return 'NOT FOUND after ' + off;
  return JSON.stringify(js.slice(Math.max(0, at - SHOW), at + needle.length + SHOW));
}

log('=== render context around primary surface hit ===');
const SURF = [
  ['titlebar', 19646837, 'titlebar__btns'],
  ['nav add-friend btn', 12500752, 'nav-button_add_friend'],
  ['conv-item', 12415122, 'conv-item '],
  ['contact-search', 12281665, 'contact-search'],
  ['threadChat__title', 3813388, 'threadChat__title '],
  ['threadChat__avatar', 3813275, 'threadChat__avatar'],
  ['chat-message row', 115311, 'chat-message '],
  ['content-message-container', 0, 'content-message-container'],
  ['chat-date', 225046, 'chat-date'],
  ['chat-input-container', 6543073, 'chat-input-container'],
  ['chat-box-input', 6590721, 'chat-box-input'],
  ['chat-box-input__tools__btn', 5563239, 'chat-box-input__tools__btn'],
  ['zmenu-item', 174239, 'zmenu-item'],
  ['zmenu-body', 7341341, 'zmenu-body'],
  ['zl-modal', 3368481, 'zl-modal'],
  ['zl-modal__dialog-body', 1259670, 'zl-modal__dialog-body'],
  ['setting-section-content__item', 8083647, 'setting-section-content__item'],
  ['sidebar-icon', 12360050, 'sidebar-icon'],
];
for (const [name, off, needle] of SURF) {
  log(`\n## ${name}`);
  log('   ' + ctx(off, needle));
}

// --- state layer detection
log('\n=== state-layer signals (whole bundle, occurrence counts) ===');
const SIGS = [
  ['createStore(', 0], ['configureStore(', 0], ['useSelector', 0], ['useDispatch', 0],
  ['createSlice', 0], ['redux', 0], ['zustand', 0], ['createContext', 0],
  ['useContext(', 0], ['useReducer', 0], ['useState(', 0], ['mobx', 0],
  ['Provider', 0], ['store.dispatch', 0], ['observe(', 0], ['proxy(', 0],
  ['useSyncExternalStore', 0], ['React.createElement', 0], ['_jsx(', 0], ['jsxRuntime', 0],
];
for (const [s] of SIGS) {
  let n = 0, p = 0;
  while ((p = js.indexOf(s, p)) >= 0) { n++; p += s.length; }
  log(`  ${s.padEnd(24)} ${n}`);
}

// --- react root / app shell
log('\n=== app shell anchors ===');
for (const s of ['#root', 'rootId', 'id="root"', 'getElementById("root")', 'titleBar', 'titlebar-os', 'convList', 'chatArea']) {
  let n = 0, p = 0, first = -1;
  while ((p = js.indexOf(s, p)) >= 0) { if (first < 0) first = p; n++; p += s.length; }
  log(`  ${JSON.stringify(s).padEnd(26)} occ=${String(n).padStart(4)} firstAt=${first}`);
}

// --- css: does chat-date really own backdrop-filter (quoted) / who else
log('\n=== every rule containing backdrop-filter (selector + tail of body) ===');
{
  let i = 0;
  while (i < css.length) {
    const o = css.indexOf('{', i); if (o < 0) break;
    const c = css.indexOf('}', o); if (c < 0) break;
    const sel = css.slice(i, o).trim();
    const body = css.slice(o + 1, c);
    if (/backdrop-filter/.test(body)) {
      const bf = /backdrop-filter\s*:\s*([^;}]+)/.exec(body);
      log(`  @${o}  ${sel.slice(0, 150)}`);
      log(`        backdrop-filter: ${bf && bf[1]}`);
    }
    i = c + 1; while (i < css.length && /[\s;]/.test(css[i])) i++;
  }
}

// --- .custom / theme hooks reachable from these surfaces?
log('\n=== theme-hook signals in js ===');
for (const s of ['app-custom-theme', 'CUSTOM', 'custom-theme', 'setBackgroundColor', 'updateThemeConfig', 'classList.add', 'classList.remove', 'documentElement']) {
  let n = 0, p = 0, first = -1;
  while ((p = js.indexOf(s, p)) >= 0) { if (first < 0) first = p; n++; p += s.length; }
  log(`  ${JSON.stringify(s).padEnd(28)} occ=${String(n).padStart(4)} firstAt=${first}`);
}
log('\nwrote _r3_ctx.txt');
