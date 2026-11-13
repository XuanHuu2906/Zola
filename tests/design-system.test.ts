import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  avatarVariant, bubbleVariant, conversationVariant, deliveryLabel, deliveryVariant, directionToClass,
  filterChipVariant, matchVariant, messageRowVariant, pressedVariant, railButtonVariant, reactionVariant, toggleVariant,
} from '../src/design-system/variants.ts';
import { wallpaperFor } from '../src/design-system/wallpaper.ts';
import { deriveBoundaryState } from '../src/components/error-boundary-state.ts';

const tokens = fs.readFileSync(path.join('src', 'design-system', 'tokens.css'), 'utf8');
const globals = fs.readFileSync(path.join('src', 'design-system', 'globals.css'), 'utf8');

test('layer boundaries hold against resolved import paths, not specifier text', () => {
  // Resolve import paths rather than matching relative specifier text.
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
    .flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
  const files = walk('src').filter(file => /\.(ts|tsx)$/.test(file)).map(file => file.split(path.sep).join('/'));

  const violations: string[] = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      if (!specifier.startsWith('.')) continue;
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      const line = source.slice(0, match.index).split('\n').length;
      const crosses =
        (file.startsWith('src/design-system/') && !resolved.startsWith('src/design-system/')) ||
        (file.startsWith('src/components/') && !resolved.startsWith('src/components/') && !resolved.startsWith('src/design-system/')) ||
        (file.startsWith('src/renderer/') && resolved.startsWith('electron/'));
      if (crosses) violations.push(`${file}:${line} -> ${resolved}`);
    }
  }
  assert.deepEqual(violations, [], 'cross-layer imports must not compile (GLASS_DESIGN_SYSTEM.md §1)');
});

