# ADR-001 — Standalone demo; actual-client integration NO-GO

Date: 2026-11-05 (Asia/Saigon). Status: **NO-GO for P3**. Passive installed-client reconnaissance: **RUN (read-only)** — see [report](../reports/ZALO_ARCH_RECON.md).

Recon observed Zalo PC **26.10.20.3253**, VNG-signed, with `resources\app.asar` and full
Chromium packaging markers: Electron **22.3.9** / Chromium **108.0.5359.215**, 7 fuses
(`EnableEmbeddedAsarIntegrityValidation` and `OnlyLoadAppFromAsar` disabled).

A deeper read-only pass then inspected the bundled JavaScript, because the theme question
cannot be answered from metadata alone. It found that Zalo ships a **first-party theme
system** — `DARK / LIGHT / SYSTEM / CUSTOM`, CSS custom-property token palettes, a color
picker dashboard headed "Personalize Your Look & Feel", persisted to `localStorage`
(`za_theme`) and to the main-process `app_theme` config over the `update-theme-conf` /
`get-theme-conf` channel. That is a real customization engine, but it is Zalo's own:
the CUSTOM dashboard is reachable in 26.10.20 only from a **debug context menu** item
("Personalize theme"), and the user-facing Settings page exposes just `LIGHT / DARK /
SYSTEM`. The packaged renderer contains **no** `insertCSS` / `injectCSS` /
`executeJavaScript` call, the main window runs `contextIsolation: true`,
`nodeIntegration: false` with a single fixed preload, and the preload bridge is a closed
`contextBridge` allowlist.

So the precise finding is: **an internal, partly debug-gated built-in theme engine exists,
but no supported third-party hook reaches it.** The client is Electron-packaged, which
makes patching technically possible — an ASAR patch is a change to a signed VNG package
that crosses the update boundary and is a Terms 4.4/4.5 concern — and that route remains
NO-GO. Evidence and limitations: [feasibility report](../reports/ZALO_THEME_FEASIBILITY.md).

## Decision and evidence

Ship work toward an independent offline design prototype. No authorized, verified presentation-layer extension point for Zalo PC has been established in this session. This is an evidence gate, not a claim that every possible integration route is impossible.

Official sources inspected:

1. [Zalo PC](https://zalo.me/pc) describes native/web offerings, synchronization and file/group features. It does not establish that a standalone Electron demo can reuse them.
2. [PC personalization guide](https://help.zalo.me/huong-dan/chuyen-muc/zalo-cong-viec/ca-nhan-hoa-zalo-tren-may-tinh/) documents built-in preferences. The inspected guide supplies no general renderer replacement/plugin contract; installed-version availability is unverified.
3. [Terms of use](https://zalo.vn/dieukhoan/) section 4 lists restricted actions, including redesign/disassembly/modification (4.4), unauthorized interference (4.5), and unapproved third-party access (4.7). The [official update notice](https://help.zalo.me/huong-dan/chuyen-muc/quan-ly-tai-khoan-zalo/tai-khoan/thong-bao-ve-dieu-khoan-su-dung-moi-nhat-cua-zalo/) is dated 28 August 2026. These are relevant constraints for the project's authorization gate; this document makes no independent legal determination.

## Options

| Route | Reach / limitation | Maintenance and decision |
| --- | --- | --- |
| Built-in Zalo preferences | User-facing themes are LIGHT/DARK/SYSTEM; a CUSTOM token dashboard exists but is debug-gated in 26.10.20 | Lowest maintenance; user-operated; not a glass redesign route |
| Windows decoration | Window frame/OS appearance does not replace internal panels | OS-dependent; outside current implementation |
| Zalo Web customization | Separate web client; not evidence of PC feature parity or permission | NEEDS AUTHORIZATION and documented mechanism; no experiment run |
| Native-client patch/injection | Touches original renderer/package/runtime and update boundary; ASAR load-integrity is off but patching a signed package is still a Terms 4.4/4.5 concern | NO-GO under plan and current evidence |
| Independent Electron demo | Fully controlled fictional UI, no login/sync/real calls/files | Current implementation path; packaging validation blocked |

## Risk, maintenance cost and rollback

| Route | Risk | Maintenance | Rollback |
| --- | --- | --- | --- |
| Standalone demo (chosen) | None to Zalo; fictional data only | Owned by us; no upstream coupling | Close the demo, or open `legacy/index.html` |
| Native-client patch | Breaks on every client update; invalidates the VNG signature; Terms 4.4/4.5 exposure; account and user data at risk | Total — re-diff each release | Reinstall the original client; no guarantee for modified profiles |
| Preload/extension injection | No hook exists; creating one requires patching | Total | Same as patching |
| Zalo Web customization | Authorization unknown; UI/API drift | Medium, but blocked on the gate | Revert the customization; no PC parity claim |

## Next gate

Before P3: obtain a documented supported route, authority for the precise change, and an isolated test account; then define regression/rollback for login, messaging, files, groups, calls, notifications, reconnect and updates. Current compatibility for all real Zalo functions is **UNKNOWN / NOT TESTED**. P2 acceptance is met without any "100% Zalo compatibility" claim.

No actual Zalo files or runtime were modified, so no original-client rollback is needed. Demo rollback is opening `legacy/index.html`. Closing the demo drops in-memory fictional messages. The demo's own settings/cache directory is separate from Zalo.

Limits of this evidence: only Zalo PC 26.10.20 was examined; the deeper pass **did** copy
and read three bundled JavaScript files (`main.js`, `compact-app-pc….js`,
`preload-render.js`) plus CSS probes, which supersedes the "no `app.asar` payload read"
wording in the earlier G4 reports. No profile, chat database, credential, media or
network data was accessed. Static reading only — nothing was executed, so all real Zalo
behavior remains **UNKNOWN / NOT TESTED**, and the absence of a hook is evidence
against an extension point rather than proof that none exists.
