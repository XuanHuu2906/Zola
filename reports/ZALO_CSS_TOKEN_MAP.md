# R2 — Zalo CSS Design System Mapping (REA)

**Target:** Zalo PC `26.10.20.3253` (VNG GROUP JSC, signed) — Electron `22.3.9` / Chromium `108.0.5359.215`
**Artifact:** `app.asar` 177,728,582 B, SHA-256 `d83256230e5d1d4483c2411f71936c3dc1562fb8a885fd8752cab17d229201e6`
**Stylesheet:** `pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.css` — 2,328,581 B
**Renderer:** `pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js` — 20,927,993 code units
**Tool:** REA only (`open_binary` → `inspect_artifact` → `extract_artifact`). All measurements below are from static parsing of the REA-extracted copy (see §7).
**Evidence dumps:** `_r2_map.txt`, `_r2_matrix.txt`, `_r2_stats.txt`, `_r2_darkmix.txt`, `_r2_resolved.txt`, `_r2_palette.txt`

> **Offset convention:** `@N` = UTF-16 code-unit offset. Rule counts are over the **15,950** style rules produced by `_r2_map.cjs` (a raw brace scan gives 16,041; the 91 dropped at-rule blocks are enumerated in §7.3).

---

## 0. Verdict in one paragraph

Zalo's design system is **three independent token layers that only agree by coincidence**. Layer A is the build-time SCSS mixin pair (`alias_variable` light @43,288 / `dark_alias_variable` @13,665), which is what actually ships and what the app renders. Layer B is the JS `TOKEN_MAP` (376 entries) which produces the *internal* generator's output. Layer C is the runtime injector `euSg`, reachable from exactly one module. **They diverge on 78 light and 219 dark tokens**, so "the token names in the JS" are not a reliable description of what the CSS does. Measured over the **420** semantic CSS custom properties that exist in the shipped stylesheet: **197 are retintable through the internal Magic path, 99 use an alias outside that path, 63 are raw literals, and 61 are categorically excluded by the generator's own name filter** (`input-field-bg` / `border` / `divider`). **No core UI surface in the shipped app has a single `backdrop-filter`, and none uses a semi-transparent background.** Any Apple Glass appearance in R4 is therefore **built from scratch** — there is nothing in Zalo's stylesheet to inherit or extend. Likewise `.custom` ships **zero base rules**: CUSTOM mode has no compiled appearance at all and depends entirely on a runtime-injected sheet.

---

## 1. Token inventory

### 1.1 Where tokens are defined

Seven `:root`-family blocks exist in the shipped CSS. Only two carry semantic tokens:

| Block | Offset | Vars | Contents |
|---|---|---|---|
| `:root body.dark` | 13,636 | 0 | (empty selector remnant) |
| `:root .dark` | 13,665 | **725** | 420 semantic + 305 scale |
| `:root` | 36,011 | 307 | pure scale palette |
| `:root,:root .light` | 43,288 | **418** | all semantic, **0 scale** |
| `:root` | 59,605 | 1 | `--nav-width`-class singleton |
| `:root` | 246,033 | 10 | late overrides |
| `:root` | 1,755,156 | 31 | late overrides |

Measured (`_r2_map.txt:1-5`):

```
rules parsed=15950
light selector=":root,:root .light" vars=418
dark  selector=":root .dark" vars=725
scale tokens light=0 dark=305
semantic tokens light=418 dark=420
```

**Important asymmetry:** the light block defines **no** scale tokens. Light-mode scale values come from the separate `:root` block @36,011. Dark-mode scale values are inline in `:root .dark` @13,665. This means `--N300` resolves differently depending on which block won, not from the light/dark class alone.

### 1.2 Semantic token union

`semantic token union = 420` (`_r2_matrix.txt:1`).

- **Light-only semantic tokens: 0**
- **Dark-only semantic tokens: 2** — `--HL_photo-bg`, `--HL_input`
- **Identical in light and dark: 68** (`_r2_map.txt:43`) — e.g. `--link=#0068ff`, `--text-on-color=#fff`, `--icon-on-color=#fff`, all `--button-*-normal: transparent`, `--shadow-*` are literals, `--toast=rgba(0,0,0,0.9)`
- **Differing: 350**

