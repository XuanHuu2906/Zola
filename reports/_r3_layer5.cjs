const fs = require('fs');
const dir = 'C:/Users/huung/AppData/Local/Temp/rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6/pc-dist/';
const css = fs.readFileSync(dir + 'compact-app-pc.f32c58b63b6f4273a8a4.css', 'latin1');
const out = [];
const log = (...a) => out.push(a.map(String).join(' '));
const R = [];
(function () {
  let i = 0;
  while (i < css.length) {
    const o = css.indexOf('{', i); if (o < 0) break;
    const c = css.indexOf('}', o); if (c < 0) break;
    const sel = css.slice(i, o).trim();
    if (sel && !sel.startsWith('@')) R.push({ at: i, sel, body: css.slice(o + 1, c) });
    i = c + 1; while (i < css.length && /[\s;]/.test(css[i])) i++;
  }
})();

function base(label, re, cap) {
  log(`\n### ${label}`);
  let n = 0;
  for (const r of R) {
    const ps = r.sel.split(',').map(s => s.trim());
    const hit = ps.filter(p => re.test(p) && p.split(/[\s>+~]/).length <= 3);
    if (!hit.length) continue;
    log(`  @${r.at} ${hit[0]}   (parts=${ps.length})`);
    log(`      ${r.body.slice(0, 300)}`);
    if (++n >= cap) break;
  }
  if (!n) log('  (none)');
}

base('html / body', /^(html|body)(\.[A-Za-z0-9_.-]+)?$/, 8);
base('#app', /^#app(\.[A-Za-z0-9_-]+)*$/, 5);
base('.main', /^\.main(\.[A-Za-z0-9_-]+)*$/, 8);
base('.main__center', /^\.main__center$/, 4);
base('.content-message-container', /^\.content-message-container$/, 4);
base('.chat-message plain', /^\.chat-message$/, 4);
base('.message-box', /^\.message-box(\.[A-Za-z0-9_-]+)*$/, 5);
base('.message-view__scroll', /^\.message-view__scroll(\.[A-Za-z0-9_-]+)*$/, 5);
base('.message-view__scroll__inner', /^\.message-view__scroll__inner(\.[A-Za-z0-9_-]+)*$/, 4);

log('\n\n=== any rule painting a page-level background on body/html/#app/.main ===');
for (const r of R) {
  const ps = r.sel.split(',').map(s => s.trim());
  if (!ps.some(p => /^(html|body|#app|\.main)([.#:][\w-]+)*$/.test(p))) continue;
  const m = r.body.match(/background[a-z-]*\s*:[^;]*/g);
  if (!m) continue;
  log(`  @${r.at} ${r.sel.slice(0, 130)} => ${m.join(' | ').slice(0, 220)}`);
}

log('\n\n=== .dist-wallpaper / wallpaper / cover-image / --chat-background tokens ===');
for (const t of ['--chat-background', '--conversation-background', '--cover-image', '--wallpaper', '--chat-bg', '--layer-background', '--layer-background-subtle', '--layer-background-hover', '--layer-background-selected', '--title-bar']) {
  const re = new RegExp('(^|[;{])' + t + ':([^;}]+)', 'g');
  const hits = [...css.matchAll(re)].slice(0, 4).map(m => m[2].trim());
  log(`  ${t} => ${JSON.stringify(hits)}`);
}

fs.writeFileSync('D:/Zalo/reports/_r3_layer5.txt', out.join('\n'));
console.log('done ' + out.length);
