# R22 — do not invite established installations to repeat first-run sync

The user's screenshot showed the R21 banner still visible on an existing installation. R21 only persisted completion for new successful syncs; older accounts had no completion marker, so the invitation remained. Requiring another sync did not match the requested first-install-only behavior.

Added a separate, per-account `phone_sync_setup_required_v1` flag. It is initialized before loading server metadata: a fresh empty cache requires setup, while a legacy cache that already has messages or conversations skips onboarding. The check reads only row presence, not message contents. The decision is persisted, so ordinary cache population after a fresh installation does not accidentally dismiss setup, and restarting an established installation does not reintroduce it.

This is a setup migration, **not** an assertion that historical phone sync succeeded: `phone_sync_complete_v1` remains unchanged. New accounts still require an actual full successful sync to dismiss the invitation; failed/canceled syncs retain retry behavior.

Login sends the setup-eligibility flag to the renderer. Both the banner and account-menu action check it, in addition to actual completion.

Regression coverage includes legacy cache migration without a fake success flag, fresh caches populated before successful sync, the actual client login payload for an upgraded account, and browser tests showing no legacy invitation before/after reload while retaining the new-account success/failure flow. No real account or phone sync was accessed by the tests.

Validation passed: typecheck, lint, 558 unit tests, 5 browser tests, renderer/Electron builds, packaging, and 51/51 installed program-file parity. The updated build is installed; the running app was not automatically restarted.
