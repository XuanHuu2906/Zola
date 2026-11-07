# ADR-003 — Loopback-only transport test double

Date: 2026-11-06 (Asia/Saigon). Status: **implemented (M2)**. Scope: test/Node only.

## Context

`docs/CUSTOM_CLIENT_ARCHITECTURE.md` §2 puts a `TransportPort` at layer 4, below the
`IZaloClient` adapter. M2 wants a real HTTP + push path exercised end-to-end without any
Zalo endpoint, host, header or credential. The gate table in
[`API_AUTHORIZATION_GAP.md`](API_AUTHORIZATION_GAP.md) is **0/4 open**, so nothing may leave
the machine.

Two facts constrain the design:

1. The production renderer ships `connect-src 'none'` in the CSP meta tag (`index.html` line 9)
   and [ADR-002](ADR-002-desktop-security.md) keeps it that way. Any renderer-side socket is
   therefore blocked by design, not by accident.
2. A raw claim of "transport works" is worthless if the peer is Zalo. The only peer we may
   talk to is a server this repository starts on `127.0.0.1`.

## Decision

`src/transport/loopback.ts` implements `TransportPort` against a **loopback-only** base URL:

- `assertLoopback()` throws for any hostname other than `127.0.0.1`, `::1`, `[::1]`, `localhost`,
  and for any scheme other than `http(s)`.
- The wire protocol is ours: `x-demo-session` header, `/session` handshake, `/events` SSE.
  There is no Zalo path string anywhere in the file.
- `connect`, `pumpPush`, `reconnectOnce` and `disconnect` return `ClientResult`, never throw.
  Backoff is bounded by `backoff.maxRetries`; `reconnectOnce` performs **one** round and lets
  the caller decide whether to continue, so an unattended loop cannot spin.
- The class is reachable only from Node (main process / tests). The renderer cannot import it
  because of the layer rule enforced in `tests/design-system.test.ts`.

`tests/transport.test.ts` starts a real `node:http` server on an ephemeral loopback port and
drives the transport against it: handshake, 401-is-unauthorized (not retryable-network), empty
handle refused before a socket opens, connection-refused classified as retryable network,
SSE frame counting, backoff-then-success, retry exhaustion, disconnect emitting exactly one
event, and pre-aborted signal producing `cancelled` without opening a socket.

## Consequences

- M2 is `PASS (loopback)` with 10 tests, and the pass means **our server answered our client**.
  It says nothing about Zalo.
- The production CSP stays closed. If a future authorized adapter needs the renderer to reach
  a real backend, that is a separate ADR changing CSP, and it is blocked by A1+A2 — not a
  tweak this one permits.
- `LoopbackTransport.capability` is `'mock'`, so `docs/CUSTOM_CLIENT_ARCHITECTURE.md` §8 keeps
  M2 at `PASS (loopback)` rather than `PASS (live)`.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Mock `fetch` at the transport layer | No socket, no real handshake; the test would pass even if timeouts, aborts or SSE parsing were broken |
| Bind to `0.0.0.0` / LAN address | Reachable from other machines; not required and widens the blast radius |
| Let the renderer talk to the loopback server | Requires reopening `connect-src`; ADR-002 forbids it, and the UI has no business owning a socket |
| Point the transport at a Zalo host "just to see" | A1 closed; an endpoint being readable is not permission to call it |
