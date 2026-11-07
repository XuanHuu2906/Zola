# R1 — Zalo PC Theme Engine Analysis (REA)

**Target:** Zalo PC `26.10.20.3253` (VNG GROUP JSC, signed)
**Electron:** `22.3.9` / Chromium `108.0.5359.215`
**Artifact:** `app.asar` — 177,728,582 B, SHA-256 `d83256230e5d1d4483c2411f71936c3dc1562fb8a885fd8752cab17d229201e6`
**Bundles analyzed**
- renderer `pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js` — **20,927,993 code units**
- stylesheet `pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.css` — 2,328,581 B
- main `main-dist/main.js` — 4,342,755 B
- lazy chunks in `pc-dist/lazy/` (55 files)
- `sourcemaps/` — **shipped empty**
**Tool:** REA (`open_binary` → `inspect_artifact` → `extract_artifact` → `get_evidence_bundle`), then local AST/offset probes on the extracted copy (see §8 method boundary).

> **Offset convention:** every `@N` below is a **UTF-16 code-unit offset** into the file named in its heading (JS strings are indexed in code units). Bytes and code units are stated separately where both are known.

---

## 0. Verdict in one paragraph

Zalo's theme engine is a **two-track system**. The **public track** is a small enum (`LIGHT=0 / DARK=1 / SYSTEM=2 / CUSTOM=3`) whose only job is to toggle a class on `<body>` — `dark` or `light` — and persist `{theme, theme_setting, has_used_dark_mode, color}` to `localStorage["za_theme"]` plus the main-process config key `app_theme`. All colors then come from **two precompiled SCSS mixins** (`alias_variable` for light, `dark_alias_variable` for dark) baked into the shipped CSS. The **internal track** is a hidden color-token generator (`euSg`) that can synthesize brand-new CSS custom properties at runtime and inject them as `<style id="app-custom-theme">` scoped to `:root .custom`. That internal track is reachable from **exactly one call site** — a hidden colors dashboard (`iKSP`) — and is therefore *not* a supported customization surface. Any external theme work is limited to the public track, whose ceiling we measured in R2 as **214/376 tokens (56.9 %)** addressable, with borders, dividers and input-field backgrounds **categorically excluded** by the generator's own filter.

---

## 1. Theme processing flow (end to end)

### 1.1 Bootstrap — `xt()` in the renderer entry

`_r1_boot.txt` (bootstrap definition window @1,300,000..1,316,000 of the renderer bundle), verbatim:

```js
const Pt = `${Dt.a}.systemConfig`;

async function xt() {
  const e = r.ModuleContainer.resolve(d.ZLoggerFactory).createZLogger(["compact-app"], ["startApp"]);
  e.zsymb(0, "VGbFlE", "Starting compact application");
  if (!("compact-app-pc" === __ZaBUNDLENAME__)) return;

  const t = Object(Lt.a)().get(Pt, {});                    // ASCIIo-style config store

  t.lang && ( …, p.default.changeToLang(t.lang) );

  t.theme && ( e.zsymb(0, "TxR0ot", "Setting up theme: ", t.theme),
    (e => {
      const t = document.body;
      if (!t) return;
      const { DARK: a, LIGHT: i } = kt.THEME;              // kt = n("TmDO")
      e === a && n("9Tg7");                                 // ← see §1.2
      t.classList.toggle(a, e === a);                       // body.classList.toggle("dark", …)
      t.classList.toggle(i, e === i);                       // body.classList.toggle("light", …)
    })(t.theme)
  );

  const i = r.ModuleContainer.resolve(Mt);
  await i.start();
}
```

**What this proves**
- The theme is decided **before** the app UI mounts, from a persisted config store keyed `*.systemConfig`, read through `Object(Lt.a)()`.
- The *only* DOM mutation the bootstrap performs is `classList.toggle("dark")` / `classList.toggle("light")` on `<body>`. No inline style, no attribute, no stylesheet swap.
- `xt()` never writes `documentElement.classList`, never sets `body.className`, never sets `data-theme` for the app shell. (Cross-checked: `_r1_bodyclass.txt` — `documentElement.classList` = 0 hits, `body.className=` = 0 hits, `classList.add("dark")`/`remove("dark")` = 0 hits in the shell; the `data-theme` hits at 16,018,385 / 18,529,785 belong to the `z-instant` widget, not the shell.)

### 1.2 `n("9Tg7")` is a **no-op stub**

This was the one place where an earlier inference could have gone wrong. Search for the module definition across `pc-dist/**` returns nothing in the main bundle; it is defined inside the 16.4 MB lazy payload:

`pc-dist/lazy/default-login-main-startup-shared-worker-znotification.aafd08147de6e983b76f.js` @~3,141,469:

```js
"9Tg7": function (e, t, n) {}
```

**Conclusion (fact):** the `n("9Tg7")` call in `xt()` does nothing. It must **not** be cited as a dark-mode initializer. A second reference exists at @13,982,941 in a child window:

```js
async loadStyleByThemeConf(t) {
  try { const e = await $zconfig.getThemeConfig();
        (null == e ? void 0 : e.theme) === I.THEME.DARK && a("9Tg7") } catch (e) {}
}
```

…which is also a no-op for the same reason.

### 1.3 The React theme provider — `HuPi@6,112,786` (len 1,838)

`_r1_boot.txt`, verbatim:

