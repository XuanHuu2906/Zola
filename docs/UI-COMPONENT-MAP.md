# Legacy → React feature parity map

> Archived (2026-11-12): the legacy/demo surfaces described here have been removed. See [README.md](../README.md) for the current application entry flow.

Source migration is implemented and exercised: 16 Node tests and 14 browser
scenarios pass on Windows. The Electron smoke separately checks runtime boundaries
and native window controls. See `reports/AGENT_DELIVERY.md` for command logs.

| Legacy source/behavior | React or TypeScript owner | Verification |
| --- | --- | --- |
| `renderRail`, navigation | `components/NavigationRail`, `FeaturePage`, store `view` | E2E PASS |
| `renderConversationList`, selection | `components/ConversationList`, store `selectChat` | E2E PASS |
| Accent-insensitive search | `shared/logic.ts`, `DemoAdapter.search` | Node tests PASS |
| All/unread/groups/work filters | `shared/logic.ts`, store `filter` | Node tests and E2E PASS |
| Pinned ordering | `selectChats`, store `togglePin` | Pure sorting and UI E2E PASS |
| Mark unread / read on selection | Zustand `markUnread`, `selectChat` | E2E PASS |
| Fictional initial chats | typed `adapters/seed.ts`, cloned by `DemoAdapter.list` | Clone independence PASS |
| `renderChat`, `renderMessage` | `components/ChatPane` | Full typecheck and actual screenshot review PASS |
| HTML escaping | React text children (no `innerHTML`) | Literal markup browser E2E PASS |
| Enter send / Shift+Enter / IME | `MessageComposer`, store `send`, `DemoAdapter.send` | Adapter, keyboard and browser composition-path E2E PASS; physical OS IME still NOT RUN |
| Filename/size attachment | `MessageComposer` maps File to metadata, `DemoAdapter.attach` | Adapter and browser E2E PASS |
| Emoji / reaction sample | local draft and store `react` | E2E PASS |
| Search within conversation | `ChatPane`, accent-insensitive highlighting | E2E PASS |
| Settings/theme/glass | native `dialog` + store `prefs` + CSS variables | Preferences allowlist, reload, modal focus E2E PASS |
| Motion | `MotionConfig`, message enter animation, OS media query | OS reduced-motion E2E PASS |
| Reduced blur | `prefs.lowBlur`, CSS fallback | E2E class/persistence PASS |
| Toasts / call placeholders | store `notify`, App live status | E2E PASS |
| Window controls (previously decorative) | minimal preload → checked IPC → BrowserWindow | Electron smoke PASS; physical drag NOT RUN |

React-local state: open dialog, open context menu, in-chat query. Zustand: selected conversation, navigation, filters, preferences, demo messages and drafts. Only four preference fields are serialized. Drafts now survive switching conversations within the current session; they are not persisted.

The original `src/app.js`, `src/logic.js`, `src/icons.js`, `src/styles.css` and original tests remain untouched. `legacy/` is a self-contained rollback/reference copy, including the original manifest and avatars. New code does not load the manual DOM event handlers.
