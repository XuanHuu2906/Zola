# R19 — Linux 1:1 calling implementation

Status: implemented and packaged for review; **real calls are unverified**. No account was opened and no contact was called during this investigation. The user explicitly permitted AppImage extraction; this did not authorize a test call.

## Source and investigation

Craft Anything inspected the installed `/home/nguyenhuu/.local/opt/zalo/Zalo.AppImage`, SHA-256 `72fd3a6fd8adf337fec10ffe0b7a9c5bdc6d846be6419f7afc5c6842fe570cc6`. Filename searches across accessible home, installation, mount and temporary directories found this package plus an identical Trash copy. Other ASAR hits belonged to Zola and Docker Desktop. Private account-data contents were excluded. Inaccessible system temporary directories were not searched. See `R19_CALLING_INVENTORY.json`.

The package is the community Linux port, **not a verified unmodified official distribution**. Extraction recovered bundled Zalo 26.11.10 JavaScript under `AppDir/app`, a Linux wrapper ASAR, and `zcall-native`. The engine README identifies generated source from Zalo-Linux-Native-Dev commit `b331561`; its interoperability claims have not been tested here. Craft evidence: `ev_a152c39aecfb434304d44b2b293e58f9135c6044669dd5ea97cdcc5dfb8dadb7`, `ev_e600067c2e88239207007b05a7f25424a0999ebc179e2f4bb949ff9a0bba62b8`.

The bundled shared renderer chunk contains the HTTP voicecall methods and native signal dispatcher. `R19_CALLING_PROTOCOL_EXCERPTS.txt` records the relevant excerpts and original character offsets. Its derived evidence is `ev_eb4ea50aaad17ee482cbc41a0de110f0d82e48f5b9efa2d6cf2bb493fcd811d4`. These are static code observations, not live server traces.

| Native command | HTTP voicecall endpoint | Significant wire fields |
| --- | --- | --- |
| 401 | requestcall | typeRequest, calleeId, callId, codec, imei |
| 416 | request | session, RTP/RTCP addresses, extendData, subCommand |
| 407 / 408 | ringring / answerack | callerId / calleeId, status 0 |
| 402 | answer | session_id, callerId, status; no imei |
| 405 | cancel | callerId from engine toId, callType |
| 409 | endcall | uidTo from engine toId, status 3 |
| 406 | logendcall | call_id, partner_id, logdata |
| 12006 | conf | isOnCam, isOnMic |

## Implementation

- `electron/protocol/call-signaling.ts` maps the observed fields and sends requests through zca-js custom API utilities. The existing login session supplies encryption and authentication. The renderer receives neither session material nor signal responses.
- `electron/calls/control.ts` watches 601/603 frames on the existing socket, decrypts with the existing listener key, and forwards recent 1:1 `voip` events. It detaches on reconnect/logout and drops unrelated, stale, malformed and group events. It does not create a new account session or control socket.
- `electron/calls/service.ts` lazily loads the locally extracted engine, bridges signaling, and forwards only UI state and H.264 frames. It blocks overlapping calls and ignores replies from disposed/superseded calls. Logout, disconnect and quit stop media. Native engine logging is disabled in this bridge.
- `CallPanel.tsx` and `useCalls.ts` provide outgoing/incoming UI, accept/reject, hangup, mute, camera toggle, camera encoding and remote video decoding. MediaStream tracks and codecs close on teardown. A failed decoder can recover on a subsequent keyframe. Encoding failures stop camera capture.
- Trusted main-frame IPC checks cover the calling bridge. Renderer camera permission is limited to the main app document during an active call; native audio capture is handled by the local engine. CSP permits local media without enabling renderer network access.

Scope is **Linux x64, 1:1 calls**. Group calls, screen sharing and device selection are not exposed. The engine runs in Electron's main process and spawns its own audio helper; a future process-isolated adapter would contain engine faults more strongly.

The prepared local runtime is gitignored in `.zola-call-runtime`, with its source README and provenance. Linux packaging copies it to `resources/zola-call-runtime`, outside ASAR. `npm run calls:prepare -- /path/to/Zalo.AppImage` explicitly prepares it on another checkout by running extraction only. `ZOLA_CALL_RUNTIME` optionally selects another prepared runtime. No official transport AES secret was extracted or embedded in Zola's bridge.

## Validation and remaining work

Passed: typecheck, lint, full unit suite (547 tests), browser suite (2 tests), renderer/Electron builds, packaging and ASAR parity (50 files). Focused calling/boundary tests were rerun after lifecycle cleanup. The 16 runtime files were also compared byte-for-byte with the package. `R19_CALLING_VALIDATION.json` records the final artifact hash.

Unit tests use a fake native engine; browser calling tests use a synthetic authenticated bridge. They validate wiring and lifecycle, **not real Zalo interoperability**. No native engine execution, microphone recording, camera capture, UDP media exchange or real call was performed after extraction.

Still required: explicitly authorized live outgoing and incoming tests with a user-selected test contact, verifying server acceptance for Zola's session, control delivery, voice both ways, video both ways, mute/camera toggles, remote/local hangup and reconnect. System audio/H.264 availability has not been exercised by this change. The newly built AppImage has not been installed over the running app.