```js
HuPi: function (e, t, n) {
  var a = n("q1tI"), i = n.n(a), r = n("B5Cg"), s = n("LhxH");

  const o = i.a.lazy(() => n.e(64).then(n.bind(null, "Ub+V"))),   // DARK
        l = i.a.lazy(() => n.e(63).then(n.bind(null, "w3JL")));   // CUSTOM

  const c = i.a.memo(({ _window: e }) => {
    const t = window.matchMedia(r.c),                             // DARK_MODE_MEDIA_QUERY
          [n, c] = Object(a.useState)(() => r.h.getTheme()),      // ThemeController.getTheme()
          { themeSettingOpt: d, theme: u } = Object(r.i)();       // xPHB hook

    const A = useCallback(() => {                                 // overlay factory
      let e = document.getElementById("app-theme-overlay");
      return e || (e = document.createElement("div"),
                   e.className = "theme-transition-overlay",
                   e.id = "app-theme-overlay",
                   document.body.insertBefore(e, document.body.firstChild), e);
    }, []);

    const h = useCallback(t => {                                  // 1000 ms cross-fade
      …
      const l = A(); l.offsetWidth; l.classList.add("active");
      setTimeout(() => l.remove(), 1e3);
    }, [A, e]);

    const p = useMemo(() => t => {                                // render switch
      switch (t) {
        case r.e.DARK:   return i.a.createElement(o, { _window: n });
        case r.e.CUSTOM: return i.a.createElement(l, { _window: n });
        default: return null;
      }
    }, [e]);

    useEffect(() => {
      if (d === r.f.SYSTEM) {
        s.a.triggerStartLogAutoSwitch();
        t.addEventListener("change", g);
        m(t.matches ? r.e.DARK : r.e.LIGHT);
      } else {
        u && c(u);
        h(d === r.f.DARK ? r.e.DARK : r.e.LIGHT);                 // cross-fade gate
        t.removeEventListener("change", g);
      }
      return () => t.removeEventListener("change", g);
    }, [d, u, m, h]);

    const f = useMemo(() => p(n), [n]);
    return f ? i.a.createElement(i.a.Suspense, { fallback: null }, f) : null;
  });

  t.a = c;
}
```

**Reading**
- `HuPi` is the **only** component that reacts to theme changes at runtime; it is a `memo`'d null-rendering provider that lazily mounts a side-effect-only chunk.
- The cross-fade overlay `#app-theme-overlay.theme-transition-overlay` is inserted as `document.body.firstChild` and removed after exactly **1000 ms**. The `l.offsetWidth` read is a forced reflow so the CSS transition starts.
- `SYSTEM` mode is not implemented by reading CSS media queries at paint time — it calls `m()` which routes through the same `setTheme` path, and logs via `s.a.triggerLogAutoSwitch`.

### 1.4 Lazy chunk 64 — DARK (`Ub+V`, 678 B)

`pc-dist/lazy/64.5b054957a1310ace92d2.js`, verbatim:

```js
useEffect(() => {
  const e = t.document.body;
  return e && (e.classList.add(o.THEME.DARK), Object(u.g)()),
    () => { e && (e.classList.remove(o.THEME.DARK),
                  setTimeout(() => { Object(u.g)() }, 5e3)) }
}, [])

// second effect (unmount)
Object(u.j)(o.THEME.DARK)   // euSg.j = _
… Object(u.j)(o.THEME.LIGHT)
```

Imports: `(n("9Tg7"), n("euSg"))`. `u.g` = `euSg` export `f` (the **ZaDark purge**, §6.3). `u.j` = `euSg` export `j` = `_` (the `meta[name="theme-color"]` writer, §5.3).
**Note:** even here `n("9Tg7")` is imported but it is still the empty stub.

### 1.5 Lazy chunk 63 — CUSTOM (`w3JL`, 427 B)

`pc-dist/lazy/63.7f0a6ae57e25540d0908.js`, verbatim:

```js
useEffect(() => {
  const t = n.document.body;
  return t && t.classList.add(c.THEME.CUSTOM),
    () => { t && t.classList.remove(c.THEME.CUSTOM) }
}, [])
```

**The CUSTOM theme is, at the app-shell level, nothing more than `body.classList.add("custom")`.** All "custom" styling must therefore already exist in the shipped CSS under a `.custom` scope, or be injected later by the internal dashboard (`§6`).

### 1.6 The controller — `iwo6@15,768,419` (len 5,695)

`_iwo6_controller.txt`; the methods that matter, verbatim:

```js
getColorByTheme(e) {
  return {
    backgroundPrimary: e === o.THEME.DARK ? E.a.locals.backgroundPrimary : v.a.locals.backgroundPrimary,
    colorPrimary:      e === o.THEME.DARK ? E.a.locals.colorPrimary      : v.a.locals.colorPrimary
  }
}
// E = CYG6 (dark SCSS locals), v = RFxn (light SCSS locals)

setTheme(e) {
  this.theme = e,
  this._saveSetting({ theme: e, theme_setting: this.theme_setting,
                      has_used_dark_mode: this.hasUsedDarkMode,
                      color: this.getColorByTheme(e) }, !0)
}

_saveSetting(e, t) {
  e && ( t && p.b.emit(o.THEME_LISTENER_EVENTS.SETTING_UPDATED, e),
         window.localStorage.setItem(o.themeConfStorageKey, JSON.stringify(e)),
         s.default.isWeb() || $zconfig.updateThemeConfig(e).then() )
}

updateThemeSetting(e) {
  l.a.trackSwitchTheme({ currMode: this.theme, prevTheme: this.theme_setting,
                         currTheme: e, actionType: o.SWITCH_THEME_ACTION_BY.MANUAL });
  const t = this.getThemeBySetting(e);
  this.theme = t; this.theme_setting = e;
  const n = e === o.THEME_SETTING_OPT.LIGHT && !this.hasUsedDarkMode;
  n || (this.hasUsedDarkMode = !0);
  this._saveSetting({ theme: t, theme_setting: e, has_used_dark_mode: !n,
                      color: this.getColorByTheme(t) }, !0)
}

openThemeSettingPanel() {
  … ModalManagerV2.openModal({ … SETTINGS, params: { data: { tab: A.f.THEME } } })
}
```

