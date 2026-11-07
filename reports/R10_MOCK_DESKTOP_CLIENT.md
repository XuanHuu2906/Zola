# R10 — Functional Mock Desktop Client

**Trạng thái:** HOÀN THÀNH phần **mock**. **Kết luận: 8/8 workflow đạt `MOCK_PASS`. Không có `LIVE_PASS`.**
**Ngày:** 2026-11-06 · **Sản phẩm:** Glass Messenger Demo `0.3.0`
**Phạm vi:** toàn bộ dữ liệu là seed cục bộ; không có lời gọi mạng nào tới Zalo, không có credential,
cookie, session token hay dữ liệu cá nhân.

> Báo cáo này **không** chứng minh bất kỳ khả năng backend nào. Cổng uỷ quyền A1–A4 vẫn
> **đóng 0/4** ([API_AUTHORIZATION_GAP](../docs/API_AUTHORIZATION_GAP.md)). `MOCK_PASS ≠ LIVE_PASS`.

---

## 1. Ba chiều trạng thái (Master Plan §10)

| Chiều | Giá trị | Ghi chú |
|---|---|---|
| Evidence | `OBSERVED` | Đọc trực tiếp từ `src/renderer/**`, `src/shared/**`, chạy trên bản đóng gói |
| Authorization | `BLOCKED` | A1–A4 đóng 0/4; không có adapter nào được phép kết nối Zalo |
| Testing | `MOCK_PASS` | 62 unit test + 26 E2E + smoke/soak/portable trên Electron |

---

## 2. Workflow tối thiểu (Master Plan §7)

| # | Workflow | Trạng thái | Bằng chứng | Cơ chế |
|---|---|---|---|---|
| 1 | Mở app, fake login, danh sách hội thoại | `MOCK_PASS` | `demo.spec.ts:6`; `smoke-desktop.cjs` bấm `Vào bản demo` trên mọi lần chạy | `sessionStorage` `zalo-glass-session`; gate ở `App.tsx` |
| 2 | Mở chat, cuộn lịch sử, tải trang tiếp | `MOCK_PASS` | `demo.spec.ts:43`; unit `history pages keep every id positive…` | `buildOlderPage` + `clampPageSize(1..50)`; `useLayoutEffect` giữ vị trí đọc |
| 3 | Gửi tin + pending/sent/failed/retry | `MOCK_PASS` | `demo.spec.ts:64`; unit `delivery settles one message…` | `demoAdapter.send/settle`; `settleLater` 600 ms; retry giữ `failed` độc lập |
| 4 | Nhận tin, unread badge, desktop notification | `MOCK_PASS` | `demo.spec.ts:100`; `electron-smoke.json.notification` | `pickIncomingTarget` (không nhắm chat đang mở) + IPC `notice:demo` |
| 5 | Danh bạ, nhóm, thông tin hội thoại | `MOCK_PASS` | `demo.spec.ts:285`, `demo.spec.ts:318` | `ContactsScreen`/`GroupInfoScreen`/`InfoScreen` đọc seed |
| 6 | Chọn file, upload/download giả lập | `MOCK_PASS` | `demo.spec.ts:373`, `demo.spec.ts:394` | `transfer.ts` reducer + interval 140 ms; chỉ lưu tên/dung lượng |
| 7 | UI gọi thoại/video, session state mocked | `MOCK_PASS` | `demo.spec.ts:194`, `demo.spec.ts:223`; unit 2 test call | `call.ts` state machine; timer tự huỷ khi unmount |
| 8 | Mất mạng, đồng bộ, khôi phục | `MOCK_PASS` | `demo.spec.ts:236`, `demo.spec.ts:266`; unit 2 test network | `offline → syncing → online`; `markPendingSent` chỉ đổi `pending` |

Bảy workflow còn lại đều có ít nhất một kịch bản E2E **và** một unit test cho phần logic thuần.
Workflow 4 có thêm bằng chứng phía shell (payload IPC), vì trình duyệt không có `window.desktop`.

---

## 3. Lệnh đã thực thi (tất cả exit 0)

