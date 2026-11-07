# Zalo Apple Glass UI — Agent Execution Plan

**Version:** 1.1 — STACK LOCKED / DESKTOP MIGRATION  
**Date:** 2026-11-04  
**Platform:** Windows 10/11 (Windows PC)  
**Working directory (example):** `D:\Reverse Engineer\Zalo-Apple-Glass-UI`  
**Approved visual target:** `assets/approved-reference.jpg`  
**Related documents:** `docs/TECH_STACK.md`, `docs/ARCHITECTURE.md`, `docs/SPEC-GLASS.md`, `docs/QA-CHECKLIST.md`

## 0. Mục tiêu, sự thật hiện tại và quyết định đã khóa

### Product goal

Xây dựng **ứng dụng Windows desktop demo** với thiết kế Apple-inspired Liquid/Frosted Glass theo ảnh duyệt, tương tác mượt, có thể đóng gói thành `.exe`/Windows installer. Sau đó **nghiên cứu tính khả thi** của việc áp dụng presentation layer cho Zalo PC thật mà không mất chức năng; không được hứa hoặc giả định có đường tích hợp như vậy.

### LOCKED TECH STACK — KHÔNG ĐỔI nếu chưa có chấp thuận

| Lớp | Công nghệ chính thức | Vai trò |
|---|---|---|
| Desktop runtime | **Electron** | Cửa sổ Windows, desktop APIs, đóng gói |
| UI | **React** | Component tree của prototype |
| Language | **TypeScript** | Typed renderer, shared types, Electron main/preload |
| Build/dev | **Vite** | Dev server + production renderer build |
| Styling | **Tailwind CSS v4** | Layout/utility; CSS variables cho glass tokens |
| UI state | **Zustand** | Theme, selection, filters, demo state có giới hạn |
| Animation | **Motion for React** (`motion`) | Micro-interactions; reduced motion |

**Supporting tooling được phép lựa chọn hợp lý, nhưng không thay thế stack chính:** `electron-vite` (hoặc pipeline Vite tương đương cho main/preload/renderer); `electron-builder` cho Windows packaging; `lucide-react` cho icon; `Vitest` + React Testing Library cho unit/component tests; `Playwright` (và Electron automation khi khả thi) cho E2E; ESLint + Prettier. Pin phiên bản tương thích sau khi Agent kiểm tra tài liệu/release và chạy install thực tế. Không tự thêm backend/database/Docker/Socket.IO/cloud.

### SOURCE STATUS — CỰC KỲ QUAN TRỌNG

> **Mục này là ảnh chụp *trước khi* Agent thực thi (2026-11-04).** Trạng thái hiện tại
> nằm ở bảng gate mục 4 và [QA-CHECKLIST](docs/QA-CHECKLIST.md); các dòng dưới đây giữ
> nguyên để đối chiếu, không phải mô tả hiện trạng.

- **Đã tồn tại:** `index.html`, `src/app.js`, `src/logic.js`, `src/icons.js`, `src/styles.css`, `tests/logic.test.cjs`, ảnh mẫu/assets, script đọc metadata Zalo.
- **Chưa tồn tại:** Electron shell, React app, TypeScript build, Vite setup, Tailwind v4 setup, Zustand, Motion, `.exe`, tích hợp Zalo thật. Đây là **mục tiêu Agent phải triển khai**, KHÔNG phải tình trạng đã xong.
- **Baseline người tạo gói đã chạy (Linux, Node v22.16.0):** `npm test` = **7/7 PASS**; `npm run check` = **PASS** vào 2026-11-04. Agent phải chạy lại trong Windows workspace và ghi bằng chứng riêng. UI visual/Electron/Windows build/Zalo: **NOT RUN/NOT IMPLEMENTED** cho tới khi Agent thực sự thực hiện.
- Dữ liệu chat hiện tại là **fictional local demo**. Tất cả nút call/video, upload, notification chỉ được gọi là demo cho tới khi có tích hợp được phép và được kiểm thử.

