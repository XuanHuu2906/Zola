# Persistent login on the same PC

Previously, any saved-session restore failure (including an offline network or a login deadline) deleted the session and fell through to QR. A retry also skipped restoration because of a process-local `restoreTried` flag.

Restoration now always reuses saved cookies, IMEI and user agent. Restore errors preserve the encrypted file and offer a retry; QR starts automatically only if no saved session exists. A user can explicitly discard an unusable session through “Đăng nhập lại bằng QR”. Concurrent restore requests share one attempt. Existing QR retry behavior remains independent of that guard.

Successful cookie login saves the cookie jar after rotation without replacing the device identity. Session updates use an exclusive temporary file, flush, and atomic rename, preserving the previous file if the update fails. Missing files are distinguished from temporary storage/keyring/decryption failures. Encryption unavailability is no longer silently treated as a missing session or a successful save.

There is no local session expiration timer. Zalo can still revoke or expire server-side sessions; the client cannot make a revoked session valid indefinitely. Explicit logout still clears the saved session. Regression coverage exercises restore retry without QR, locked storage, rotated cookies with stable identity, and concurrent restoration.
