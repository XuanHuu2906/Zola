# Zola

**Ứng dụng desktop cho Zalo cá nhân, xây dựng với Electron, React và TypeScript.**

Zola hướng tới một ứng dụng Zalo desktop có mã nguồn mở, giao diện kính mờ và khả năng phát triển cùng cộng đồng. Dự án kết nối tài khoản Zalo qua [zca-js](https://github.com/JustKemForFun/zca-js), lưu bộ nhớ đệm trên máy và cung cấp giao diện riêng cho việc trò chuyện hằng ngày.

Zola là dự án độc lập, không phải sản phẩm chính thức và không liên kết với Zalo hoặc VNG. Dự án đang trong quá trình phát triển; một số tính năng còn thử nghiệm.

## Tính năng và trạng thái

- **Đăng nhập bằng QR:** khôi phục phiên đã lưu khi mở lại ứng dụng; yêu cầu quét QR khi phiên không còn dùng được.
- **Trò chuyện cá nhân và nhóm:** nhận tin nhắn trực tiếp, hiển thị hội thoại và tải lịch sử trong phạm vi dữ liệu có sẵn.
- **Bộ nhớ đệm SQLite:** lưu hội thoại và tin nhắn riêng cho từng tài khoản, giúp mở lại dữ liệu đã tải trên máy.
- **Thông báo desktop:** nhấn thông báo để mở cuộc trò chuyện tương ứng.
- **Đồng bộ từ điện thoại — thử nghiệm:** có sẵn trong giao diện; chưa xác nhận hoạt động từ đầu đến cuối với điện thoại thật.
- **Gọi thoại và video — thử nghiệm, Linux x64:** cần chuẩn bị media runtime riêng; chưa xác nhận cuộc gọi, microphone và camera với tài khoản thật.

### Giới hạn hiện tại

Lịch sử đã có trong bộ nhớ đệm có thể đọc lại trên máy. Việc lấy các tin nhắn cũ hơn phụ thuộc vào nguồn dữ liệu và khả năng của giao thức; Zola chưa bảo đảm khôi phục đầy đủ lịch sử. Cơ chế lấy tin nhắn bỏ lỡ khi kết nối lại có giới hạn và chưa phát hiện chắc chắn mọi khoảng trống.

Gọi nhóm và chia sẻ màn hình chưa được cung cấp. Cấu hình đóng gói hiện có cho Windows x64 và Linux x64; macOS chưa có quy trình đóng gói được tài liệu hóa.

## Sử dụng ứng dụng

Với bản phát hành đã đóng gói, người dùng không cần Node.js, terminal hoặc biến môi trường:

1. Mở bản Zola dành cho hệ điều hành của bạn: file portable `.exe` trên Windows hoặc `.AppImage` trên Linux.
2. Quét mã QR bằng Zalo trên điện thoại khi đăng nhập lần đầu. Những lần sau, ứng dụng tự khôi phục phiên còn hiệu lực.
3. Trò chuyện ngay. Để lấy lịch sử cũ, chọn **Đồng bộ ngay** trên lời mời hoặc **Tài khoản Zalo → Đồng bộ lịch sử từ điện thoại**.
4. Mở Zalo trên điện thoại và xác nhận nếu được yêu cầu. Tiến trình đồng bộ hiển thị ngay trong ứng dụng; nếu thất bại, bạn có thể thử lại từ menu tài khoản.

Sau khi đồng bộ hoàn tất, lời mời ban đầu được ẩn. Mục đồng bộ trong menu tài khoản vẫn có sẵn để sử dụng lại. Đồng bộ không yêu cầu bật cờ hoặc khởi động lại ứng dụng.

## Phát triển từ mã nguồn

### Yêu cầu

- Node.js **24 trở lên** và npm.
- Git để lấy mã nguồn.
- Tài khoản Zalo và điện thoại để quét QR đăng nhập.
- Môi trường desktop để chạy Electron.

Sau khi clone repository, mở terminal tại thư mục dự án:

```bash
npm ci
npm run dev:desktop
```

Lệnh `dev:desktop` biên dịch Electron main/preload, khởi động Vite và mở cửa sổ ứng dụng. Quét QR bằng Zalo trên điện thoại nếu được yêu cầu. Đóng cửa sổ hoặc nhấn `Ctrl+C` để dừng môi trường phát triển.

Nếu chỉ cần làm giao diện:

```bash
npm run dev
```

Vite phục vụ giao diện tại `http://127.0.0.1:5173`. Bản xem trước trong trình duyệt không có cầu nối Electron để đăng nhập Zalo và không có tài khoản demo ngoại tuyến. Chạy riêng từng lệnh phát triển để tránh trùng cổng.

### Lưu ý trên Linux

Nếu Electron báo thiếu binary sau khi cài dependency, tải runtime bằng:

```bash
node node_modules/electron/install.js
```

Một số công cụ kiểm thử có thể tự tìm Node 24 qua `tools/node-run.cjs`. Tuy nhiên, hãy đặt Node 24 trở lên trên `PATH` để các lệnh build và kiểm tra kiểu chạy nhất quán.

## Kiểm tra và đóng gói

| Lệnh | Mục đích |
| --- | --- |
| `npm run check` | Kiểm tra TypeScript, ESLint và unit test |
| `npm test` | Chạy unit test |
| `npm run build` | Kiểm tra kiểu và build giao diện |
| `npm run build:electron` | Biên dịch Electron main/preload |
| `npm run test:e2e` | Kiểm thử giao diện bằng Playwright |
| `npm run test:desktop` | Kiểm tra khởi động, bridge và điều khiển cửa sổ |
| `npm run test:single-instance` | Kiểm tra chỉ mở một phiên ứng dụng |
| `npm run build:desktop` | Kiểm tra, build và đóng gói cho hệ điều hành đang dùng |
| `npm run verify:asar` | Đối chiếu mã đã build với nội dung gói ASAR |

Trước lần chạy Playwright đầu tiên:

```bash
npx playwright install chromium
npm run test:e2e
```

Các bài kiểm tra desktop cần có bản build trước:

```bash
npm run build
npm run build:electron
npm run test:desktop
npm run test:single-instance
```

Đóng gói ứng dụng:

```bash
npm run build:desktop
```

Kết quả nằm trong `release/`: Windows tạo file portable `.exe`, Linux tạo `.AppImage`. Các báo cáo kiểm tra gói nằm trong `reports/`. Cấu hình Linux còn khai báo media runtime tại `.zola-call-runtime/`; xem phần gọi thử nghiệm bên dưới khi chuẩn bị đóng gói.

Trên Linux, sau khi có AppImage, có thể cài cho người dùng hiện tại bằng `npm run install:linux`. Script giải nén ứng dụng vào `~/.local/opt/glass-messenger` và tạo launcher `zola` trong `~/.local/bin`, giúp chạy trên hệ thống thiếu FUSE 2.

## Tính năng thử nghiệm

### Đồng bộ lịch sử từ điện thoại

Đồng bộ được bật sẵn. Chọn **Đồng bộ ngay** trên lời mời sau đăng nhập hoặc **Đồng bộ lịch sử từ điện thoại** trong menu tài khoản. Không cần cấu hình biến môi trường.

Phần triển khai và giới hạn kiểm chứng được ghi tại [báo cáo Sync V2](reports/R13_SYNC_V2.md). Tính năng này chưa được xác nhận đồng bộ hoàn chỉnh với điện thoại thật.

### Gọi thoại và video trên Linux x64

Media runtime được chuẩn bị từ AppImage `VN-Linux-Family/zalo-for-linux` do bạn cung cấp:

```bash
npm run calls:prepare -- /path/to/Zalo.AppImage
npm run dev:desktop
```

Lệnh chuẩn bị thực thi trình xử lý `--appimage-extract` của gói đầu vào. Chỉ sử dụng gói bạn tin cậy. Runtime nằm tại `.zola-call-runtime/` và được Git bỏ qua; có thể đổi đường dẫn qua `ZOLA_CALL_RUNTIME`. Backend âm thanh cần PipeWire/PulseAudio và libopus; video cần hỗ trợ H.264 WebCodecs từ Chromium.

Đọc [báo cáo triển khai cuộc gọi](reports/R19_CALLING_IMPLEMENTATION.md) để biết phạm vi đã kiểm tra. Media runtime là thành phần bên ngoài, cần được xem xét riêng trước khi phân phối.

## Dữ liệu trên máy

- Phiên đăng nhập lưu trong `zca-session.bin`, được mã hóa qua Electron `safeStorage`.
- Hội thoại và tin nhắn được lưu trong SQLite `cache-<ownId>.db`, riêng cho từng tài khoản. Việc mã hóa phiên đăng nhập không đồng nghĩa bộ nhớ đệm tin nhắn cũng được mã hóa.
- `live-listener.log` lưu thông tin chẩn đoán có xoay vòng, được thiết kế để không ghi nội dung tin nhắn hoặc thông tin xác thực.

Khi báo lỗi, hãy loại bỏ thông tin cá nhân khỏi ảnh chụp và log. Không đính kèm phiên đăng nhập, cookie, token hoặc cơ sở dữ liệu trò chuyện.

## Cấu trúc dự án

```text
src/renderer/       Giao diện React, trạng thái trò chuyện và ánh xạ IPC
src/shared/         Logic dùng chung và kiểm tra cấu hình
electron/          Tiến trình chính, preload và tích hợp desktop
  db/              Bộ nhớ đệm SQLite và migration
  protocol/        Kết nối Zalo, phiên đăng nhập và đồng bộ
tests/             Unit test và kiểm thử giao diện
tools/             Công cụ phát triển, build và kiểm tra desktop
docs/              Tài liệu kiến trúc và kiểm thử
reports/           Báo cáo kỹ thuật và kết quả kiểm chứng
```

Stack chính: Electron, React, TypeScript, Vite, Tailwind CSS v4, Zustand, Motion, `zca-js` và SQLite qua `node:sqlite`.

## Đóng góp

Bạn có thể tham gia bằng cách báo lỗi, cải thiện tài liệu, chỉnh giao diện hoặc gửi bản sửa. Với thay đổi lớn về kiến trúc hay giao thức, hãy mở issue để trao đổi phạm vi trước khi triển khai.

1. Fork repository và tạo nhánh cho thay đổi của bạn.
2. Cài dependency bằng `npm ci` và phát triển với `npm run dev:desktop`.
3. Bổ sung hoặc cập nhật kiểm thử phù hợp khi thay đổi hành vi.
4. Chạy `npm run check`; chạy thêm kiểm thử giao diện hoặc desktop nếu phần thay đổi có liên quan.
5. Gửi pull request mô tả vấn đề, cách sửa và kết quả kiểm tra. Với thay đổi giao diện, kèm ảnh chụp đã che dữ liệu cá nhân.

Khi báo lỗi, ghi rõ hệ điều hành, phiên bản Node.js, phiên bản Zola hoặc commit, các bước tái hiện, kết quả mong đợi và kết quả thực tế. Phân biệt kết quả kiểm thử mô phỏng với kết quả đã kiểm chứng trên tài khoản thật.

Một số hướng đóng góp hiện tại:

- Cải thiện độ ổn định khi kết nối lại và phát hiện khoảng trống lịch sử.
- Kiểm chứng đồng bộ điện thoại và cuộc gọi trong môi trường thật.
- Tối ưu danh sách tin nhắn lớn, cuộn ảo và tìm kiếm nội dung.
- Cải thiện khả năng truy cập, trải nghiệm Linux/Windows và tài liệu cho người mới.

## Tài liệu kỹ thuật

- [Kiến trúc custom client](docs/CUSTOM_CLIENT_ARCHITECTURE.md)
- [Hướng dẫn QA thủ công](docs/MANUAL-QA.md)
- [Tiến độ và bằng chứng kiểm chứng](reports/PLAN_V2_STATUS.md)
- [Đồng bộ điện thoại](reports/R13_SYNC_V2.md)
- [Gọi thoại và video](reports/R19_CALLING_IMPLEMENTATION.md)
- [Thông báo desktop](reports/R20_NOTIFICATIONS.md)

Các báo cáo ghi lại trạng thái tại thời điểm kiểm tra và có thể chứa quyết định hoặc thử nghiệm lịch sử.

## Giấy phép

Dự án hướng tới phát hành mã nguồn mở, nhưng hiện chưa có file `LICENSE` và `package.json` vẫn khai báo `UNLICENSED`. Giấy phép mã nguồn mở chưa được chốt. Dependency, tài nguyên và media runtime bên ngoài có điều kiện sử dụng riêng.
