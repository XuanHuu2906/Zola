# Apple Glass visual specification — v1

**Approved reference:** `assets/approved-reference.jpg` (generated concept artwork).
This is an inspiration reference, not a screenshot of a modified Zalo application.

## Surfaces

| Surface | Appearance | Interaction |
|---|---|---|
| App shell | Frosted translucent blue, 29 px corner radius, light border | Browser viewport |
| Rail | Deep tinted glass, large capsule selected item | Main section navigation |
| Chat list | Translucent secondary pane, soft selected row | Search, filter, open conversations |
| Conversation | Layered light-blue transparent plane | Display fake local messages |
| Incoming bubble | Milky glass, subtle white border | Purely visual |
| Outgoing bubble | Saturated translucent blue | Local demo send |
| Composer | Floating pill glass with icons | Demo text input, filename-only attachments |
| Dialog | Heavier backdrop blur, clear hierarchy | Theme, glass intensity, reduced motion |

## Tokens

- Frame tint: blue-violet; accent: `#298cff` in the dark theme.
- Typical corner radii: 14, 20, 26, 29 px.
- Translucent layering controlled via CSS custom property `--glass-opacity`.
- Background: composed radial and linear gradients (no required image download).
- Blur: `backdrop-filter`; rendered outcome varies by OS, browser and GPU.
- Contrast: dark theme text `#f4f8ff`; light theme text `#152d57`.
- No expectation of pixel-identical matching to Apple's proprietary Liquid Glass material system.

## Accessibility / performance

- Keyboard: Enter send (local); Shift+Enter newline; Escape close dialog.
- Focus-visible outlines for keyboard users.
- OS reduced-motion and the UI switch are implemented through Motion/CSS and
  verified by browser E2E. Low-blur mode is available and persists on reload.
- Runtime timing and memory evidence, when measured, is recorded in the delivery
  report. One workstation does not establish performance on lower-end GPUs.

## Migration notes (2026-11-05)

Legacy geometry, gradients, avatars and panel styles were retained in
`src/renderer/styles/globals.css`; theme variables are in `tokens.css`.
Tailwind v4 is imported through its Vite plugin. New details: real desktop window
controls, visible local-demo composer hint, keyboard-accessible reaction buttons,
native settings dialog, per-conversation session drafts and low-blur toggle.
Dark panels now use a stronger navy tint, and outgoing bubbles/selected blue
buttons use deeper blue after real screenshot sampling exposed insufficient
contrast in the reference-derived pale glass. Typography, panel geometry,
avatars, gradient backdrop and floating composer remain recognizable.

Dark/light chat and settings at 1366×768 pass axe WCAG A/AA rules with no reported
violations. Axe cannot resolve all pseudo-element/gradient backgrounds, so a
separate pixel sampler checks composited backgrounds under visible text.
Minimum sampled ratios: dark chat 5.33:1, dark settings 6.09:1, light chat 5.51:1,
light settings 5.70:1. Reports cover these states at default glass strength;
they do not certify all themes/settings, placeholders, icon contrast or assistive
technology. See `reports/accessibility/` and `reports/VISUAL_QA.md`.
