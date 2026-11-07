# R12 — Giai đoạn 5: chế độ Zalo thật (zca-js)

Date: 2026-11-07 (Asia/Saigon).
Scope: `docs/zalo-ui-plan-v2.md` §5, dưới điều kiện của [ADR-004](../docs/ADR-004-zca-js-integration.md).

## Trạng thái tổng

| Hạng mục | Trạng thái | Bằng chứng |
| --- | --- | --- |
| Code hoàn tất (main, preload, IPC, protocol, renderer) | `IMPLEMENTED` | `npm run typecheck`, `npm test`, `npm run lint`, `npx playwright test` |
| Đăng nhập QR thật | `BLOCKED (chưa đăng nhập)` | Chưa chạy với tài khoản phụ |
| Khôi phục phiên sau khi tắt mở app | `BLOCKED (chưa đăng nhập)` | Cần phiên thật để lưu/đọc `safeStorage` |
| Nhận tin realtime | `BLOCKED (chưa đăng nhập)` | Cần listener thật |
| Gửi tin + trạng thái | `NOT_RUN` (live) / `PASS` (logic) | `appendOutgoing`/`settleOutgoing`/`retryTarget` có unit test; đường IPC chưa chạy thật |
| Banner bốn trạng thái | `PASS` (logic) / `NOT_RUN` (UI live) | `tests/live.test.ts`; không có phiên để kích `replaced` |
| Không lộ secret ở renderer | `PASS` | `tests/protocol-boundary.test.ts` — quét `src/**` và `electron/preload.ts` |
| **`LIVE_PASS`** | **0** | ADR-004 §5 |

Không có hạng mục nào trong checklist gốc được đánh dấu hoàn thành, vì cả năm đều cần một phiên thật.

## Đã kiểm chứng bằng máy

- `npm run typecheck` — cả `tsconfig.json` và `tsconfig.electron.json` sạch.
- `npm test` — **120/120** pass, gồm 15 test cho `src/renderer/live/*` và `src/shared/live.ts`
  (`adoptEcho` 3 ca, nhãn/tông/mức kết nối lại 1 ca, `subscribeLive` 3 ca, cộng phần `map.ts`).
- `npm run lint` trên đúng danh sách đường dẫn của script — không lỗi. (Chạy `npm run lint` qua
  wrapper RTK sẽ quét toàn repo và báo hàng nghìn lỗi ở các file `.cjs` khảo sát cũ; đó không phải
  phạm vi của script.)
- `npx playwright test` — **26/26** pass; cửa demo `Vào bản demo` vẫn là lối mặc định, 7 hội thoại,
  `Tên hiển thị demo` vẫn được focus.

## Thay đổi so với plan, và lý do

1. **`ConnectionState` của plan là một type riêng** (`LiveConnection`), không ghi đè
   `ConnectionState = 'online' | 'offline' | 'syncing'` của bản demo. Type demo đã bị
   `tests/core.test.ts` và `tests/e2e/demo.spec.ts` khoá; gộp hai bảng trạng thái sẽ làm hỏng
   hành vi demo đã được kiểm.
2. **Không có đường vào chế độ thật ở màn đăng nhập demo là lỗi, đã sửa.** `enterLive()` tồn tại
   nhưng không nơi nào gọi, nên chế độ thật không thể mở. Nay `LoginScreen` hiện nút phụ
   "Đăng nhập Zalo thật" **chỉ khi `window.chat` tồn tại**, kèm câu cảnh báo bắt buộc nguyên văn.
   Trong trình duyệt thường (`npm run dev`) nút này không render.
3. **Bố cục live dùng lưới hai cột.** `LiveSession` không có `NavigationRail`, nên nếu dùng
   `.app-layout` (ba cột `210px 390px 1fr`) thì danh sách hội thoại rơi vào cột rail 210px. Đã thêm
   `.live-layout` với `390px minmax(0,1fr)`, cùng biến thể 310px/255px cho hai breakpoint, và dời
   `left` của `.live-banner` theo.
4. **Cửa QR chiếm trọn cửa sổ.** Trước khi sửa, `LiveSession` dựng cả `LiveStage` lẫn `LiveLoginScreen`
   làm anh em, nên form QR xếp dưới một cột trống. Nay khi chưa đăng nhập, `LiveSession` chỉ trả
   `LiveOverlays`.
5. **Không còn hộp hồ sơ mở mặc định.** `LiveOverlays` cũ trả `LiveProfileScreen` khi
   `liveOverlay === null`, tức là luôn có modal che màn hình. Nay không có overlay thì không render gì.
6. **Banner ẩn khi chưa đăng nhập.** Trạng thái khởi tạo là `disconnected`; hiện "Mất kết nối" đè lên
   màn QR là báo lỗi sai.

## Rủi ro còn mở

- Chưa có lần chạy thật nào: mọi kết luận về payload, thời điểm, hay hành vi server của zca-js vẫn ở
  mức **khai báo** (`docs/zca-capabilities.md`).
- `getMessages` cho hội thoại 1-1 dựa vào `requestOldMessages`; chưa xác minh nó trả về gì trong
  thực tế.
- Đóng gói: zca-js là dependency runtime của main và phải nằm trong asar. `npm run build:desktop`
  chưa được chạy lại sau khi thêm dependency.
- ADR-002 ghi rằng `tests/core.test.ts` khoá chuỗi CSP — **sai**, đã sửa trong ADR. Hiện không có
  test nào so khớp hai bản CSP; đó là nợ kỹ thuật đã ghi nhận.

## Bước tiếp theo để đổi `BLOCKED` thành `PASS`

Chạy `npm run dev:desktop` bằng tài khoản phụ, rồi làm đúng năm mục checklist gốc, ghi lại từng mục
với mốc thời gian và ảnh chụp DevTools chứng minh không có cookie/IMEI/token trong renderer. Chỉ sau
đó mới được đặt `LIVE_PASS = 1`.