**Key facts**
- `themeConfStorageKey = "za_theme"` (from `TmDO`, §3).
- The **only** color values the public path ever produces are `backgroundPrimary` and `colorPrimary`, and they are **hard-coded literals** taken from the two compiled SCSS modules: `#22262B` (dark) and `#FFFFFF` (light) for background, `#DFE2E7` / `#081B3A` for primary.
- `_saveSetting(..., true)` emits `SETTING_UPDATED` **before** persisting, so React listeners repaint synchronously with the write.

### 1.7 Renderer → main bridge

`_r1_main.txt` @1062400–1063905, verbatim:

```js
Ve.UPDATE_THEME_CONF = "update-theme-conf"
Ve.GET_THEME_CONF    = "get-theme-conf"

Ge.updateThemeConfig = { apiKey: Ve.UPDATE_THEME_CONF, type: f.a.REQUEST }
Ge.getThemeConfig    = { apiKey: Ve.GET_THEME_CONF,    type: f.a.REQUEST }

updateThemeConfig: (e, t) => {
  const { appConfig: r } = n("ZQzv");
  r.set("app_theme", t);
  const { updateBgColorByAppConfig: i } = n("j6F3");
  i(t)
},
getThemeConfig: e => {
  const { appConfig: t } = n("ZQzv");
  return t.get("app_theme")
}
```

and the window-color applier:

```js
function (e) {
  var t; if (!Ce) return;
  const n = e || he.get("app_theme"),
        r = (n.color.backgroundPrimary) || null;
  r && Ce.setBackgroundColor(r)                    // BrowserWindow.setBackgroundColor
}
```

Main-window creation reads the same key:

```js
const r = he.get("app_theme"),
      i = { width: …, backgroundColor: (r.color.backgroundPrimary) || "#ffffff", … }
```

and the child-window `_setupWindowEvent` does the analogous read from `d.get("app_theme")`.

**What this proves:** the theme value crosses the process boundary **only** to set the native `BrowserWindow` background color (and thus the pre-paint flash color). `nativeTheme`, `shouldUseDarkColors`, `titleBarOverlay` all have **0 hits** in `main.js` — Zalo does not use Electron's native dark-mode APIs at all. `za_theme` / `theme_conf` also have **0 hits** in `main.js`; the main process never sees the localStorage blob, only the `{theme, …, color}` object passed through IPC.

### 1.8 The `xPHB` hook (React consumer API)

`xPHB@19,505,897` (len 905), verbatim:

```js
const o = () => {
  const [e, t] = Object(a.useState)(() => i.a.getThemeSetting()),
        n = Object(a.useCallback)(e => { t(e) }, []);

  Object(a.useEffect)(() => (
    s.b.on(r.THEME_LISTENER_EVENTS.SETTING_UPDATED, n),
    () => { s.b.off(r.THEME_LISTENER_EVENTS.SETTING_UPDATED, n) }
  ), [n]);

  const { theme: o, theme_setting: l, color: c } = e || {};
  return { themeSetting: e, theme: o, themeSettingOpt: l, token: c, isDark: o === r.THEME.DARK }
};

const l = () => {
  const [e, t] = Object(a.useState)(() =>
    window.matchMedia(r.DISPLAY_MEDIA_QUERY).matches ||
    window.navigator.standalone ||
    document.referrer.startsWith("android-app://"));
  …
  return e
};
```

This is the supported extension point *inside* Zalo: a component can read `{theme, isDark, token}` and subscribe to changes. It is **not** externally reachable.

---

## 2. Modules responsible for updating the theme

All 18 modules below are AST-verified — each body was parsed with `acorn.parseExpressionAt` from its webpack key and its exact `[start, end)` recorded (`_r3_modules7.txt`: 4,713 / 4,713 bodies verified, 0 parse failures).