## 1. Nguyên tắc không thể thương lượng

1. **Ưu tiên:** P0-A (baseline) → P0-B (migration) → P0-C (visual parity) → P1-A (Electron Windows) → P1-B (QA) → P1-C (passive Zalo recon, chỉ khi được cho phép) → P2 (ADR) → P3 (conditional integration). Không làm P3 khi chưa có gate GO.
2. **Không đổi stack:** Không dùng Tauri, Next.js, Angular, Vue, vanilla-only làm kiến trúc đích; có thể giữ phiên bản Vanilla làm tham chiếu khi migration.
3. **Không đụng Zalo thật:** Không sửa `Zalo.exe`, `app.asar`, file profile/signature/updater; không injection/hooking, bypass sandbox/anti-tamper/CSP/TLS, không reverse private API hoặc thu thập token/cookie/chat/password, không đọc chat database.
4. **Không đồng nhất Electron của ta với Electron của Zalo:** App desktop do ta tạo KHÔNG có quyền hay khả năng tự động reuse dữ liệu, IPC, session hoặc business features của Zalo.
5. **Electron security by default:** `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true` khi khả thi, preload tối thiểu với `contextBridge` allowlist; CSP chặt, không bật remote module, không load arbitrary remote URL, không expose Node/fs/child_process cho renderer; `webSecurity` giữ bật. Mọi ngoại lệ cần ADR, lý do và kiểm thử.
6. **Giữ visual reference:** `assets/approved-reference.jpg` là chuẩn cảm hứng; các panel kính mờ, rail/danh sách chat/chat pane, floating composer, blue-violet gradients, typography rõ, ưu tiên dark/light và reduced motion.
7. **Không ghi đè vô ý:** Kiểm tra Git status và làm việc trong thư mục dự án; lưu baseline nguồn hiện tại trong commit/branch hoặc `legacy/` nếu workspace chưa có Git. Không xóa mã đang hoạt động trước khi đạt parity.
8. **Không báo PASS khi chưa chạy:** Mỗi mục ghi `PASS`/`FAIL`/`BLOCKED`/`NOT RUN`/`N/A` + command, exit code, môi trường, bằng chứng. Build thành công không được đồng nghĩa visual/E2E PASS.
9. **Quyền riêng tư:** Không gửi artifacts/telemetry/tài liệu máy lên cloud khi chưa được người dùng cho phép; script khảo sát Zalo chỉ chạy sau khi người dùng xem/chấp thuận, chạy non-admin.
10. **Không tự cài hay chạy lệnh thay đổi hệ thống** ngoài dependency project và build artifacts trong workspace; không chỉnh registry Windows, Defender, chính sách máy, user profile Zalo.

## 2. Kiến trúc đích

```text
zalo-apple-glass-ui/
├── electron/
│   ├── main.ts                 # BrowserWindow, lifecycle, navigation/security
│   └── preload.ts              # contextBridge, allowlisted minimal APIs
├── src/
│   ├── renderer/
│   │   ├── main.tsx            # React root
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── AppShell/
│   │   │   ├── NavigationRail/
│   │   │   ├── ConversationList/
│   │   │   ├── ChatPane/
│   │   │   ├── MessageComposer/
│   │   │   └── SettingsDialog/
│   │   ├── store/              # Zustand (UI/demo state)
│   │   ├── adapters/
│   │   │   ├── types.ts        # UI adapter contracts
│   │   │   └── demo.ts         # Fictional, offline-only
│   │   └── styles/
│   │       ├── globals.css     # Tailwind entry
│   │       └── tokens.css      # Glass/light/dark tokens
│   └── shared/                 # Pure types/utilities
├── assets/                    # approved-reference.jpg, demo avatar assets
├── tests/                     # migrated unit/component + E2E
├── tools/Inspect-Zalo.ps1      # existing read-only audit script
├── docs/
├── reports/                   # local test evidence; no personal data
├── index.html                 # Vite renderer entry AFTER migration
├── package.json
├── tsconfig*.json
├── vite.config.ts             # or electron-vite.config.ts, document the choice
└── electron-builder.yml       # or equivalent, if packaging tool chosen
```

