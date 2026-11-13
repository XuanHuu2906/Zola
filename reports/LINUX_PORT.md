# Linux port — Fedora 45

Date: 2026-11-08. Host: Fedora Linux 45 (Workstation), kernel 7.2.15-300.fc45.x86_64,
Wayland session (`XDG_SESSION_TYPE=wayland`, `DISPLAY=:0`), x86_64.

The tree was Windows-first: packaging, smoke paths and the profile directory
assumed a portable `.exe` next to a writable folder. The renderer, Electron
shell and every test suite were already platform-neutral. This records what
changed and what was actually observed on Fedora.

## What changed

| File | Change | Why |
| :--- | :--- | :--- |
| `electron-builder.yml` | added a `linux` block: AppImage x64, `executableName: glass-messenger-demo`, `build/icons` PNG set, `syncDesktopName` | the tree had only a `win` target |
| `electron/main.ts:14` | packaged profile path: Windows keeps next-to-executable; Linux/macOS use `app.getPath('userData')` | an AppImage mounts read-only at a path that changes every launch, so `.glass-demo-data` inside the mount is discarded. The Zalo session would never survive a restart. `PORTABLE_EXECUTABLE_DIR` still wins when set, so the soak keeps its isolated profile. |
| `tools/hash-release.cjs` | matches `.exe/.AppImage/.deb/.rpm/.dmg/.zip`, records `platform` | was hardcoded to `.exe` |
| `tools/mark-delivery.cjs` | delivery name from host platform, matches both `x64` and `x86_64` | electron-builder spells the arch differently for AppImages |
| `tools/verify-asar.cjs` | default asar path per host (`linux-unpacked`, `mac`, `win-unpacked`) | was hardcoded to `release/win-unpacked` |
| `tools/soak-desktop.cjs` | unpacked executable path per host, accepts a path argument | ditto |
| `tools/smoke-portable.cjs` | Linux default is the AppImage; sets `APPIMAGE_EXTRACT_AND_RUN=1` | Fedora has no `libfuse2` |
| `tools/dev-desktop.cjs` | `--smoke` signs in to the demo before waiting for the composer | the script predated the demo sign-in screen — a pre-existing bug, not Linux-specific |
| `package.json` | `build:desktop` no longer pins `--win portable`; added `install:linux` | `--win` cannot run on a Linux host |
| `README.md` | Linux section, Node 24 instructions, corrected test count (89 → 120), profile location | documented Windows only |
| `tools/install-linux.sh` | new: extracts the AppImage to `~/.local/opt/glass-messenger`, writes a launcher and a `.desktop` entry | Fedora ships FUSE 3 but not the `libfuse.so.2` an AppImage runtime needs |

## Node.js

`package.json` requires Node `>=24`. Fedora 45 packages Node 22 as `nodejs` and
Node 24 as `nodejs24` (`/usr/bin/node-24`) — not on `PATH` as `node`. Observed
here: Node v24.22.2 installed under `~/.local/lib/nodejs`, symlinked as
`~/.local/bin/node24` / `npm24`, no root required.

`npm ci` succeeded: 421 packages, 0 vulnerabilities. Electron 45 does not fetch
its binary during install; it downloads on first use (its `index.js` calls
`install.js` when `dist/` is missing). A clean CI job that never launches
Electron must run `node node_modules/electron/install.js` first.

## Observed results