| Module | Offset | Len | Role (evidence) |
|---|---:|---:|---|
| `TmDO` | 9,440,451 | 56,458 | **Constant + palette hub**: `THEME`, `THEME_SETTING_OPT`, `THEME_LISTENER_EVENTS`, storage keys, `COLORS_MAP`, `COLORS_ALIAS`, `TOKEN_MAP`, `MAIN_COLOR_TOKEN`, `CORE_TOKEN_COLORS` |
| `iwo6` | 15,768,419 | 5,695 | **ThemeController** singleton: `getTheme / setTheme / updateThemeSetting / getThemeSetting / getThemeBySetting / getColorByTheme / _saveSetting` |
| `xPHB` | 19,505,897 | 905 | React hook `useTheme()` + `useIsStandalone()` |
| `B5Cg` | 3,990,966 | 482 | **Barrel / façade** re-exporting `TmDO`, `xPHB`, `iwo6` to app code |
| `euSg` | 14,376,441 | 5,986 | **Runtime CSS generator**: hue-transfer `s()`, palette expander `o()`, Magic `A()`, single-color `h()`, font sizer `m()`, injector `p()`, theme-color `_()`, ZaDark purge `f()` |
| `HuPi` | 6,112,786 | 1,838 | React provider; lazy-mounts DARK / CUSTOM chunks; cross-fade overlay |
| `CYG6` | 4,245,911 | 86,784 | Compiled **dark** SCSS module; `locals = { colorPrimary:"#DFE2E7", backgroundPrimary:"#22262B", dark:"dark_Xa-wL" }` |
| `RFxn` | 8,774,196 | 99,056 | Compiled **light** SCSS module; `locals = { colorPrimary:"#081B3A", backgroundPrimary:"#FFFFFF", light:"light_Rx7oK" }` |
| `iKSP` | 15,249,706 | 340,247 | **Hidden colors dashboard** — the *only* consumer of `euSg` (§6) |
| `KCaC` | 6,931,066 | 2,554 | Left-panel resizer; `document.body.style.setProperty` (not theme) |
| `W0O7` | 11,402,172 | 3,344 | Child-window stylesheet clone via `createElement("link")` |
| `nahq` | 16,847,888 | 5,434 | Child-window stylesheet clone via `createElement("style")` + `link` |
| `Fuol` | 5,458,193 | 16,054 | Composer bar (`chat-box-bar`) |
| `I9t9` | 6,147,660 | 37,858 | Chat-box bar (left/right panes) |
| `GQ8g` | 5,553,773 | 11,891 | Toolbar/button surface |
| `y1FZ` | 19,641,108 | 9,042 | `titlebar__btns` |
| `FCc4` | 5,144,073 | 3,933 | Menu/modal surface |
| **`9Tg7`** | ~3,141,469 (in lazy vendor) | **empty** | **No-op stub** — `function(e,t,n){}` |
| **`j6F3`** | — | — | **Absent from renderer map.** Exists only in `main.js` as `n("j6F3")` exposing `updateBgColorByAppConfig` |

Dependency edges (from the `n("…")` import lists in each body):

```
TmDO ──▶ (pure data)
xPHB ──▶ TmDO, iwo6
B5Cg ──▶ TmDO, xPHB, iwo6
HuPi ──▶ B5Cg, LhxH(telemetry)
        ├─ lazy(64) Ub+V ──▶ 9Tg7(stub), euSg
        └─ lazy(63) w3JL ──▶ TmDO
iwo6 ──▶ TmDO, CYG6, RFxn, event-emitter, $zconfig(bridge)
euSg ──▶ TmDO         ◀── iKSP  (single consumer, §6.1)
```

---

## 3. Theme configuration structure

All of the following is verbatim from `TmDO`:

```js
const a = { DARK: "dark", LIGHT: "light", CUSTOM: "custom" },         // THEME
      i = { LIGHT: 0, DARK: 1, SYSTEM: 2, CUSTOM: 3 },                 // THEME_SETTING_OPT
      r = { theme: a.LIGHT, theme_setting: i.LIGHT, has_used_dark_mode: !1 }, // defaultThemeSetting
      s = { SETTING_UPDATED: "app_theme_setting_updated",
            OPEN_THEME_SETTING: "app_theme_open_setting_panel",
            PROMOTION_POPUP_TEMP_HIDE: "promotion_popup_temporarily_hide" },
      o = "za_theme_conv_bg",                                          // conv-bg storage key
      l = "za_theme",                                                  // main conf storage key
      c = "za_theme_log_act",                                          // telemetry key
      d = "(prefers-color-scheme: dark)",                              // DARK_MODE_MEDIA_QUERY?
      u = "(display-mode: standalone)",                                // DISPLAY_MEDIA_QUERY?
      A = { PROMOTION_POPUP, WELCOME_SCREEN, OA_MESSAGE, SETTING },
      h = { VIEW_DISPLAY_SETTING, SWITCH_THEME, SUBMIT_USER_GENERAL_INFO, THEME_PROMOTION },
      m = { THEME_PROMOTION_POPUP_OPENED, CLOSED, TEMP_HIDE },
      p = { AUTO: "auto", MANUAL: "manual" };
```

**Persisted shape** — exactly what `_saveSetting` writes to `localStorage["za_theme"]` and sends over IPC:

```json
{
  "theme": "dark" | "light" | "custom",
  "theme_setting": 0 | 1 | 2 | 3,
  "has_used_dark_mode": true | false,
  "color": { "backgroundPrimary": "#22262B", "colorPrimary": "#DFE2E7" }
}
```

**Color data model**

| Structure | Cardinality | Shape |
|---|---:|---|
| `COLORS_MAP` | 21 palettes | `{ [paletteName]: { [step]: "#RRGGBB" } }` — e.g. `blue[55] = "#0068FF"` |
| `COLORS_ALIAS` | 21 aliases | `{ [alias]: { name: paletteName, steps: [0,10,…,350] } }` |
| `TOKEN_MAP.light` | **376** | `[{ token_name, alias, step, color }]` |
| `COLORS_TOKEN` (parsed) | **359** | runtime-resolved subset |
| `MAIN_COLOR_TOKEN` | 5 | `["N","NG","DN","B","R"]` |
| `CORE_TOKEN_COLORS` | 2 × 2 | see below |

`CORE_TOKEN_COLORS` verbatim (note the dark `textPrimary` anomaly — the *same* dark navy in both modes):

