# ADR — Runtime-first: official Zalo runtime vs. standalone client

> Historical decision record (2026-11-12): the former demo-only direction has been superseded by the user's request for a live-only client. Current behavior and integration caveats are in [README.md](../README.md).

Date: 2026-11-06 (Asia/Saigon). Status: **Accepted for R11A scope only.**
Supersedes nothing. Extends [ADR-001](ADR-001-integration-strategy.md), which stays in force verbatim.

## Context

ADR-001 (2026-11-05) decided: ship an independent Electron demo; actual-client integration NO-GO
because no supported presentation-layer extension point exists, and patching the signed VNG package
crosses the update boundary.

Master Plan V3 then pivoted R11: instead of *writing* a new Zalo network client, first ask whether the
official Windows runtime can be *hosted or driven* behind the existing Apple Glass UI. R11A is that
audit. Evidence: [`reports/R11V3_RUNTIME_BOUNDARY.md`](../reports/R11V3_RUNTIME_BOUNDARY.md);
options: [`reports/R11V3_INTEGRATION_OPTIONS.md`](../reports/R11V3_INTEGRATION_OPTIONS.md).

The audit produced two facts that ADR-001 could not have known, because it did not sweep the whole
bundle for hosting primitives:

1. **No hosting surface exists at all.** Across 116/116 packaged JS files: `BrowserView` 0,
   `WebContentsView` 0, `webviewTag` 0, `protocol.handle` 0, `registerHttpProtocol` 0,
   `registerStreamProtocol` 0, `registerBufferProtocol` 0; `http.createServer` 0,
   `https.createServer` 0, `express(` 0, `app.listen(` 0, WebSocket 0. The two apparent dev
   surfaces — `http://127.0.0.1:3000` in `getHtml()` and `protocol.registerFileProtocol("zfile", …)` —
   are both gated by `isDev()`, which folds to the constant `false`.
2. **One OS-level channel does exist.** `HKCU:\Software\Classes\zalo` is registered by the app with
   `shell\open\command = "…\Zalo.exe" "--" "%1"` and no `DelegateExecute`. The running instance
   handles `second-instance`, parses `^zalo:?//conversation/?\?(phone|username|id)=\+?(.+)`, and the
   renderer calls `autoOpenConversationBy{Phone,Username,Id}`.

## Decision

1. **Runtime-hosted integration (running our UI inside Zalo) is closed on evidence.**
   Status `NO_SUPPORTED_CANDIDATE_YET`. The blocker is a *missing prerequisite*, not insufficient
   effort: Zalo 26.10.20 exposes no hook. The three ways to manufacture one are all forbidden —
   `app.asar` patch, preload/extension injection, and private IPC through DevTools. No adapter will be
   written for this direction, now or as a placeholder ("không chế tạo adapter giả định", plan §5).

2. **Companion via the OS-registered URI scheme is the one candidate.** Status `CANDIDATE_FOUND`,
   exactly one PoC defined (open one user-agreed test conversation via
   `zalo://conversation/?phone=<TEST_NUMBER>`), acceptance AC1–AC5, best possible label
   `COMPANION_POC_PASS`. It is a **dependent companion**: it requires the user to have Zalo installed
   and logged in, and it must say so wherever it is described (plan §10).

3. **ADR-001 is unchanged and still binding.** Native-client patch/injection remains NO-GO. Nothing in
   this ADR reopens that route. R11A adds a companion channel; it does not remove a prohibition.

4. **A1–A4 stay 0/4.** `AUTHORIZED` remains 0. R11A does not open any gate: "Khả thi về kỹ thuật ≠
   được phép tích hợp" (plan §2.4 #7). Using the OS channel while it is unexamined for Terms compliance
   is acceptable only inside the R11B test scope with user-controlled data; shipping it needs its own
   authorization check.

## Rationale for the two rejections that matter

| Route | Why rejected | Evidence |
|---|---|---|
| Named pipe `PipeZCallRecv` / `PipeZCallSend` | Loopback `net.createServer` inside Zalo main; payload is `JSON.stringify` → AES → `write(f"$")` with `getCallV2TransportAesKey()` drawn from `ZPC_SECRET_VALUES`. Using it means extracting a bundled key and speaking an undocumented internal protocol — plan §2.4 #5 and #6, §2.3. **`BLOCKED`, not "hard".** | `R11V3_RUNTIME_BOUNDARY.md` §8 |
| DevTools (`devTools: true` is real) | Manual, non-programmable, and calling internal `ipcMain` from it *is* private IPC access. Not a supported entry point. | §3.3 |

A third rejection, already in ADR-001: `app.asar` patching. It stays NO-GO.

## Consequences

**Positive.**
- R11B has one concrete, testable action instead of an open-ended search.
- The companion design does not read session state, tokens, cookies, or messages; it does not modify
  the installation. Rollback is "close the conversation".
- The mock adapter stays intact and is not compromised by exploration.

**Negative / accepted limits.**
- The companion channel is **one-way** (L1) and opens conversations only (L8). Apple Glass cannot learn
  which conversation Zalo is showing. Any UI that claims two-way sync would be lying.
- It requires Zalo installed and logged in on page MAIN (L2); otherwise the request queues.
- UIA is currently empty (L5) and `setAccessibilitySupportEnabled` is 0 (L6), so UI Automation must not
  be treated as a state-readback mechanism until measured again.
- The `zalo://` path depends on a 790 KB **VNG launcher** stub forwarding argv to the versioned binary —
  L7. The stub is *not* Squirrel: `Squirrel` / `Update.exe` / `--processStart` occur **0** times in its
  ASCII and UTF-16LE strings, its PDB is `D:\workspace\StubExecutableZalo\…\Zalo.pdb`, and it is signed
  `CN=VNG GROUP JSC` (R11V3_RUNTIME_BOUNDARY §7.6). That it *launches* the versioned binary is
  **`OBSERVED`** (276/276 second-instance runs correlate with a stub run within ±10 s). That argv reaches
  the renderer is **`INFERRED`** — exactly what the PoC must verify.
- Everything is pinned to 26.10.20.3253 and drifts with each auto-update.

## Rollback

Nothing has been changed. No Zalo file, package, profile or registry key was written by R11A; only reads
occurred. If a future R11B PoC is reverted, there is nothing on disk to restore — only the conversation
window it opened.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Ship the Android/third-party-client route (e.g. Olaz-like) | Motivation only; no proof of internals; and plan §2.4 #3 forbids taking code or bundles from third-party clients |
| Reuse the ZaloCall pipe "just to see if it decodes" | Extracting a key to speak an internal protocol is the exact thing plan §2.3 forbids |
| Add an "enable real adapter" toggle so the gate looks satisfied | Explicitly forbidden (plan §9); a switch is not evidence |
| Keep R11A open and keep sweeping for a hosting hook | Plan §12 stop rule: the criterion is one reproducible real action, not module count |
