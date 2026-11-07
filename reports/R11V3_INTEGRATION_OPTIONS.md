# R11V3 — Integration Options (R11A)

**Trạng thái:** R11A đóng. Chọn **tối đa hai** hướng có cơ sở (plan §12).
**Ngày:** 2026-11-06 (Asia/Saigon) · **Phạm vi:** Zalo PC 26.10.20.3253 trên máy này · **Công cụ RE:** REA (duy nhất)
**Bằng chứng nền:** [`R11V3_RUNTIME_BOUNDARY.md`](R11V3_RUNTIME_BOUNDARY.md) — mọi số trong tài liệu này trích từ đó, không đếm lại.

> **Không có adapter nào được chế tạo trong R11A.** Chưa có dòng code tích hợp nào được viết.
> A1–A4 = **0/4**. `LIVE_PASS` = **0**.

---

## 0. Kết luận điều hướng

| # | Hướng | Kết luận R11A | Đi tiếp? |
|---|---|---|---|
| A | **Runtime-hosted** — UI Apple Glass chạy *bên trong* Zalo | `NO_SUPPORTED_CANDIDATE_YET` | **Không.** Không có bề mặt hosting |
| B | **Companion / OS** — điều khiển Zalo đã cài qua URI scheme hệ thống | `CANDIDATE_FOUND` | **Có**, đúng một PoC, chuyển R11B |

Tổng cộng: **một** candidate hợp lệ, không phải hai. Plan §12 cho phép tối đa hai; không có hướng thứ hai nào
có cơ sở bằng chứng để đưa vào, và việc bịa thêm hướng thứ hai là chính điều plan cấm.

---

## Candidate A — Runtime-hosted (UI ngoài chạy trong runtime Zalo)

### A.1 Định nghĩa

Apple Glass UI được nạp *bên trong* process Zalo chính thức: như một `BrowserView`/`WebContentsView` của
main window, như một `webview`, như một cửa sổ `BrowserWindow` do mã Zalo tạo, hoặc qua một protocol handler
do Zalo đăng ký để phục vụ trang của ta.

### A.2 Trạng thái: `NO_SUPPORTED_CANDIDATE_YET`

| Điều kiện cần | Đo được | Nguồn |
|---|---|---|
| Có API nhúng nội dung ngoài | `BrowserView`=0, `WebContentsView`=0, `addBrowserView`=0, `setBrowserView`=0 | hosting sweep, 116/116 JS |
| Có webview | `webviewTag`=0, `<webview`=0, `will-attach-webview`=0 | hosting sweep |
| Có protocol handler mở | `protocol.handle`=0, `registerHttpProtocol`=0, `registerStreamProtocol`=0, `registerBufferProtocol`=0 | hosting sweep |
| Có server nội bộ để nạp UI | `http.createServer`=0, `https.createServer`=0, `express(`=0, `app.listen(`=0 | host-surface sweep |
| Có nhánh dev-server | `getHtml()` trả `http://127.0.0.1:3000/…` **nhưng** `if (isDev())` = `if (false)` | main.js @2218293, @2227030 |
| `zfile://` | `registerFileProtocol("zfile", …)` **chỉ trong** `if (oe())` = `if (false)` | main.js `Wn()` |
| Có thể chèn CSS/JS | `insertCSS`=0, `executeJavaScript`=0 | hosting sweep |

Hai bề mặt *trông giống* hosting đều là **dead code ở bản production**, và điều này được chứng minh bằng
hằng số chứ không bằng suy luận: `oe()` → `n("ZQzv").isDev` → `function I(){ return d }` → `const d = !1`,
không gán lại trong toàn bộ 16,951 ký tự của module `ZQzv`, không có `process.env`.

### A.3 Blocker chính xác

**Thiếu prerequisite, không phải thiếu nỗ lực.** Không tồn tại một điểm móc (hook) nào trong Zalo
26.10.20 để một UI ngoài được nạp vào. Ba đường duy nhất có thể tạo ra điểm móc đó đều bị cấm:

1. **`app.asar` patch** — sửa package đã ký của VNG, vượt qua ranh giới update → `NO-GO` (ADR-001, plan §2.3, §2.4 #9).
2. **Preload/extension injection** — không có hook; tạo hook đòi patch → cùng `NO-GO`.
3. **Private IPC qua DevTools** (`devTools: true` có thật) — mở bằng thao tác UI thủ công, không lập trình
   được, và gọi `ipcMain` nội bộ chính là private IPC access → plan §2.3 chặn.

### A.4 PoC

**Không có.** Plan §6.1 đòi "bằng cơ chế được hỗ trợ, không chỉnh sửa ứng dụng". Không có cơ chế như vậy tồn
tại cho hướng A. Viết một PoC ở đây sẽ là chế tạo adapter giả định — bị plan §5 exit criteria cấm nguyên văn.

**Điều kiện mở lại hướng A** (không phải việc của R11B): một bản Zalo tương lai công bố API nhúng chính thức,
hoặc VNG cấp quyền bằng văn bản. Khi đó phải audit lại từ đầu bằng REA và mở gate A1–A4.

---

## Candidate B — Companion qua URI scheme hệ thống

### B.1 Định nghĩa

Apple Glass **không** thay thế UI Zalo và **không** gọi backend Zalo. Nó là một ứng dụng đồng hành
(companion) yêu cầu người dùng **đã cài Zalo chính thức** (plan §10 cho phép mô hình này, kèm yêu cầu
nói rõ "phải cài Zalo"). Nó điều khiển Zalo bằng **cơ chế đăng ký công khai của Windows**: gọi URI
`zalo://conversation/?phone=<số>`; Windows spawn tiến trình Zalo thứ hai; instance đang chạy nhận argv qua
`second-instance` và mở hội thoại đó.

Đây **không** phải Zalo API, **không** phải IPC nội bộ, **không** phải đọc dữ liệu phiên. Đây là cùng cơ chế
một người dùng kích hoạt khi bấm một link `zalo://` trên web.

### B.2 Chuỗi bằng chứng đầu-cuối (`OBSERVED`, tĩnh)

| Bước | Bằng chứng | Mức |
|---|---|---|
| 1. OS có đăng ký scheme | `HKCU:\Software\Classes\zalo` EXISTS; `shell\open\command = "…\Zalo.exe" "--" "%1"`; **không** có `DelegateExecute` | `OBSERVED` (registry) |
| 2. Không có `DelegateExecute` → Windows spawn process | Hệ quả của việc thiếu khoá COM activator | `INFERRED` (hành vi chuẩn của Windows) |
| 3. Process thứ hai không tự chuyển argv | `main-dist/second-instance.js` (1,516 B) chỉ ghi `startup.log` rồi `app.quit()` | `OBSERVED` (đọc file) |
| 4. Instance đang chạy nhận argv | `On.on("second-instance", (e,t,n) => { … Pn.receiveArguments(t) })` | `OBSERVED` (main.js @3565789) |
| 5. Stub 790 KB **khởi chạy** binary versioned và chuyển argv | Stub là launcher tự viết của VNG (`D:\workspace\StubExecutableZalo\…\Zalo.pdb`, ký `CN=VNG GROUP JSC`), import `GetCommandLineW`+`CommandLineToArgvW`+`CreateProcessW`. Log: **276/276** lần `second-instance` đều khớp ±10 s với một lần stub chạy | Khởi chạy: **`OBSERVED`**. Chuyển **argv**: **`INFERRED`** ← L7 |
| 6. Parser lấy `argv[idx("--")+1]` | `function Hn(e)` @2710764 | `OBSERVED` |
| 7. Regex `^zalo:?//conversation/?\?(phone\|username\|id)=\+?(.+)` | cùng chỗ | `OBSERVED` |
| 8. Gửi tới renderer | `Ce.webContents.send("z-uri-open-conv", {term, data})` khi `Fe === be` | `OBSERVED` |
| 9. Renderer mở hội thoại | `autoOpenConversationBy{Phone,Username,Id}` @18466 trong `…ec73261654…js`; handler đăng ký qua `$zsub.$zuri.onRequestOpenConv` @18950 | `OBSERVED` |

Bước 2 và phần **argv** của bước 5 là `INFERRED` **và chính là thứ PoC phải kiểm chứng**. Không được
ghi chúng là đã biết. (Phần *khởi chạy* của bước 5 nay đã `OBSERVED` — xem bằng chứng log ở cột giữa.)

**Bổ sung: cold start dùng chung một hàm.** `main.js` @2714883 gọi `process.argv[1] && Hn(process.argv)`
ngay trên đường khởi động, nên deep link hoạt động cả khi Zalo **chưa** chạy. PoC không cần ép Zalo chạy trước.

### B.3 PoC tối thiểu — đúng một cái

> **Một** thao tác, **một** quan sát, **không** gửi tin, **không** đọc nội dung.

**Điều kiện tiên quyết (chưa thoả — xem B.7):**
- P1. Người dùng xác nhận **hội thoại test** cụ thể (số điện thoại hoặc username do người dùng kiểm soát,
  hoặc tài khoản Zalo thứ hai cùng người dùng). **Không** dùng hội thoại thật với người khác.
- P2. Người dùng đã đăng nhập Zalo trên máy và app đang ở page MAIN (`Fe === be`), hoặc chấp nhận nhánh
  xếp hàng.
- P3. Người dùng đồng ý ghi màn hình/log phiên PoC, với nội dung hội thoại được che.

**Lệnh (PowerShell, không sửa gì):**

```powershell
Start-Process "zalo://conversation/?phone=<TEST_NUMBER>"
```

tương đương `ShellExecute` trên `HKCU:\Software\Classes\zalo` — **không** gọi trực tiếp `Zalo.exe`, để chứng
minh đúng cơ chế OS đăng ký.

**Quan sát và ghi:**
1. Có process `Zalo.exe` thứ hai xuất hiện rồi biến mất không? (chứng minh bước 2)
2. Cửa sổ Zalo có hiện ra và được focus không? (chứng minh cơ chế tự khôi phục từ tray trong handler — L5)
3. Zalo có hiển thị **đúng** hội thoại test không? (chứng minh bước 6–9)
4. Thời gian từ lệnh tới hội thoại hiện ra.
5. Nếu Zalo đang tắt hoàn toàn: hành vi khác thế nào? (ghi riêng, không tính vào pass)

**Tiêu chí chấp nhận (acceptance test):**

| # | Tiêu chí | Cách kiểm |
|---|---|---|
| AC1 | Cửa sổ Zalo hiện và được focus | Ảnh chụp trước/sau; `GetForegroundWindow` |
| AC2 | Hội thoại hiện ra **đúng** người nhận test | Ảnh chụp đã che nội dung; so khớp tên/số test |
| AC3 | Không có hành động ghi nào xảy ra | Không tin nhắn nào được gửi; log ghi rõ "open only" |
| AC4 | Không có process/pipe/file nào của Zalo bị ta đọc hay sửa | Kiểm bằng process list và hash của `app.asar` trước/sau |
| AC5 | Tái lập được | Chạy 3 lần; ghi tỉ lệ thành công và thời gian |

**Nhãn tối đa đạt được:** `COMPANION_POC_PASS`.
**Không bao giờ** được ghi `RUNTIME_POC_PASS` (không đi qua runtime theo nghĩa hosting) và **không bao giờ**
`LIVE_PASS` (không có backend Zalo nào được kiểm thử qua phương thức được phép).

**Rollback:** đóng hội thoại vừa mở trong Zalo. Không có state nào bị thay đổi; không có file nào cần khôi
phục. Nếu PoC thất bại, không cần rollback — không có gì bị ghi.

**Hậu quả nếu Zalo tắt / update / logout:** đây là companion **phụ thuộc** Zalo. Zalo không cài → không có
scheme trong registry → lệnh thất bại (phải báo lỗi rõ cho người dùng, không im lặng). Zalo update → grammar
có thể đổi; mọi offset/chuỗi ở tài liệu này trôi theo phiên bản. Logout → link xếp hàng tới khi login xong (L2).

### B.4 Giới hạn của Candidate B — đo được, đầy đủ

| # | Giới hạn | Hệ quả cho sản phẩm |
|---|---|---|
| L1 | **Một chiều.** Không có kênh đọc trạng thái trả về. `$zuri` có 4 loại descriptor nhưng registrar dựng `$zsub` chỉ hiện thực `SUBSCRIBE`/`UNSUBSCRIBE`/`SUBSCRIBE_V2`; `REQUEST`/`RAW_SEND` bị bỏ im lặng nên renderer gọi trần và **không nhận trả lời** | Apple Glass **không biết** Zalo đang mở gì; không thể đồng bộ UI hai bên |
| L2 | Cần đã login + page MAIN; nếu không thì xếp hàng (`Fe===be&&Ce?send:(Qe=data,Ze=term)`) | Không lái được màn login |
| L3 | **Compact app không tiêu thụ** kênh này, dù bundle compact **có gọi** `$zuri.checkOpenConvReq()`/`checkArgvLink()`: `z-uri-open-conv`, `z-uri-request`, `check-arg-link`, `onRequestOpenConv`, `onNewRequest` = **0**; chunk `aa2b4a7e` (đăng ký `globalThis.$zsub` + `Ke("$zuri",…)`) **không được nạp** (`aa2b4a7e` = 0); `second-instance` = 0 trong `compact-app.js`. Component gốc của compact chỉ mount màn *ổ đĩa không truy cập được* hoặc màn *migration* — chat shell (`chatController` ×290) không bao giờ mount. Chi tiết: boundary §7.5 L3, §7.7 | Không điều khiển được chế độ compact qua URI. Chế độ compact chỉ là **fallback khi không truy cập được thư mục dữ liệu**, không phải UI để tích hợp |
| L4 | Không có toast activator cho Zalo PC (không có `com.vng.zalo` dưới `AppUserModelId`) | Không đọc notification qua Windows toast platform |
| L5 | UIA hiện rỗng (`DESCENDANTS=0`, `MainWindowHandle=0`, mọi cửa sổ `VIS=False`) | **Không** dựa vào UI Automation để đọc trạng thái; PoC phải khôi phục cửa sổ trước |
| L6 | `setAccessibilitySupportEnabled`=0, không có `--force-renderer-accessibility` | Cây accessibility không đảm bảo đầy đủ ngay cả sau khi show |
| L7 | Stub 790 KB phải chuyển **argv** xuống binary versioned — **`INFERRED`**. Việc *khởi chạy* thì đã `OBSERVED` (276/276) | Nếu argv không được chuyển tiếp đúng, hướng B sụp; PoC kiểm đúng điều này |
| L8 | Grammar chỉ `phone\|username\|id`; `phone` bị lọc còn chữ số | Không mở group/file/call qua đường này |

**Giới hạn kiến trúc quan trọng nhất:** B **không phải** một client thay thế và **không** đóng gói được
tính năng Zalo. Nó chỉ là một *cầu điều khiển mở hội thoại*. Không được tuyên bố "đã có client native đầy
đủ" (plan §12).

### B.5 Vì sao dùng URI scheme thay vì UI Automation

Plan §2.3 mô tả phương án B là "UI Automation/accessibility". R11A **không** chọn UIA làm cơ chế PoC, và
đây là lý do đo được, không phải sở thích:

| Tiêu chí | UI Automation | URI scheme |
|---|---|---|
| Cây UIA hiện có | **Rỗng**: `DESCENDANTS=0`, `BUTTONS=0`, `EDITS=0`, `LISTITEMS=0`, `MainWindowHandle=0` | không cần |
| Cần cửa sổ hiển thị | **Có** — nhưng app đang minimized-to-tray (`VIS=False`) | Không; handler tự `show()` |
| Cần `setAccessibilitySupportEnabled` | Có lợi — nhưng = **0** và không có `--force-renderer-accessibility` | Không |
| Tính ổn định | Phụ thuộc cây UI, đổi theo từng bản Zalo | Regex cố định trong main process |
| Đích cần chứng minh | "mở hội thoại test" | "mở hội thoại test" |

Cả hai đều là **OS integration công khai** theo đúng tinh thần plan §9 ("mô hình sử dụng giao diện OS công
khai để điều khiển ứng dụng người dùng đã cài"). URI scheme thắng vì nó **không phụ thuộc trạng thái cửa
sổ**, trong khi UIA hiện không quan sát được gì.

UIA **không** bị loại vĩnh viễn: nếu PoC làm cửa sổ hiện ra, phải **đo lại** cây UIA và ghi kết quả mới. Nếu
khi đó UIA có nội dung, nó là ứng viên cho một PoC **thứ hai** (đọc trạng thái — điều URI scheme không làm
được, L1). Chưa đo thì `NOT_RUN`, không được suy đoán.

### B.6 Vì sao B vẫn hợp lệ dù hẹp

1. **Dùng API hệ điều hành công khai** — plan §9 nói rõ: "mô hình sử dụng giao diện OS công khai để điều
   khiển ứng dụng người dùng đã cài" là **một loại tích hợp khác** với việc gọi backend nội bộ.
2. **Không sửa gì** — không patch, không inject, không đọc secret, không replay session. Ranh giới plan §2.3
   sạch.
3. **Kiểm thử được** — đích đến ("đúng hội thoại hiện ra") là quan sát được bằng mắt và bằng ảnh chụp.
4. **Đúng tiêu chí quyết định của plan §12** — "một hành động Zalo thật có thể tái lập từ ứng dụng của
   chúng ta."

Nhưng: B **không tự động** làm A1–A4 mở. `AUTHORIZED` vẫn = 0. Trước khi phát hành thành sản phẩm phải
kiểm tra điều kiện sử dụng của Zalo cho đúng hành vi companion này (plan §9).

### B.7 Prerequisites chưa thoả — lý do R11B **chưa** bắt đầu

| # | Prerequisite | Trạng thái |
|---|---|---|
| P1 | Người dùng chỉ định hội thoại test có đồng ý | **Chưa có.** R11A không được tự chọn |
| P2 | Xác nhận môi trường (đã login, page MAIN) | Chưa kiểm trong phiên PoC |
| P3 | Đồng ý ghi bằng chứng + che nội dung | Chưa có |
| A3 | Tài khoản test sạch | **0/4** |
| A4 | Cô lập + rollback đã định nghĩa | **0/4** |

Plan §6.3 đòi "dữ liệu test do người dùng kiểm soát". R11A **không** được tự bịa số điện thoại hay tự mở
một hội thoại thật. R11B chỉ bắt đầu khi người dùng xác nhận P1–P3.

---

## 1. So sánh hai hướng

| Tiêu chí | A — Runtime-hosted | B — Companion |
|---|---|---|
| Cơ chế | Nhúng UI vào Zalo | Điều khiển Zalo từ ngoài |
| Bằng chứng tồn tại | **Không** (0 hook) | **Có** (registry + code path) |
| Sửa Zalo | Cần (patch) → cấm | **Không** |
| Đọc dữ liệu phiên | Cần | **Không** |
| Dùng secret | Có thể cần | **Không** |
| Hai chiều | Có thể | **Không** (L1) |
| Feature coverage | Toàn bộ nếu hoạt động | **Chỉ mở hội thoại** (L8) |
| Kiểm thử | Không (không có cơ chế) | **Có** (ảnh chụp + foreground) |
| Nhãn tối đa | — | `COMPANION_POC_PASS` |
| Kết luận | `NO_SUPPORTED_CANDIDATE_YET` | `CANDIDATE_FOUND` |

---

## 2. Những hướng **không** được đưa vào danh sách (và vì sao)

| Hướng | Vì sao loại |
|---|---|
| Named pipe `PipeZCallRecv/Send` | AES key trích từ `ZPC_SECRET_VALUES`; protocol nội bộ không tài liệu hoá → plan §2.4 #5, #6; §2.3 → `BLOCKED` |
| `ZaloCap.exe` | Screencap nội bộ, argv riêng tư, không có contract → `BLOCKED` |
| DevTools IPC (`devTools: true`) | Private IPC access, thủ công, không lập trình được → plan §2.3 → `BLOCKED` |
| `zfile://` | Dead code ở production (`isDev=false`) → không tồn tại lúc chạy |
| `--launch-compact-app` | Chỉ chọn một bundle first-party sẵn có; không nhận nội dung ngoài |
| Zalo Web customization | Không phải Zalo PC; quyền chưa xác định; ADR-001 giữ `NEEDS AUTHORIZATION` |
| `app.asar` patch / preload injection | ADR-001 `NO-GO`, giữ nguyên |

Đây là danh sách **đóng**: mọi đường khác đã bị loại bằng quan sát trong `R11V3_RUNTIME_BOUNDARY.md` §3–§8.

---

## 3. Việc tiếp theo — một hành động cụ thể

**Không** bắt đầu R11B tự động. Cần người dùng trả lời đúng một câu:

> Hội thoại test nào (số điện thoại hoặc username, do bạn kiểm soát) được dùng cho PoC `zalo://conversation/?phone=…`,
> và bạn có đồng ý ghi màn hình/log với nội dung được che không?

Khi có câu trả lời → chạy đúng B.3, lưu bằng chứng vào `reports/executed/`, viết
`reports/R11V3_RUNTIME_POC.md`, và gán đúng **một** nhãn: `COMPANION_POC_PASS`, `BLOCKED`, hoặc `NOT_RUN`.

Nếu không có câu trả lời: R11A đứng nguyên ở trạng thái này. Bản mock vẫn hoạt động; không có gì bị phá.