The 68 identical tokens are the ones a naive "swap the palette" theme cannot improve — they are pinned by design (`#fff` on-color text, `transparent` button shells, the 8 fixed accent `-bg` brand colors, the `-on-color` button family).

### 1.3 Scale palette (aliases)

Measured from `_r2_palette.txt`:

| Alias | Light | Dark |
|---|---|---|
| `--N0` | `#fff` | `#081b3a` |
| `--N300` | `#081b3a` | `#fff` |
| `--B55` | `#0068ff` | `#0068ff` |
| `--BA55` | `rgba(0,0,0,0.55)` | `hsla(0,0%,100%,0.55)` |
| `--BLA55` | `rgba(0,104,255,0.55)` | `rgba(0,104,255,0.55)` |
| `--WA100` | `#fff` | `#000` |

21 alias families exist: `N NG DN NA B STB SKB R OR Y G TL P PK WA BA BLA GR PU` (+`H`/`V`/`D` gradient families). `MAIN_COLOR_TOKEN = ["N","NG","DN","B","R"]` — only these five are retintable through the internal Magic path.

### 1.4 JS `TOKEN_MAP` — 376 entries, and it does **not** match the CSS

`TOKEN_MAP.light` holds 376 entries (`_r2_stats.txt`), grouped: Control/button 139, Accent 120, Background/layer 49, Border/divider 18, Icon 16, Text 15, Conversation/message 12, Other 3, Navigation 2, Shadow 2.

The SCSS mixin resolves 396 tokens. The two sets are **not the same set and not the same values**:

| Comparison | Result |
|---|---|
| `alias_variable` tokens | 396 |
| `dark_alias_variable` tokens | 396 |
| Light-value differences (mixin vs TOKEN_MAP) | **78** (+1 boundary-case) |
| Dark-value differences (mixin vs TOKEN_MAP) | **219** |
| TOKEN_MAP tokens absent from dark mixin | **28** (`--button-tertiary-*`, `--button-ghost-*`, `--shadow-*`, `--border-selected`, `--border-inverse`, `--background-focus-ui`, `--*-quote-selected-alpha`) |
| Tokens in both, resolved | 371 / 376 (`_r2_resolved.txt`) |
| Missing from both blocks | `--border-selected`, `--border-inverse`, `--background-focus-ui`, `--blue-quote-selected-alpha`, `--white-quote-selected-alpha` |

Examples of divergence (`_r2_darkmix.txt`):

```
--layer-background-navbar-hover:  TOKEN_MAP=B70   mixin=BA15
--text-primary:                   light=N300       dark=DN200
--layer-background-selected:      light=B15        dark=STB25
```

**Consequence for R2:** any claim of the form "token X equals colour Y" must state *which layer* is meant. This report uses the **shipped CSS values** (Layer A) as the ground truth, because that is what renders.

---

## 2. Required token grouping

Two groupings are given: (a) the user-required functional categories, (b) the generator's own category model.

### 2.1 User-required categories (`_r2_matrix.txt`, 12 categories, 381/420 assigned)