**Renderer UI → adapter contract → demo data.** `AuthorizedZaloAdapter` là ý tưởng cho tương lai, tuyệt đối chưa tạo implementation gọi endpoint Zalo không công khai. Không cần backend riêng.

**Transparent UI distinction:** `backdrop-filter`/CSS glass = kính mờ **bên trong nội dung cửa sổ**. Độ trong suốt tới desktop Windows, Mica/Acrylic hoặc `transparent` BrowserWindow là **nhánh thử nghiệm riêng** vì phụ thuộc compositor/OS, hiệu năng, shadow, hit testing và security. Không hứa pixel-perfect Apple Liquid Glass; có fallback nontransparent để văn bản dễ đọc.

## 3. Milestones và task chính xác

### P0-A — Audit & baseline (LÀM ĐẦU TIÊN)

**Tasks**
1. Đọc `AGENT_PLAN.md`, `docs/TECH_STACK.md`, README, architecture, glass spec, checklist; xem ảnh tham chiếu.
2. Kiểm tra `git status`, `node -v`, `npm -v`, Windows version; ghi nhận thư mục làm việc, toolchain hiện có.
3. Chạy `npm test` và `npm run check` trên prototype cũ; ghi **stdout/exit code** vào `reports/agent-baseline.md`.
4. Chụp baseline UI ở 1920×1080 và 1366×768 nếu có GUI. Nếu không có GUI → `NOT RUN`, không giả mạo screenshot.
5. Lập component/feature parity map `legacy behavior → React component/store/test` trong `docs/UI-COMPONENT-MAP.md`.

**Acceptance:** Có baseline, các chỗ chưa kiểm thử minh bạch, không mất file legacy.

### P0-B — Migration sang stack LOCKED (BLOCKER trước mọi redesign sâu)

**Tasks**
1. Khởi tạo Vite + React + TypeScript trong repo hiện hữu; giữ lịch sử code legacy. Thiết lập Tailwind CSS v4 chính thức (không cấu hình theo v3), scripts tách `dev`, `build`, `typecheck`, `lint`, `test`, `check`.
2. Thiết lập `src/renderer/main.tsx`, App root, component boundaries. Chuyển logic helper và dữ liệu demo từ `src/logic.js`, `src/app.js` sang TS modules, không copy các event binding DOM thủ công vào React.
3. Dùng React state cho component-local; Zustand cho global UI/demo state. Store **không** chứa credential/session/chat thật; persistence chỉ cho theme, blur, reduced-motion và layout preferences.
4. Tạo `DemoAdapter` typed (chat list, messages, search/filter, sample local-send, simulated attachment metadata). Gắn nhãn rõ mock/demo; không phát network request.
5. Chuyển assets, icons và `src/styles.css` thành CSS tokens + Tailwind v4 utilities. Không dùng dynamic Tailwind class strings dễ bị tree-shaken. Bảo toàn giao diện approved-ref.
6. Tích hợp Motion for React chỉ cho chuyển cảnh/hover/enter cần thiết; respect `prefers-reduced-motion`, có fallback tắt motion.
7. Chuyển các unit tests `node:test` cũ sang Vitest hoặc giữ compatibility có giải thích; thêm component tests cho critical interactions.

**Acceptance:** `npm run dev` hiển thị React prototype, `npm run build`, `npm run typecheck`, `npm test`, `npm run check` chạy được với evidence; 7 hành vi baseline còn tương đương; không mất UI hay dữ liệu demo; không cần Zalo thật.

### P0-C — Approved Apple Glass UI parity