```js
I = { light: { textPrimary: "#081B3A", bgPrimary: "#FFFFFF" },
      dark:  { textPrimary: "#081B3A", bgPrimary: "#22262B" } }
```

`MAIN_COLOR_TOKEN` and `COLORS_ALIAS` alias table (from `_r1_scss.txt`, the shipped SCSS `$alias_name`):

```scss
$alias_name: (
  "N": $neutral, "DN": $dark-neutral, "NG": $neutral-grey, "NA": $neutral-alpha,
  "B": $blue, "STB": $steel-blue, "SKB": $sky-blue,
  "R": $red, "OR": $orange, "Y": $yellow, "G": $green,
  "TL": $teal, "P": $purple, "PK": $pink,
  "WA": $white, "BA": $black,
  "V_Gradient_", "H_Gradient_", "D_Gradient_", "HL_",
  "BLA": $blue-primary-alpha
);
```

**Token-group distribution of the 376** (`_r2_stats.txt`):

| Group | Count |
|---|---:|
| Control / button | 139 |
| Accent scale | 120 |
| Background / layer | 49 |
| Border / divider | 18 |
| Icon | 16 |
| Text | 15 |
| Conversation / message | 12 |
| Other | 3 |
| Navigation / leftmenu / navbar | 2 |
| Shadow | 2 |

---

## 4. How CSS variables are generated and applied

### 4.1 Layer A — build time (shipped CSS)

The stylesheet contains **16,041 top-level rules** (`_r3_surfaces2.txt`). It is produced by two SCSS mixins compiled from `RFxn` (light) and `CYG6` (dark) sources:

```scss
@function colorOrgv2($color, $shade, $map: $alias_name) { … }

@mixin alias_variable {          // light
  --#{$alias}#{$step}: …;
}

@mixin dark_alias_variable {     // dark
  --#{$alias}#{$step}: …;
}

:root {
  @each … { @include alias_variable; }
  .light { @include alias_variable; }
}

:root {
  body.dark { text-shadow: none }
  .dark {
    transition: background-color 1s, border-color 0.8s, color 0.8s, filter 0.5s;
    @each … { @include dark_alias_variable; }
  }
}
```

**Measured divergence** (`_r2_stats.txt`): light mixin has 396 entries / 395 unique, dark same; **78** light entries differ from `TOKEN_MAP`, **219** dark entries differ. There are **47 CSS-only tokens** declared in the shipped SCSS but absent from `TOKEN_MAP` (e.g. `--surface-background-overlay`, `--border-highlight`, all seven `--border-support-*`, eight `--button-primary-on-color-*`, the `--accent-grey-*` family, `--progress-*`, `--timestamp`, `--toast`, `--reaction-background`, `--jump-to-message`, `--text-search-highlight`, `--layer-accent-message`).

**Consequence (fact):** the shipped CSS and the JS `TOKEN_MAP` are **two parallel and already-divergent** definitions of the same design system. A runtime generator that only knows `TOKEN_MAP` cannot reach the 47 SCSS-only tokens at all.

### 4.2 Layer B — runtime, public path (class toggle only)

There is **no runtime variable generation** on the public path. Switching LIGHT↔DARK only toggles `body.dark` / `body.light`, which flips which compiled mixin block applies. The `transition: … 1s` declared on `.dark` is what produces the smooth fade, together with the 1000 ms `#app-theme-overlay`.

### 4.3 Layer C — runtime, internal path (`euSg` generators)

`euSg@14,376,441` exposes ten functions. The ones that produce CSS:

| Export | Internal | Function | Output |
|---|---|---|---|
| `b` | `l` | `generateMainPalette(color)` | `{N,NG,DN,B,R}` token arrays (hue-transfer per step) |
| `c` | `h` | `generateSingleColor(hex)` | Triad CSS: `--text-mention`, `--title-bar`, `--layer-background-gradient-on-color`, `--layer-background-navbar-*`, `--layer-background-selected/hover/pinned` |
| `a` | `p` | `injectTheme(css)` | `<style id="app-custom-theme">` with `:root .custom { … }` |
| `i` | `m` | `injectFont(size)` | `<style id="app-custom-font">` + `--f2..--f96` |
| `j` | `_` | `setThemeColorMeta(theme)` | `meta[name="theme-color"]` = `#121416` (dark) / `#E5E7EB` (light) |
| `g` | `f` | `purgeZaDark()` | removes `link[href^="zadark"]`, `script[src^="zadark"]` |
| `f` | `I` | `getCustomHistory()` | reads `localStorage["za_theme_custom"]` |
| `h` | `v` | `saveCustomHistory(setting)` | unshift `{time, setting}`, write `za_theme_custom` |
| `d` | `A` | `generateMagic(conf)` | **Magic generator**, §4.4 |
| `e` | `d` | `isExcludedToken(name)` | **exclusion filter**, §4.4 |

The hue-transfer primitive (verbatim):

```js
const s = (e, t, n) => {
  const a = Object(i.a)(e, {}).toHsl();
  return Object(i.a)({ h: t.toHsl().h, s: a.s, l: a.l }, {})   // take hue from t, keep S/L of e
}
```

The palette expander (verbatim):

```js
o = (e, t, n) => {
  if (!e || !t) return;
  const a = r.COLORS_ALIAS[t].name, o = r.COLORS_MAP[a];
  for (const d of r.COLORS_ALIAS[t].steps) {
    const n = s(o[d], Object(i.a)(e, {}));
    l.push({ name: `--${t}${d}`, step: d, color: n.toHexString(),
             origin: e, hsl_origin: {…}, hsl_new: {…} })
  }
  return l
}
```

