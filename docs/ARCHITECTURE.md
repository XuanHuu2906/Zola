# Architecture — implementation and remaining gates

> Archived (2026-11-12): this describes the removed offline/demo architecture. The current live-only startup and session behavior are documented in [README.md](../README.md).

Updated 2026-11-05. The migrated renderer and Electron runtime have been exercised on Windows.

```text
Electron main (TypeScript → CommonJS)
  ├─ BrowserWindow: opaque, frameless, sandbox + contextIsolation
  ├─ local glass://app asset protocol and restrictive CSP
  └─ preload: minimize / maximize / close only
       └─ React + TypeScript renderer, bundled by Vite
           ├─ Tailwind v4 + legacy-derived glass tokens
           ├─ Motion + OS reduced motion + low-blur setting
           ├─ Zustand: fictional chats, drafts, selection, preferences
           └─ typed DemoAdapter: seed/search/local send/file metadata
```

No backend, database, remote renderer, account/session API or Zalo adapter exists. Every displayed conversation comes from the supplied fictional seed. React renders text as children; manual DOM string/event rendering is confined to unchanged legacy sources.

## Boundaries

- Component-local state: dialog, context menu, in-chat query. The native modal dialog and explicit Tab wrapping supply focus containment and restore focus on close.
- Global state: Zustand store with validated preferences; persistence explicitly allowlists four preference fields. Chats and drafts stay in memory.
- File boundary: HTML file input maps each selected file to name/size only.
- Desktop boundary: three fixed preload functions; main validates sender, main frame and trusted document URL.
- Renderer production: Vite `dist/`. Desktop code: TypeScript `dist-electron/`. Packaging: electron-builder portable x64.
- Visuals: opaque native window; CSS glass inside its content. Native transparent windows/Mica/Acrylic are not implemented.

[ADR-002](ADR-002-desktop-security.md) documents protocol, CSP, IPC and development exceptions.

## Evidence gates

| Gate | Current evidence |
| --- | --- |
| G0 baseline | 7/7 original tests PASS; 13-file checksum verification; actual legacy screenshots |
| G1 migration | Full typecheck, lint, 89/89 tests, production build and development Electron launch PASS |
| G2 visual | 26/26 browser scenarios (incl. IME and glass-endpoint contrast sweeps); dark/light captures at three sizes; keyboard and sampled text contrast PASS; user design acceptance remains subjective |
| G3 desktop | Windows portable 0.3.0 (R10, full-window shell) built/hashed with an embedded icon — 112,248,617 B, SHA-256 `85f92db5…5f8ec3`, asar 11/11 byte-identical; unpacked and actual wrapper both pass two smoke cycles; 150-send/30-cycle soak PASS on two runs (no accumulation; natural reclamation latency varied — 801 ms once, not observed within 20 s the other time, GC and a second reload then returned to baseline); drag-region, layout, DSF/zoom, AX-tree and full-window-shell geometry checks PASS (emulated, not physical hardware) |
| R10 mock workflows | 8/8 `MOCK_PASS` — offline seeded data only, not `LIVE_PASS` |
| R11 contracts | M0 `PASS (mock)`, M1 `PASS (mock)`, M2 `PASS (loopback)` — the M2 peer is our own `node:http` server on `127.0.0.1`; M3/M4 `BLOCKED` on A1+A2. Zero `LIVE_PASS`. See [R11](../reports/R11_AUTHORIZED_BACKEND_INTEGRATION.md) |
| G4 recon | RUN read-only: Zalo PC 26.10.20.3253, VNG-signed, `app.asar` + Chromium markers; no integration hook identified |
| G5 integration | NO-GO for experimentation; no verified authorized extension route |
| P3 | Not started |

[Delivery report](../reports/AGENT_DELIVERY.md) is the authoritative evidence record. Source existence is not a passed runtime gate.
