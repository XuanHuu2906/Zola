# Zalo PC theme/customization feasibility (P2)

Date: 2026-11-05 (Asia/Saigon). Status: **NO-GO for P3** — unchanged.
Scope: read-only inspection of the installed Zalo PC client. Nothing was modified,
injected, attached to, or executed.

## Why this report exists

`AGENT_PLAN.md` P2 asks whether Zalo supports a theme/plugin/customization channel,
and requires the answer to be recorded in `docs/ADR-001-integration-strategy.md`
with evidence, risk, maintenance cost, rollback and limits.

The earlier G4 report (`ZALO_ARCH_RECON.md`) was metadata-only and said so. It could
not answer the theme question, because answering it required reading bundled
JavaScript. This report records that second, deeper step and — importantly — what it
did and did not establish.

## Evidence inventory

| Artifact | What it is | How produced |
| --- | --- | --- |
| `zalo-deep-survey-20261105-213452.json` | Packaging hashes, Authenticode, PE machine, Electron fuses, embedded versions, process list | `tools/Verify-ZaloSurvey.ps1` (read-only) |
| `zalo-deep-survey-20261105-213350.json` | Same script, earlier run with a broken fuse parse (`count: -41`) | Superseded — do not cite |
| `zalo-asar-index-20261105.json` | ASAR **file index only**: 13,169 files / 62 dirs, `payloadsRead: false` | `tools/Inspect-AsarIndex.ps1` |
| `_tmp_main.js` (4,342,755 B) — **deleted 2026-11-05**, SHA-256 `a0150ebc…97a2f6a9` | Copy of `main-dist/main.js`, the main-process bundle | `tools/query-asar-index.cjs cat` |
| `_tmp_compact.js` (20,927,993 B) — **deleted 2026-11-05**, SHA-256 `6ec04117…8faaf415` | Copy of `pc-dist/compact-app-pc.f32c58b6….js`, the renderer bundle | `tools/query-asar-index.cjs cat` |
| `_tmp_preload.js` (1,990,534 B) — **deleted 2026-11-05**, SHA-256 `24c5ecb8…f2f61602` | Copy of `main-dist/preload-render.js` | `tools/query-asar-index.cjs cat` |
| `pc-dist/compact-app-pc.f32c58b6….css` (2.33 MB) | Stylesheet, probed in-place via `find` | `tools/query-asar-index.cjs find` |

### Authorization provenance

The G4 metadata sweep ran after explicit user approval of `tools/Inspect-Zalo.ps1`
(see `RECON_PREFLIGHT.md`). The deeper payload read recorded below was performed under
the user's instruction to complete P2, which requires answering the theme question. It
stayed within the same hard limits — read-only, no attach, no execution, no profile or
account data — but it went beyond what the G4 preflight described, so it is disclosed
here rather than folded into the earlier approval. If the user judges it out of scope,
the copies can be deleted; nothing in the project depends on them.

### Disclosure correcting earlier wording

`reports/ZALO_ARCH_RECON.md` and `reports/RECON_PREFLIGHT.md` state that no `app.asar`
payload content was read. That was true of the G4 metadata sweep. It is **not** true of
the deeper pass recorded here: three JavaScript bundles were copied out of the archive
and read, plus CSS probes. No profile, chat database, credential, media asset, network
traffic or account data was read; the reader is capped by byte size in
`tools/query-asar-index.cjs`. All reads were of application code shipped in the signed
package, for the sole purpose of identifying UI surfaces — the activity the G4
`notInspected` clause anticipated.

## Findings

### 1. The client is Electron 22.3.9 / Chromium 108, fused as a normal consumer build

`sandbox`-relevant fuses at sentinel offset 112,166,917 (wire version 1, 7 entries):
`RunAsNode`, `EnableCookieEncryption`, `EnableNodeOptionsEnvironmentVariable`,
`EnableNodeCliInspectArguments` enabled; `EnableEmbeddedAsarIntegrityValidation`,
`OnlyLoadAppFromAsar`, `LoadBrowserProcessSpecificV8Snapshot` disabled.

