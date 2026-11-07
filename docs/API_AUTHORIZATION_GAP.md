# Khoảng trống quyền sử dụng API (R8)

**Trạng thái:** **CHƯA MỞ — 0/4 cổng.** Không có adapter nào được phép kết nối backend Zalo.
**Ngày:** 2026-11-06
**Cơ sở:** [R6 §6.3](../reports/R6_CLIENT_ARCHITECTURE.md) (quyền sử dụng không chứng minh được bằng
static analysis) · [R7 §2](../reports/R7_PROTOCOL_AND_FEATURE_MAP.md) (cột *Quyền sử dụng* =
BLOCKED cho cả 9 tính năng) · [ADR-001](ADR-001-integration-strategy.md)

> Tài liệu này **không** đưa ra kết luận pháp lý. Nó ghi lại **cái gì đã biết**, **cái gì còn thiếu**,
> và **cái gì phải đúng trước khi** bất kỳ dòng mã nào được nói chuyện với backend Zalo.

---

## 1. Vì sao tồn tại tài liệu này

R6 đọc được **471 endpoint**, **43 lệnh WebSocket**, **233 ánh xạ commandId**, và toàn bộ hợp đồng
IPC. Nhưng có một câu hỏi R6 **không thể** trả lời, và nó không phải câu hỏi kỹ thuật:

> **Chúng ta có được phép dùng những endpoint đó không?**

Static analysis trả lời "máy làm được gì". Nó không trả lời "chúng ta được làm gì". Hai câu đó khác
nhau, và nhầm lẫn giữa chúng là sai lầm nguy hiểm nhất trong toàn bộ dự án.

R7 đặt cột *Quyền sử dụng* = **BLOCKED** cho cả 9 tính năng, kể cả những tính năng đã đọc được đầy đủ
hình dạng như F1 và F4. Đó là chủ ý: **có endpoint ≠ được phép dùng endpoint**.

---

## 2. Bốn cổng

Mọi việc nối mạng thật phải qua bốn cổng, theo thứ tự. Không cổng nào đang mở.

### A1 — Quyền truy cập API

| | |
|---|---|
| **Câu hỏi** | Zalo/VNG có cấp quyền cho một client bên thứ ba dùng giao diện lập trình của họ không? |
| **Trạng thái** | **CHƯA XÁC ĐỊNH** |
| **Đã kiểm tra** | Trang sản phẩm Zalo PC, hướng dẫn cá nhân hoá, điều khoản sử dụng (xem ADR-001). Không tài liệu nào mô tả một API công khai cho client bên thứ ba. |
| **Còn thiếu** | Văn bản của VNG nêu rõ: API nào, cho ai, phạm vi nào, thời hạn nào. |
| **Không chấp nhận** | "App khác làm được"; "endpoint công khai trên mạng"; "không thấy bị chặn"; "chỉ để học". |
| **Ai mở được** | Chủ dự án, bằng văn bản từ nhà cung cấp — không phải bằng phân tích kỹ thuật. |

**Vì sao đây là cổng đầu tiên:** nếu A1 không mở, ba cổng còn lại vô nghĩa. Không có mức độ "dùng
một chút" nào hợp lệ.

### A2 — Phạm vi được phép

| | |
|---|---|
| **Câu hỏi** | Nếu A1 mở, chính xác những tính năng nào nằm trong phạm vi? |
| **Trạng thái** | **CHẶN BỞI A1** |
| **Cần ghi rõ** | 9 tính năng R7, từng tính năng một: F1…F9 — cho phép / không cho phép / chưa nói |
| **Đặc biệt** | F7 (gọi điện) và F8 (đồng bộ) cần nêu riêng kể cả khi phạm vi chung đã rõ, vì rủi ro của chúng khác hẳn F1–F6 |
| **Ghi chú** | Phạm vi hẹp hơn quyền A1 là bình thường. Phạm vi rộng hơn là không có. |

### A3 — Tài khoản thử nghiệm

| | |
|---|---|
| **Câu hỏi** | Có tài khoản tách biệt, không chứa dữ liệu thật của ai, để thử nghiệm không? |
| **Trạng thái** | **CHƯA CÓ** |
| **Yêu cầu tối thiểu** | Tài khoản riêng; không có liên hệ, không có tin nhắn, không có tệp của người thật; có thể xoá bỏ mà không ảnh hưởng ai |
| **Vì sao bắt buộc** | F8 (đồng bộ) có thể **làm mất tin** nếu áp dụng sai thứ tự (R7 §10). Thử trên tài khoản thật là rủi ro không chấp nhận được. |
| **Không chấp nhận** | Tài khoản cá nhân; tài khoản của người khác được "mượn"; tài khoản có dữ liệu thật đã sao lưu "để đề phòng". |

### A4 — Môi trường cách ly và đường lùi

| | |
|---|---|
| **Câu hỏi** | Khi thử nghiệm hỏng, có cách quay lại trạng thái an toàn không? |
| **Trạng thái** | **CHƯA ĐỊNH NGHĨA** |
| **Cần có** | Máy hoặc profile tách biệt; cách xoá sạch dữ liệu cục bộ do thử nghiệm sinh ra; cách dừng ngay lập tức; người chịu trách nhiệm xác nhận đã quay lại |
| **Đặc biệt** | Không được thử trên máy đang dùng Zalo thật của bất kỳ ai |
| **Ghi chú** | Với ứng dụng chat, "hoàn tác" không tồn tại ở phía người nhận. Một tin đã gửi là đã gửi. |

