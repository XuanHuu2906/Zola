# R20 — old group notifications and notification activation

Two source-level causes were reproduced in regression tests:

1. `setAvatar` republishes a cached page of group messages when member avatars finish loading. Those events lacked `backfill`, so any messages not yet present in the renderer were treated as live incoming messages, producing toasts and OS notifications. This can race the history request after restarting and selecting a group. Offline catch-up and unsolicited `old_messages` also used the live incoming path.
2. The native notification handler created and showed an Electron `Notification` without retaining a conversation destination or registering a `click` handler. Clicking therefore had no app-level restore/navigation behavior.

Changes:

- Avatar refreshes, offline catch-up and old-message events carry `backfill: true` through IPC. The existing history reducer inserts/enriches those messages silently; genuinely live messages keep their normal notification behavior.
- Notifications carry a validated conversation ID. Main retains the native objects, restores a minimized window, shows/focuses it and sends `notice:openThread` on click.
- The renderer flushes queued messages, closes overlays, selects the conversation and loads its history using the existing selection path. Unknown destinations and signed-out sessions are ignored.
- Logout/quit closes pending notifications and invalidates old click callbacks. Native objects are retained with a bounded count.

Validation: `npm run check` passed (typecheck, lint, 552 unit tests). Three browser tests passed, including a synthetic restart/group-history and notification-navigation regression. Native restore/focus, stale callbacks and invalid destinations are tested with a fake notification/window interface. The group avatar test also verifies that cached messages are emitted as history with their updated avatars.

No real account was opened and no call was made. Actual desktop-shell notification interaction remains a manual check after restarting the installed app.

The verified package was installed to `~/.local/opt/glass-messenger`; its ASAR matches the packaged build byte-for-byte. The existing app process was not restarted. Close and reopen Zola to load the fix.
