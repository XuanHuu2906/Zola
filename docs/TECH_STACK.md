# Locked tech stack — Zalo Apple Glass UI

**Approved:** 2026-11-04 | **Version:** 1.0 | **Target:** Windows Desktop prototype

**Implementation update, 2026-11-05:** dependency installation and the locked-stack
migration are verified on Windows. Full TypeScript checks, ESLint, 16 Node tests,
11 browser E2E scenarios and Electron development launch pass. Exact versions and
resolved dependencies are retained in `package.json` and `package-lock.json`.
See `reports/AGENT_DELIVERY.md` for packaging and runtime evidence.

Validated versions: Electron 45.2.3, React 19.2.6, TypeScript 5.9.3, Vite 8.3.5,
Tailwind 4.2.2, Zustand 5.0.8, Motion 12.23.24, electron-builder 26.18.0.
Node 24.22.2 / npm 11.19.1. Playwright 1.58.2 exercises real browser components;
the existing `node:test` suite is retained for compatibility instead of adding
a second unit-test runner. Axe 4.14.0 plus screenshot pixel sampling supplements
keyboard and visual review; this is not a full WCAG certification.

| Concern | Decision | Notes |
|---|---|---|
| Desktop | **Electron** | Own standalone window; does not integrate Zalo automatically |
| UI | **React** | Component-based chat-like UI |
| Language | **TypeScript** | Main, preload, renderer, adapter contracts |
| Bundler | **Vite** | React renderer and development build |
| Styling | **Tailwind CSS v4** | Standard layout and utilities |
| Glass styling | **Custom CSS variables and backdrop-filter** | Glass tokens, light/dark, fallbacks |
| State | **Zustand** | UI and fictional demo state only |
| Motion | **Motion for React** (`motion`) | Smooth micro-interactions; reduced motion support |

**Allowed supplementary dev tools:** electron-vite (or equivalent Vite integration), electron-builder (Windows packaging), Vitest, React Testing Library, Playwright, ESLint, Prettier, lucide-react. Use compatible versions verified at implementation time and commit a lockfile.

**No backend, database, Docker, Redis, Socket.IO or private Zalo API** for the offline demo. Original HTML/CSS/Vanilla JS remains preserved in `legacy/`; the root entry now targets React. Electron + React won't by themselves preserve or expose Zalo login, message handling, audio/video, files or synchronization.

## Renderer / Desktop boundaries

```text
Electron main process
  └─ BrowserWindow (contextIsolation, sandbox, nodeIntegration=false)
      ├─ Minimal allowlisted preload (contextBridge, only if needed)
      └─ React + TypeScript renderer (Vite)
          ├─ Glass design system (Tailwind CSS v4 + CSS variables)
          ├─ Motion for React
          ├─ Zustand UI state
          └─ Typed DemoAdapter → fictional local conversations only
```

## Windows glass decision

- Start with **opaque Electron window + internal frosted glass**. This matches most approved mockup visuals with a reliable fallback.
- Transparent windows, Windows Mica / Acrylic and OS backdrop effects are **optional experiments**, not required to ship v1. Their compositor behavior differs from CSS `backdrop-filter`.
- Do not use Electron `webContents.insertCSS` as a strategy to modify the real Zalo application; it applies to content in an Electron instance we control.

## Definition of done for target stack

1. React/TS dev renderer launches and renders approved layout.
2. Tailwind CSS v4 and design tokens work in production build, including light/dark and reduced motion.
3. Zustand demo state and Motion interactions are covered by tests and keyboard QA.
4. Electron launches on Windows, secure main/preload boundary is validated.
5. Windows installer or portable `.exe` builds and is smoke tested. Path/hash recorded.
6. No claim that standalone desktop demo is a working Zalo client.

See `AGENT_PLAN.md` for task sequence and verification gates.