| Category | n | Representative tokens |
|---|---:|---|
| **Accent** | 132 | `--accent-{blue,green,grey,orange,pink,purple,red,skyblue,steal,stealblue,yellow}-{bg,border,icon,text}[-bold,-subtle]` |
| **Control / button** | 124 | `--button-{primary,secondary,danger}-*`, `--button-{ghost,tertiary}-{primary,neutral,danger,on-color}-*` |
| **Background** | 40 | `--layer-background`, `--layer-background-{hover,selected,subtle,disabled,inverse,pinned,ptv*}`, `--surface-background{,-subtle,-overlay}`, `--background-{activeness,inactiveness}`, `--curtain*`, `--skeleton*`, `--title-bar`, `--tip-bg`, `--input-{white,grey}`, `--item-wa-*`, `--tip-bg` |
| **Text** | 20 | `--text-{primary,secondary,disabled,information,on-color,on-disabled-color,placeholder,errors,success,warning,mention,quote,navbar-sublevel-*}`, `--link`, `--success`, `--timestamp`, `--tab-txt`, `--text-search-highlight` |
| **Border** | 22 | `--border`, `--border-{subtle,bold,hover,disabled,focused,highlight,errors,success,warning,information,support-*}`, `--border-{on-color,vanish}`, `--divider{,-subtle,-bold,-on-color}` |
| **Icon** | 12 | `--icon-{primary,secondary,disabled,on-color,on-disabled-color,errors,success,warning,information,hover-bg,count-noti-*}` |
| **Navigation** | 10 | `--layer-background-{navbar,leftmenu}-{normal,hover,selected}`, `--icon-navbar-{normal,disabled,sublevel-*}` |
| **Message** | 9 | `--media-message-{hover,selected}`, `--{blue,white}-quote{,-selected}`, `--floating-menu`, `--partial-quote-floating`, `--toast` |
| **Conversation** | 5 | `--grey-dot`, `--red-dot`, `--reaction-background`, `--jump-to-message`, `--emoji-status-bubble-color` |
| **Surface** | 4 | `--layer-background-navbar-sublevel-{normal,hover,selected}`, `--layer-accent-message` |
| **Shadow** | 3 | `--shadow-{overlay,overflow,bubble}` |
| **Layout / other** | 0 | (no semantic layout tokens; `--space-*`/`--medium` are separate) |

**Unassigned semantic tokens: 39.** These do not fit any required category and are reported rather than forced in:

```
--input-placeholder-wh --input-icon-wh --input-placeholder-gr --input-icon-gr
--layer-{alert,error,success,warning,information,neutral-information}-background
--cta-link{,-primary,-disabled,-hover,-pressed} --cta-destruction{,-pressed}
--cta-link-neutral{,-disable}
--input-field-bg-{filled,outline}{,-hover,-pressed} --input-field-ptv-{bg,outline}
--blue-message{,-selected} --white-message{,-selected}
--progress-{track,indicator}{,-on-background}
--vtt-{normal,hover}-button-bg
--HL_photo-bg --HL_input
```

### 2.2 The generator's own model (`_r2_map.txt:9-40`, all light semantic = 418)

```
accent 132 | control/button 124 | background/surface 53 | other 26 | border/divider 22
text 21 | icon 16 | navigation 11 | conversation 5 | message 5 | shadow 3
```

Note the three tokens the generator files under **text** but which behave differently: `--self-bubble-chat-shadow` (a shadow), `--blue-quote` / `--white-quote` / `-selected` (message surfaces, alias-driven).

---

## 3. Token → component map

Rule counts are over 15,950 rules; "used" = number of distinct non-`:root` selectors that reference the token. **467 tokens are consumed by ≥1 rule; 158 semantic tokens are never consumed** (`_r2_map.txt:46-48`) — the majority of the never-consumed set are the `--accent-*-border-*` / `--accent-*-text-*` / `--accent-*-icon-*` families (see §5.3).

### 3.1 Design spine (top-40 consumption, `_r2_map.txt:50-91`)

| Rank | Token | Rules | Rank | Token | Rules |
|---:|---|---:|---:|---|---:|
| 1 | `--text-secondary` | 630 | 11 | `--layer-background-hover` | 142 |
| 2 | `--text-primary` | 625 | 12 | `--text-errors` | 138 |
| 3 | `--text-information` | 482 | 13 | `--surface-background-subtle` | 133 |
| 4 | `--layer-background` | 480 | 14 | `--accent-grey-icon` | 123 |
| 5 | `--border` | 407 | 15 | `--border-focused` | 111 |
| 6 | `--text-on-color` | 239 | 16 | `--border-subtle` | 90 |
| 7 | `--layer-background-subtle` | 175 | 17 | `--space-xs` | 89 |
| 8 | `--icon-secondary` | 157 | 18 | `--BA20` | 85 |
| 9 | `--WA100` | 151 | 19 | `--medium` | 81 |
| 10 | `--layer-background-hover` | 142 | 20 | `--divider` | 77 |

### 3.2 Spine token → component family (`_r2_matrix.txt:416-436`)

