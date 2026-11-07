const fs = require('fs');
const base = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const css = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.css', 'utf8');
const js = fs.readFileSync(base + 'compact-app-pc.f32c58b63b6f4273a8a4.js', 'latin1');
const out = [];
const log = (...a) => { const l = a.map(String).join(' '); out.push(l); console.log(l); };

// ---------- 1. class names present in the stylesheet
const cssClasses = new Map();
for (const m of css.matchAll(/\.([A-Za-z][A-Za-z0-9_-]{1,60})/g)) {
  cssClasses.set(m[1], (cssClasses.get(m[1]) || 0) + 1);
}
log(`css distinct class selectors = ${cssClasses.size}`);

// ---------- 2. className literals in the bundle
const jsClasses = new Map();
for (const m of js.matchAll(/className\s*:\s*"([^"]{1,200})"/g)) {
  for (const c of m[1].split(/\s+/)) if (c) jsClasses.set(c, (jsClasses.get(c) || 0) + 1);
}
for (const m of js.matchAll(/className\s*=\s*"([^"]{1,200})"/g)) {
  for (const c of m[1].split(/\s+/)) if (c) jsClasses.set(c, (jsClasses.get(c) || 0) + 1);
}
log(`js distinct className tokens = ${jsClasses.size}`);
const both = [...jsClasses.keys()].filter((c) => cssClasses.has(c));
log(`js classes that also appear in CSS = ${both.length}`);

// ---------- 3. candidate surface prefixes grounded in BOTH
const SURFACE_PREFIXES = [
  'sidebar', 'nav', 'leftmenu', 'left-menu', 'leftpanel', 'left-panel',
  'conversation', 'conv-', 'chat-', 'message', 'msg-', 'bubble',
  'composer', 'input-', 'editor', 'typing',
  'dialog', 'modal', 'popup', 'menu-', 'context-menu', 'dropdown',
  'setting', 'titlebar', 'title-bar', 'header',
];
function surfaceOf(c) {
  for (const p of SURFACE_PREFIXES) if (c.startsWith(p) || c.includes(p)) return p;
  return null;
}
const bySurface = {};
for (const [c, n] of jsClasses) {
  if (!cssClasses.has(c)) continue;
  const s = surfaceOf(c);
  if (!s) continue;
  (bySurface[s] ||= []).push({ cls: c, js: n, css: cssClasses.get(c) });
}
log('\n=== classes grounded in BOTH js className literals and CSS selectors ===');
for (const [s, arr] of Object.entries(bySurface).sort((a, b) => b[1].length - a[1].length)) {
  log(`\n## ${s} (${arr.length})`);
  log('  ' + arr.sort((a, b) => b.css - a.css).slice(0, 40).map((x) => `${x.cls}(css=${x.css},js=${x.js})`).join(' '));
}

// ---------- 4. tokens used per top-level surface selector
function ruleSpansFor(pred) {
  const res = [];
  let i = 0;
  const n = css.length;
  while (i < n) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const sel = css.slice(i, open);
    let d = 0, j = open;
    for (; j < n; j++) {
      if (css[j] === '{') d++;
      else if (css[j] === '}') { d--; if (d === 0) break; }
    }
    let own = '', dd = 0;
    for (let k = open + 1; k < j; k++) {
      const ch = css[k];
      if (ch === '{') dd++;
      if (ch === '}') dd--;
      if (dd === 0) own += ch;
    }
    if (pred(sel.trim())) res.push({ sel: sel.trim(), own });
    i = j + 1;
  }
  return res;
}

const PROBES = {
  'sidebar / left menu': /\.sidebar|leftmenu|left-menu|leftpanel|left-panel/,
  'conversation list': /\.conv-|conversation-item|\.chat-item|ConvItem/i,
  'chat header': /\.chat-header|header-chat|chathead/i,
  'message bubble': /\.msg-|\.message-|bubble|chat-message/i,
  'composer / input': /\.chat-input|composer|\.input-chat|editor-chat/i,
  'dialog / modal': /\.z-modal|\.modal-|\.dialog-|z-dialog/i,
  'context menu / popup': /\.contextmenu|context-menu|\.z-context|popover/i,
};

log('\n=== tokens referenced by surface selectors ===');
for (const [label, re] of Object.entries(PROBES)) {
  const rs = ruleSpansFor((s) => re.test(s));
  const toks = new Map();
  for (const r of rs) for (const m of r.own.matchAll(/var\((--[A-Za-z0-9_-]+)/g)) toks.set(m[1], (toks.get(m[1]) || 0) + 1);
  log(`\n## ${label}: rules=${rs.length} distinct-var-refs=${toks.size}`);
  log('  selectors: ' + rs.slice(0, 8).map((r) => r.sel.slice(0, 90)).join(' | '));
  log('  tokens: ' + [...toks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map((e) => `${e[0]}x${e[1]}`).join(' '));
}

fs.writeFileSync('D:/Zalo/reports/_r3_classes.txt', out.join('\n'), 'utf8');
fs.writeFileSync('D:/Zalo/reports/_r3_classes.json', JSON.stringify({
  cssClassCount: cssClasses.size, jsClassCount: jsClasses.size,
  grounded: both.length, bySurface,
}, null, 1), 'utf8');
