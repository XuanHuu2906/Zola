# Windows baseline

Observed 2026-11-04 UTC / 2026-11-04–05 Asia/Saigon. Working directory: `D:\Zalo`.

| Item | Observation |
| --- | --- |
| OS | Windows, `win32 x64`, kernel `10.0.26200` |
| Node | v24.22.2 |
| npm | 11.19.1 |
| Git | `rtk git status --short` → exit 1: not a Git repository |
| Original app | Vanilla HTML/CSS/JS, fictional data, no Electron |
| Reference | `assets/approved-reference.jpg`, visually inspected with image viewer |
| Preservation | 13 files copied into `legacy/` before changing the entry point or package manifest |

## Executed checks

| Command | Exit | Result | Evidence |
| --- | --- | --- | --- |
| `rtk proxy npm test` (original scripts) | 1 | BLOCKED: Node test worker spawn EPERM | [stdout](baseline-test.log) |
| `rtk proxy npm run check` (original scripts) | 1 | BLOCKED at test worker; preceding syntax checks completed | [stdout](baseline-check.log) |
| `rtk proxy node --test --test-isolation=none tests/logic.test.cjs` | 0 | PASS, 7/7 original helper tests | Tool output and subsequent combined [test log](unit-tests.log) |
| Legacy copy verification + SHA-256 generation | 0 | PASS: original JS, CSS, tests, assets still equal their legacy copies | [manifest](legacy-sha256.txt) |

The test runner uses Node 24's in-process isolation option because the environment refused subprocess creation. No production sandbox was disabled. The seven original tests were not changed.

## Visual baseline

1920×1080 and 1366×768 screenshots: **NOT RUN**. The connected UI inventory returned `apps: []`, `browsers: []`; no screenshot was fabricated. Reference-image inspection does not establish browser rendering parity. The complete baseline can still be opened at `legacy/index.html` on a machine with a browser.

## Dependency restriction

- `npm view vite ... --offline`: ENOTCACHED.
- Registry metadata request with normal online npm mode: ECONNREFUSED, configured proxy `127.0.0.1:9`.
- `npm install --offline --ignore-scripts --no-audit --no-fund --cache .npm-cache`: exit 1, missing `@eslint/js` metadata.
- No proxy, machine configuration, registry, or sandbox setting was changed.
- No lockfile or runnable Electron artifact can be truthfully claimed from these attempts.
