# ADR-002 — Local Electron protocol and minimal bridge

Status: implemented; runtime flags, bridge isolation and window controls verified
by packaged Electron smoke on Windows 2026-11-05.

The Vite renderer and TypeScript main/preload use separate builds. `tsc -p tsconfig.electron.json` emits CommonJS files for Electron. No main-process bundler or backend is needed.

- Production serves only bundled `index.html` and allowlisted asset paths using `glass://app`; no `file://` page or remote application is loaded. Encoded traversal, credentials, alternate hosts, and non-asset paths are rejected.
- BrowserWindow sets sandbox/contextIsolation/webSecurity true; nodeIntegration/webviewTag false. Release devtools are disabled.
- Preload exposes two disjoint worlds. `window.desktop` carries only `minimize`, `toggleMaximize`, `close`, `notify`; `window.chat` (added in Phase 5, see ADR-004) carries one named function per purpose and returns an unsubscribe from every `on*`. `ipcRenderer` itself is never exposed. Every IPC handler validates the originating webContents, main frame and document URL; every chat payload is schema-validated in main before it reaches the protocol layer.
- Permission requests/checks, downloads, new windows, webviews and renderer navigation/redirects are denied. Production web requests must use the local protocol.
- CSP denies external scripts, connections, frames, objects and form submission. `style-src 'unsafe-inline'` is intentional for React CSS custom properties and Motion inline style updates; scripts remain restricted to self. This is not permission for injected script.
- **CSP amendment (Phase 5):** `img-src` becomes `'self' data:`. The Zalo login QR arrives from zca-js as base64 and is turned into a data URL *in main*; there is no runtime-generated PNG that the `glass://app` asset allow-list could serve. No remote host is admitted, so a Zalo avatar still cannot load — which is why `LiveThread.avatar` is typed `null`. Both authored copies of the policy (`electron/security.ts`, `index.html`) must say the same thing. No test asserts that parity: `tests/protocol-mapper.test.ts` only mentions `img-src` in an assertion message. Treat the two copies as needing manual review until a parity test exists.
- Vite development alone allows the inline React refresh preamble and loopback HMR websocket. Packaged main ignores `GLASS_DEV`, and the production HTML plus response-header CSP remains strict.
- Frameless window uses a small drag region with controls excluded. An opaque BrowserWindow plus CSS glass is the only implementation; Mica/Acrylic/desktop transparency are not implemented.
- File input reads only `name` and `size`; no FileReader, content upload, object URL, Node file bridge, session or credential exposure.
- Preferences only: theme, glass, motion, lowBlur. Fictional chats/drafts remain in memory. Electron keeps its own portable cache/preferences under `.glass-demo-data` next to the portable exe, or inside the development project.

The `userData` and `sessionData` paths are configured synchronously before
Electron emits `ready`, as required by the [app API](https://www.electronjs.org/docs/latest/api/app/).
The smoke script verifies the active paths in the running application; that
runtime assertion passes in Electron smoke. Portable evidence is recorded
separately from the unpacked application.

Sources: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security/), [sandbox](https://www.electronjs.org/docs/latest/tutorial/sandbox), [custom protocols](https://www.electronjs.org/docs/latest/api/protocol). These informed implementation; pure policy tests alone do not prove actual sandbox enforcement. `tools/smoke-desktop.cjs` verifies runtime flags, absence of renderer `require`, exact bridge keys, blocked external fetch/new windows, storage paths and native controls. This is targeted verification, not a penetration test.

Electron is pinned to 45.2.3. Both `npm audit` and `npm audit --omit=dev` report
zero known advisories.

The twelve moderate reports came from one transitive minimatch
glob-amplification advisory (GHSA-g3hv-75wg-m249, affected `>=7.0.0 <11.0.1`)
reached through `electron-builder` and `typescript-eslint`; it is a
development-tooling path, not a runtime application dependency. npm's suggested
fix was a semver-major downgrade of both parents, so the resolution is a scoped
`overrides` entry — `"minimatch@>=7.0.0 <11.0.1": "11.0.4"` — that patches only
the affected range and leaves the 3.x/5.x copies used by eslint's own glob
chain untouched. `npm run check` (typecheck, lint, 62/62 tests — the R10-era count;
the R11 tree has 89) was re-run on the
R10 tree, and every desktop smoke and the soak ran on the artifact built from it. [Before](../reports/executed/audit-pre-fix.log) and
[after](../reports/executed/audit-post-override.log) logs are retained.
