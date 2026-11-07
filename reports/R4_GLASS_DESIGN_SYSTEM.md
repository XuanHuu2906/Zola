# R4 — Apple Glass Design System (implemented)

**Target of the study:** Zalo PC `26.10.20.3253` (VNG GROUP JSC, signed) — Electron `22.3.9` / Chromium `108.0.5359.215`
**Artifact studied in R1–R3:** `app.asar` 177,728,582 B, SHA-256 `d83256230e5d1d4483c2411f71936c3dc1562fb8a885fd8752cab17d229201e6`
**Deliverable:** the independent prototype `zalo-apple-glass-ui@0.3.0` in `D:\Zalo` (Electron `45.2.3`, React `19.2.6`, Vite `8.3.5`, Tailwind CSS `4.2.2`, Zustand `5.0.8`, Motion `12.23.24`, TypeScript `5.9.3`).
**RE tool:** REA only (no other RE tool was used at any point in R1–R4).

> **Boundary.** This report documents a *from-scratch* design system. No Zalo source, asset, theme file, or third-party Zalo customisation project (ZaDark or otherwise) contributed code or values to it. Zalo's findings are used as *constraints and naming references*, never as a value source — exactly as R2 §8.2 required.

---

## 0. Verdict in one paragraph

R4 is **implemented and verified**: the prototype now expresses its entire glass appearance as a **65-token contract** (with 24 light-theme overrides), and of the **17 `backdrop-filter` declarations** in the stylesheet **13 are live glass rules reading `blur(var(--blur-*))`** — the other four are the two low-blur degradation steps and the two scrim-off rules. All six R3 §12 design constraints are satisfied by a named file and a named test. Three gates pass on the current tree: `npm run check` (**28/28** node tests, typecheck + lint clean), `npm run build` (`344.55 kB` JS / `37.19 kB` CSS), `npm run test:e2e` (**14/14** Playwright tests). Contrast is evidenced at **128 sampled rows** in the default state (0 failures, worst **5.33:1** against a 4.5:1 floor) and at **512 sampled rows** across the glass-endpoint sweep `{15%,95%} × {low-blur, normal} × {settings, chat} × {dark, light}` (0 failures, worst **4.96:1**). axe reports **0 violations** in all four theme/state combinations. The legacy files (`src/app.js`, `src/logic.js`, `src/icons.js`, `src/styles.css`) are byte-identical to their recorded hashes. **This is not, and does not claim to be, a Zalo theme.** Whether any of it can legally and technically reach the shipped Zalo client is R5's question, and R5's default is NO-GO.

---

## 1. Scope and the inputs that shaped it

R4's only inputs were the three approved reports plus the approved reference image:

| Input | What R4 took from it |
|---|---|
| **R2 §8.1** Build glass from zero | No `backdrop-filter`, no semi-transparent fill, no glass-border token exists on any Zalo core surface. R4 authored all three. |
| **R2 §8.2** Vocabulary, not values | Token *names* follow Zalo's proven spine (`text`, `muted`, `border`, `divider`, `pane`, `selected`, `bubble`); **no Zalo value was copied**. |
| **R2 §8.3** Borders are not themeable in Zalo | Border/divider/hairline is a **first-class 11-token family** in both themes (the gap R2 identified). |
| **R2 §8.4** `.custom` means nothing | R4 defines its own complete theme contract; nothing depends on a Zalo custom-theme hook. |
| **R2 §8.5** Two layers of truth | Every value in this report is an R4-authored value. No Zalo CSS value or `TOKEN_MAP` value is quoted as a design input. |
| **R3 §12.1** Model the layer stack | Glass is **one composited layer per surface**, declared once in `globals.css`; the app never stacks three opaque fills. |
| **R3 §12.2** Adopt the date-pill idiom | `.day-label` is now exactly the shipped idiom: translucent fill + its own `blur(var(--blur-pill))` + radius. |
| **R3 §12.3** Never build glass under `contain`/`translateZ(0)` | `globals.css` contains **zero** `contain:` declarations and **zero** `translateZ`; `.chat-wallpaper` and `.window-shell` carry neither `contain` nor `transform`. Asserted by test #10. |
| **R3 §12.4** Typed variant map, not string concatenation | 9 `Record<State, string>` maps + 1 function in `src/renderer/ui/variants.ts`; five components rewired to consume them. |
| **R3 §12.5** `--curtain` is already what glass wants | R4 keeps the *concept* (a dark scrim behind floating layers) but deliberately uses an authored **tinted** `--backdrop: rgba(15,32,75,.45)` instead of Zalo's neutral `rgba(0,0,0,.6)`, because the R4 palette is blue-based. **Deviation, recorded on purpose** — the ratio is not copied, only the role. |
| **R3 §12.6** Wallpaper is data, not CSS | `ChatWallpaper.tsx` + pure `wallpaper.ts` own the wallpaper as a typed tone source. |
| **Reference image** (`assets/approved-reference.jpg`) | Light and dark glass, rounded shell, translucent rail/pane, soft raised surfaces. |