`EnableEmbeddedAsarIntegrityValidation: disabled` and `OnlyLoadAppFromAsar: disabled`
mean the packaged `app.asar` is **not** integrity-checked at load. That is a structural
fact about the shipped build, not an invitation: using it would mean editing the signed
package, which is exactly the route the ADR already marks NO-GO.

### 2. The main window exposes no third-party preload or extension slot

`main-dist/main.js` @ 2,696,309 (`function Rn`, main window creation):

```js
frame: !1, titleBarStyle: "hidden", show: !1,
backgroundColor: (r?.color?.backgroundPrimary) || "#ffffff",
webPreferences: {
  webSecurity: !oe(), allowRunningInsecureContent: oe(), devTools: !0,
  partition: "persist:zalo",
  webgl: !0, experimentalFeatures: !0, experimentalCanvasFeatures: !0,
  backgroundThrottling: !1,
  nodeIntegration: !1, contextIsolation: !0, sandbox: !1,
  preload: c.join(__dirname, "preload-render.js")
}
```

`contextIsolation: true` + `nodeIntegration: false` + a fixed, single preload path.
There is no configuration value read from disk that would let a third party add a
preload or an extension to this window. (Other windows in the bundle use the same
shape: `sandbox: false` appears at 5 sites and `contextIsolation: true` at 7.)

### 3. The preload bridge is a closed allowlist

`main-dist/preload-render.js` contains 42 `contextBridge` references / 41
`exposeInMainWorld` calls — a fixed API surface with named entries such as `$zconfig`.
It contains **0** `executeJavaScript` and **0** `insertCSS` calls. Nothing in the bridge
accepts arbitrary CSS or arbitrary script from the page.

### 4. Zalo has a real, first-party theming system — including a CUSTOM mode

`pc-dist/compact-app-pc.f32c58b6….js` @ 9,412,869 (theme module exports):

```js
const a = { DARK: "dark", LIGHT: "light", CUSTOM: "custom" },
      i = { LIGHT: 0, DARK: 1, SYSTEM: 2, CUSTOM: 3 },
      r = { theme: a.LIGHT, theme_setting: i.LIGHT, has_used_dark_mode: !1 },
      s = { SETTING_UPDATED: "app_theme_setting_updated",
            OPEN_THEME_SETTING: "app_theme_open_setting_panel",
            PROMOTION_POPUP_TEMP_HIDE: "promotion_popup_temporarily_hide" },
      o = "za_theme_conv_bg", l = "za_theme", c = "za_theme_log_act";
```

Persistence (@ 15,735,054):

```js
_saveSetting(e, t) {
  e && (t && p.b.emit(THEME_LISTENER_EVENTS.SETTING_UPDATED, e),
        window.localStorage.setItem(themeConfStorageKey, JSON.stringify(e)),
        s.default.isWeb() || $zconfig.updateThemeConfig(e).then())
}
```

Main-process side: the client channel map (`main.js` @ 1,031,775) defines
`UPDATE_THEME_CONF="update-theme-conf"` / `GET_THEME_CONF="get-theme-conf"`, handled at
@ 1,032,721 by
`updateThemeConfig: (e,t) => { appConfig.set("app_theme", t); updateBgColorByAppConfig(t) }`
and `getThemeConfig: () => appConfig.get("app_theme")`. The stored value feeds window
creation: `backgroundColor` comes from `app_theme.color.backgroundPrimary`.

So the theme preference round-trips renderer → main process → window background color.
This is a genuine, supported-by-the-client mechanism — **for the client's own settings
UI**.

### 5. The CUSTOM surface is a hidden dashboard, reachable only from a debug menu

The CUSTOM UI exists (`compact-app-pc…js` @ 15,265,759):

```jsx
<div className="colors_dashboard">
  <div className="colors_dashboard-header">
    <h4>Personalize Your Look & Feel</h4>
    <div className="colors_action-header">
      … ImageRadio DARK / LIGHT / SYSTEM / "Custom"
    </div>
  </div>
  <Tabs tabs={[ { textKey: "Palettes", … }, { textKey: "Tokens", … } ]} />
```

