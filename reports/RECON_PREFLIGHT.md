# Rà soát trước khi khảo sát Zalo PC

Trạng thái: đã đọc mã `tools/Inspect-Zalo.ps1`; chưa chạy trên Zalo.
Các công cụ REA có trong phiên này, gồm `open_binary`, `binary_session` và
`analyze_javascript_application`. Chưa chọn/mở binary hay gắn vào tiến trình Zalo.

## Thao tác cụ thể đang chờ xác nhận phạm vi

```powershell
rtk proxy powershell.exe -NoProfile -File .\tools\Inspect-Zalo.ps1
```

Chạy bằng quyền người dùng thông thường từ `D:\Zalo`.

Script hiện tại:

- Đọc tên, PID, PID cha và đường dẫn executable của các tiến trình có tên chứa Zalo.
- Suy ra thư mục cài đặt từ executable đang chạy; nếu không tìm thấy thì dừng,
  không tự mở hay đăng nhập Zalo.
- Đọc version/product metadata và trạng thái chữ ký của tối đa 10 executable.
- Kiểm tra sự tồn tại của các dấu hiệu đóng gói như `app.asar`, `.pak`, thư viện
  Chromium; không giải nén hoặc đọc nội dung `app.asar`.

  > **Cập nhật 2026-11-05:** phạm vi này áp dụng cho lượt khảo sát G4 (chỉ metadata).
  > Một lượt đọc sâu hơn sau đó **có** sao chép và đọc ba file JavaScript trong
  > `app.asar` (`main-dist/main.js`, `pc-dist/compact-app-pc….js`,
  > `main-dist/preload-render.js`) cùng vài chỗ trong file CSS, để trả lời câu hỏi
  > theme/plugin mà metadata không trả lời được. Không đọc profile, database, chat,
  > credential, media hay dữ liệu mạng. Chi tiết và giới hạn:
  > [ZALO_THEME_FEASIBILITY.md](ZALO_THEME_FEASIBILITY.md).
- Liệt kê đệ quy metadata các file trong thư mục cài đặt để tổng hợp số lượng,
  dung lượng theo phần mở rộng; không xuất danh sách tên file.
- Ghi báo cáo JSON cục bộ vào `D:\Zalo\reports\zalo-recon-<timestamp>.json`.
  Tiền tố hồ sơ người dùng trong đường dẫn được thay bằng `%USERPROFILE%`;
  các đoạn đường dẫn khác vẫn có thể xuất hiện trong báo cáo.

Không có thao tác sửa Zalo, injection, attach debugger, đọc nội dung chat/database,
credential, gửi báo cáo lên mạng hoặc gọi API Zalo. Mã không thực hiện yêu cầu
mạng trực tiếp; việc kiểm tra chữ ký sử dụng cơ chế xác thực của Windows.

## Giới hạn kết luận

Marker Electron/Chromium không chứng minh framework UI, khả năng thay giao diện
hay tương thích đầy đủ. Báo cáo chỉ phục vụ bước P1-C và cập nhật ADR. Việc patch,
giải mã API riêng, lấy dữ liệu tài khoản hoặc triển khai tích hợp vẫn ngoài phạm vi.

## Vì sao cần xác nhận riêng

`AGENT_PLAN.md`, mục P1-C yêu cầu:

> Người dùng xem và đồng ý chạy `tools/Inspect-Zalo.ps1` trên máy Windows

Đây là gate phạm vi do kế hoạch của dự án quy định, không phải thiếu quyền filesystem
hay yêu cầu cấp quyền lại của REA. Skill REA cho phép gọi công cụ trong phạm vi đã
được giao và không tự yêu cầu xác nhận cho mỗi lần gọi.