---

## 2. The token contract — `src/renderer/styles/tokens.css` (~120 lines)

The file is the whole design system. It declares **65 tokens** on `:root` (dark, `color-scheme: dark`) and **24 overrides** under `:root[data-theme="light"]`. Every light-theme override redefines an existing dark token — **there are zero light-only tokens**, so no selector can depend on a token that exists in one theme and not the other.

### 2.1 Families

| Family | Count | Tokens |
|---|---:|---|
| **Border / divider / hairline** (R2 §8.3) | **11** | `--border`, `--border-subtle`, `--divider`, `--border-shell`, `--border-dialog`, `--border-floating`, `--border-bubble`, `--border-bubble-out`, `--border-control`, `--border-rail`, `--border-focus` |
| **Glass fill ladder** | **13** | `--glass-fill-{shell,pane,raised,control,input,selected,active,pill,chip,floating,dialog,toast,scrim}` |
| **Blur ladder** | **6** | `--blur-{shell,dialog,floating,toast,scrim,pill}` |
| **Shadow ladder** | **6** | `--shadow-{shell,dialog,floating,bubble,bubble-out,control}` |
| **Radius ladder** | **9** | `--radius-{shell,shell-compact,panel,card,control,bubble,floating,dialog,pill}` |
| **Text** | **3** | `--text`, `--muted`, `--quiet` |
| **Surfaces / accents** | **17** | `--shell`, `--rail`, `--pane`, `--hover`, `--selected`, `--incoming`, `--outgoing`, `--accent`, `--accent-2`, `--deep-shadow`, `--feature-bg`, `--backdrop`, `--saturate-shell`, `--saturate-dialog`, `--wallpaper-scrim`, `--wallpaper-strength`, `--glass-opacity` |

### 2.2 The density scalar

```css
--glass-opacity: .68;   /* 0.15–0.95, written by App.tsx from the stored preference */
--glass-fill-pane:   rgba(182,211,255, calc(var(--glass-opacity)*.08));
--glass-fill-raised: rgba(218,235,255, calc(var(--glass-opacity)*.12));
--glass-fill-control:rgba(222,238,255, calc(var(--glass-opacity)*.20));
--glass-fill-input:  rgba(221,237,255, calc(var(--glass-opacity)*.23));
--glass-fill-selected: rgba(237,247,255, min(.23, calc(var(--glass-opacity)*.31)));
--glass-fill-active: rgba(220,236,255, calc(var(--glass-opacity)*.31));
```

Six of the thirteen fills scale with `--glass-opacity`. The user-facing slider is bounded **15–95** in `src/shared/preferences.ts:10` (`Math.max(15, Math.min(95, p.glass))`), which is exactly the range the contrast sweep covers. The **shell** fill is deliberately *not* scaled — it is the outermost plate and must stay legible at both endpoints, which is why the sweep measures chat text against it. Tiers that are pure chrome (`pill`, `chip`, `floating`, `dialog`, `toast`, `scrim`) are fixed so a user cannot drag the app into an unreadable dialog.

---

## 3. The elevation ladder

Each tier pairs **one translucent fill + one blur + one shadow + one radius**, all token-driven. No tier is defined by a literal anywhere outside `tokens.css`.