```
--text-primary            total=625  other:530  input:28  button:16  settings:15  modal:12  message row:9
--text-secondary          total=627  other:522  button:34  input:21  settings:14  composer:13  modal:11
--text-information        total=473  other:363  button:46  message row:28  composer:12  input:12  settings:5
--text-on-color           total=238  other:190  button:28  message row:11  input:3  settings:3  composer:2
--layer-background        total=472  other:380  input:22  button:21  modal:17  settings:16  composer:9
--layer-background-subtle total=174  other:150  input:7  modal:5  settings:4  message row:2  titlebar:2
--layer-background-hover  total=142  other:117  settings:10  button:4  modal:3  message row:2  input:2
--layer-background-selected total=30 other:14  message row:10  conv list row:3  context menu:2  settings:1
--border                  total=395  other:299  input:41  button:20  modal:14  settings:10  message row:5
--border-subtle           total=88   other:77   input:7  button:3  modal:1
--border-focused          total=110  other:58   input:28  button:12  composer:4  message row:4  modal:3
--divider                 total=77   other:68   settings:4  modal:3  composer:2
--icon-primary            total=39   other:31   composer:2  message row:2  button:1  input:1  settings:1
--icon-secondary          total=157  other:134  message row:6  composer:5  button:4  input:4  settings:2
--background-activeness   total=66   other:46   button:9  message row:8  composer:1  input:1  modal:1
--WA100                   total=136  other:113  button:11  message row:7  settings:3  composer:2
--surface-background-subtle total=133 other:125 settings:3  modal:2  composer:2  input:1
--shadow-overlay          total=41   other:34   message row:2  modal:2  context menu:1  button:1  input:1
--shadow-overflow         total=9    other:9
--shadow-bubble           total=9    other:9
```

**Reading of the "other" column:** it is large because Zalo's component class names are not systematic. The named buckets are a lower bound, not a census. The safe statement is the *relative* ordering — e.g. `--border-focused` is concentrated in **inputs** (28 of 110) and **buttons** (12 of 110), while `--layer-background-selected` is concentrated in **message rows** (10 of 30) and **conversation rows** (3 of 30).

### 3.3 Per-surface token census (`_r3_surfaces2.txt`, 16,041-rule parse)

| Surface | Rules | Unique vars | Top tokens |
|---|---:|---:|---|
| Conversation list row `.conv-item` | 71 | 15 | `--text-primary(8) --layer-background-selected(4) --text-information(3) --text-secondary(2)` |
| Chat header `.threadChat__title` | **5** | **1** | `--BA20(3)` only |
| Message row `.chat-content`/`.chat-message` | 119 | 14 | `--N300(6) --G20(4) --text-information(3) --B10(3)` |
| Bubble `.content-message-container` | 23 | 6 | `--text-primary(2) --border-focused(1) --text-information(1)` |
| Date divider `.chat-date` | 20 | 4 | `--text-on-color(1) --timestamp(1) --BA20(1) --border-focused(1)` |
| Composer `.chat-box-bar`/`.chat-box-input` | 29 | 8 | `--text-information(4) --layer-background(3) --cta-link(2)` |
| Titlebar `.titlebar` | 34 | 11 | `--icon-on-color(3) --text-primary(2) --R60(2)` |
| Context menu `#zmenu`/`.zmenu-item` | 51 | 16 | `--text-information(3) --layer-background-selected(3) --layer-background-hover(2)` |
| Modal `.zl-modal__*` | 16 | 3 | `--border(2) --layer-background(2) --divider(1)` |
| **Left panel `.leftpanel`** | **0** | **0** | *(selector does not exist in shipped CSS)* |
| **Right panel `.rightpanel`** | **0** | **0** | *(selector does not exist in shipped CSS)* |

**Two important negative findings:**
1. `.leftpanel` and `.rightpanel` appear in **zero** CSS rules. Any assumption that Zalo has a styled left/right panel class is unfounded — the navigation surface is `#titleBar` / `.conv-list-*` / `.navbar-*`.
2. The chat header is `.threadChat__title`, and it consumes **exactly one token family** (`--BA20`). The header's appearance is therefore almost entirely inherited from its ancestors, not locally themed. This constrains any CSS-only glass plan for the header.