with per-token color pickers (`z-color-input`, `type="color"`, first at @ 15,263,136)
writing `--<alias><step>` CSS custom properties and a generated `contentCss` string
(@ 14,345,338) covering `--text-primary`, `--title-bar`,
`--layer-background-navbar-normal|hover|selected`. The dashboard also carries per-group
and per-friend chat-background overrides (`z_chatbg` via `useChatBg`) — still Zalo's
own UI, not an external theming contract.

Reachability is the decisive part. `SHOW_THEME_SETTING_VIEW` appears 4 times in the
whole 20 MB bundle:

| # | Offset | Role |
| --- | --- | --- |
| 1, 2 | 3,507,192 / 3,507,217 | Enum declaration (`SideBarActions`) |
| 3 | 12,283,253 | The **only** dispatcher — a context-menu item |
| 4 | 15,552,137 | Reducer: maps the action to `THEME_SETTING_PAGE` |

`THEME_SETTING_PAGE` is enum value `14`. The router then renders the dashboard
component itself (@ 15,516,940): `chatview.view == Fl.THEME_SETTING_PAGE` →
`createElement(Dt, …)`, and `Dt` is the `colors_dashboard` component
(@ 15,263,403). So the dashboard is wired and functional — just not reachable from
normal UI.

The sole dispatcher (offset 12,283,156) is embedded in a debug context menu next to
"Business Account → Convert to domain profile DEV", "Multi window → Package
information", "Simulate renew link fail", "Copy UID" and `IN_69_TESTING`-gated
"Debug Error -69" entries:

```js
c.push({ type: o.SUBMENU, text: "Personalize theme",
         onclick: () => { ct.h.updateThemeSetting(ct.f.CUSTOM),
                          i && i({ type: S.SideBarActions.SHOW_THEME_SETTING_VIEW }) } }),
```

The user-facing path is different and narrower. `OPEN_THEME_SETTING` has real emitters
— e.g. a welcome-screen `darkmode_support` CTA `STR_TRY_NOW` (@ 1,782,682) and a
dynamic-banner action `action.open.theme_setting` (@ 19,035,798) — all of which reach
`openThemeSettingPanel` (@ 15,737,240), which opens the **Settings modal on the THEME
tab**. That panel's `Ut()` render function (@ 8,003,200) exposes exactly three
ImageRadios — `STR_SETTINGS_DEFAULT` / `STR_SETTINGS_DARKMODE` / `STR_SETTINGS_SYSTEM`.
CUSTOM is not among them.

There are **0** occurrences of `executeJavaScript`, `insertCSS`, `injectCSS` or
`webContents` in the renderer bundle, and 0 `executeJavaScript` / `insertCSS` /
`injectCSS` in the main bundle. Theme CSS is applied by the app's own token module —
`Object(dt.a)(n)` where `{contentCss: n}` comes from `Object(dt.c)(value, false)` in the
`z-color-input` handler (@ 15,263,136) — so it is an internal module call, not an
exposed injection point.

### 6. The stylesheet is a normal token-based design system

The 2.33 MB `compact-app-pc….css` defines palettes as CSS custom properties, e.g.
`--layer-background-leftmenu: #1d2025`, `--layer-background-navbar-normal: #121416`,
`--layer-background-navbar-hover: hsla(0,0%,100%,0.1)`. This is why the CUSTOM
dashboard can retheme the app — and also why copying those token *names* into a
standalone demo is a design-inspiration question, not an integration route.

## What this does and does not establish

**Established:** Zalo PC ships a first-party theme system with a CUSTOM token
dashboard; the dashboard is debug-gated; the shipped renderer and preload expose no
third-party CSS/script hook; the ASAR is not load-integrity-checked.

**Not established:** any authorized way for a third party to use the theme system.
The absence of a hook is evidence against an extension point; it is not proof that
none exists in some code path not inspected. No Zalo function was executed or tested,
so **all real Zalo behavior remains UNKNOWN / NOT TESTED**.