| Check | Command | Result |
| :--- | :--- | :--- |
| Typecheck | `npm run typecheck` | 0 errors (renderer + electron) |
| Lint | `npm run lint` | 0 problems |
| Node tests | `npm test` | **120/120 pass**, 172 ms at the time of the port; **169/169** after the L1–L3 fixes, log rotation, the node-run shim and the SQLite cache suites, see [PLAN_V2_STATUS](PLAN_V2_STATUS.md) §3, §4, §6 |
| Renderer build | `npm run build` | 2177 modules, `dist/` 401 kB JS / 52 kB CSS |
| Browser E2E | `npm run test:e2e` | **26/26 pass**, 39.2 s (Chromium 145 headless) |
| Dev launch | `npm run dev:desktop -- --smoke` | PASS, zero page errors — [dev-desktop-smoke.json](dev-desktop-smoke.json) |
| Package | `npm run build:desktop` (full pipeline) | `release/Glass-Messenger-Demo-0.3.0-x86_64.AppImage`, 132,923,923 bytes, SHA-256 `b6d182b0…` |
| asar parity | `npm run verify:asar` | **15/15** bundled files byte-identical — [asar-parity.json](asar-parity.json) |
| Unpacked smoke | `npm run test:desktop -- release/linux-unpacked/glass-messenger-demo unpacked` | PASS: 2 launches, send, window controls, sandbox/bridge, screenshots — [unpacked-smoke.json](unpacked-smoke.json) |
| Extended desktop QA | `npm run test:desktop:extra` | PASS on all 7 checks — [desktop-extra-qa.json](desktop-extra-qa.json) |
| Single-instance lock | `npm run test:single-instance` | PASS: second process exits 0 in 294 ms with no window; primary keeps one window and is restored — [single-instance-smoke.json](single-instance-smoke.json) |
| Soak | `SOAK_BATCHES=12 npm run test:soak` | PASS: 60 sends, 12 settings cycles, live DOM back to baseline, clean close — [stability-smoke.json](stability-smoke.json) |
| Wrapper smoke | `node tools/smoke-portable.cjs` | PASS, 2 full AppImage cycles — [portable-smoke.json](portable-smoke.json) |
| Installer | `npm run install:linux` then `~/.local/bin/glass-messenger-demo` | launched, signed in, sent a message, closed; zero page errors |

Screenshots: [AppImage](screenshots/portable-0.png), [installed launcher](screenshots/linux-installed.png),
1920×1080 / 1600×900 / 1366×768 in [screenshots](screenshots) from the unpacked smoke.

## Notes and known limits

- **AppImage needs libfuse2.** Fedora 45 has `fuse3-libs` but no `libfuse.so.2`, so a
  bare `./Glass-Messenger-Demo-*.AppImage` prints `dlopen(): error loading libfuse.so.2`.
  Two working paths, both observed: `APPIMAGE_EXTRACT_AND_RUN=1 ./…AppImage`, or
  `npm run install:linux`, which extracts once into `~/.local/opt/glass-messenger`
  and installs a launcher at `~/.local/bin/glass-messenger-demo` plus a
  `.local/share/applications` entry. This mirrors how Zalo itself is installed on this
  machine (`~/.local/opt/zalo/Zalo.AppImage` + a `.desktop` file).
- **No rpm or deb target.** `rpmbuild` is not installed here, and building rpm/deb
  through electron-builder on Fedora needs `rpmbuild` + `fakeroot`. The AppImage plus
  the extract installer cover the same use.
- **Profile location changed on Linux.** Data now lives in
  `~/.config/zalo-apple-glass-ui/.glass-demo-data`. A profile written by an earlier
  Linux build that ran from the AppImage mount would have been discarded anyway.
- **The window is frameless on Wayland too.** Window controls and the drag region are
  renderer-drawn, so the extended QA hit-map passes unchanged. Wayland server-side
  decorations are not used because `frame: false`.
- **Natural reclamation was not observed within 20 s** in the 12-batch soak (Windows
  measured 762 ms–several seconds depending on run). Live DOM still returned to
  baseline, and a forced-GC sample confirmed no accumulation. Treated as engine
  scheduling, not a defect; a 30-batch run is the closer comparison.
- **Not re-verified on Linux:** physical drag with a mouse, IME composition inside the
  Electron shell (the browser E2E IME test does pass), screen-reader output, and the
  real-Zalo (`zca-js`) path. These remain manual and unclaimed, exactly as on Windows.
- Nothing was connected to a real Zalo backend. The UI is unchanged; only packaging,
  profile location and tooling paths were made host-aware.
