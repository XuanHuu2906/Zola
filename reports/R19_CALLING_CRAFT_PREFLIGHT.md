> Initial preflight, superseded by [R19_CALLING_IMPLEMENTATION.md](R19_CALLING_IMPLEMENTATION.md). The AppImage has since been extracted with user permission and calling code implemented.

# Investigation report

**Question:** Determine the official installed Zalo voice/video call implementation and implement interoperable calling in Zola.

**Purpose:** User-requested interoperability for their personal Zalo client.

**Done when:** Evidence-backed call protocol and implementation integrated and tested, with any real-call validation limitations stated.

## What we looked at

- Zalo.AppImage (A Linux (or Unix) program)
- /home/nguyenhuu/Hoc Tap/Zola

## What we found

### The local installer script downloads Zalo.AppImage from VN-Linux-Family/zalo-for-linux into ~/.local/opt/zalo. This establishes the installer's community source, not a verified official Zalo PC artifact.

- **Confidence:** Seen it (observed)
- **Evidence:**
  - `ev_74cbd5427c819f1a2badd0a47d9662e15d7d0335c1415f494c9c1fae72b0f2b1` — install-zalo.py: lines 1–55 of 55 (UTF-8). (path=/home/nguyenhuu/.local/bin/install-zalo.py)

### Zola main.ts denies all permission requests and permission checks. Supporting renderer microphone/camera capture will require an origin-scoped media permission implementation.

- **Confidence:** Seen it (observed)
- **Evidence:**
  - `ev_c0c9a3a8eaee98adf6cf0725b027989427ddc286f69cd3086e35b77f097690f3` — main.ts: lines 396–410 of 486 (UTF-8). (path=/home/nguyenhuu/Hoc Tap/Zola/electron/main.ts)

### The historical R11V3 report contains a native ZaloCall IPC path with encrypted JSON over named pipes/Unix sockets. This is historical secondary evidence only; the original official files and media/signaling behavior have not been revalidated in this investigation.

- **Confidence:** Seen it (observed)
- **Evidence:**
  - `ev_af1c4ef3ffc7304af43101ddafb5b6731f17dd064d2d9ef28db7c56087d1a29d` — R11V3_RUNTIME_BOUNDARY.md: lines 561–598 of 691 (UTF-8). (path=/home/nguyenhuu/Hoc Tap/Zola/reports/R11V3_RUNTIME_BOUNDARY.md)

## Open questions

- Where is the user's official Zalo PC installation or original app.asar plus native call binaries? _(severity High, Open)_
  - would settle it: User supplies absolute installation/artifact path; open and inventory original files with Craft Anything.

## How this was done

- **Mode:** Deep (the original's code and files could be read)
- **Engines:** builtin
- **Limitations:**
  - The file is read as text as it is stored: nothing is run, rendered or formatted, and text a program builds or downloads while it runs isn't here.

## Handoff

User requests reverse engineering their official Zalo with Craft Anything to implement voice/video in Zola. Inspected source and historical reports, no code changes. Working tree already extensively dirty; preserve user changes. Current target ~/.local/opt/zalo/Zalo.AppImage SHA256 72fd3a6fd8adf337fec10ffe0b7a9c5bdc6d846be6419f7afc5c6842fe570cc6 is ELF with DWARFS marker; do not execute without runtime consent. Installer ~/.local/bin/install-zalo.py points to community VN-Linux-Family/zalo-for-linux. No verified official Zalo PC app.asar or ZaloCall binary found in searched home locations. Asked user asynchronously for official installation path. Historical R11V3 §8 has native encrypted JSON call IPC but is secondary evidence, not a verified current protocol. Zola denies all media permissions in electron/main.ts; renderer CSP connect-src none in electron/security.ts. Next: obtain original official files, inventory JS/native calling components, derive signaling/media evidence before implementation. No credentials/profile contents read; no real calls made. Javascript toolset enabled but tool discovery snapshot still exposes core tools only. Temporary /tmp/zola-zalo.squashfs is a failed exploratory slice at a false hsqs marker, not valid SquashFS; ignore it.

