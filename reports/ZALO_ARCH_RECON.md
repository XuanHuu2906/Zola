# Installed Zalo reconnaissance

Status: **RUN (read-only), 2026-11-05 19:34 +07:00**. G4 evidence only.
Report: `zalo-recon-20261105-193413.json`.

Authorized by the user's explicit instruction to run the sweep. Executed command
(non-admin, from the project folder):

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\Inspect-Zalo.ps1
```

Scope kept to process metadata, executable version/signature, packaging markers and
an aggregate extension inventory. No process attach/debug, no `app.asar` extraction
or content read, no profile, cache, chat, credential or network access. REA tools
were not attached to Zalo.

**Superseded in part (2026-11-05, later pass):** a subsequent deeper read-only pass
copied and read three bundled JavaScript files (`main-dist/main.js`,
`pc-dist/compact-app-pc….js`, `main-dist/preload-render.js`) and probed the CSS bundle,
in order to answer the theme/plugin question this metadata sweep could not. No profile,
database, credential, media or network data was read. Findings and disclosure:
[ZALO_THEME_FEASIBILITY.md](ZALO_THEME_FEASIBILITY.md). The statements above remain
accurate for *this* G4 sweep.

## Findings

| Question | Observed evidence |
| --- | --- |
| Installed version | `Zalo.exe` file/product version **26.10.20.3253**; install folder `Zalo-26.10.20` |
| Publisher / signature | All five inspected executables report **Valid**, subject `CN=VNG GROUP JSC, O=VNG GROUP JSC, S=Ho Chi Minh City, C=VN, SERIALNUMBER=0303490096` |
| Process layout | One parent `Zalo.exe` (PID 18220) with 7 child `Zalo.exe` processes, plus `plugins\capture\ZaloCall.exe` and `ZaloCap.exe` |
| Packaging | `resources\app.asar` **present**; `resources\app.asar.unpacked` **present**; `resources\app\package.json` absent |
| Chromium markers | `chrome_100_percent.pak`, `chrome_200_percent.pak`, `resources.pak`, `icudtl.dat`, `v8_context_snapshot.bin`, `libEGL.dll`, `libGLESv2.dll` all present |
| Extension inventory | `.asar` 1 file / 169.5 MB · `.pak` 58 files / 31.76 MB · `.html` 1 file / 6.49 MB · `.js` 26 files / 0.12 MB · `.json` 3 files |

Hypothesis recorded by the script: **strong Electron packaging indicator** (`app.asar`),
not a definitive framework or version confirmation.

## Interpreted carefully

- These markers show a Chromium-family, `app.asar`-packaged desktop client. They do
  **not** prove which UI framework renders it, and they say nothing about whether the
  client exposes a supported theme/plugin/CSS hook. The small `.js` count outside the
  archive (0.12 MB total) indicates the application bundle is inside `app.asar`, whose
  contents were deliberately not read.
- `app.asar.unpacked` and a `plugins\capture` directory with `ZaloCall.exe`/`ZaloCap.exe`
  show native helper components, not an extension point. Nothing observed suggests the
  renderer can be replaced from outside.
- Signature validity confirms the inspected files match the VNG-signed build; it is not
  a statement about modification permissions.

## Impact

G4 is now **RUN with evidence**, instead of NOT RUN. It does not change G5: no authorized,
verified presentation-layer integration route has been established, so **P3 remains NO-GO**
per `docs/ADR-001-integration-strategy.md`. No Zalo file, process, package or session was
modified; no original-client rollback is needed.

## Limitations

The report redacts only `%USERPROFILE%`; other path segments remain visible. The script
reads at most ten executables and reports extension totals only, so it is not a complete
inventory. Marker presence is evidence, not proof of framework or compatibility.
