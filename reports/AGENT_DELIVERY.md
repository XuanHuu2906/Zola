# Agent Delivery

Date: 2026-11-06 (Asia/Saigon), updated for R10 (mock desktop client). The standalone Windows demo builds and its 0.3.0 portable executable passes two sign-in/send/settings/close cycles. Core automated gates pass; physical drag, IME and screen-reader checks remain listed below. G4 (Zalo recon) is RUN read-only; G5 (integration) remains closed. Everything below is `MOCK_PASS` — see [R10](R10_MOCK_DESKTOP_CLIENT.md).

This report supersedes the earlier delivery and blocked-environment reports.
Earlier deliveries are preserved as `delivery-before-contrast-fix.md` and in
`reports/executed/*-before-fix/`.

## Environment

- Workspace: `D:\Zalo`, Windows `win32 x64`, kernel `10.0.26200`.
- Node v24.22.2, npm 11.19.1, Electron 45.2.3, electron-builder 26.18.0, Vite 8.3.5, TypeScript-ESLint 8.72.1, @axe-core/playwright 4.14.0.
- No Git repository. Original source preserved in `legacy/` (13 files, SHA-256 manifest).
- Installed Zalo version: 26.10.20.3253, VNG-signed (read-only metadata sweep only).
- Playwright Chromium (Chrome for Testing 145.0.7632.6) installed locally.

## Changes

- `src/renderer/` → React components, typed demo seed/adapter, Zustand state, Motion effects, native modal settings, session drafts, theme/glass/low-blur/reduced-motion preferences.
- `src/shared/` → diacritic-insensitive search, categories, file metadata sanitization, preference validation and serialization allowlist.
- `electron/` → isolated/sandboxed BrowserWindow, `glass://app` bundled resource protocol, narrow checked window-control bridge, permissions/navigation/network policies, portable `.glass-demo-data` storage set before `ready`.
- `vite.config.mts`, TS configs, ESLint, builder YAML, `package.json` → separate renderer and desktop pipelines; portable Windows x64 target.
- `tests/` → 62 Node tests (7 legacy + 20 core + 20 design-system + 15 adapter) and 26 executed Playwright cases: 21 from `demo.spec.ts` (19 declarations; the layout case runs at three viewports), 2 axe cases from `accessibility.spec.ts`, and 3 from `extended-qa.spec.ts` (two contrast sweeps + the browser IME path). R10 added 6 unit tests and 6 scenarios.
- `tools/` → dev lifecycle, Electron smoke, legacy capture, artifact hashing and syntax-check helpers, plus this round's additions: `qa-desktop-extra.cjs` (drag-region hit map, layout sizes, DPI/zoom, accessibility tree, control focusability), `make-icon.cjs` (deterministic multi-size `.ico`), `mark-delivery.cjs` (flags the current version in the artifact manifest). `Inspect-Zalo.ps1` unchanged.
- `build/icon.ico` → generated 7-size icon (256/128/64/48/32/24/16), wired through `win.icon`; the packaged executable now embeds it instead of Electron's default.
- `package.json` → version 0.3.0; `overrides.minimatch` pins the advisory-affected range to 11.0.4; scripts `test:desktop:extra` and `build:icon` added.
- R10 mock workflows → `src/shared/{transfer,call,network}.ts` pure reducers; `useDemoStore` connection state and `goOffline`/`reconnect`; `ChatPane` demo-lab menu, transfer progress and incoming-file download; `MessageComposer` offline disable; `CallScreen` cleanup-safe timer; connection banner in `App.tsx`. Six new unit tests (62 total) and six new E2E scenarios (26 total). See [R10](R10_MOCK_DESKTOP_CLIENT.md) §5.
- `docs/` → component map, current architecture/QA, integration and Electron security decisions.
- Legacy preservation: all original JS/CSS/tests/assets remain at their old paths; the self-contained `legacy/` also preserves the original entry point/package. Root entry/package now target React.

