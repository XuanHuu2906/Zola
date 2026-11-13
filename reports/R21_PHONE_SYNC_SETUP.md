> Superseded for legacy installations by [R22_SYNC_LEGACY_SETUP.md](R22_SYNC_LEGACY_SETUP.md): established accounts no longer need another sync to dismiss setup.

# R21 — hide phone-sync setup after successful completion

The phone-sync invitation and account-menu sync action now remain available until a full sync succeeds, then stay hidden across restarts and application upgrades. The completion flag lives in the existing per-account SQLite `kv` table (`phone_sync_complete_v1`), so another account on this machine still gets its own setup invitation. Failed/canceled syncs do not set the flag. Missing or unreadable state defaults to showing the invitation.

`SyncV2Controller.onComplete` runs only after every message partition group has finished successfully, including the final group. Completion of the conversation-index session or an intermediate group does not mark setup complete. The existing API still returns after the initial request is accepted; acceptance alone does not count as success.

The protocol client persists completion and sends the flag with the final sync event. Login includes the saved flag so the renderer can hide both the banner's “Đồng bộ ngay” and the account-menu action immediately on reopening. Renderer state resets for the next account.

Older builds did not persist a reliable full-sync completion flag. Existing messages or a saved conversation index are not proof of successful completion; those accounts need one successful full sync on this version to record the flag. The change does not guess success from message counts.

Validation: `npm run check` passed (typecheck, lint, 555 unit tests); all 4 browser tests passed. Added coverage includes SQLite reopen/account isolation, completion after all partition groups, failed/canceled completion, and UI behavior through partial completion, failure, full success, and reopening. Browser tests use a synthetic bridge; no actual phone sync was initiated.

The verified build was installed to `~/.local/opt/glass-messenger`; installed ASAR parity passed for all 51 program files. The running app was not restarted automatically.