Design spine (shared by ≥4 surfaces, `_r3_surfaces2.txt:61`):
```
--text-information(6) --text-primary(5) --border-focused(5)
--background-activeness(5) --WA100(5) --text-secondary(4) --layer-background(4)
```

---

## 4. Glass feasibility — blur, transparency, glass border, shadow

### 4.1 `backdrop-filter` — 7 rules in the entire stylesheet (`_r2_map.txt:140-147`)

```
.seasonal-item-preview                       -> blur(2px)
.preview-ts .block-date>.chat-date>span      -> blur(10px)
.preview-ts.active-scroll .block-date>.chat-date>span -> blur(10px)
.mvr-thumbplaceholder                        -> blur(22px)
.analytic-conv-resources-container           -> blur(30px)
.health-center-analytic-modal                -> blur(4px)
.health-center-tab                           -> blur(4px)
```

**None** of these is a core messaging surface. Six are seasonal/health-centre/analytics preview widgets; the two `.chat-date` ones are inside a `ts` preview harness, not the live chat.

### 4.2 `filter: blur()` — 13 rules, all image placeholders (`_r2_map.txt:149-162`)

```
.lqip.-blur-{low,medium,high}>.lqip__preview-thumb     -> blur(8|18|36px)
.tiny-thumb.-blur-{low,medium,high}:before             -> blur(8|16|36px) brightness(1.1)
.mvr-thumbplaceholder                                  -> blur(22px)
.health-center-modal-container .health-center-modal-effect -> blur(10px)
.health-center-modal .health-center-modal-background   -> blur(30px) grayscale(100%)
.health-center-analytic-button:after                   -> blur(16px)
.dark .tiny-thumb.-blur-{low,medium,high}:before       -> blur(8|16|36px) brightness(.5)
```

These are LQIP progressive-image placeholders and one health-centre modal. They duplicate neighbouring pixels of an image; they do not sample the page behind an element.

### 4.3 Semi-transparent surface backgrounds — **zero on every surface**

`_r2_matrix.txt:438-449`:

```
conversation row   rules= 49  backdrop=0 blur=0 shadow= 0 radius=  1 semiBg= 0 opaqueBg=8
chat header        rules= 16  backdrop=0 blur=0 shadow= 1 radius=  2 semiBg= 0 opaqueBg=2
message row        rules=374  backdrop=0 blur=0 shadow=14 radius= 28 semiBg= 0 opaqueBg=81
bubble             rules= 23  backdrop=0 blur=0 shadow= 0 radius=  1 semiBg= 0 opaqueBg=1
composer           rules=107  backdrop=0 blur=0 shadow= 2 radius= 15 semiBg= 0 opaqueBg=19
titlebar           rules= 68  backdrop=0 blur=0 shadow= 0 radius=  2 semiBg= 0 opaqueBg=10
context menu       rules= 51  backdrop=0 blur=0 shadow= 0 radius=  1 semiBg= 0 opaqueBg=10
modal              rules=116  backdrop=0 blur=0 shadow= 0 radius=  7 semiBg= 0 opaqueBg=18
settings           rules=160  backdrop=0 blur=0 shadow= 0 radius= 11 semiBg= 0 opaqueBg=21
leftpanel          rules=  0
rightpanel         rules=  0
```

Every themed surface paints **opaque** backgrounds. The only semi-transparent *tokens* are `--curtain*` (scrim overlays), `--skeleton*`, `--timestamp`, `--floating-menu`, `--bg-message-info`, `--background-control-alpha*` and the `--border*`/`--divider*` family — none of which is a surface fill for a glass panel.

### 4.4 Shadow system — 3 tokens, all literal, no glass-border token

```
--shadow-overlay  = 0px 0px 1px 0px rgba(21,39,71,0.3),  0px 8px 12px 0px rgba(21,39,71,0.15)
--shadow-overflow = 0px 0px 1px 0px rgba(21,39,71,0.12), 0px 0px 8px 0px rgba(21,39,71,0.15)
--shadow-bubble   = 0px 0px 1px 0px rgba(21,39,71,0.25), 0px 1px 1px 0px rgba(21,39,71,0.25)
```

