# Agent Delivery

Date: 2026-11-05 (Asia/Saigon). All standalone demo gates (G0–G3) are now executed with evidence. G4 (Zalo recon) and G5 (integration) remain closed.

> **Superseded snapshot.** This file records the state *before* the contrast fix. The
> 0.2.0 executable it cites was deleted on 2026-11-05; the current delivery artifact is
> 0.3.0 in [AGENT_DELIVERY.md](AGENT_DELIVERY.md). Nothing here was rewritten — read it
> as history, not as current state.

## Environment

- Workspace: `D:\Zalo`, Windows `win32 x64`, kernel `10.0.26200`.
- Node v24.22.2, npm 11.19.1, Electron 45.2.3, electron-builder 26.18.0, Vite 8.3.5, TypeScript-ESLint 8.72.1, @axe-core/playwright 4.14.0.
- No Git repository. Original source preserved in `legacy/` (13 files, SHA-256 manifest).
- Installed Zalo version: UNKNOWN; no local Zalo reconnaissance performed.
- Playwright Chromium (Chrome for Testing 145.0.7632.6) installed locally.

## Changes

- `src/renderer/` → React components, typed demo seed/adapter, Zustand state, Motion effects, native modal settings, session drafts, theme/glass/low-blur/reduced-motion preferences.
- `src/shared/` → diacritic-insensitive search, categories, file metadata sanitization, preference validation and serialization allowlist.
- `electron/` → isolated/sandboxed BrowserWindow, `glass://app` bundled resource protocol, narrow checked window-control bridge, permissions/navigation/network policies, portable `.glass-demo-data` storage set before `ready`.
- `vite.config.mts`, TS configs, ESLint, builder YAML, `package.json` → separate renderer and desktop pipelines; portable Windows x64 target.
- `tests/core.test.ts` → nine new pure behavior/security tests; original seven tests unchanged. `tests/e2e/` → ten executed Playwright scenarios (8 demo + 2 accessibility).
- `tools/` → dev lifecycle, Electron smoke, legacy capture, artifact hashing and syntax-check helpers. `Inspect-Zalo.ps1` unchanged/unrun.
- `docs/` → component map, current architecture/QA, integration and Electron security decisions.
- Legacy preservation: all original JS/CSS/tests/assets remain at their old paths; the self-contained `legacy/` also preserves the original entry point/package. Root entry/package now target React.

### Fix in this session

- `src/renderer/App.tsx:24` — removed `aria-label="Thanh tiêu đề"` from the plain `div.titlebar` (axe `aria-prohibited-attr`: aria-label unsupported on a div with no role). Accessible content is the visible prototype tag plus labelled window buttons.

## Executed commands

Commands were invoked through `rtk` as required. PASS applies only to the described scope.

| Command | Exit | Status | Evidence |
| --- | --- | --- | --- |
| `npm install --save-dev --save-exact ...` (Electron 45.2.3, then builder/Vite/eslint/axe) | 0 | PASS | [install-electron](../reports/executed/install-electron.log), [update-toolchain](../reports/executed/update-toolchain.log) |
| `npx playwright install chromium` | 0 | PASS | [install-browser](../reports/executed/install-browser.log) |
| `npm run check` (typecheck + lint + 16 tests) | 0 | PASS | [check-after-aria](../reports/executed/check-after-aria.log) |
| `npm run build` (tsc + vite production) | 0 | PASS: 2148 modules | [build-renderer](../reports/executed/build-renderer.log) |
| `npm run build:electron` | 0 | PASS | [build-electron](../reports/executed/build-electron.log) |
| `npm run capture:legacy` | 0 | PASS: 1920×1080, 1366×768 | [legacy-capture](../reports/executed/legacy-capture.log) |
| `npm run test:e2e` | 0 | PASS 10/10 | [e2e-after-aria](../reports/executed/e2e-after-aria.log) |
| `npm run test:desktop` (dev Electron smoke) | 0 | PASS: two launches, send, controls, isolation | [electron-smoke](../reports/executed/electron-smoke.log) |
| `node tools/smoke-desktop.cjs release/win-unpacked/... packaged` | 0 | PASS: packaged app, FPS + memory measured | [smoke-packaged](../reports/executed/smoke-packaged.log), [JSON](../reports/packaged-smoke.json) |
| `npm run build:desktop` | 0 | PASS: portable exe produced + hashed | [desktop-build](../reports/executed/desktop-build-after-aria.log) |
| `Get-FileHash` on portable exe | 0 | PASS: hash matches `desktop-artifacts.json` | tool output |
| Launch portable exe (`Start-Process`) | 0 | PASS: window "Zalo Apple Glass UI — Prototype", 5 processes, closed cleanly | manual PowerShell session |
| `node tools/smoke-desktop.cjs release/Glass-...exe portable` | 1 | NOT APPLICABLE: Playwright cannot attach to the NSIS portable wrapper (tool limitation) | [smoke-portable](../reports/executed/smoke-portable.log) |