### Verified refinements

- `src/renderer/App.tsx:24` — removed `aria-label="Thanh tiêu đề"` from the plain `div.titlebar` (axe `aria-prohibited-attr`: aria-label unsupported on a div with no role). Accessible content is the visible prototype tag plus labelled window buttons.
- Settings dialog restores opener focus and wraps Tab/Shift+Tab correctly; initial E2E failure was resolved.
- Actual rendered-pixel sampling exposed low text contrast missed by axe's incomplete gradient checks. Dark surfaces and blue buttons/bubbles were deepened; the four primary states exceed 4.5:1 and the extended endpoint sweep reaches a 4.96:1 minimum across 512 samples.
- Vite dependency scanning is limited to the real entry point; generated reports and Electron cache directories are excluded from file watching. This removes locked-cookie watcher errors and unrelated development reloads.
- Portable wrapper has a dedicated automated smoke through a temporary loopback CDP port. The unpacked app separately verifies main-process flags, storage paths and native controls.

## Executed commands

Commands were invoked through `rtk` as required. PASS applies only to the described scope.

| Command | Exit | Status | Evidence |
| --- | --- | --- | --- |
| `npm install --save-dev --save-exact ...` (Electron 45.2.3, then builder/Vite/eslint/axe) | 0 | PASS | [install-electron](../reports/executed/install-electron.log), [update-toolchain](../reports/executed/update-toolchain.log) |
| `npx playwright install chromium` | 0 | PASS | [install-browser](../reports/executed/install-browser.log) |
| `npm run typecheck` | 0 | PASS (pre-shell-change run; superseded by `npm run check` below on the rebuilt tree) | [r10-typecheck](executed/r10-typecheck.log) |
| `npm run lint` | 0 | PASS (pre-shell-change run; superseded by `npm run check` below) | [r10-lint](executed/r10-lint.log) |
| `npm test` | 0 | PASS 62/62 (pre-shell-change run; superseded by `npm run check` below) | [r10-unit](executed/r10-unit.log) |
| `npm run check` (typecheck + lint + tests), re-run after the shell change | 0 | PASS — combined gate, 62/62 | [log](executed/r10-check-current.log), [JSON](executed/r10-check-current.json), earlier [r10-check](executed/r10-check.log) |
| `npm run build` (tsc + Vite production), rebuilt with the shell change | 0 | PASS: 369.59 kB JS / **49.88 kB CSS** (11.28 kB gzip) | [r10-shellfull-build](executed/r10-shellfull-build.log); pre-shell [r10-build](executed/r10-build.log) (49.70 kB CSS) |
| `npm run build:electron` | 0 | PASS | [r10-build-electron](executed/r10-build-electron.log) |
| `npm run capture:legacy` | 0 | PASS: 1920×1080, 1366×768 | [legacy-capture](../reports/executed/legacy-capture.log) |
| `npx playwright test`, re-run after the shell change | 0 | PASS 26/26 (46.3 s) | [log](executed/r10-e2e-current.log), [JSON](executed/r10-e2e-current.json) |
| `npm run test:desktop` (dev Electron smoke), re-run after the shell change and again after `bridgeKeys` was recorded | 0 | PASS: two launches, sign-in, send, controls, isolation, `bridgeKeys` captured per run, notification IPC payload | [log](executed/r10-desktop-smoke-current.log), [JSON](electron-smoke.json) |
| `node tools/smoke-desktop.cjs "release/win-unpacked/Glass Messenger Demo.exe" unpacked`, re-run on the rebuilt package | 0 | PASS: 2 launches, runtime boundaries, native controls, notification IPC, timings/memory | [log](executed/r10-unpacked-smoke-current.log), [JSON](unpacked-smoke.json) |
| `npm run dev:desktop -- --smoke` | 0 | PASS: dev renderer, sample send, clean close | [log](executed/dev-desktop-final.log), [JSON](dev-desktop-smoke.json) |
| `npm run test:desktop:extra`, re-run on the rebuilt package | 0 | PASS 7/7 groups: 34-point drag-region hit map, 3 window sizes, DSF 1/1.25/1.5/2, zoom 1/1.25/1.5/2, **full-window shell geometry**, AX names in dark/light, control focus | [log](executed/r10-desktop-extra-current.log), [JSON](desktop-extra-qa.json) |
| `SOAK_BATCHES=6 node tools/soak-desktop.cjs` | 0 | PASS: 30 sends, 6 settings cycles (pre-shell-change tree) | [r10-soak-6](executed/r10-soak-6.log) |
| `node tools/soak-desktop.cjs`, 30 batches, run C on the rebuilt package | 0 | PASS: 150 sends, 30 cycles, 0 errors, live DOM back to 347 nodes, natural reclaim **803 ms** | [log](executed/r10-soak-30-run-c.log), [JSON](executed/soak-30-run-c.json) |
| `SOAK_BATCHES=30 node tools/run-npm.cjs ... run test:soak`, run B on the rebuilt package | 0 | PASS: 150 sends, 30 cycles, 0 errors, live DOM back to 347 nodes; natural reclaim **not observed within 20 s** this run; forced collection reached 223 listeners / 452 nodes and a second reload held at 450 nodes, so there is no accumulation | [log](executed/r10-soak-30-current.log), [JSON](executed/soak-30-run-b.json) |
| `node tools/soak-desktop.cjs`, 30 batches, run A (pre-shell-change tree) | 0 | PASS: 150 sends, 30 cycles, natural reclaim 801 ms — **superseded package**, kept as history | [log](executed/r10-soak-30.log) |
| `npm run build:desktop` (post-shell change) | 0 | PASS: portable exe rebuilt, hashed, flagged, asar parity 11/11 — **112,248,617** bytes, SHA-256 `85f92db5…5f8ec3` | [r10-shellfull-build](executed/r10-shellfull-build.log), [JSON](executed/r10-shellfull-build.json), [metadata](desktop-artifacts.json), [asar parity](asar-parity.json) |
| `node tools/smoke-portable.cjs`, re-run on the rebuilt artifact | 0 | PASS: 2 complete wrapper cycles (112,248,617-byte exe, `glass://app/index.html`, zero page errors) | [log](executed/r10-portable-current.log), [JSON](portable-smoke.json), `screenshots/portable-{0,1}.png` |
| `npm run verify:asar`, re-run standalone after `dist/` was rebuilt by the E2E gate | 0 | PASS: 11/11 bundled files byte-identical to the current tree | [r10-asar-parity-current](executed/r10-asar-parity-current.log), [JSON](asar-parity.json); inside packaging: [r10-shellfull-build](executed/r10-shellfull-build.log) |
| Artifact ↔ manifest re-check | 0 | PASS: on-disk exe matches `desktop-artifacts.json` in bytes and SHA-256 | [artifact verify](executed/r10-artifact-verify.log) |
| Embedded executable icon | 0 | PASS: icon extracted from `win-unpacked` exe renders the generated tile | `screenshots/exe-icon-extracted.png` |
| `npm run test:legacy` | 0 | PASS 7/7 | [log](executed/verify-legacy-030.log) |
| Legacy SHA-256 recheck | 0 | PASS 13 preserved files; original source/assets/tests unchanged | [JSON](legacy-preservation-final.json) |
| `npm audit --omit=dev --json` | 0 | PASS: zero known advisories | [log](executed/audit-production-post-override.log) |
| `npm audit --json` | 0 | PASS: zero advisories after the scoped minimatch override (was 12 moderate) | [before](executed/audit-pre-fix.log), [after](executed/audit-post-override.log) |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\Inspect-Zalo.ps1` | 0 | PASS (read-only): Zalo 26.10.20.3253, `app.asar` + Chromium markers | [recon report](ZALO_ARCH_RECON.md) |

Npm commands are captured by `tools/run-npm.cjs`; companion JSON files record
arguments, timestamps and exit codes. The `MODULE_TYPELESS_PACKAGE_JSON` warning
is nonfatal; CommonJS desktop output and legacy CJS tests are retained deliberately.
Earlier failed focus/contrast runs are retained; only the final run establishes PASS.

After the full-window shell CSS change and the artifact rebuild, the gates that
could be affected were re-run on the rebuilt tree and every step exited 0:
`check` 62/62 ([log](executed/r10-check-current.log)),
E2E 26/26 ([log](executed/r10-e2e-current.log)),
dev Electron smoke ([log](executed/r10-desktop-smoke-current.log)),
extra desktop QA ([log](executed/r10-desktop-extra-current.log)),
unpacked smoke ([log](executed/r10-unpacked-smoke-current.log)),
portable smoke ([log](executed/r10-portable-current.log)),
and the 30-batch soak ([log](executed/r10-soak-30-current.log),
[log C](executed/r10-soak-30-run-c.log)).

Note on timestamps: logs dated before 10:05 on 2026-11-06
(`r10-e2e`, `r10-desktop-extra`, `r10-desktop-smoke`, `r10-unpacked-smoke`,
`r10-portable`, `r10-soak-30`, `r10-soak-6`) were produced against the previous
CSS. They remain as history; the `*-current` logs listed above are the
authoritative ones for the shipped package.

## Desktop packaging

- Target: **portable Windows x64 `.exe`** through electron-builder.
- Output: `release/Glass-Messenger-Demo-0.3.0-x64.exe`
- Bytes: **112,248,617** · SHA-256: **85f92db5fcf258a85acc72844c2141cbc48ce377266e611a62f40fbf365f8ec3**
- Rebuilt 2026-11-06 after the full-window shell change (the desktop app no
  longer shows the floating frame, outer gutter, rounding or luminous border).
  Packaging output was captured this time:
  [r10-shellfull-build](executed/r10-shellfull-build.log) (exit 0, asar 11/11),
  then unpacked smoke, portable smoke and the parity/artifact checks below.
- The new `app.asar` was compared byte-for-byte against the current tree — all
  **11** bundled program files match: `index.html` (832 B), the CSS (49,889 B) and
  JS (369,598 B) bundles, five avatar PNGs and the three `dist-electron/*.js`
  outputs. Both smoke harnesses ran on this exact package.
- The earlier R10 packaging run (before the shell change) had no captured stdout,
  so its exit code was never claimed; that gap is now closed for the current
  build by [r10-shellfull-build](executed/r10-shellfull-build.log). `build:desktop`
  ends with `verify:asar`, so a stale package fails the build instead of shipping.
- Earlier builds were **deleted on 2026-11-05** with the user's approval to reclaim
  space; only the current 0.3.0 build remains in `release/`. Pre-R10 hashes are
  retained in this report's history (0.2.1 `2db74681…a181fc`, 0.2.0 `2d65f1d4…32d8`,
  pre-R10 0.3.0 `2c2aa075…32c11b`) but no longer appear in
  [desktop-artifacts.json](desktop-artifacts.json), which the hash helper rewrites
  per build and now lists only the delivery artifact (`delivery: true`,
  `deliveryVersion: 0.3.0`). Those hashes identify deleted trees; they do not
  restore them.
- Unpacked runtime verified: `release/win-unpacked/Glass Messenger Demo.exe` — Playwright smoke re-run on the rebuilt R10 tree, 2 launches, including the notification IPC payload ([log](executed/r10-unpacked-smoke-current.log), [JSON](unpacked-smoke.json)).
- Portable wrapper verified automatically: self-extracts, opens `glass://app/index.html`, sends sample text, opens/closes settings, closes through the actual UI, then repeats. Both wrapper exits are 0; no page errors. Test-only loopback debugging is supplied by the smoke command, not normal app startup.
- Code signing: not configured (unsigned demo build). The executable now carries the
  generated `build/icon.ico` (7 sizes); the icon was extracted back out of the packaged
  binary to confirm it, not assumed from configuration.
- No installer was executed, and no system settings or installed Zalo files were changed.

## Visual QA

- Approved reference inspected and compared against rendered captures.
- Baseline legacy captures: 1920×1080, 1366×768 — captured.
- React light/dark captures: 1920×1080, 1600×900, 1366×768 — captured (`reports/screenshots/react-*.png`).
- Final unpacked app captures: same three resolutions × 2 runs (`reports/screenshots/unpacked-*.png`), regenerated against the current package after the shell change. Portable wrapper captures `portable-0.png` / `portable-1.png` likewise come from the current portable smoke.
- Layout parity confirmed: 3-column glass shell, rail, conversation list, chat pane, floating composer, window controls.
- Desktop shell geometry (asserted by `test:desktop:extra` check `window-shell-geometry` on the current build, Electron at 1600×900): `#app` padding **0px**, shell rect **0,0,1600×900** (exact viewport), `border-radius` **0px**, `border-width` **0px**, `box-shadow` **none**, document overflow **0×0**, and all four corner hit-tests resolve inside the shell. `tools/qa-desktop-extra.cjs` fails the run if any of those regress. This applies only to the Electron window; the browser preview keeps the floating framed shell.
- Idle requestAnimationFrame timing (unpacked app, current package): two samples of 120 intervals, mean 8.33 ms both runs, p95 **8.60** ms / **8.50** ms. This reflects idle callback cadence on this workstation, not measured animation FPS or a GPU benchmark.
- Working set samples (Electron reports KiB, current package): Browser **116.8** MiB both runs, GPU **290.8–296.4** MiB, Utility **44.8–48.6** MiB, renderer (Tab) **115.6–115.9** MiB. These snapshots do not establish peak/long-session memory behavior.
- Accessibility: axe reports **0 violations** in dark/light chat/settings, with unresolved gradient checks retained. The extended sweep (dark/light × glass 15/95 × normal/low blur, settings and chat) measured **512 text samples, minimum 4.96:1, zero below 4.5:1**. See [visual methodology and limits](VISUAL_QA.md).
- Accessibility tree: the raw CDP AX tree was walked in dark and light; **8 interactive nodes per theme, 0 without an accessible name**, and all three window controls are keyboard focusable. This is the platform tree, not a screen-reader session.
- IME: the browser composition path is automated (Enter during composition does not send; committed Vietnamese text sends once). A physical OS IME remains NOT RUN.
- Drag region: 34 sampled points across the titlebar resolve to `-webkit-app-region: drag`, the three window buttons resolve to `no-drag` and receive their own clicks, and the band begins at the rail edge instead of covering navigation. This is computed-style and hit-testing evidence — **an actual mouse drag was not performed**.
- Layout/DPI: 1000×700, 1366×768 and 1920×1080 have zero scroll overflow and fit the shell; device scale factors 1/1.25/1.5/2 and browser zoom 1/1.25/1.5/2 keep the titlebar at 47 CSS px, at least 44×44 px button targets, and never overlap the rail. Emulated metrics are not a multi-monitor hardware test.

## Security

Source review and runtime smoke both confirm: context isolation, sandbox and webSecurity enabled; Node/webview integration disabled; preload bridge exposes exactly `close`, `minimize`, `notify`, `toggleMaximize`; sender-validated IPC; deny-by-default permissions and navigation; local production `glass://app` protocol with restrictive CSP; no demo network/data-service code.

Pure tests exercise protocol path/origin policy and metadata/preference boundaries.
Packaged smoke asserts actual BrowserWindow flags, blocked external fetch/new
windows and an empty `pageerror` list across two launches. This does not constitute
a complete security audit. See [ADR-002](../docs/ADR-002-desktop-security.md).

Both audits are now clean: **zero advisories overall** (`npm audit` and
`npm audit --omit=dev` both exit 0). The twelve moderate reports came from one
transitive minimatch glob-amplification advisory (GHSA-g3hv-75wg-m249, affected
range `>=7.0.0 <11.0.1`) reached through `electron-builder` and `typescript-eslint`.
A scoped `overrides` entry pins only that range to 11.0.4; the 3.x/5.x copies used
by eslint's own glob chain are untouched. `npm run check` (typecheck, lint, 62/62
tests) was re-run on the R10 tree, and both smokes plus the soak ran on the
resulting artifact. This is a dependency-graph statement, not a vulnerability audit
of this code.

## Recon / compatibility decision

- Installed-client reconnaissance: **RUN read-only after explicit user approval**. Observed Zalo PC 26.10.20.3253, VNG-signed (all inspected executables Valid), `resources\app.asar` present, `app.asar.unpacked` present, full Chromium `.pak`/`icudtl.dat`/V8 snapshot marker set, with `ZaloCall.exe`/`ZaloCap.exe` native helpers. [Recon report](ZALO_ARCH_RECON.md).
- A deeper read-only pass (P2) then read three bundled JavaScript files to answer the theme question: Zalo ships an internal `DARK/LIGHT/SYSTEM/CUSTOM` theme engine with token palettes, but its CUSTOM dashboard is debug-gated and the shipped renderer/preload expose **no** third-party CSS or script hook. [Feasibility report](ZALO_THEME_FEASIBILITY.md).
- Public official documentation reviewed; [ADR-001](../docs/ADR-001-integration-strategy.md) records **NO-GO for P3** because no verified authorized integration route exists. The recon evidence confirms the packaging hypothesis but does not change that decision.
- No Zalo PC/Web feature compatibility claim. All real login, synchronization, calls, files, notifications and updates are UNKNOWN / NOT TESTED.

## Remaining gaps

1. A real mouse drag of the titlebar, a physical OS IME (Telex/VNI), a screen-reader
   session with spoken output, multiple physical monitors and per-monitor DPI remain
   NOT RUN. The new checks cover computed drag regions, emulated DPI/zoom and the raw
   AX tree, which are related but not equivalent.
2. The 30-batch soak (150 sends, 30 settings cycles) is shorter than the earlier
   60-batch run and still not a multi-hour profile. It was run twice on the
   **rebuilt** package, and the two runs disagree on **reclamation latency**, which
   is why no single reclaim figure is stated as an invariant:
   - Run C (3.06 min, exit 0): without forcing collection, the engine released the
     previous document at **803 ms** — Documents 1, Nodes 452, listeners 223,
     heap 5.4 MB at the reclaim sample.
   - Run B (4.34 min, exit 0): reclamation **did not occur within the 20 s polling
     window** — Documents stayed at 3, Nodes 1650, listeners 1350, heap ≈10.4 MB
     across 77 samples. Forced collection then produced Documents 1, Nodes 452,
     listeners 223, heap 4.1 MB, and a second reload held at Nodes 450 /
     listeners 223 / heap 3.2 MB.
   In both runs live DOM returned to the 347-node baseline immediately, so the
   evidence supports "no accumulation, reclamation is deferred and
   scheduler-dependent", not "reclaims within N ms". The 801 ms figure in
   [r10-soak-30.log](executed/r10-soak-30.log) came from the **pre-shell-change**
   tree and is history only. Memory between batches grew with the 150 rendered
   messages, which is expected for an in-memory chat list. Contrast sampling covers
   the glass endpoints, not every slider value or non-text controls. None of these
   samples are WCAG certification.
3. Code signing is still not configured; the generated icon is now embedded but is a
   demo mark, not a brand asset. Signing is required before broader distribution.
4. G4 metadata sweep is done, but it established no integration hook. P3 remains
   closed until evidence and authority establish GO.

Rollback: open `legacy/index.html`. Original prototype remains usable independently of the migrated toolchain. Do not replace working official Zalo with this demo.
