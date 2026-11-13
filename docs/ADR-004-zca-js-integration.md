# ADR-004 — Nối zca-js thật (Giai đoạn 5), có điều kiện

> Historical scope note (2026-11-12): the former optional real-Zalo mode is now the sole application flow. The unofficial-library and account-risk warnings below still apply.

Date: 2026-11-07 (Asia/Saigon). Status: **Accepted — phạm vi thử nghiệm, người dùng tự chịu rủi ro.**
Không thay thế [ADR-001](ADR-001-integration-strategy.md) hay [ADR_RUNTIME_FIRST](ADR_RUNTIME_FIRST.md);
cả hai **vẫn còn hiệu lực** cho hướng tích hợp với Zalo PC đã cài.

## Bối cảnh

`docs/zalo-ui-plan-v2.md` (plan v2) mô tả Giai đoạn 5 = "Nối UI với Zalo thật" bằng `zca-js`,
một thư viện **API Zalo không chính thức cho tài khoản cá nhân**. Plan được viết như một tài liệu
kỹ thuật độc lập, không biết tới ADR-001/`ADR_RUNTIME_FIRST` trong cùng repo.

ADR-001 và `CUSTOM_CLIENT_ARCHITECTURE.md` §10 cấm: patch/inject `Zalo.exe`/`app.asar`, trích xuất
credential, vượt qua xác thực, dùng client bên thứ ba. `zca-js` **không vi phạm** các điều đó theo
nghĩa đen — nó không chạm vào bản cài Zalo PC, không trích xuất khóa, không inject. Nó đăng nhập
bằng QR như một trình duyệt mới và nói chuyện trực tiếp với server Zalo.

Nhưng ADR-001 cũng kết luận *"actual-client integration NO-GO"*, và `docs/API_AUTHORIZATION_GAP.md`
ghi A1–A4 = 0/4. Dùng `zca-js` là việc **khác** hướng đó, nhưng vẫn là "nói chuyện với Zalo mà
không có uỷ quyền chính thức".

Ngày 2026-11-07 người dùng yêu cầu rõ ràng: **"Thử nối zca-js thật"**, sau khi được cho thấy cả
mâu thuẫn ADR và rủi ro khóa tài khoản mà chính `zca-js` ghi trong README.

## Quyết định

1. **Phạm vi là thử nghiệm cá nhân, không phải sản phẩm.** Chỉ tài khoản phụ. Không tuyên bố
   "tương thích Zalo" hay "Zalo client". Mô tả app vẫn là demo UI độc lập + một chế độ thử nghiệm.
2. **Hai chế độ song song, không thay thế nhau.** Đường demo tĩnh (`Vào bản demo`) giữ nguyên và
   vẫn là đường mặc định; đường thật là *thêm vào* và luôn hiển thị cảnh báo.
3. **Không có thay đổi nào với bản cài Zalo.** Không patch, không inject, không đọc `app.asar`,
   không đụng profile/session/DB của Zalo. Đây là điều vẫn giữ nguyên từ ADR-001.
4. **Ranh giới kỹ thuật (plan §1) là bắt buộc:**
   - Chỉ `src/protocol/` được `import 'zca-js'`; test layering sẽ chặn mọi file khác.
   - Renderer không bao giờ nhận cookie, IMEI, `userAgent`, `cipher_key`, token.
   - Phiên lưu bằng `safeStorage` trong main, không bao giờ qua IPC.
5. **`LIVE_PASS` vẫn là 0 cho tới khi có phiên thật chạy.** Mọi kết quả của Giai đoạn 5 ở trạng thái
   không có phiên phải được ghi là `BLOCKED (chưa đăng nhập)` hoặc `NOT_RUN`, không phải PASS.
   Khác biệt với R10: `MOCK_PASS` vẫn dùng được, nhưng nó **không** chứng minh gì về zca-js.
6. **Giai đoạn 6 (đồng bộ + SQLite) không nằm trong quyết định này.** Nếu cần, phải có ADR riêng.

## Hệ quả

**Chấp nhận được.**
- UI Glass có dữ liệu thật để kiểm tra, đúng mục tiêu MVP của plan.
- Không có nguy cơ làm hỏng bản cài Zalo của người dùng.
- Nếu zca-js hỏng/chết/dừng, chỉ cần xóa `src/protocol/` và quay về demo tĩnh.

**Rủi ro chấp nhận.**
- **Tài khoản có thể bị Zalo khóa/ban.** Đây là rủi ro của zca-js, không phải của repo. Chỉ dùng
  tài khoản phụ; người dùng đã đồng ý.
- `zca-js` 2.2.0 không chính thức; API có thể đổi bất cứ lúc nào, và server Zalo có thể chặn.
- Mở Zalo Web cùng lúc sẽ làm listener dừng (`DuplicateConnection`/`KickConnection`). Đây là hành vi
  được thiết kế thành trạng thái `replaced` có nút "Kết nối lại", không tự retry.
- `zca-js` là dependency runtime của main, phải được đóng gói (`node_modules` trong asar) — khác với
  mọi dependency hiện tại vốn chỉ dùng lúc build.

**Không thay đổi.**
- ADR-001 (patch/inject Zalo PC) vẫn NO-GO.
- G5 (integration chính thức) vẫn NO-GO.
- A1–A4 vẫn 0/4.

## Cách áp dụng

- Mọi tài liệu mô tả chế độ thật **phải** ghi: "dùng zca-js không chính thức, chạy được hay không
  phụ thuộc server Zalo, có thể khiến tài khoản bị khóa".
- Không được viết "Zalo" như thể app là client chính thức.
- Nếu phải chọn giữa độ tiện và độ kín (ví dụ: hiển thị lỗi chi tiết vs. lỗi chung), chọn kín.
- Số liệu về payload/behavior zca-js chỉ được ghi ở mức "khai báo" cho tới khi có một lần chạy thật
  với tài khoản phụ; xem `docs/zca-capabilities.md`.