| Lệnh | Kết quả | Bằng chứng |
|---|---|---|
| `npm run check` (typecheck + lint + `npm test`) | PASS — gộp cả ba bước, **62/62**, chạy lại sau đổi khung | [r10-check-current.log](executed/r10-check-current.log) |
| `npm run typecheck` / `npm run lint` / `npm test` riêng lẻ | PASS — **cây trước khi đổi khung**; đã được `npm run check` ở trên phủ | [r10-typecheck.log](executed/r10-typecheck.log), [r10-lint.log](executed/r10-lint.log), [r10-unit.log](executed/r10-unit.log) |
| `npx playwright test` | **26/26 pass**, 46.3 s (chạy lại sau đổi khung) | [r10-e2e-current.log](executed/r10-e2e-current.log) |
| `npm run build` | 369.59 kB JS (116.37 gzip), **49.88 kB CSS** (11.28 gzip) trên cây hiện tại; trước khi đổi khung là 49.70 / 11.23 | [r10-shellfull-build.log](executed/r10-shellfull-build.log), [r10-build.log](executed/r10-build.log) |
| `npm run build:electron` | PASS — chạy riêng trước khi đổi khung; `build:desktop` hiện tại có chạy lại bước này | [r10-build-electron.log](executed/r10-build-electron.log), [r10-shellfull-build.log](executed/r10-shellfull-build.log) |
| `npm run test:desktop` | PASS ×2 lần chạy, gồm payload `notice:demo` (chạy lại sau đổi khung) | [r10-desktop-smoke-current.log](executed/r10-desktop-smoke-current.log), [electron-smoke.json](electron-smoke.json) |
| `node tools/smoke-desktop.cjs "release/win-unpacked/Glass Messenger Demo.exe" unpacked` | PASS ×2 lần chạy trên gói R10 đã đóng lại (chạy lại) | [r10-unpacked-smoke-current.log](executed/r10-unpacked-smoke-current.log), [unpacked-smoke.json](unpacked-smoke.json) |
| `npm run test:desktop:extra` | PASS 7/7 nhóm kiểm tra (chạy lại trên gói đã đóng lại; nhóm 5 là hình học tràn viền) | [r10-desktop-extra-current.log](executed/r10-desktop-extra-current.log), [desktop-extra-qa.json](desktop-extra-qa.json) |
| `SOAK_BATCHES=6 node tools/soak-desktop.cjs` | PASS — 30 gửi, 6 chu kỳ cài đặt (**cây trước khi đổi khung**; chỉ còn giá trị lịch sử, bản hiện tại đã được phủ bởi soak 30 batch) | [r10-soak-6.log](executed/r10-soak-6.log) |
| `node tools/soak-desktop.cjs` | PASS — **30 batch / 150 gửi / 0 lỗi**; hai lần chạy trên **bản đóng gói lại**: lần C reclaim tự nhiên **803 ms**, lần B **không reclaim trong 20 s** nhưng GC cưỡng bức + reload thứ hai đưa renderer về 223 listener / 450 node ⇒ không tích tụ, độ trễ reclaim phụ thuộc scheduler | [log C](executed/r10-soak-30-run-c.log), [JSON C](executed/soak-30-run-c.json), [log B](executed/r10-soak-30-current.log), [JSON B](executed/soak-30-run-b.json) |
| `node tools/smoke-portable.cjs` | PASS ×2 lần liên tiếp trên artifact đã đóng lại (chạy lại) | [r10-portable-current.log](executed/r10-portable-current.log), [portable-smoke.json](portable-smoke.json), trước đó: [r10-portable.log](executed/r10-portable.log), [r10-portable-2.log](executed/r10-portable-2.log) |
| `npm run verify:asar` | PASS — 11/11 file đóng gói trùng byte với cây nguồn; chạy lại sau khi `dist/` được build lại lúc chạy E2E, vẫn 11/11 | [r10-asar-parity-current.log](executed/r10-asar-parity-current.log), [asar-parity.json](asar-parity.json), trước đó: [r10-shellfull-build.log](executed/r10-shellfull-build.log), [r10-asar-parity.log](executed/r10-asar-parity.log) |
| Đối chiếu artifact ↔ manifest (sau build mới) | PASS — 112,248,617 byte, SHA-256 `85f92db5…5f8ec3` | [r10-artifact-verify.log](executed/r10-artifact-verify.log) |
| `npm run build:desktop` (sau khi đổi khung tràn viền) | **exit 0** — asar 11/11 trùng byte, artifact được hash + flag | [r10-shellfull-build.log](executed/r10-shellfull-build.log), [JSON](executed/r10-shellfull-build.json) |

---

## 4. Artifact

| Mục | Giá trị |
|---|---|
| Đường dẫn | `release/Glass-Messenger-Demo-0.3.0-x64.exe` |
| Dung lượng | 112,248,617 bytes |
| SHA-256 | `85f92db5fcf258a85acc72844c2141cbc48ce377266e611a62f40fbf365f8ec3` |
| `app.asar` ↔ `dist/` | So từng byte trên 11 file đóng gói: `index.html`, CSS, JS, `dist-electron/*` (3), 5 ảnh avatar — **tất cả trùng byte, 0 file sai** (`npm run verify:asar`) |
| Artifact ↔ manifest | File EXE trên đĩa khớp `reports/desktop-artifacts.json` về cả byte lẫn SHA-256 (`delivery: true`, `deliveryVersion: 0.3.0`) |