The `MODULE_TYPELESS_PACKAGE_JSON` warning during tests is nonfatal; CommonJS desktop output and legacy CJS tests are retained deliberately.

## Desktop packaging

- Target: **portable Windows x64 `.exe`** through electron-builder.
- Output: `release/Glass-Messenger-Demo-0.2.0-x64.exe`
- Bytes: **112,118,993** · SHA-256: **eb8539cb541c4f6c9df2a846fda09865ca10945d84c9c6466a8d6da009b45354**
- Unpacked runtime verified: `release/win-unpacked/Glass Messenger Demo.exe` (Playwright smoke, 2 runs).
- Portable wrapper verified manually: self-extracts to `%TEMP%`, opens the app window, exits cleanly.
- Code signing: not configured (unsigned demo build).
- No installer was executed, and no system settings or installed Zalo files were changed.

## Visual QA

- Approved reference inspected and compared against rendered captures.
- Baseline legacy captures: 1920×1080, 1366×768 — captured.
- React light/dark captures: 1920×1080, 1600×900, 1366×768 — captured (`reports/screenshots/react-*.png`).
- Packaged app captures: same three resolutions × 2 runs (`reports/screenshots/packaged-*.png`).
- Layout parity confirmed: 3-column glass shell, rail, conversation list, chat pane, floating composer, window controls.
- Measured performance (packaged): mean frame 8.34 ms, p95 8.5 ms (≈120 fps), 120 samples.
- Memory (packaged): Browser ≈116 MB WS, GPU ≈317 MB WS, Utility ≈45 MB WS, Tab ≈106 MB WS.
- Accessibility (axe): **0 violations** in light and dark; remaining `color-contrast` entries are axe *incomplete* (pseudo-element background cannot be computed), not violations.
- IME input remains a manual follow-up; automated typing covers Enter/Shift+Enter and diacritic search.

## Security

Source review and runtime smoke both confirm: context isolation, sandbox and webSecurity enabled; Node/webview integration disabled; preload bridge exposes exactly `close`, `minimize`, `toggleMaximize`; sender-validated IPC; deny-by-default permissions and navigation; local production `glass://app` protocol with restrictive CSP; no demo network/data-service code.

Pure tests exercise protocol path/origin policy and metadata/preference boundaries. Packaged smoke asserts the actual BrowserWindow `webPreferences` and an empty `pageerror` list across two launches. See [ADR-002](../docs/ADR-002-desktop-security.md).

## Recon / compatibility decision

- Installed-client reconnaissance: **NOT RUN**, separate review/authorization gate from the supplied plan remains unmet. [Recon report](ZALO_ARCH_RECON.md).
- Public official documentation reviewed; [ADR-001](../docs/ADR-001-integration-strategy.md) records **NO-GO for P3** because no verified authorized integration route exists.
- No Zalo PC/Web feature compatibility claim. All real login, synchronization, calls, files, notifications and updates are UNKNOWN / NOT TESTED.

## Remaining gaps

1. Code signing for the portable executable if distribution is intended.
2. Manual IME/Vietnamese input composition check and native window drag/hit-testing check on physical hardware.
3. Long-session performance/memory soak beyond the 120-frame sample.
4. Only after the separate requested review/authorization: passive Zalo metadata. P3 remains closed until evidence and authority establish GO.

Rollback: open `legacy/index.html`. Original prototype remains usable independently of the migrated toolchain. Do not replace working official Zalo with this demo.
