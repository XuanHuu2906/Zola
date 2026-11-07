# Visual and accessibility QA — 2026-11-05

Reference: `assets/approved-reference.jpg`. Actual legacy captures:
`screenshots/legacy-1920x1080.png`, `screenshots/legacy-1366x768.png`.
Actual React captures: `screenshots/react-{dark,light}-{1920x1080,1600x900,1366x768}.png`.
These are renderer screenshots captured on Windows, not generated mockups.

## Review

Three columns, rounded glass surfaces, blue/violet backdrop, supplied avatars,
incoming/outgoing message alignment and floating composer are preserved.
Dark mode deliberately uses deeper navy than the concept/reference to keep
text readable. Light mode uses navy text over pale glass. Native controls appear
only in Electron; the browser preview omits decorative fake window controls.

The captures at three required sizes were inspected. Composer and navigation
remain reachable and no document-level horizontal overflow was observed.
At 1366×768, the chat and conversation lists scroll; opening at the newest
message can place older content above the visible region. This is intentional.
At 1920×1080, the shell is capped at 1680×960 and centered.
No claim of pixel-identical Apple materials or final user design approval.

## Executed accessibility checks

- Keyboard Enter/Shift+Enter, modal Tab/Shift+Tab wrap, Escape and opener-focus
  restoration: browser E2E PASS. Initial focus restoration failure was fixed.
- Theme/preferences reload, low blur, OS reduced motion: E2E PASS.
- Axe WCAG 2 A/AA + 2.1 AA tags: zero violations for dark/light chat/settings.
  Raw reports retain incomplete checks; gradients/pseudo-elements prevent axe
  from conclusively evaluating all text backgrounds.
- A supplementary sampler hides text fill without changing layout, captures
  the rendered background, and calculates WCAG luminance contrast using the
  computed foreground/opacity at visible text ranges. It samples actual pixels
  under text rather than inferring an opaque CSS background.

| State at 1366×768 | Text ranges | Pixel samples | Minimum sampled ratio |
| --- | ---: | ---: | ---: |
| Dark chat | 49 | 762 | 5.33:1 |
| Dark settings | 15 | 390 | 6.09:1 |
| Light chat | 49 | 762 | 5.51:1 |
| Light settings | 15 | 390 | 5.70:1 |

Extended sweep at the glass-strength endpoints (15 and 95) with normal and
low blur, dark and light, settings and chat — 512 text samples in
`accessibility-extended/`. Minimum 4.96:1, zero samples below 4.5:1. The earlier
disk-dark run that failed at 4.16:1 (`14:27`) and 4.45:1 is preserved in
`accessibility-extended-before-fix/`; the fix was applied to
`src/renderer/styles/globals.css` and re-verified by `extended-qa.spec.ts`.

Thresholds: 4.5:1 normal text, 3:1 large text. Initial failures and final results
are kept separately in `accessibility-before-contrast-fix/` and `accessibility/`.
The sampled check excludes logos, hidden/clipped text, SVG and emoji-only text;
it does not establish placeholder/icon contrast, all glass slider settings,
screen-reader compatibility, physical IME behavior or WCAG certification.

The verified layout and contrast changes are covered by `executed/e2e-021.log`
and re-confirmed on the R10 tree by `executed/r10-e2e-current.log` (26/26 PASS,
re-run after the full-window shell change; the earlier 26/26 on the pre-shell
tree is `executed/r10-e2e.log`, and the older 14/14 result is preserved in
`executed/verify-e2e-030.log`). An OS-level IME was not exercised; the automated check drives Chromium
composition events only. Native drag is now measured indirectly by
`desktop-extra-qa.json` — computed `-webkit-app-region` values plus a 34-point
`elementFromPoint` hit map — which is hit-testing evidence, not a performed
mouse drag. Emulated device scale factors and zoom factors are likewise not a
multi-monitor hardware test. Physical drag, OS IME, screen-reader speech and
per-monitor DPI remain manual and no manual PASS is asserted.
