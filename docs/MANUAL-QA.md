# Manual QA — four checks the automated suite cannot cover

> Archived (2026-11-12): these steps target the removed demo interface. They are retained as historical evidence and are not current Zola test instructions.

These four items are recorded as `NOT RUN` in [QA-CHECKLIST.md](QA-CHECKLIST.md). They
need a human at the machine: a real mouse, a real OS input method, a real assistive
technology, and real displays. Nothing here can be promoted to `PASS` by a script, and
this document does **not** assert that any of them pass.

Record results back into [QA-CHECKLIST.md](QA-CHECKLIST.md) only after performing them.
If a check is skipped, leave it `NOT RUN` — a skipped check is not a pass.

## Before you start

Use the packaged build, not the browser:

```powershell
npm run build:desktop
```

then run `release\Glass-Messenger-Demo-0.3.0-x64.exe` from a writable directory, or use
`npm run dev:desktop` for the dev renderer. The window controls and drag region only
exist in the Electron shell (`window.desktop`), so a plain browser at
`http://127.0.0.1:5173` cannot exercise checks 1 and 3.

Machine state when this checklist was written (2026-11-05):

| Fact | Value |
| --- | --- |
| Displays detected | 1 — `\\.\DISPLAY1`, 1920×1080, primary |
| Implication | Check 4 cannot run on this machine unless a second display is attached |

---

## 1. Physical mouse drag of the titlebar

**Why the automation is not enough:** `desktop-extra-qa.json` proves that 34 sampled
points resolve to `-webkit-app-region: drag` and that the three buttons resolve to
`no-drag`. That is computed style and hit-testing. It does not prove the OS actually
moves the window.

**Steps**

1. Launch the app. Note the window's screen position.
2. Move the pointer into the titlebar band — above the conversation list, to the right
   of the navigation rail (the band starts at `left: 210px`, or `76px` when the window
   is narrower than 900 px).
3. Press and hold the left button, drag ~200 px right and ~100 px down, release.
4. Repeat, starting the drag from a point just left of the minimize button.
5. Click each of the three window buttons (minimize, maximize/restore, close). Reopen
   the app and repeat the maximize/restore button twice.
6. Try to drag starting from inside the navigation rail, the conversation list, and the
   message composer.

**PASS looks like**

- The window follows the pointer in steps 3, 4 and 6 (titlebar band only).
- The window does **not** move in step 6 from the rail, list, or composer.
- Minimize actually minimizes; maximize/restore toggles back to the previous size;
  close actually exits.
- No visual tearing, no jump on drag start, no frozen UI afterwards.

**FAIL looks like**

- Window does not move when dragged by the titlebar.
- Window moves when dragging from the rail, list, composer, or a button.
- Dragging selects text instead of moving the window.
- A button click starts a drag, or the button does nothing.

**Record:** start and end window position, which region you dragged, screenshot of the
window after the drag as `reports/screenshots/manual-drag-*.png`.

---

## 2. Physical OS Vietnamese IME (Telex / VNI)

**Why the automation is not enough:** `extended-qa.spec.ts` fires synthetic CDP
composition events. The browser test proves the app handles composition correctly *when
composition happens*; it does not prove that real Windows IME produces that event
stream inside Electron.

**Setup**

1. Windows Settings → Time & language → Language & region → add **Tiếng Việt**.
2. Set Vietnamese input to **Telex** (or VNI — record which).
3. Switch to Vietnamese with `Win + Space` and confirm the taskbar shows `VI`.

**Steps**

1. Click into the message composer.
2. Type `xin chao` — expect the composer to show `xin chào`.
3. Type `tie^ng vie^.t` (Telex) — expect `tiếng việt`.
4. Type a partial word (`vie`) and press **Enter while the IME candidate window is
   still open**. The message must **not** be sent.
5. Finish the word and press Enter again. Exactly one message must be sent, with the
   correct diacritics.
6. In the composer press **Shift+Enter**. A newline must be inserted, not a send.
7. Repeat in the settings dialog's text fields if any are present.

**PASS looks like**

- Diacritics render as typed; no dropped, duplicated, or out-of-order characters.
- Enter during composition never sends.
- Enter after composition sends exactly once.
- Shift+Enter always inserts a newline.

**FAIL looks like**