**Tasks**
1. Layout 3 cột: navigation rail / conversation list / chat pane, floating composer, topbar và settings modal.
2. Tokens: color, tint, opacity, radius, backdrop blur, border highlight, spacing, elevation, typography, light/dark, focus, animation duration.
3. Interactions: search tiếng Việt không dấu, filters all/unread/group/work, selected chat, pinned/unread, bubble, emoji/reaction demo, file-name/size-only preview, theme + blur controls.
4. Keyboard: `Enter` gửi demo, `Shift+Enter` newline, `Escape` đóng dialog; labels/focus order rõ, contrast bảo đảm.
5. 3 resolutions: 1920×1080, 1600×900, 1366×768; tránh overflow nghiêm trọng. Đo FPS/perf nếu có điều kiện; fallback low-blur, OS reduced motion.

**Acceptance:** screenshots sau migration so với `assets/approved-reference.jpg` + baseline cũ, checklist cập nhật; call/video là placeholder rõ ràng, không mạo nhận tính năng Zalo.

### P1-A — Windows Electron shell và packaging

**Tasks**
1. Dùng Electron để boot React renderer **độc lập**, chọn `electron-vite` hoặc pipeline Vite tương đương cho main/preload/renderer; không dùng `file://` tùy tiện cho web content hoặc load remote website không kiểm soát.
2. Implement `BrowserWindow` tại `electron/main.ts`; `preload.ts` tối giản. Context isolation, sandbox, nodeIntegration false, webSecurity on; permission requests deny-by-default; prevent unsafe navigation/new windows; no devtools in release unless explicitly enabled.
3. Thiết kế frameless/titlebar controls cho Windows nếu test được drag/maximize/minimize/close; không dùng CSS `-webkit-app-region: drag` phủ nút tương tác.
4. Ưu tiên cửa sổ opaque + simulated glass. Native transparency/Mica/Acrylic chỉ làm nhánh tùy chọn có feature flag + fallback; test performance và khả năng điều khiển cửa sổ.
5. Cấu hình đóng gói Windows **NSIS installer hoặc portable .exe** (ghi rõ loại output) bằng công cụ packaging đã chọn. Build artifact nằm trong project `dist/` hoặc `release/`, không tự cài vào máy/khởi chạy installer nếu chưa được chấp thuận.
6. `npm run dev:desktop` phải mở cửa sổ Electron; `npm run build:desktop` phải tạo desktop distributable; `npm run check` phải bao gồm typecheck, lint và tests sau migration. Ghi lại những scripts thực tế trong README.

**Acceptance:** screenshots Electron trên Windows và tương tác demo; desktop app khởi động/đóng/mở lại; packaging Windows thành công có path + hash + exit code; nếu build Windows không được chạy trong môi trường hiện tại thì ghi **NOT RUN** (không báo `.exe` đã có).

### P1-B — Regression, accessibility, security & delivery QA

**Tasks**
1. Unit + RTL tests: tìm kiếm không dấu, filters, local send, filename-only attachment, persistence settings, theme switching, modal/keyboard, XSS-safe rendering.
2. E2E: chọn chat, gửi demo, search, dialog, dark/light, reload, reduced motion. Nếu có Playwright Electron support phù hợp, kiểm thử shell; nếu không, phân biệt browser E2E và Electron smoke.
3. Security review: CSP, preload allowlist, Electron flags, navigation, file chooser API; không truy cập internet/account trong demo.
4. Screenshot visual review và accessibility, ưu tiên keyboard và contrast. Document perf/memory measurements thực sự đo được.
5. QA matrix và report với PASS/FAIL/NOT RUN dựa trên chứng cứ, không dựa trên code chỉ mới tồn tại.

**Acceptance:** Test/visual/security report đầy đủ, còn lỗi blocker ghi rõ; không có data exfiltration.

### P1-C — Passive reconnaissance of installed Zalo (CHỈ KHI CÓ QUYỀN)

**Tasks**
1. Người dùng xem và đồng ý chạy `tools/Inspect-Zalo.ps1` trên máy Windows; chạy PowerShell non-admin từ project folder:
   ```powershell
   powershell.exe -NoProfile -File .\tools\Inspect-Zalo.ps1
   ```