test('no mock adapter or demo composition source remains in the live-only app', () => {
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
    .flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
  const files = walk('src').map(file => file.split(path.sep).join('/'));
  assert.ok(!files.some(file => /(?:^|\/)(?:demo|seed|mock)\.(?:ts|tsx)$/.test(file)));
  assert.ok(!files.some(file => /(?:^|\/)(?:services|transport|composition)\//.test(file)));
});

test('every variant map resolves both states to distinct, complete class strings', () => {
  const maps = { avatarSize: null, messageRowVariant, toggleVariant, pressedVariant, reactionVariant,
    matchVariant, bubbleVariant, railButtonVariant, filterChipVariant, conversationVariant };
  // Số trạng thái khai tường minh thay vì luôn là 2: bong bóng có ba loại nội
  // dung (chữ, tệp, phương tiện) và gộp chúng lại sẽ bỏ mất kiểu bố cục riêng
  // của ảnh. Vẫn kiểm đủ và không trùng nhau — đó mới là điều test này bảo vệ.
  const arity: Record<string, number> = { bubbleVariant: 3 };
  for (const [name, map] of Object.entries(maps)) {
    if (!map) continue;
    const values = Object.values(map as Record<string, string>);
    const expected = arity[name] ?? 2;
    assert.equal(values.length, expected, `${name} must cover exactly ${expected} states`);
    assert.equal(new Set(values).size, expected, `${name} states must not collapse to one string`);
    for (const value of values) assert.equal(value, value.trim(), `${name} has stray whitespace`);
  }
});

test('class maps carry no empty-string gaps except the intentional idle no-ops', () => {
  assert.equal(pressedVariant.idle, '');
  assert.equal(matchVariant.plain, 'bubble-copy');
  for (const value of Object.values(messageRowVariant)) assert.ok(value.startsWith('message-row'));
  for (const value of Object.values(reactionVariant)) assert.ok(value.startsWith('reaction'));
  for (const value of Object.values(toggleVariant)) assert.ok(value.startsWith('toggle'));
});

test('delivery is a three-state map that keeps its own ARIA labels', () => {
  const states = Object.keys(deliveryVariant) as Array<keyof typeof deliveryVariant>;
  assert.deepEqual(states.sort(), ['failed', 'pending', 'sent']);
  assert.equal(new Set(Object.values(deliveryVariant)).size, 3, 'delivery states must not collapse');
  assert.equal(new Set(Object.values(deliveryLabel)).size, 3, 'delivery labels must be distinguishable');
  for (const state of states) {
    assert.ok(deliveryVariant[state].startsWith('delivery'), `${state} must stay on the delivery class`);
    assert.ok(deliveryLabel[state].trim().length > 0, `${state} needs a spoken label`);
  }
  assert.match(globals, /\.delivery-failed \{[^}]*var\(--danger\)/, 'failure must use the danger token');
});

test('direction mapping never treats the sender as a layout class', () => {
  assert.equal(directionToClass('me'), 'outgoing');
  assert.equal(directionToClass('them'), 'incoming');
  assert.equal(messageRowVariant[directionToClass('me')], 'message-row outgoing');
  assert.equal(messageRowVariant[directionToClass('them')], 'message-row incoming');
});

test('avatar variants always emit exactly one size token and one art fallback', () => {
  assert.equal(avatarVariant('minh-anh', 'regular', true), 'avatar avatar-minh-anh regular');
  assert.equal(avatarVariant('zalo', 'tiny', false), 'avatar avatar-zalo tiny avatar-art');
  for (const size of ['regular', 'large', 'tiny'] as const) {
    const value = avatarVariant('du-an', size, false);
    assert.equal(value.split(' ').filter(part => part === size).length, 1);
    assert.ok(value.endsWith(' avatar-art'));
  }
});

test('wallpaper is a typed tone map keyed on chat kind, not on a CSS variable', () => {
  const chats = [{ isGroup: false }, { isGroup: true }];
  assert.equal(wallpaperFor(chats[0]).tone, 'dusk');
  assert.equal(wallpaperFor(chats[1]).tone, 'mint');
  for (const chat of chats) {
    const source = wallpaperFor(chat);
    assert.ok(source.gradient.startsWith('linear-gradient('));
    assert.ok(!source.gradient.includes('var('), 'wallpaper must be a concrete owned value');
  }
});

test('glass token ladder declares one fill, blur and shadow per tier', () => {
  for (const tier of ['shell', 'pane', 'raised', 'control', 'input', 'selected', 'active', 'pill', 'chip', 'floating', 'dialog', 'toast', 'scrim']) {
    assert.match(tokens, new RegExp(`--glass-fill-${tier}:`), `missing fill for ${tier}`);
  }
  for (const tier of ['shell', 'dialog', 'floating', 'toast', 'scrim', 'pill']) {
    assert.match(tokens, new RegExp(`--blur-${tier}:`), `missing blur for ${tier}`);
  }
  for (const tier of ['shell', 'dialog', 'floating', 'bubble', 'bubble-out', 'control']) {
    assert.match(tokens, new RegExp(`--shadow-${tier}:`), `missing shadow for ${tier}`);
  }
});

test('typography, spacing and motion live on the ladder, not in the stylesheet', () => {
  for (const family of ['--type-', '--leading-', '--space-', '--duration-', '--ease-']) {
    assert.match(tokens, new RegExp(`${family}[a-z0-9-]+:`), `missing ${family}* family`);
  }
  // Every font-size must read a type token; a raw px size means a role was skipped.
  const rawSizes = globals.match(/font-size:\s*[0-9.]+px/g) ?? [];
  assert.deepEqual(rawSizes, [], 'font-size must come from --type-*');
  const rawLeading = globals.match(/line-height:\s*[0-9.]+(?!px)/g) ?? [];
  assert.deepEqual(rawLeading, [], 'line-height must come from --leading-*');
  // Spacing: any px length that matches a declared step must use that step.
  const stepValues = new Set([...tokens.matchAll(/--space-\d+:\s*([0-9.]+)px/g)].map(m => m[1]));
  const props = 'padding|margin|gap|margin-top|margin-bottom|padding-top|padding-bottom';
  for (const match of globals.matchAll(new RegExp(`(?:^|[;{ ])(?:${props}):([^;}]*)`, 'gm'))) {
    for (const token of match[1].trim().split(/\s+/)) {
      const px = /^([0-9.]+)px$/.exec(token);
      assert.ok(!px || !stepValues.has(px[1]), `off-ladder literal ${token} should use var(--space-*)`);
    }
  }
  // Motion: no hard-coded duration or easing outside the ladder.
  assert.doesNotMatch(globals, /transition:[^;}]*[0-9.]+m?s\b[^;}]*/g, 'transition must use --duration-*');
});

test('type roles cover every size the stylesheet actually needs', () => {
  const declared = new Set([...tokens.matchAll(/--type-[a-z-]+:\s*([0-9.]+px)/g)].map(m => m[1]));
  const used = new Set([...globals.matchAll(/var\(--type-([a-z-]+)\)/g)].map(m => m[1]));
  for (const role of used) assert.match(tokens, new RegExp(`--type-${role}:`), `used but undeclared: ${role}`);
  assert.equal(declared.size, 19, 'the shipped scale has 19 distinct sizes; keep the count honest');
});