Dark mode adds an inset hairline: `0px 0px 0px 1px rgba(188,214,240,0.08) inset` on `--shadow-overlay` and `--shadow-bubble`. **That inset hairline is the closest thing Zalo ships to a "glass border"** — a 1 px inset ring at 8 % opacity. There is no dedicated glass-border token, no `--glass-*` family, and no `--blur-*` family.

Usage: `--shadow-overlay` 49 rules (message row 2, modal 2, context menu 1, button 1), `--shadow-overflow` 9 rules, `--shadow-bubble` 9 rules — all in the "other" bucket.

### 4.5 Border radius — where rounding already exists

`border-radius` appears **1,392** times bundle-wide. Per-surface counts (`_r2_matrix.txt`): message row 28, composer 15, settings 11, modal 7, titlebar 2, chat header 2, conversation row 1, bubble 1, context menu 1.

### 4.6 Feasibility verdict

| Glass primitive | Present in shipped CSS? | Evidence | Consequence for R4 |
|---|---|---|---|
| `backdrop-filter` on a core surface | **No** — 0 of 7 rules | §4.1 | Must be authored from scratch |
| Semi-transparent surface fill | **No** — 0 on all 9 surfaces | §4.3 | Must be authored from scratch |
| Sub-pixel/1 px glass border | **Partial** — `0 0 0 1px … inset` in dark `--shadow-overlay`/`--shadow-bubble` only | §4.4 | Reuse the *idea*, not the token |
| Multi-layer soft shadow | **Yes** — 3 tokens, 2-layer light / 3-layer dark | §4.4 | Directly reusable as a reference |
| Rounded corners | **Yes** — 1,392 declarations | §4.5 | Directly reusable as a reference |
| Noise / grain / specular highlight | **No** | — | Must be authored from scratch |
| `color-mix` / `oklch` / relative color | **Not observed** | — | Must be authored from scratch |

**No part of Zalo's shipped CSS can be "switched on" to produce glass.** R4's visual layer is 100 % original work.

---

## 5. Retint ceiling — not every token is externally changeable

This is the section the task explicitly demanded: *"Không mặc định rằng tất cả CSS tokens đều thay đổi được từ bên ngoài."*

### 5.1 Method

For each of the 420 semantic tokens, `_r2_matrix.cjs` classifies reachability through the **only** runtime writer (`euSg`, §6 of R1):

1. Not defined in either block → `no-def`
2. Name matches `input-field-bg|border|divider` → `excluded-by-filter` (the generator skips these unconditionally)
3. Alias family ∈ `MAIN_COLOR_TOKEN = {N, NG, DN, B, R}` → `magic`
4. Other alias family → `alias-not-in-magic` (G, WA, BA, Y, OR, TL, SKB, PK, P, STB)
5. No alias (raw literal value) → `literal`

The generator's two filter mechanisms, quoted from `euSg` (R1 §4.4):

```js
["input-field-bg", "border", "divider"].forEach(n => { e.includes(n) && (t = !0) });
...
if (d(e.token_name)) return;             // ← borders / dividers / input-field-bg skipped
```

### 5.2 Result (`_r2_matrix.txt:410-414`)

| Class | Count | % of 420 | Meaning |
|---|---:|---:|---|
| `magic` | **197** | 46.9 % | Alias ∈ {N, NG, DN, B, R} → retintable by the internal generator |
| `excluded-by-filter` | **61** | 14.5 % | **All** `--border*` (22) + **all** `--divider*` (4) + `--accent-*-border*` (33) + `--input-field-bg*` → structurally unreachable |
| `alias-not-in-magic` | **99** | 23.6 % | Alias exists but outside the 5-token main set |
| `literal` | **63** | 15.0 % | Hard-coded value; no alias to swap |

**Ceiling: 197 / 420 = 46.9 % of semantic tokens.** Even that ceiling is not usable externally, because the generator that reaches it is behind a hidden dashboard (§6 of R1).

### 5.3 Two denominators — do not mix them