2. Chỉ dùng process metadata, executable version, signature và package/runtime markers. Bảo vệ đường dẫn có thông tin cá nhân khi xuất báo cáo.
3. `app.asar`/Chromium chỉ là dấu hiệu; không tự suy rằng Zalo dùng React hoặc cho phép plugin/theme/CSS injection.
4. Nếu chưa chạy được: ghi `BLOCKED` / `NOT RUN` và lý do; vẫn hoàn tất prototype desktop.

**Acceptance:** `reports/ZALO_ARCH_RECON.md` có findings / uncertainties / impact / next gate; không sửa app hoặc đọc dữ liệu tài khoản.

### P2 — Integration feasibility ADR (KHÔNG patch Zalo)

**Tasks**
1. Kiểm tra kênh theme/plugin/customization được Zalo hỗ trợ và điều khoản hiện hành.
2. So sánh native settings, Windows-level decoration, tùy biến Zalo Web ở môi trường được phép, và can thiệp client native (mặc định NO-GO nếu không có thẩm quyền).
3. Phân biệt đầy đủ chức năng Zalo **PC** với Zalo **Web** và standalone Electron mockup.
4. Quyết định `GO / NO-GO / NEEDS AUTHORIZATION` trong `docs/ADR-001-integration-strategy.md`, nêu evidence, rủi ro, chi phí maintenance, rollback và giới hạn.

**Acceptance:** Không có phát ngôn "100% Zalo compatibility" khi chưa có triển khai/tập test độc lập.

### P3 — Authorized integration experiment (STOP GATE)

Chỉ được mở nếu có đường tích hợp **được phép, tương thích đã được kiểm chứng** và người dùng xác nhận phạm vi thay đổi; nếu không thì **NO-GO**. Tạo adapter cách ly, bật/tắt được; không thay logic authentication, IPC, messaging, calls, storage và updater. Test baseline với test account, regression về login, send/receive, file, group, calls, notifications, search, reconnect, update, rollback. Fail → stop & rollback. Chức năng chưa test = UNKNOWN.

## 4. Scripts & acceptance gates (Agent phải tạo, không giả vờ đã tồn tại)

**Target scripts (đã có trong `package.json` sau migration; danh sách đầy đủ ở [README](README.md)):**

```powershell
npm install
npm run dev             # Vite renderer preview
npm run dev:desktop     # Electron + Vite, Windows desktop
npm run typecheck
npm run lint
npm test
npm run check           # typecheck + lint + tests
npm run build           # Production renderer
npm run build:desktop   # Windows installer/portable .exe
```

Toolchain Node.js LTS + npm, các thư viện đã khóa ở mục 0. Agent tự xác minh version tương thích Electron/Vite/Tailwind v4, ghi vào lockfile (`package-lock.json`) và dùng `npm ci` trong CI. Không copy code từ ứng dụng Zalo sang repo.

**Milestone evidence:**