Lưu ý về bằng chứng đóng gói: lần rebuild R10 đầu tiên **không lưu** stdout của `electron-builder`, nên
báo cáo này không ghi exit code cho lần đó. Khoảng trống đã được đóng bằng lần build sau khi đổi khung:
`r10-shellfull-build.log` ghi lại đầy đủ, exit 0, có hash artifact và asar parity. Mọi cổng phía sau
(`check`, `verify:asar`, cả hai smoke) đều chạy trên đúng file EXE hiện tại. Log
`desktop-build-030.log` (2026-11-05) là bản **trước R10** và chỉ còn giá trị lịch sử.

Repackage là bắt buộc sau mỗi thay đổi UI: `soak-desktop.cjs` chạy `release/win-unpacked/` và
`smoke-portable.cjs` chạy EXE portable, nên chúng chỉ đo code đã đóng gói.

---

## 5. Thay đổi mã trong R10

| File | Vai trò |
|---|---|
| `src/shared/transfer.ts` | Reducer tiến trình upload/download thuần, clamp 0..100, NaN→0 |
| `src/shared/call.ts` | State machine cuộc gọi: ring → connected → ended, chỉ đếm giây khi connected |
| `src/shared/network.ts` | `canSend`, `connectionLabel`, `nextConnection`, `markPendingSent` (giữ identity khi no-op) |
| `src/renderer/store/useDemoStore.ts` | `connection` state, `goOffline`, `reconnect`, chặn gửi/nhận khi offline, `cancelTransfer` |
| `src/renderer/components/ChatPane/index.tsx` | Phòng thử demo 3 mục; khối transfer có progressbar/cancel; nút tải xuống cho tệp nhận |
| `src/renderer/components/MessageComposer/index.tsx` | Disable toàn bộ composer khi mất mạng, đổi placeholder và hint |
| `src/renderer/components/Overlays/index.tsx` | `CallScreen` dùng timer có cleanup, trạng thái từ `call.ts` |
| `src/renderer/App.tsx` | Banner kết nối `role="status"` `aria-live="polite"` |
| `src/design-system/globals.css` | Khối transfer, khối call, khối connection — chỉ dùng token, không literal ngoài ladder |
| `src/design-system/globals.css` (tràn viền) | `#app:has(.desktop-shell){padding:0}` và `.window-shell.desktop-shell` bỏ bo góc/viền/bóng, kích thước 100% — chỉ áp dụng trên Electron; preview trình duyệt giữ khung nổi. Không sửa JSX, không sửa tiến trình main |
| `tests/core.test.ts` | +6 test cho transfer/call/network; tổng 62 |
| `tests/e2e/demo.spec.ts` | +6 kịch bản; tổng 26 toàn bộ suite |
| `tools/smoke-desktop.cjs` | Kiểm chứng payload `notice:demo` (thay `Notification.prototype.show` để không bật toast thật) |
| `tools/smoke-portable.cjs` | Thêm bước bấm `Vào bản demo`; thay `waitForEvent('page')` bằng poll vì page đã tồn tại trước khi navigate |

---

## 6. Giới hạn — những gì **không** được chứng minh

- **Không có kết nối Zalo.** Không đăng nhập thật, không gửi/nhận thật, không gọi API nào.
- **Không có backend.** `src/adapters/mock.ts` (`MockZaloClient`) vẫn chưa nối vào UI; UI dùng
  `src/renderer/adapters/demo.ts`. Đây là hai cây adapter song song, đúng theo R8.
- **Notification thật chưa kiểm.** Smoke chỉ chứng minh payload IPC đúng (title ≤80, body ≤180,
  string-only) và renderer gọi đúng một lần; `Notification.prototype.show` đã bị vô hiệu trong lúc chạy.
- **Call không chạm micro/camera/mạng.** Không có `getUserMedia`, không thiết lập WebRTC.
- **File chỉ có metadata.** Không đọc bytes, không truyền, không lưu `File` object.
- **Bốn mục QA tay vẫn `NOT RUN`**: kéo titlebar bằng chuột thật, IME Telex/VNI của OS, phiên
  screen reader có tiếng đọc, nhiều màn hình vật lý/DPI riêng. Xem [MANUAL-QA](../docs/MANUAL-QA.md).

---

## 7. Kết luận

R10 đạt điều kiện "workflow chạy được trên Electron và có automated tests cho các luồng quan
trọng", với trạng thái **`MOCK_PASS`** — không phải, và không được ghi thành, `LIVE_PASS`.

Bước tiếp theo theo thứ tự của Master Plan là **R11 — Authorized Backend Integration**, và nó
**bị chặn** cho tới khi A1 mở: chưa có văn bản quyền sử dụng API từ nhà cung cấp.