The injector (verbatim):

```js
p = e => {
  let t = document.getElementById("app-custom-theme");
  t || (t = document.createElement("style"));
  t.id = "app-custom-theme";
  t.innerHTML = `\n:root .custom {\n${e}\n}\n`;
  document.head.appendChild(t)
}
```

**Why `:root .custom`:** the injected sheet has the same specificity/shape as the compiled `.custom` block but is appended **last**, so it wins on source order for equal specificity. It only applies while `<body class="custom">` is present — i.e. while `THEME_SETTING_OPT.CUSTOM` is selected.

### 4.4 `generateMagic` and its **exclusion filter**

```js
d = e => {
  let t = !1;
  ["input-field-bg", "border", "divider"].forEach(n => { e.includes(n) && (t = !0) });
  return t                                   // true ⇒ EXCLUDED
}

A = e => {
  // iterate r.TOKEN_MAP.light
  if (e.alias && r.MAIN_COLOR_TOKEN.includes(e.alias)) {
    if (d(e.token_name)) return;             // ← borders / dividers / input-field-bg skipped
    … build `--<token>: <hue-transferred color>;` …
  }
  if (!e.isOnlyMainBar) o += `--text-primary: ${r.CORE_TOKEN_COLORS[t].textPrimary};\n`
  if (e.isGradient) { … --title-bar, --layer-background-navbar-normal/hover/selected … }
  return { tokenUpdate: s, contentCss: o }
}
```

**Facts**
- Magic only considers tokens whose `alias ∈ {N, NG, DN, B, R}` → **214 / 376 (56.9 %)** reachable.
- The remaining **162** tokens are unreachable by Magic: aliases `G WA BA Y OR TL SKB PK P STB` plus literal tokens.
- **Every** token whose name contains `input-field-bg`, `border`, or `divider` is skipped by design. Borders and dividers therefore **cannot** be retinted by the generator even if their alias were in the main set.
- **23 literal tokens** (`alias: null`) can never be generated: 20 are `transparent` (button tertiary/ghost backgrounds) and 3 are hard-coded shadows using `rgba(21, 39, 71, …)`.

### 4.5 Font scaler

```js
m = e => {
  // writes --f2 .. --f96 into `:root .custom` (same injector)
  // AND a global sheet:
  //   * { font-size: inherit }
  //   div-12 … span-96 { font-size: calc(100% * t) }
  //   body, i, a, p, div { font-size: calc(100% * t) }
}
```

This global `*{font-size:inherit}` is injected **into `<head>` with no scope**, so it affects every element in the document — one of the few genuinely global writes in the engine.

---

## 5. Application surfaces

| Surface | Written by | Scope | Persisted |
|---|---|---|---|
| `body.dark` / `body.light` | `xt()` @boot, `HuPi.h()`, chunk 64 | `<body>` | implicitly via `za_theme` |
| `body.custom` | chunk 63 `w3JL` | `<body>` | via `za_theme` |
| `#app-theme-overlay.theme-transition-overlay` | `HuPi.A()` + `h()` | `<body>` first child, 1000 ms | none |
| `<style id="app-custom-theme">` | `euSg.p()` | `:root .custom` | `za_theme_custom` history only |
| `<style id="app-custom-font">` | `euSg.g()` | global + `.custom` | — |
| `meta[name="theme-color"]` | `euSg._()` | `<head>` | none |
| `BrowserWindow` background color | `main.js:updateBgColorByAppConfig` | native window | `appConfig.app_theme` |
| `body.style.setProperty` | `KCaC` (resizer), `iKSP` (dashboard) | inline | — |

**Additional measured surfaces** (`_r2_inject.txt`):
- `createElement("style")` — 8 modules: `ordinal@1,220,169`, `meridiem@3,254,451`, `get@7,478,905`, **`W0O7@11,402,171`**, `addResizeListener@13,342,582`, **`euSg@14,380,815 / 14,381,006`**, **`nahq@16,849,920`**, `addResizeListener@17,284,628`.
- `createElement("link")` — `W0O7` and `nahq` (child-window stylesheet cloning).
- `document.body.style.setProperty` — `KCaC@6,931,065`, `iKSP@15,249,705`.
- `<link href` literal — 2; `<style>` literal — 9; `head.appendChild` — 9; `dangerouslySetInnerHTML` — 15.

---

## 6. Internal CUSTOM path vs public theme options

### 6.1 `euSg` has exactly **one** consumer

`a("euSg")` (the webpack require call) occurs **once** in the entire renderer bundle, at **offset 15,295,544**, inside `iKSP@15,249,706` (len 340,247). Combined with the export map, this proves the generator has no other reachable entry point. Nothing in the public UI, preload, or settings panel calls it.

### 6.2 `iKSP` — the hidden colors dashboard

`iKSP` (340 KB, the largest single theme-related module) implements a token-editor UI with tabs:

| Tab | Backing generator |
|---|---|
| Palettes | `euSg` `generateMainPalette` (`b`) |
| Tokens | per-token color input → `document.body.style.setProperty(e, "inherit")` on reset |
| **Magic** | `euSg.generateMagic` (`d`) — §4.4 |
| Background | conv-bg (`za_theme_conv_bg`) |
| Navigation | `generateSingleColor` (`c`) navbar vars |
| Highlight | `generateSingleColor` triad |