| Denominator | Numerator | Ratio | Source |
|---|---:|---:|---|
| **420** semantic CSS tokens | 197 magic | **46.9 %** | `_r2_matrix.txt` (this report's primary figure) |
| **376** `TOKEN_MAP` entries | 214 reachable (`B=83 N=72 R=50 NG=8 DN=1`) | **56.9 %** | `_r2_stats.txt` (R1's figure) |

Both are correct for their own denominator. **R1 cites 214/376 (56.9 %); R2 cites 197/420 (46.9 %).** They measure the same property over different populations — `TOKEN_MAP` omits 44 semantic tokens that exist in CSS and includes some entries the CSS never consumes.

### 5.4 What this means concretely

- **Borders and dividers cannot be retinted, ever, by the generator.** `--border` (407 rules), `--border-focused` (111), `--border-subtle` (90), `--divider` (77), `--divider-bold` (23) — the entire line-work of the UI is locked to the compile-time palette.
- **Only 5 alias families are retintable.** Every `--accent-green-*`, `--accent-orange-*`, `--accent-pink-*`, `--accent-purple-*`, `--accent-skyblue-*`, `--accent-steal-*`, `--accent-stealblue-*`, `--accent-yellow-*` is pinned — that is **99** tokens in the "semantic green/orange/pink/purple/sky/teal/yellow accent" family alone. Only 29 of those 99 are even referenced.
- **158 semantic tokens are never referenced by any rule** (`_r2_map.txt:46-48`). Most are `--accent-*-{border,text,icon}[-bold,-subtle]` (≈110 of them). Retinting a never-consumed token changes nothing on screen.

Per-class consumption (recomputed over all 420 tokens, not only the 381 assigned in §2.1):

| Class | Total | Consumed by ≥1 rule | Unreferenced |
|---|---:|---:|---:|
| `magic` | 197 | **150** | 47 |
| `excluded-by-filter` | 61 | 27 | 34 |
| `alias-not-in-magic` | 99 | 29 | 70 |
| `literal` | 63 | 56 | 7 |

So the **effective** retint surface is **150 tokens** — the magic-class tokens that a real selector actually reads. The remaining 47 magic tokens (`--accent-blue-bg-bold`, most `--accent-{red,green}-*`, `--border-selected`-adjacent entries) are defined but painted nowhere; retinting them is a no-op.

---

## 6. The `.custom` scope — no compiled appearance

CUSTOM is a first-class enum value (`CUSTOM=3`) and has its own lazy chunk (`w3JL`). But in the shipped stylesheet:

```
standalone .custom class selector occurrences: 14
.custom{ rule:                                  0
.custom.mask-sidebar rules:                     14
JS body.classList.add/remove(…CUSTOM):          2
```

(`_r2_matrix.txt:451-455`)

**There is no `.custom { … }` base block.** All 14 standalone `.custom` occurrences are `.custom.mask-sidebar`, and they do only:

```css
#titleBar                        { background: var(--layer-background-navbar-normal) }
.conv-list-semi-compact          { background: var(--layer-background-gradient-on-color) }
#contact-search, #conversationListId, .conv-item,
.msg-filters-bar, .msg-item      { background-color: unset }
…selected                        { background-color: var(--layer-background-selected) }
.conv-item.pinned                { background-color: var(--layer-background-pinned) }
#conversationListId              { box-shadow: var(--shadow-overflow) }
```

**Consequence:** CUSTOM mode has **zero compiled appearance of its own**. Whatever CUSTOM looks like comes entirely from the runtime-injected `<style id="app-custom-theme">` sheet, which in turn is reachable only from the hidden dashboard (§6.1 of R1). Any external assumption that "selecting CUSTOM gives you a skin" is false — selecting CUSTOM without the internal generator yields basically the light theme with unset conversation backgrounds.

---

## 7. Method, coverage, and limits

### 7.1 Tool and pipeline

| Step | REA call | Result |
|---|---|---|
| 1 | `binary_session` | bound to `Zalo.exe` / `app.asar` |
| 2 | `open_binary` | ASAR opened |
| 3 | `inspect_artifact` | 13,169 artifacts, SHA-256 verified |
| 4 | `extract_artifact` | extraction root `…\rea-extracted-bbf240c9-…`, `containment_verified: true`, `cleanup.verified: true`, `residual_paths: []` |
| 5 | `get_evidence_bundle` | evidence records retained |

All CSS/JS parsing after step 4 is **static string/AST analysis of the extracted copy** using Node's own parser. This is post-extraction analysis of an artifact REA produced, not a substitute RE tool — the same boundary already disclosed in R1 §8.2.

### 7.2 Scripts (all in `reports/`)

| Script | Output | Purpose |
|---|---|---|
| `_r2_map.cjs` | `_r2_map.txt` | flat rule index, light/dark blocks, category groups, per-surface census, glass rules, shadow defs |
| `_r2_matrix.cjs` | `_r2_matrix.txt` | 12 required categories, reachability classifier, spine→family map, per-surface glass feasibility |
| `_r2_darkmix.cjs` | `_r2_darkmix.txt` | SCSS mixin vs `TOKEN_MAP` divergence |
| `_r2_resolved.cjs` | `_r2_resolved.txt` | per-token resolution of all 376 `TOKEN_MAP` entries |
| `_r2_palette.cjs` | `_r2_palette.txt` | block-level scale-palette probes |
| `_r3_surfaces2.cjs` | `_r3_surfaces2.txt` | strict parse for the per-surface census in §3.3 |

### 7.3 Rule-count reconciliation

| Parser | Rules | Composition |
|---|---:|---|
| raw brace scan (every `{…}` block) | **16,041** | all style + at-rule blocks |
| `_r2_map.cjs` / `_r2_matrix.cjs` (keeps `@media`, drops other at-rules) | **15,950** | 16,041 − 91 at-rule blocks |
| cleaned variant (also drops `from` / `to` / `N%` keyframe steps) | **15,758** | 15,950 − 192 |

The 91 dropped at-rule blocks are: `@keyframes` 67, `@-webkit-keyframes` 7, `@-moz-keyframes` 1, `@font-face` 14, `@property` 1, `@container` 1. The 16 `@media` blocks are retained in all lenient counts. The 192 keyframe-step selectors are why the lenient count still over-reports "selectors".

**No quantitative conclusion in this report depends on which count is used** — all reachability and category figures are token sets, not rule counts; all consumption figures use the lenient 15,950 parser consistently. Values quoted from R3's strict parse are labelled as such (§3.3).

### 7.4 Explicitly NOT RUN / BLOCKED

| Item | Status | Reason |
|---|---|---|
| Live DOM probe of computed styles | **NOT RUN** | Would require launching the target and attaching to a live renderer; not permitted under the standing no-modify/no-attach constraint |
| Observation of the hidden dashboard UI | **NOT RUN** | Requires authenticating and opening a private internal route |
| Source-level token names | **BLOCKED** | `sourcemaps/` ships empty |
| Rendered verification of `--HL_*` tokens | **BLOCKED** | The two dark-only tokens have no consumer rule |

### 7.5 Fact vs inference

**Fact (measured):** every count, block offset, rule body and CSS value in §1–§6.
**Inference (labelled):** the component-family buckets in §3.2 are heuristic class-name matches; the "effective retint surface ≤39" figure in §5.4 is a **lower bound** derived from named buckets only.

---

## 8. Conclusions that feed R4

1. **Build glass from zero.** No `backdrop-filter`, no semi-transparent surface fill, no glass-border token exists on any core surface. Copy the *idea* of dark mode's `0 0 0 1px rgba(188,214,240,0.08) inset` hairline; author everything else.
2. **The token vocabulary is usable as a naming reference**, not as a value source. Adopt the spine (`--text-primary/secondary/information/on-color`, `--layer-background{,-subtle,-hover,-selected}`, `--border{,-subtle,-focused}`, `--divider`, `--icon-primary/secondary`, `--background-activeness`, `--shadow-{overlay,overflow,bubble}`) because it maps cleanly onto a glass system and is already proven to address real components.
3. **Do not assume borders are themeable.** In R4's own system, make border/divider/hairline a first-class token family — that is precisely the gap Zalo leaves.
4. **Do not assume `.custom` means anything.** There is no compiled custom theme. R4 defines its own complete theme contract.
5. **Two layers of truth must never be conflated.** If R5 ever cites a Zalo token value, it must say whether it is quoting the shipped CSS (Layer A) or `TOKEN_MAP` (Layer B); they differ on 78 light and 219 dark tokens.