| Gate | Điều kiện PASS | Trạng thái trước khi Agent thực thi | Trạng thái 2026-11-06 (Windows, bản R10) |
|---|---|---|---|
| G0 Legacy baseline | npm test/check chạy lại, giữ source cũ | PASS trên môi trường tạo gói; Windows NOT RUN | **PASS** — 7/7 trên Windows, source legacy giữ nguyên theo SHA-256 manifest ([log](reports/executed/verify-legacy-030.log), [checksums](reports/legacy-sha256.txt)) |
| G1 React migration | dev/build/typecheck/tests đều chạy thực tế | NOT IMPLEMENTED | **PASS** — typecheck + lint + **62/62** tests; Vite 8.3.5 build 369.59 kB JS / 49.88 kB CSS (bản đã đổi khung) ([check](reports/executed/r10-check-current.log), [build](reports/executed/r10-build.log)) |
| G2 Visual approval | screenshots Windows + visual comparison/keyboard QA | NOT RUN | **PASS (kỹ thuật)** — **26/26** E2E, screenshots 3 độ phân giải, 512 mẫu contrast min 4.96:1; **không** có phê duyệt thiết kế cuối cùng từ người dùng ([E2E](reports/executed/r10-e2e-current.log), [visual](reports/VISUAL_QA.md)) |
| G3 Electron desktop | Electron smoke + Windows `.exe`/installer artifact thực tế | NOT IMPLEMENTED | **PASS** — portable 0.3.0 (112,248,617 B, SHA-256 `85f92db5…5f8ec3`) + unpacked/portable smoke + soak 150 gửi × 2 lần ([artifacts](reports/desktop-artifacts.json), [unpacked](reports/executed/r10-unpacked-smoke-current.log), [portable](reports/executed/r10-portable-current.log), [soak C](reports/executed/soak-30-run-c.json), [soak B](reports/executed/soak-30-run-b.json)) |
| G4 Zalo recon | approved read-only metadata report | NOT RUN | **PASS (read-only)** — Zalo PC 26.10.20.3253, VNG-signed ([recon](reports/ZALO_ARCH_RECON.md)) |
| G5 Integration | verified authorized route + ADR GO | NOT ESTABLISHED | **NO-GO** — không có kênh tích hợp được phép; P2 đã hoàn tất ([ADR-001](docs/ADR-001-integration-strategy.md), [feasibility](reports/ZALO_THEME_FEASIBILITY.md)) |

Vẫn **NOT RUN** và không được tính là PASS: kéo titlebar bằng chuột thật, IME
Telex/VNI của OS, phiên screen reader có tiếng đọc, nhiều màn hình vật lý /
DPI riêng từng màn hình. Xem [QA](docs/QA-CHECKLIST.md).

## 5. Regression matrix

| Feature | Standalone demo | Actual Zalo (chỉ sau G5=GO) |
|---|---|---|
| UI/theme/glass/motion | React/CSS + screenshots + tests | Test cụ thể theo cơ chế được phép |
| Chat list / search | Fake/local data | Official data, không mô phỏng |
| Message send/receive | Fake local-send only | Test account send/receive thực tế |
| File attachments | Display filename + size only | Real file transfer |
| Call/video | Disabled/demo notification | Full audio/video test |
| Windows notifications | Demo only nếu có | Native notifications thật |
| Groups/contacts | Fictional data | Official app functionality |
| Offline, reconnect, update | Desktop UI reliability | Full official app behavior |
| Authentication / privacy | NO real Zalo account | Independent security review |

**Result labels:** `PASS`, `FAIL`, `BLOCKED`, `NOT RUN`, `NOT APPLICABLE`. Mỗi PASS phải có command, exit code, test count hoặc screenshot.

## 6. Deliverables cuối cùng

- [x] Code Electron + React + TypeScript + Vite + Tailwind v4 + Zustand + Motion, giữ legacy baseline cho đến khi parity đạt — `legacy/` nguyên vẹn ([checksums](reports/legacy-sha256.txt)).
- [x] `package-lock.json`, TS + Vite/Electron build configs, scripts documented, no backend — `npm ci` dùng được với lockfile đã giữ.
- [x] Windows desktop `.exe`/installer artifact **chỉ nếu đã build thành công**, ghi đường dẫn và SHA-256 — portable 0.3.0, `release/Glass-Messenger-Demo-0.3.0-x64.exe`, 112,248,617 B, SHA-256 `85f92db5…5f8ec3` ([metadata](reports/desktop-artifacts.json)). Không tạo installer.
- [x] `reports/agent-baseline.md` + `reports/AGENT_DELIVERY.md` có bằng chứng lệnh đã chạy và môi trường.
- [x] `docs/UI-COMPONENT-MAP.md`, cập nhật `docs/ARCHITECTURE.md` và `docs/SPEC-GLASS.md` nếu có thay đổi thực tế.
- [x] Tests + `docs/QA-CHECKLIST.md`, screenshots dưới `reports/screenshots/` hoặc `NOT RUN` — bốn mục tay vẫn ghi `NOT RUN`, không tính PASS.
- [x] `reports/ZALO_ARCH_RECON.md` hoặc lý do `NOT RUN/BLOCKED` nếu chưa khảo sát Zalo — đã khảo sát read-only, kèm [feasibility P2](reports/ZALO_THEME_FEASIBILITY.md).
- [x] `docs/ADR-001-integration-strategy.md` (`GO`, `NO-GO`, `NEEDS AUTHORIZATION`) — **NO-GO** cho P3.
- [x] README hướng dẫn Windows: install, dev, test, build, file output, demo disclaimer, rollback.