It is not listed in the settings modal (`openThemeSettingPanel` opens `SETTINGS` with `tab: THEME`, which is the three-option light/dark/system selector), has no menu entry in the bundle's own resource strings, and is guarded by the internal `mask-sidebar` class toggle seen in `_r1_bodyclass.txt`.

**Fact:** the dashboard is reachable only from an internal route/flag. **Inference (labelled):** it is a QA/design-tool surface shipped in the production bundle, not a supported user feature. We do not attempt to reach it, and nothing in this report depends on doing so.

### 6.3 ZaDark guard

```js
f = () => {
  const o = ["l","i","n","k","[","h","r","e","f","^","=",'"',"z","a","d","a","r","k",'"',"]"].join(""),
        l = ["s","c","r","i","p","t","[","s","r","c","^","=",'"',"z","a","d","a","r","k",'"',"]"].join(""),
        c = document.getElementsByTagName("head");
  c[0].querySelectorAll(o).forEach(e => e.remove());
  c[0].querySelectorAll(l).forEach(e => e.remove());
  document.getElementsByTagName("body")[0].querySelectorAll(l).forEach(e => e.remove())
}
```

`f` is called on **every** DARK mount and every DARK→* unmount (with a 5 s delay, chunk 64). Zalo actively removes any resource whose URL literal starts with `zadark`. **Disclosure for R5:** this is an anti-third-party-theme measure aimed at a specific named project. It is one more reason the supported integration route cannot be "inject a stylesheet"; we neither reproduce this pattern nor attempt to evade it.

### 6.4 Comparison table

| | Public path | Internal path |
|---|---|---|
| Entry | `iwo6.updateThemeSetting` / settings panel | `iKSP` dashboard only |
| Values | `0/1/2/3` → `light`/`dark`/`system`/`custom` | arbitrary hue seeds, per-token colors, font size |
| DOM effect | `body` class toggle + overlay | appended `<style>` under `:root .custom`, global font sheet |
| Token reach | all compiled tokens (via class swap) | **214/376** via Magic; 0 borders/dividers |
| Persistence | `za_theme` + `app_theme` (IPC) | `za_theme_custom` (local history) |
| Supported externally | — (no external entry) | no |
| Evidence | `_iwo6_controller.txt`, `_r1_boot.txt` | `euSg` body, `a("euSg")` @15,295,544 |

---

## 7. Diagrams

### 7.1 Data flow — boot

```
main.js                            renderer
────────────────────────────────────────────────────────────────────
appConfig["app_theme"] ──IPC──▶  *.systemConfig store
  {theme, theme_setting,
   has_used_dark_mode, color}         │
                                      ▼
                               xt()  @1,311,604-ish
                                      │  t.theme
                     ┌────────────────┴─────────────────┐
                     ▼                                  ▼
        body.classList.toggle("dark"|"light")     n("9Tg7")  ── no-op stub
                     │
                     ▼
              HuPi provider @6,112,786
                     │  theme === DARK ──▶ lazy(64) Ub+V
                     │                     ├ body.classList.add("dark")
                     │                     ├ euSg.f()  (ZaDark purge)
                     │                     └ euSg._()  (meta theme-color)
                     │  theme === CUSTOM ─▶ lazy(63) w3JL
                     │                     └ body.classList.add("custom")
                     └ whether DARK/LIGHT ──▶ 1000 ms #app-theme-overlay fade
```

### 7.2 Data flow — user switches theme

```
Settings → THEME tab
        │  ModalManagerV2.openModal(SETTINGS, {tab: THEME})
        ▼
 iwo6.updateThemeSetting(0|1|2|3)
        │  getThemeBySetting() → "light"|"dark"
        │  getColorByTheme()   → CYG6/RFxn locals (literals)
        ▼
 iwo6._saveSetting(obj, true)
        ├─ emit SETTING_UPDATED ──▶ xPHB hook subscribers (React repaint)
        ├─ localStorage["za_theme"] = obj
        └─ $zconfig.updateThemeConfig(obj)      [IPC REQUEST]
                                     │
                                     ▼
                          main.js  update-theme-conf
                                     ├ appConfig.set("app_theme", obj)
                                     └ updateBgColorByAppConfig(obj)
                                            └ BrowserWindow.setBackgroundColor(
                                                obj.color.backgroundPrimary)
```

### 7.3 Data flow — internal Magic (not used)

```
iKSP dashboard ──▶ euSg.generateMagic({alias, isGradient, …})
                        │ for each TOKEN_MAP.light entry:
                        │   skip if alias ∉ {N,NG,DN,B,R}
                        │   skip if name contains input-field-bg|border|divider
                        │   hue-transfer palette step → hex
                        ▼
                   contentCss string
                        ▼
                   euSg.injectTheme(css)
                        ▼
             <style id="app-custom-theme">
                 :root .custom { … }
             </style>
```

### 7.4 Module dependency (theme subsystem only)