test('border family exists in both themes and is not borrowed from Zalo', () => {
  const dark = tokens.slice(0, tokens.indexOf(':root[data-theme="light"]'));
  const light = tokens.slice(tokens.indexOf(':root[data-theme="light"]'));
  for (const name of ['--border:', '--border-subtle:', '--divider:', '--border-focus:']) {
    assert.ok(dark.includes(name), `dark theme missing ${name}`);
  }
  for (const name of ['--border:', '--border-subtle:', '--divider:', '--border-focus:']) {
    assert.ok(light.includes(name), `light theme missing ${name}`);
  }
  assert.ok(!tokens.includes('--line:'), 'legacy --line token must be fully retired');
});

test('components read glass values only through tokens', () => {
  // The @supports header itself names backdrop-filter as a feature test, not a value.
  const declarations = globals.replace(/@supports not \(\(backdrop-filter[^{]*\{/g, '');
  const backdropFilters = declarations.match(/(?:^|[\s;])(?:-webkit-)?backdrop-filter: ?[^;}]*/gm) ?? [];
  assert.ok(backdropFilters.length >= 8, 'expected a real multi-tier glass ladder');
  for (const raw of backdropFilters) {
    const declaration = raw.trim();
    if (/blur\(4px\)/.test(declaration)) continue; // the low-blur degradation step
    if (/backdrop-filter: ?none/.test(declaration)) continue; // scrim blur switched off
    assert.match(declaration, /blur\(var\(--blur-/, `hard-coded backdrop blur: ${declaration}`);
  }
  const forbidden = [
    /rgba\(22,39,84/, /rgba\(25,49,91/, /rgba\(80,119,181/, /rgba\(182,211,255/,
    /rgba\(218,235,255/, /rgba\(222,238,255/, /rgba\(221,237,255/, /rgba\(237,247,255/,
    /rgba\(225,242,255/, /rgba\(231,245,255/,
  ];
  for (const pattern of forbidden) assert.doesNotMatch(globals, pattern, `raw glass literal survived: ${pattern}`);
  assert.match(globals, /background: ?var\(--glass-fill-dialog\)/);
});

test('action colours are tokens, and their override sets stay honest', () => {
  assert.match(globals, /\.toggle\.on \{[^}]*background:var\(--switch-on\)/);
  assert.match(globals, /\.close-window:hover \{[^}]*background:var\(--danger-window\)/);
  for (const literal of ['#298cff', '#c42b35']) {
    assert.ok(!globals.includes(literal), `${literal} must not survive in the stylesheet`);
  }
  // The light theme redefines --accent, so --switch-on must not alias it; a silent
  // alias would repaint the light-theme toggle. Assert it is its own literal.
  const dark = tokens.slice(0, tokens.indexOf(':root[data-theme="light"]'));
  const light = tokens.slice(tokens.indexOf(':root[data-theme="light"]'));
  for (const name of ['--switch-on', '--danger-window']) {
    assert.match(dark, new RegExp(`${name}:\\s*#[0-9a-f]{6}`), `${name} must be declared in the dark root`);
    assert.ok(!light.includes(`${name}:`), `${name} must not be overridden per theme`);
  }
});

test('degradation covers every blurred tier in one switch', () => {
  const block = globals.slice(globals.indexOf('.low-blur .window-shell'));
  for (const selector of ['.window-shell', '.settings-modal', '.context-menu', '#toast', '.day-label']) {
    assert.ok(block.includes(selector), `low-blur must include ${selector}`);
  }
  const fallback = globals.slice(globals.indexOf('@supports not ((backdrop-filter'));
  for (const selector of ['.window-shell', '.context-menu', '.settings-modal', '#toast', '.day-label']) {
    assert.ok(fallback.includes(selector), `no-backdrop-filter fallback must include ${selector}`);
  }
});

test('glass is never nested in a containing block or transform layer', () => {
  const wallpaper = globals.slice(globals.indexOf('.chat-wallpaper {'), globals.indexOf('.messages {'));
  assert.ok(!/contain:/.test(wallpaper), 'wallpaper must not set contain');
  assert.ok(!/transform:/.test(wallpaper), 'wallpaper must not create a transform layer');
  const shell = globals.slice(globals.indexOf('.window-shell {'), globals.indexOf('.window-shell::before'));
  assert.ok(!/contain:/.test(shell), 'shell must not set contain');
});

test('every glass surface takes its radius from the ladder, including the compact shell', () => {
  for (const tier of ['shell', 'panel', 'card', 'control', 'bubble', 'floating', 'dialog', 'pill']) {
    assert.match(tokens, new RegExp(`--radius-${tier}:`), `missing radius for ${tier}`);
  }
  assert.match(tokens, /--radius-shell-compact:/, 'compact shell radius must live on the ladder');
  const rules: Array<[string, string]> = [
    ['.window-shell {', '--radius-shell'],
    ['.context-menu {', '--radius-floating'],
    ['.settings-modal {', '--radius-dialog'],
    ['.conversation {', '--radius-card'],
    ['.icon-button {', '--radius-control'],
    ['.day-label {', '--radius-pill'],
  ];
  for (const [selector, token] of rules) {
    const start = globals.indexOf(selector);
    assert.ok(start >= 0, `missing rule ${selector}`);
    const rule = globals.slice(start, globals.indexOf('}', start));
    assert.ok(rule.includes(`var(${token})`), `${selector} must use ${token}`);
  }
  const compact = globals.slice(globals.indexOf('@media (max-width:900px)'));
  assert.ok(compact.includes('border-radius:var(--radius-shell-compact)'), 'compact shell must not hard-code a radius');
});

test('the date pill keeps the shipped glass idiom: translucent fill plus its own blur', () => {
  const rule = globals.slice(globals.indexOf('.day-label {'), globals.indexOf('.message-row'));
  assert.match(rule, /background:var\(--glass-fill-pill\)/);
  assert.match(rule, /backdrop-filter:blur\(var\(--blur-pill\)\)/);
});

test('the glass primitives every screen shares are styled, not inert class names', () => {
  assert.match(globals, /\.glass-dialog,? ?\.settings-modal \{[^}]*var\(--radius-dialog\)/, 'glass-dialog must inherit the dialog shell');
  const card = globals.slice(globals.indexOf('.glass-card {'), globals.indexOf('}', globals.indexOf('.glass-card {')));
  assert.match(card, /background:var\(--glass-fill-raised\)/);
  assert.match(card, /border-radius:var\(--radius-card\)/);
  assert.match(card, /box-shadow:var\(--shadow-control\)/);
});

test('live information screen states its source and keeps network access in the main process', () => {
  const source = fs.readFileSync(path.join('src', 'renderer', 'components', 'LiveOverlays', 'screens.tsx'), 'utf8');
  for (const surface of ['info-modal', 'profile-modal']) assert.ok(globals.includes(`.${surface}`));
  assert.match(source, /Dữ liệu từ tài khoản Zalo đang đăng nhập/);
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|WebSocket/);
});

test('overlay CSS stays inside the token system', () => {
  const start = globals.indexOf('/* Secondary screens share the dialog tier');
  const block = globals.slice(start, globals.indexOf('.reduced-motion *', start));
  assert.ok(start >= 0 && block.length > 500, 'overlay block must exist');
  // Both spellings count: a hex literal slipped past a rgba-only check once.
  const literals = block.match(/rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}\b/g) ?? [];
  assert.deepEqual(literals, [], 'overlay rules must not introduce raw colour literals');
});

test('ErrorBoundary chỉ reset khi resetKey đổi, và "Thử lại" giữ nguyên khoá', () => {
  const boom = new Error('hỏng khi vẽ');
  const failure = { error: boom, seenResetKey: 'chats:u-1:live' };
  // Cùng khoá: giữ lỗi, nếu không mỗi lần render lại sẽ nuốt mất lỗi vừa bắt.
  assert.equal(deriveBoundaryState('chats:u-1:live', failure), null);
  // Đổi hội thoại: reset — lỗi của một hội thoại không được khoá các hội thoại khác.
  assert.deepEqual(deriveBoundaryState('chats:u-2:live', failure),
    { error: null, seenResetKey: 'chats:u-2:live' });
  // Bấm "Thử lại" gọi `setState({error:null})` trực tiếp và **không** đụng
  // `seenResetKey`; nếu không lần render ngay sau đó sẽ reset lần nữa và nút bấm
  // không có tác dụng gì.
  assert.equal(deriveBoundaryState('chats:u-1:live', { error: null, seenResetKey: 'chats:u-1:live' }), null);
});