- Characters duplicated or reordered (`xinn chaoo`).
- Message sent mid-composition.
- Diacritics lost in the sent bubble even though the composer showed them.
- Enter swallowed entirely, so nothing sends.

**Record:** the IME name and version (e.g. "Telex, Windows 11 build 26200"), which
steps failed, and the exact typed string vs. what appeared.

---

## 3. Screen-reader session with spoken output

**Why the automation is not enough:** the CDP accessibility tree was walked and reported
8 interactive nodes per theme with 0 unnamed. A tree is not speech. This check is about
what a person actually hears, in order.

**Setup**

Use **Narrator** (`Win + Ctrl + Enter`) or **NVDA**. Record which and its version. If
the screen reader needs installing, note that before claiming anything.

**Steps**

1. Start the app with the reader running.
2. Starting at the top of the window, tab through every interactive element in order:
   window controls → navigation rail → conversation list → chat header → message list →
   composer → send/reaction controls.
3. Open Settings. Tab through the dialog. Press `Escape`.
4. After closing, confirm focus returned to the control that opened Settings.

**PASS looks like**

- Every control announces a non-empty name and a role.
- The three window controls announce "Thu nhỏ cửa sổ", "Phóng to hoặc khôi phục cửa sổ",
  "Đóng cửa sổ".
- Focus stays inside the Settings dialog while it is open (no escape into the page
  behind), and `Escape` restores focus to the opener.
- Reading order matches visual order.

**FAIL looks like**

- A control announced as just "button", "blank", or a file name/glyph.
- Tab leaving the modal while it is open.
- Focus lost to the document body after closing the dialog.
- Vietnamese labels read as gibberish (a voice/encoding problem worth recording even
  though it is not a UI defect).

**Record:** reader name/version, the first element that failed and what was spoken,
and whether the failure is app or reader related.

---

## 4. Multiple physical monitors and per-monitor DPI

**Why the automation is not enough:** DSF 1/1.25/1.5/2 and browser zoom 1/1.25/1.5/2 were
emulated. Emulation does not reproduce mixed-DPI windows crossing a real monitor
boundary.

**Current machine:** only one display (`\\.\DISPLAY1`, 1920×1080) was detected on
2026-11-05. **This check cannot run as specified here.** Either attach a second display
or run it on another machine; otherwise leave it `NOT RUN`. Do not substitute emulation
and call it a pass — that check already exists separately.

**Steps (when a second display is available)**

1. Set display A to 100% scaling and display B to 150% (or vice versa). Record both.
2. Launch the app on A, then drag it steadily across the boundary onto B, and back.
3. Maximize on each display. Restore. Move between them again.
4. Check the titlebar height, the 44×44 minimum button targets, the rail width, and
   whether any panel overflows or text goes blurry.
5. Repeat with the displays side by side horizontally **and** stacked vertically, if
   both arrangements are possible.

**PASS looks like**

- Titlebar stays 47 CSS px, sized correctly for each display's scale.
- Buttons keep at least a 44×44 physical hit target on both displays.
- Window controls remain visible and clickable on both.
- No overflow, no clipped rail, no panel collapsing, text stays sharp after the move.

**FAIL looks like**

- Window controls disappear or become unreachable on one display.
- Content scales twice (huge) or not at all (tiny and blurry).
- Layout overflow or a scrollbar appears that is absent at 100%.
- Window snaps back or resizes itself during the crossing.

**Record:** display resolutions and scale factors, arrangement (horizontal/vertical),
which step failed, screenshots from each display.

---

## Recording results

Copy this block into [QA-CHECKLIST.md](QA-CHECKLIST.md) once a check is actually
performed. Keep `NOT RUN` for anything you did not do.

```markdown
| Manual: physical titlebar drag | PASS/FAIL | date, who, start→end position, screenshot manual-drag-*.png |
| Manual: OS Vietnamese IME (Telex/VNI) | PASS/FAIL | date, IME name+version, steps that failed |
| Manual: screen reader spoken output | PASS/FAIL | date, reader name+version, first failing element |
| Manual: multi-monitor / per-monitor DPI | PASS/FAIL/NOT RUN | date, displays + scale factors, or reason not run |
```

## What a PASS here does not mean

These four checks exercise the demo shell only. They say nothing about Zalo
compatibility — that remains **UNKNOWN / NOT TESTED** and is gated by
[ADR-001](ADR-001-integration-strategy.md).