| Tier | Fill | Blur | Shadow | Used by |
|---|---|---|---:|---|
| shell | `--glass-fill-shell` (opaque-ish base) | `--blur-shell` 44px + `saturate(150%)` | `--shadow-shell` | `.window-shell` |
| dialog | `--glass-fill-dialog` | `--blur-dialog` 35px + `saturate(160%)` | `--shadow-dialog` | `.settings-modal` |
| floating | `--glass-fill-floating` | `--blur-floating` 24px | `--shadow-floating` | `.context-menu` |
| toast | `--glass-fill-toast` | `--blur-toast` 20px | — | `#toast` |
| scrim | `--glass-fill-scrim` | `--blur-scrim` 12px | — | `.overlay`, `dialog::backdrop` |
| pill | `--glass-fill-pill` | `--blur-pill` 10px | — | `.day-label` (the R3 §12.2 idiom) |
| pane / raised / control / input / selected / active / chip | `--glass-fill-*` | *(inherits the shell's backdrop)* | control → `--shadow-control` | panel, header, search, composer, conversation, rail, filter |
| bubble / bubble-out | `--incoming` / `--outgoing` | — | `--shadow-bubble` / `--shadow-bubble-out` | `.bubble`, `.outgoing .bubble` |

The pane/raised/control/input tiers intentionally carry **no `backdrop-filter` of their own**: they sit inside `.window-shell`, which already composited the backdrop. Adding a second blur there would double-sample the desktop behind the window and is the exact failure mode R3 §12.1 warns about (stacked layers silently defeating a fill).

---

## 4. `globals.css` — every literal converted (314 lines)

The conversion was mechanical and is now enforced by test. Current state:

- **17** `backdrop-filter` / `-webkit-backdrop-filter` declarations, of which **13** are live glass rules reading `blur(var(--blur-*))`; the remaining four are the intentional exceptions: **2** `blur(4px)` low-blur degradation steps and **2** `backdrop-filter:none` scrim-off rules. The `@supports not ((backdrop-filter:blur(1px)) …)` header is a feature test, not a value, and the test strips it before scanning.
- Zero raw glass literals survive. The old `rgba(22,39,84…`, `rgba(25,49,91…`, `rgba(80,119,181…`, `rgba(182,211,255…`, `rgba(218,235,255…`, `rgba(222,238,255…`, `rgba(221,237,255…`, `rgba(237,247,255…`, `rgba(225,242,255…`, `rgba(231,245,255…` are all gone — test #8 fails the build if any returns.
- The redundant bottom-of-file overrides (`:root { --muted }`, `:root[data-theme=light] { --muted }`, `:root:not([data-theme=light]) .conversation.selected`, `:root:not([data-theme=light]) .context-menu`) were deleted; those values now live only in `tokens.css`, so there is one source of truth per value.
- **The legacy `src/styles.css` was not touched** (303 lines, hash unchanged). It still contains its original **88** `rgba(` literals, **2** `--line:` declarations and **6** `backdrop-filter` declarations. It is preserved as the pre-R4 original, which is why the test asserts `--line` is absent from `tokens.css`/`globals.css` (0 occurrences in both) but never from the legacy file.

### 4.1 One defect found during report review (and fixed)

While auditing the ladder for this report, two radius gaps surfaced that the first pass of tests did not catch:

1. **`.window-shell` broke the ladder at ≤900px.** The compact-layout media query set `border-radius:19px` directly, so `--radius-shell` was silently bypassed on small screens — a token that owned the shell everywhere else.
2. **Three ladder tokens were dead.** `--radius-card`, `--radius-control` and `--radius-pill` were declared but never referenced; the surfaces meant to use them (`​.conversation`, `.icon-button`, `.day-label`) carried literals instead. `--radius-floating` and `--radius-dialog` did not exist at all while `.context-menu` and `.settings-modal` hard-coded 16px/26px.

All five surface rules now read their radius from the ladder, the compact shell uses a new `--radius-shell-compact`, and **test #12** asserts the wiring. Every wiring preserved the exact pixel value previously rendered, so the contrast and layout evidence gathered before the fix remains valid. The remaining `border-radius` literals are genuinely non-glass (50% avatars, pill knobs, 3px tick marks) and are left alone deliberately.

### 4.2 New structural rules

```css
.chat-body { position:relative; flex:1; min-height:0; display:flex; flex-direction:column; }
.chat-wallpaper { position:absolute; inset:0; pointer-events:none;
  background-repeat:no-repeat; background-size:cover; background-position:center;
  opacity:var(--wallpaper-strength); }
.chat-wallpaper::after { content:''; position:absolute; inset:0;
  background:var(--wallpaper-scrim); opacity:.55; }
.messages { position:relative; … }
```

The wallpaper is a real plane under the message list, not a CSS background on the scroll container. This keeps it out of the scroll paint path and satisfies R3 §12.3 (no `contain`, no transform on the layer).

---

## 5. Typed variant maps — `src/renderer/ui/variants.ts` (64 lines)

R3 §12.4 established that the shipped Zalo renderer composes its state class from ≥7 booleans, so state-specific glass is unreachable for some combinations. R4 replaces that pattern with a compile-time exhaustive map:

| Map | States | Example |
|---|---|---|
| `messageRowVariant` | `incoming` / `outgoing` | `'message-row incoming'` |
| `toggleVariant` | `on` / `off` | `'toggle on'` |
| `pressedVariant` | `pressed` / `idle` | `'on'` / `''` |
| `reactionVariant` | `reacted` / `empty` | `'reaction reaction-add'` |
| `matchVariant` | `match` / `plain` | `'bubble-copy search-match'` |
| `bubbleVariant` | `text` / `file` | `'bubble bubble-file'` |
| `railButtonVariant` | `selected` / `idle` | `'rail-button is-active'` |
| `filterChipVariant` | `selected` / `idle` | `'filter-chip selected'` |
| `conversationVariant` | `selected` / `idle` | `'conversation selected'` |
| `avatarVariant(id, size, hasImage)` | 3 sizes × art/no-art | `'avatar avatar-zalo tiny avatar-art'` |

`directionToClass('me' | 'them')` is the only place a sender becomes a layout class, so the row never confuses "who sent it" with "which side it renders on".

Five components were rewired to consume these maps. The only surviving conditional is the **map key selection** (`map[cond ? 'a' : 'b']`); no component builds a class string from a boolean any more:

| File | Before | After |
|---|---|---|
| `components/ChatPane/index.tsx` | inline ternaries for row/bubble/reaction/search-match | `messageRowVariant[directionToClass(…)]`, `bubbleVariant[…]`, `reactionVariant[…]`, `matchVariant[isSearchMatch(…) ? 'match' : 'plain']` |
| `components/SettingsDialog/index.tsx` | theme-button and toggle ternaries | `pressedVariant[…]`, `toggleVariant[…]` ×2 |
| `components/NavigationRail/index.tsx` | `[\`rail-button${view===id?' is-active':''}\`]` | `railButtonVariant[view===id?'selected':'idle']` |
| `components/ConversationList/index.tsx` | filter-chip and conversation ternaries | `filterChipVariant[…]`, `conversationVariant[…]` |
| `components/Avatar.tsx` | template-string join | `avatarVariant(chat.id, size, Boolean(chat.avatar))` |

---

## 6. Owned wallpaper — `wallpaper.ts` + `ChatWallpaper.tsx`

R3 §12.6: Zalo's chat wallpaper is an inline style resolved from a `convId`-keyed JS map, which is unreachable from a stylesheet. R4 keeps the shape (a per-chat resolved value rendered as an inline background) but makes the source an explicit typed value:

```ts
export type WallpaperTone = 'dusk' | 'mint' | 'ember' | 'ice';
export interface WallpaperSource { tone: WallpaperTone; gradient: string; }
export function wallpaperFor(chat: Pick<Chat,'isWork'|'isGroup'|'verified'>): WallpaperSource
```

Tone selection is deterministic from chat kind — `isWork → ice`, `isGroup → mint`, `verified → ice`, else `dusk` — so it is unit-testable without React. The logic lives in a `.ts` file precisely because **Node's type stripping executes `.ts` but not `.tsx`**, and the design-system test must import it directly.

`ChatWallpaper.tsx` is a 7-line presentational component that applies the gradient and emits `aria-hidden="true"`; it owns no state and no CSS.

---

## 7. Degradation paths

Glass is progressive enhancement; both failure paths are token-driven and cover **every** blurred tier in one switch (test #9).

**Reduced blur** (`.low-blur`, user toggle `prefs.lowBlur`, `App.tsx:18`):

```css
.low-blur .window-shell, .low-blur .settings-modal, .low-blur .context-menu,
.low-blur #toast, .low-blur .day-label {
  backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px); }
.low-blur dialog::backdrop { backdrop-filter:none; -webkit-backdrop-filter:none; }
```

**No backdrop-filter support** (`@supports not`): every translucent tier falls back to a modelled **opaque** fill, with separate dark and light values — `.window-shell`, `.context-menu`, `.settings-modal`, `#toast`, `.day-label`. Coverage is complete for all five blurred tiers, which is what test #9 asserts; without it the tiers would render as near-invisible translucent panels on a browser that cannot blur.

---

## 8. Traceability matrix

| Requirement | Implementation | Enforcing test |
|---|---|---|
| R2 §8.1 build glass from zero | all 13 fills, 6 blurs, 6 shadows authored in `tokens.css` | #6 ladder-completeness, #11 radius-ladder |
| R2 §8.2 vocabulary not values | names mirror Zalo's spine; values are R4-authored | #7 (`--line` retired) |
| R2 §8.3 borders first-class | 11-token border family in both themes | #7 both-theme border check |
| R2 §8.4 no `.custom` dependency | theme contract lives entirely in `tokens.css` | #8 (no raw literals) |
| R3 §12.1 explicit layer stack | one composited layer per surface; pane tiers carry no second blur | #6, #8 |
| R3 §12.2 date-pill idiom | `.day-label` = fill-pill + `blur(var(--blur-pill))` + `var(--radius-pill)` | **#12** |
| R3 §12.3 no `contain`/`translateZ` | wallpaper and shell carry neither | **#10** |
| R3 §12.4 typed variants | 9 maps + `avatarVariant` + `directionToClass` | **#1–#3** |
| R3 §12.6 wallpaper is data | `wallpaper.ts` typed tone source | **#5** |
| all tiers degrade together | `.low-blur` 5 selectors, `@supports` 5 selectors | **#9** |

---

## 9. Verification evidence

All three gates were re-run on the final tree on **2026-11-06**; logs are in `reports/`.

| Command | Result | Log |
|---|---|---|
| `npm run check` (typecheck + lint + test) | **PASS** — typecheck clean, lint clean, **28/28** node tests | `reports/r4-check.log` |
| `npm run build` | **PASS** — `dist/assets/index-DopfAMui.css` **37.19 kB** (gzip 9.06), `dist/assets/index-CVQPZii6.js` **344.55 kB** (gzip 109.93), `built in 452ms` | `reports/r4-build.log` |
| `npm run test:e2e` | **PASS** — **14/14** in **22.7 s** | `reports/r4-e2e.log` |

The 28 node tests are **7** from `tests/logic.test.cjs` + **9** from `tests/core.test.ts` (the 16 baseline tests) plus the **12** new design-system assertions:

```
✔ every variant map resolves both states to distinct, complete class strings
✔ class maps carry no empty-string gaps except the intentional idle no-ops
✔ direction mapping never treats the sender as a layout class
✔ avatar variants always emit exactly one size token and one art fallback
✔ wallpaper is a typed tone map keyed on chat kind, not on a CSS variable
✔ glass token ladder declares one fill, blur and shadow per tier
✔ border family exists in both themes and is not borrowed from Zalo
✔ components read glass values only through tokens
✔ degradation covers every blurred tier in one switch
✔ glass is never nested in a containing block or transform layer
✔ every glass surface takes its radius from the ladder, including the compact shell
✔ the date pill keeps the shipped glass idiom: translucent fill plus its own blur
```

The 14 E2E tests cover accessibility (dark + light, axe + pixel contrast), six demo flows, three viewport layouts, the glass-endpoint contrast sweep, and the IME composition guard.

### 9.1 Visual artifacts

| Artifact | Path |
|---|---|
| Light — 1920×1080 / 1600×900 / 1366×768 | `reports/screenshots/react-light-{1920x1080,1600x900,1366x768}.png` |
| Dark — 1920×1080 / 1600×900 / 1366×768 | `reports/screenshots/react-dark-{1920x1080,1600x900,1366x768}.png` |
| axe reports (4 states) | `reports/accessibility/{dark,light}-{chat,settings}.json` |

All six screenshots were regenerated at `2026-11-06 02:58`, after the radius fix in §4.1 — they reflect the final source.

### 9.2 Accessibility measurements

**axe-core**: **0 violations** in `dark-chat`, `dark-settings`, `light-chat`, `light-settings`.

**Pixel-sampled text contrast** (`tests/e2e/contrast.ts`, WCAG 3:1 large / 4.5:1 normal):

| Population | Rows | Failures | Worst ratio | Worst sample |
|---|---:|---:|---:|---|
| Default state (4 files) | 128 | **0** | **5.33:1** | dark chat `"14:27"` |
| Endpoint sweep `{15,95}% × {low,normal} × {settings,chat} × {dark,light}` (16 files) | 512 | **0** | **4.96:1** | `dark-95-{normal,low}-chat` `"14:27"` (tied) |

The endpoint sweep is the important one: it proves the density slider cannot be dragged to a value that breaks text legibility, in either theme, with blur on or off. `reports/accessibility-extended/` holds all 16 per-cell result files.

### 9.3 Preserved baseline

Legacy files are byte-identical to `reports/legacy-sha256.txt`:

```
9c94dcb30827297f2a8c9581bd4798999517e61c9c7a9fc5298351167ac9c34b  src/app.js
69a0720e7301f5a8d668d6785853797b85ae09d4ab2c9a20529628503b91d47a  src/logic.js
716f7fab46482b0371fc72a23514d8683a3e398ea2d475cec5b7b62d48556cbf  src/icons.js
47c999919be20f5a5b006e7b57affd48b66c5a2e416b53f617f25c8285b20503  src/styles.css
```

The persisted-preference allowlist is still exactly `['glass','lowBlur','motion','theme']` (`src/shared/preferences.ts:16` serialises only those four fields), asserted by both `tests/core.test.ts` and `tests/e2e/demo.spec.ts`. No runtime dependency was added; the CSP in `index.html` is unchanged.

---

## 10. Fact vs inference, and what was not verified

**Fact (measured in this tree):** every token count, line count, file path, CSS declaration and test result in §2–§9; the 28/28, 344.55 kB, 37.19 kB and 14/14 figures; the 128-row and 512-row contrast populations with their worst ratios; 0 axe violations; the four legacy hashes.

**Inference (analyst judgement, not measured):** that a 44px shell blur reads as "Apple-glass" rather than merely "frosted" is a design judgement, not a measurement. That the ladder's spacing (44/35/24/20/12/10 px) conveys depth ordering is a judgement. The claim that the pane tiers should not re-blur is reasoned from compositing behaviour (a second `backdrop-filter` samples the already-blurred composition), but R4 did not A/B-measure it.

**Not verified in R4:**

| Item | Status | Reason |
|---|---|---|
| Appearance on a GPU-less / software-render path | **NOT VERIFIED** | The `@supports` fallback is asserted statically; no test runs a renderer with `backdrop-filter` disabled |
| Windows 11 acrylic / Mica backing behind the window | **NOT VERIFIED** | The demo draws its own backdrop; OS-level material was not measured |
| Behaviour at display scale ≠ 100% | **NOT VERIFIED** | Screenshots exist only at 100% DPR |
| Real OS IME | **NOT VERIFIED** | The E2E test simulates the composition event path via CDP; it does not automate a Vietnamese IME |
| Any Zalo rendering of these styles | **N/A by design** | R4 never modifies Zalo; this is R5's question |

---

## 11. What R5 must not assume

R4 proves the design system is **internally** complete, token-driven, degraded safely, and accessible. It proves **nothing** about reaching Zalo:

1. R4's token names are *inspired by* Zalo's vocabulary; they are **not** Zalo's tokens, and no R4 rule is written against a Zalo selector.
2. R4's layering (one composited layer per surface) is the opposite of Zalo's three-stacked-opaque-fills model (R3 §12.1). A CSS-only attempt to graft R4 onto Zalo would hit the stack, not the ladder.
3. R4 has no injection, no preload patch, no CSP change, no private-API use. If R5 cannot find an **authorized** route with the same properties, the correct outcome remains **NO-GO**.
4. A passing R4 says the *design* is ready. It does not say Zalo will honour a single rule of it at runtime — that question is unanswered and must stay labelled **UNVERIFIED** in R5.