## Options considered

| Route | Reality check | Verdict |
| --- | --- | --- |
| Ask user to enable CUSTOM in Zalo settings | Dashboard is debug-gated; no supported UI reaches it in 26.10.20 | Not a product route |
| Third-party preload / extension | Fixed preload path, no extension loading, `contextIsolation: true` | No supported mechanism |
| Patch `app.asar` (integrity validation is off) | Technically possible; modifies a signed VNG package, crosses the update boundary, and is a Terms 4.4/4.5 concern | **NO-GO** per ADR |
| Read/write `za_theme` in localStorage or `app_theme` config | Requires code execution inside the renderer to matter; we have none | Not reachable |
| Mirror the token *design language* into the standalone demo | Legal and safe: our own CSS, our own tokens, no Zalo code | **Allowed — already the project path** |
| Zalo Web customization | Separate client, parity unproven, permission undocumented | NEEDS AUTHORIZATION |

## Risk and maintenance cost

| Route | Risk | Maintenance |
| --- | --- | --- |
| Standalone demo (chosen) | None to Zalo; fictional data only | Owned by us; no upstream coupling |
| ASAR patch | Breaks on every update; signature invalid; ToS exposure; user data at risk | Total — re-diff each release |
| Preload injection | No hook exists; would require patching to create one | Total |
| Zalo Web | Unknown authorization; selectors/API drift | Medium, but blocked on gate |

## Rollback

The demo needs none beyond closing it or opening `legacy/index.html`. No Zalo file,
registry key, profile or process was modified by any work recorded here, so there is
nothing to roll back on the client.

## Decision

**NO-GO for P3**, unchanged. The new evidence *narrows* the picture — Zalo does have
a rich internal theme engine — but it strengthens rather than weakens the decision:
the engine is Zalo's own, gated behind a debug menu, and the packaged renderer offers
no third-party hook to reach it. The correct use of this knowledge is design
inspiration for our standalone demo, not client integration.

P3 reopens only if someone produces a **documented, supported** integration route plus
authority for the precise change and an isolated test account — the gate in
`docs/ADR-001-integration-strategy.md`.

## Limitations

- Offsets are **UTF-16 code-unit positions in the decoded JS text** (from `indexOf` on
  the file read as a string), not byte positions and not ASAR file offsets. The bundles
  contain multi-byte characters, so the two diverge (e.g. `compact-app-pc….js` is
  20,927,993 bytes but 20,864,497 code units). To re-verify, search for the quoted
  literal rather than seeking to the number. Offsets are also not stable across Zalo
  versions; only the strings and the shipped-app version are.
- The three bundle copies (`reports/_tmp_main.js`, `_tmp_compact.js`,
  `_tmp_preload.js`) and the misnamed scratch file `_tmp_theme_module.txt` were
  **deleted on 2026-11-05** with the user's approval. They were unmodified copies of
  signed application code held only as working evidence. Their SHA-256 digests are
  recorded in the Evidence inventory above so the exact bytes remain identifiable;
  the bundles themselves can be regenerated from the installed client with
  `tools/query-asar-index.cjs cat`. Consequences to be honest about:
  - Until they are regenerated, the offsets cited in this report cannot be re-checked
    locally by seeking — search the quoted literal in a fresh copy instead.
  - `_tmp_theme_module.txt` backed no claim here: it held DAL/worker message handling
    and contained 0 occurrences of "theme". Its loss costs nothing.
- Only 26.10.20 was examined. Another build may gate or expose things differently.
- Static reading only: no execution, so no claim about what the CUSTOM dashboard
  actually renders at runtime.
- The counts quoted (0 `insertCSS`, 4 `SHOW_THEME_SETTING_VIEW`, etc.) are literal
  substring counts over minified code. A dynamically-computed channel name would not be
  counted; this weakens "absent" slightly and does not affect the reachability finding,
  which rests on the dispatcher and renderer chain being present and explicit.