## 7. Required Agent delivery format

```markdown
# Agent Delivery
## Environment
- OS, Node, npm, Electron, Zalo version (only if observed)
## Changes
- file -> purpose; legacy preservation strategy
## Executed commands
- command -> exit code -> PASS/FAIL/NOT RUN -> evidence location
## Desktop packaging
- output path, format (installer vs portable), SHA-256 or NOT RUN
## Visual QA
- resolutions + screenshot paths or NOT RUN
## Security
- Electron BrowserWindow/preload/CSP status, permissions, limitations
## Recon / compatibility decision
- evidence; ADR: GO/NO-GO/NEEDS AUTHORIZATION
## Remaining gaps
- prioritized issues, blockers, rollback
```

## 8. Prompt giao Agent — COPY / PASTE

> Bạn là Senior Windows/Electron Engineer + React/TypeScript UI Engineer + QA + Reverse Engineering Analyst. Tiếp quản project `Zalo-Apple-Glass-UI` trong thư mục hiện tại. Đọc `AGENT_PLAN.md`, `docs/TECH_STACK.md`, `README.md`, `docs/ARCHITECTURE.md`, `docs/SPEC-GLASS.md`, `docs/QA-CHECKLIST.md`, và ảnh `assets/approved-reference.jpg`.
>
> **STACK ĐÃ CHỐT (bắt buộc): Electron + React + TypeScript + Vite + Tailwind CSS v4 + Zustand + Motion for React.** Build pipeline/QA/packaging supporting tools có thể bổ sung hợp lý. Mã hiện tại là HTML/CSS/Vanilla JS prototype offline, KHÔNG phải React hay Electron; hãy migrate từng bước, giữ baseline và visual parity trước khi xóa/move mã cũ.
>
> **Thực hiện ngay:** P0-A baseline → P0-B migration → P0-C visual parity → P1-A desktop Electron + Windows packaging → P1-B tests/security/visual QA. Sau đó P1-C passive Zalo recon **chỉ khi người dùng cho phép** → P2 integration ADR. P3 chỉ khi có gate GO, không tự vượt. Nếu Zalo không được cài/không được phép khảo sát, tiếp tục hoàn thành prototype desktop.
>
> **Chức năng:** UI Apple Glass theo ảnh; tương tác fake/local hoàn chỉnh (search tiếng Việt, filter, chat select, send demo, file metadata, modal/theme/blur/motion). Không tạo login/call/file thật, không gọi Zalo API, không mạo nhận đã giữ mọi chức năng Zalo. Demo adapter typed; Zustand chỉ UI/demo state. Electron phải contextIsolation, sandbox, nodeIntegration false, CSP và preload minimal.
>
> **Evidence:** Không báo PASS khi chưa thực sự chạy. Mỗi milestone ghi command + exit code + screenshot/test logs. Windows `.exe` chỉ báo hoàn thành khi file tồn tại và smoke test được; nếu chưa chạy phải ghi NOT RUN. Không đụng Zalo.exe, app.asar thật, process injection, session, chat database, API riêng hoặc bypass. Không chỉ viết kế hoạch; hãy sửa code, chạy test, cập nhật tài liệu và report theo section 7.

---

**Reality check:** App Electron được xây dựng chỉ là standalone design prototype. Biến Zalo gốc thành Apple Glass mà vẫn giữ đủ chức năng là mục tiêu cần chứng minh bằng đường tích hợp được phép, không phải cam kết đã có.