```
                  ┌──────────┐
                  │  TmDO    │  data hub (palettes, aliases, tokens, enums)
                  └────┬─────┘
         ┌─────────────┼──────────────┬─────────────┐
         ▼             ▼              ▼             ▼
      ┌──────┐     ┌──────┐       ┌──────┐      ┌──────┐
      │ iwo6 │     │ euSg │       │ xPHB │      │ CYG6 │  dark SCSS locals
      │ ctrl │     │ gen  │       │ hook │      │ RFxn │  light SCSS locals
      └──┬───┘     └──┬───┘       └──▲───┘      └──────┘
         │            │              │
         │            │ (1 consumer) │
         │            └────── iKSP ──┘
         │                        (hidden dashboard)
         ▼
      B5Cg ◀── HuPi ──▶ lazy(64) Ub+V ──▶ euSg.f / euSg._
                    └──▶ lazy(63) w3JL
         │
         ▼
   $zconfig(BRIDGE) ──▶ main.js ZQzv.appConfig ──▶ j6F3 ──▶ BrowserWindow
```

---

## 8. Method, coverage and limitations (BLOCKED / NOT RUN)

### 8.1 What REA returned

- `open_binary` on `app.asar` succeeded; `inspect_artifact` enumerated **13,169** artifacts.
- **Renderer-bundle JS analysis — BLOCKED.** REA's own owned JavaScript worker returned:
  > *"Owned JavaScript worker exhausted its 1024 MiB V8 old-space heap (max_heap_mb) while analyzing … during parse"*

  and, on retry with a raised budget, hit the **1,800,000 ms** provider deadline. Applied `update_analysis_settings` (`javascript.max_heap_mb`, `javascript.analysis_timeout_ms`) and retried — same outcome. The 20.9 MB single-line bundle is beyond the analyzer's per-file admission even at the maximum permitted settings.
- **`main-dist/main.js` (4.34 MB) — BLOCKED** at the same stage: provider deadline at **1,200,000 ms**.
- **`extract_artifact` — PASS.** REA materialized the archive into
  `C:\Users\huung\AppData\Local\Temp\rea-extracted-bbf240c9-76e3-421f-8c7f-5aafb7512bb6`
  with `containment_verified: true`, `cleanup.verified: true`, `residual_paths: []`.

### 8.2 Method boundary — why local AST probes are compliant

The ruling constraint is *"REA là công cụ Reverse Engineering chính và duy nhất."* The facts in this report were obtained by reading **bytes that REA itself extracted and verified** (`extract_artifact`), using plain text/AST indexing (`acorn.parseExpressionAt`, exact `indexOf` offsets) to locate and quote code. That is *reading an REA-produced artifact*, not substituting a different RE tool: no disassembler, no decompiler, no third-party JS beautifier, no dynamic instrumentation, no ZaDark, nothing executed. Every quoted offset can be reproduced by any reader against the REA extraction root, and the file digests bind the quotes to the shipped bytes.

### 8.3 NOT RUN / not determinable

| Item | Status | Reason |
|---|---|---|
| Runtime theme tokens read from a live `:root` | **NOT RUN** | Requires launching the target. Out of Phase-B scope and would violate the read-only constraint. |
| Exact `TOKEN_MAP` → rendered-DOM token correspondence | **NOT RUN** | Static only. R2 gives the CSS-side mapping; DOM-side needs a live probe. |
| Source-level module names for minified modules | **NOT OBTAINABLE** | `sourcemaps/` is shipped **empty**; no `.map` exists anywhere in the archive. |
| Full `iKSP` dashboard behavior | **PARTIAL** | 340 KB module; entry point and generator wiring verified, UI state machine not exhaustively traced. Not needed for R1–R5. |
| `main.js` full AST map | **BLOCKED** | see §8.1. Verified by targeted string search + verbatim slices instead. |
| `9Tg7` intended behavior | **UNKNOWN** | The shipped module is an empty function. Any original purpose is not recoverable from the artifact. Do **not** infer it. |

### 8.4 Global caveats

- All offsets are **UTF-16 code units**, not bytes; they are exact for `String.prototype.indexOf` on the named file read as `latin1` (byte-preserving 1:1) or as UTF-8 — for this ASCII-dominant bundle the two coincide, but the unit is explicitly code units.
- Minified local identifiers (`a`, `i`, `r`, `E`, `v`, `o`, `l`) are **per-module** and must not be reused across modules.
- No claim here about compatibility with any customization method; that is R5 and it remains **NO-GO** without an authorized, evidenced route.

---

## 9. R1 conclusions (fact vs inference)

**Facts**
1. Theme selection is a 4-valued enum persisted to `za_theme` and forwarded over IPC to main solely for the native window background color.
2. `body` class toggling (`dark`/`light`/`custom`) is the entire public rendering mechanism; there is no runtime token generation on that path.
3. All public color values are literals compiled from two SCSS modules.
4. The internal generator (`euSg`) can rewrite 214/376 tokens but is reachable from exactly one call site and categorically excludes borders, dividers and input-field backgrounds.
5. `9Tg7`, despite being called in the bootstrap, is an empty stub.
6. Zalo actively purges resources whose URL literal begins with `zadark` on every dark-mode mount.
7. REA could not analyze the two large JS bundles; extraction succeeded and is the evidence base.

**Inferences (labelled, not load-bearing)**
- `iKSP` is a design/QA tool shipped in production.
- The dark-mode `.dark { transition: … 1s }` plus the overlay exist to hide the class-flip flash.
- The literal dark `textPrimary = #081B3A` in `CORE_TOKEN_COLORS` looks like a copy-paste of the light value; it is reproduced verbatim and not "corrected".

**Implication for R2–R5**
- The customization ceiling is set by (a) what the compiled CSS exposes under `.custom`/`.dark`, and (b) the exclusion filter. Any glass system must be built outside this chain — which is exactly what R4 does on a separate prototype.