---

## 3. Ma trận cổng

| Cổng | Đang mở? | Cần gì để mở | Ai xác nhận |
|---|---|---|---|
| **A1** Quyền API | **KHÔNG** | Văn bản từ nhà cung cấp | Chủ dự án |
| **A2** Phạm vi | **KHÔNG** | Chính sách theo F1…F9 | Chủ dự án |
| **A3** Tài khoản thử | **KHÔNG** | Tài khoản sạch, tách biệt | Chủ dự án |
| **A4** Cách ly + lùi | **KHÔNG** | Quy trình bằng văn bản | Chủ dự án |

**Số cổng mở: 0/4.**

---

## 4. Điều khoản đã ghi nhận

ADR-001 dẫn [điều khoản sử dụng Zalo](https://zalo.vn/dieukhoan/) mục 4, trong đó có các hạn chế về
thiết kế lại / tháo rời / sửa đổi (4.4), can thiệp không được phép (4.5), và truy cập bên thứ ba
chưa được chấp thuận (4.7). Bản thông báo cập nhật điều khoản đề ngày 28/08/2026.

**Ghi nhận trung thực về giới hạn hiểu biết:**

- Đây là **dẫn chiếu**, không phải phân tích pháp lý. Dự án này không đưa ra kết luận có tính pháp lý.
- Việc đọc byte tĩnh của một gói phần mềm đã cài trên máy của chính người dùng **không** tự động là
  được phép, cũng **không** tự động là bị cấm. Đây là vùng cần ý kiến chuyên môn, không phải vùng
  mà tài liệu kỹ thuật được quyết định.
- R7 không đọc cái gì ngoài byte tĩnh: không đăng nhập, không giữ credential, không đọc profile.

---

## 5. Điều được phép làm khi cổng đóng

Đây là phần thực tế nhất của tài liệu: công việc vẫn tiến được bao xa mà không cần cổng nào.

| Được làm | Vì sao hợp lệ |
|---|---|
| Dựng và hoàn thiện UI glass | Không liên quan Zalo |
| Thiết kế `IZaloClient` và 11 cổng | Là thiết kế của chúng ta |
| Viết mock adapter cho các cổng | Không nói chuyện với ai |
| Viết Application Services trên mock | Không nói chuyện với ai |
| Kiểm thử optimistic send, retry, khử trùng echo | Chạy trên dữ liệu giả |
| Dựng test double transport trỏ vào **loopback của chính mình** | Không phải Zalo |
| Viết tài liệu này | Đây là việc cần làm |

| Không được làm | Vì sao |
|---|---|
| Gọi bất kỳ endpoint Zalo nào, kể cả "chỉ một lần để xem" | A1 đóng |
| Đăng nhập bằng tài khoản thật hay tài khoản thử | A1, A3 đóng |
| Nhúng host / domain / tham số giao thức vào mã nguồn | Biến việc chưa được phép thành mặc định |
| Dựng khung kết nối "để đó, chưa bật" | Hạ thấp rào cản cho lần bật đầu tiên |
| Đo đạc phản hồi thật để "hiểu schema" | Là gọi mạng thật dưới tên khác |

**Dòng thứ tư đáng nhấn mạnh.** Một adapter `authorized` viết sẵn nhưng chưa bật trông có vẻ vô hại;
thực tế nó biến một quyết định có ý thức thành một thao tác cấu hình. Thiết kế ở
[CUSTOM_CLIENT_ARCHITECTURE.md](CUSTOM_CLIENT_ARCHITECTURE.md) cố ý tránh điều đó: M3 (adapter
`authorized`) **chặn** cho tới khi A1+A2 mở, và không có nhánh mã nào chờ sẵn.

---

## 6. Khi nào cập nhật tài liệu này

Cập nhật khi — và chỉ khi — một trong các sự kiện sau xảy ra:

1. Có văn bản từ VNG về quyền dùng API → cập nhật A1, kèm bản trích dẫn.
2. Có chính sách phạm vi theo tính năng → cập nhật A2, theo bảng F1…F9.
3. Có tài khoản thử đạt tiêu chí A3 → ghi tài khoản nào (không ghi thông tin đăng nhập).
4. Có quy trình cách ly/lùi được người có thẩm quyền xác nhận → cập nhật A4.

Không cập nhật dựa trên: suy luận về ý định của nhà cung cấp; việc dự án khác làm; việc kỹ thuật
"chạy được"; hay việc không nhận được phản hồi.

---

## 7. Liên kết

| Tài liệu | Nội dung |
|---|---|
| [CUSTOM_CLIENT_ARCHITECTURE.md](CUSTOM_CLIENT_ARCHITECTURE.md) | Bốn lớp, 11 cổng, lộ trình M0–M4 |
| [R6_CLIENT_ARCHITECTURE.md](../reports/R6_CLIENT_ARCHITECTURE.md) | §6.3 — vì sao quyền không chứng minh được tĩnh |
| [R7_PROTOCOL_AND_FEATURE_MAP.md](../reports/R7_PROTOCOL_AND_FEATURE_MAP.md) | §2 — cột quyền sử dụng cho 9 tính năng |
| [ADR-001-integration-strategy.md](ADR-001-integration-strategy.md) | Bối cảnh quyết định và dẫn chiếu điều khoản |
