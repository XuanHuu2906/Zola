# ZALO APPLE GLASS — MASTER PLAN V3 (RUNTIME-FIRST)

> **Workspace:** `D:\Zalo`  
> **Nền tảng mục tiêu:** Windows Desktop  
> **UI stack giữ nguyên:** Electron + React + TypeScript + Vite + Tailwind CSS v4 + Zustand + Motion  
> **Reverse Engineering:** REA là công cụ RE duy nhất của dự án  
> **Thay đổi chiến lược:** Ưu tiên **tận dụng ứng dụng/runtime Zalo chính thức** thay vì tự viết lại toàn bộ giao thức Zalo.  
> **Trạng thái tại thời điểm lập plan:** R6–R10 hoàn thành theo báo cáo Agent; R11 chưa có tích hợp backend thật; A1–A4 vẫn 0/4; `LIVE_PASS = 0`.

---

## 1. Mục tiêu sản phẩm — không đổi

Xây dựng **Zalo Apple Glass**: ứng dụng Windows có giao diện Apple Liquid Glass tự thiết kế và hướng đến dùng **tài khoản Zalo thật** cho các tác vụ hằng ngày: đăng nhập, danh bạ, hội thoại, gửi/nhận tin nhắn, ảnh/tệp, nhóm, thông báo, đồng bộ và gọi thoại/video.

**Điều thay đổi:** Không bắt buộc tái triển khai từ đầu `Authentication → Messaging → Sync → Media → Calling`. Ưu tiên xem liệu có thể **tái sử dụng thành phần chạy của Zalo chính thức** qua một ranh giới tích hợp phù hợp hay không. UI riêng và business/UI logic của chúng ta vẫn được giữ nguyên.

**Điều chưa được chứng minh:** Olaz công bố giao diện native, đăng nhập QR và tự tải Zalo (~340 MB) khi chạy lần đầu. Đây là thông tin mô tả sản phẩm mà người dùng cung cấp, **không phải bằng chứng về cách Olaz kết nối nội bộ**. Không suy diễn rằng có thể nhúng `app.asar`, dùng native module hay bắt chước cơ chế của Olaz chỉ từ mô tả đó.

### 1.1. Tiêu chí thành công cuối cùng

- App mang giao diện Apple Glass riêng, điều hướng và thao tác mượt trên Windows.
- Có **một luồng thật chạy qua Zalo** được đo bằng phép thử đầu-cuối, không phải mock; sau đó mở rộng theo bằng chứng.
- Giao diện và data layer không phải làm lại từ đầu khi đổi tích hợp.
- Thông báo trung thực chức năng nào thật sự hoạt động; không gọi `MOCK_PASS` là `LIVE_PASS`.
- Nếu chỉ có thể điều khiển cửa sổ Zalo gốc, phải ghi rõ đó là **Companion Mode** chứ không phải full native runtime-hosted client.

---

## 2. Quyết định kiến trúc: chuyển sang Runtime-first

### 2.1. Hướng cũ — không còn là ưu tiên R11

```text
Apple Glass UI → Application Services → IZaloClient → Custom Protocol Adapter → Zalo Backend
```

Hướng cũ yêu cầu tự xử lý phần lớn authentication, transport, sync, media, cuộc gọi. Không xóa code/contract đã tạo: chúng vẫn là một ranh giới abstraction hữu ích và là fallback phát triển UI.

### 2.2. Hướng mới — mục tiêu cần PoC

```text
┌────────────────────────────────────────────┐
│ Apple Glass UI (React / Electron Renderer)│
└──────────────────────┬─────────────────────┘
                       │
               Application Services
                       │
                 IZaloClient ports
                       │
              Runtime Bridge Adapter
                       │
           Supported Integration Boundary
                       │
      Official Zalo Installation / Runtime
                       │
                 Zalo Backend
```

`Supported Integration Boundary` là **giả thuyết cần xác minh**, không phải một API đang tồn tại. Không tự động coi các IPC, hàm JavaScript hoặc endpoint nội bộ quan sát qua REA là giao diện được phép dùng.

### 2.3. Hai phương án kỹ thuật cần phân biệt

| Phương án | Ý tưởng | Lợi thế | Giới hạn |
|---|---|---|---|
| **A — Runtime-hosted** (ưu tiên khảo sát) | UI riêng sử dụng thành phần runtime chính thức **nếu** có phương thức khởi chạy/tích hợp được hỗ trợ, tương thích và được phép | Có cơ hội giữ tính năng của Zalo gốc | Chưa chứng minh có bridge, có thể phụ thuộc phiên bản và điều kiện phân phối |
| **B — Companion/OS integration** (phương án phụ) | UI riêng điều khiển/quan sát một số thao tác qua khả năng Windows công khai như UI Automation/accessibility | PoC thực tế không cần tự viết giao thức | Dễ vỡ khi UI thay đổi; khó đạt giao diện client hoàn chỉnh, thường vẫn cần cửa sổ Zalo gốc |

Không triển khai cơ chế truy cập IPC riêng, injected hooks, patch binary, chiếm quyền phiên, tái sử dụng cookie/token hoặc gọi endpoint chưa được cấp quyền để biến giả thuyết thành "đã chạy".

### 2.4. Ràng buộc giữ nguyên / thay đổi

**Thay đổi có chủ đích:** Cho phép kiến trúc **phụ thuộc vào Zalo chính thức đã cài** hoặc bản runtime được tải từ nguồn chính thức theo điều kiện sử dụng phù hợp. Không còn bắt buộc Zalo Apple Glass phải độc lập hoàn toàn về runtime.

**Giữ nguyên:**

1. Không sửa hay phá hỏng cài đặt Zalo gốc; thao tác phân tích trên bản sao kiểm soát được nếu cần.
2. REA là công cụ reverse-engineering duy nhất; công cụ build, test, kiểm thử UI hay kiểm tra checksum không bị coi là công cụ RE thứ hai.
3. Không lấy mã, bundle hoặc implementation của Olaz/client bên thứ ba.
4. Không đóng gói/phân phối lại binary hoặc bundle Zalo khi chưa có quyền thích hợp; việc tải thành phần chính thức không tự tạo quyền sử dụng/chia sẻ.
5. Không trích xuất, tiết lộ, ghi log hay chuyển tiếp credential, cookie, token, khóa mã hóa hoặc tin nhắn cá nhân.
6. Không bỏ qua xác thực, server authorization hoặc cơ chế bảo vệ.
7. Không mở cổng A1–A4 chỉ bằng bằng chứng REA. **Khả thi về kỹ thuật ≠ được phép tích hợp.**
8. Không xoá/sửa lịch sử các báo cáo R6–R10; tạo tài liệu bổ sung khi thay đổi chiến lược.
9. Không lặp lại CSS injection hoặc patch `app.asar` trong bản chính thức.

---

## 3. Đường cơ sở — những gì đã hoàn thành

**Giữ nguyên kết quả do Agent báo cáo, chưa được kiểm chứng độc lập trong tài liệu này:**

- R6–R8: phân tích kiến trúc, feature map, 11 cổng/port `IZaloClient` và kiến trúc độc lập.
- R9–R10: Apple Glass UI, Application Services, mock workflows, build Windows.
- R10: `8/8` workflow MOCK_PASS; packaging/smoke/soak và hash artifact đã có bằng chứng theo báo cáo; không claim live.
- Lần kiểm gần nhất do người dùng báo cáo: `npm run check` exit 0; 89/89 tests; Playwright 26/26.
- REA F7: quét 116/116 JS files trong phạm vi đã nêu; không phát hiện lời gọi capture thật trong tập JS đó. **Không suy ra phần native hoặc toàn bộ Zalo không có calling.**
- Authorization: A1–A4 = **0/4**; `LIVE_PASS = 0`.

**Không bắt đầu lại R6–R10. Không thêm mock không phục vụ PoC.**

---

## 4. Roadmap V3

| Milestone | Nhiệm vụ | Điều kiện kết thúc |
|---|---|---|
| **R11A — Runtime Boundary Audit** | Dùng REA xác định ranh giới UI / core / native / process / lifecycle của Zalo Windows | Bản đồ bằng chứng, 1–2 giả thuyết bridge kiểm chứng được, không lập lại nghiên cứu tổng quát |
| **R11B — One Real-Action PoC** | Chọn đường tích hợp hợp lệ; thử một thao tác người dùng thật với Zalo gốc trong môi trường kiểm soát | Có video/log/bằng chứng đầu-cuối **hoặc** kết luận blocker cụ thể của nhánh đã thử |
| **R11C — Bridge + UI Integration** | Chỉ khi R11B đạt: xây `RuntimeBridgeAdapter` tương thích 11 ports, kết nối Apple Glass UI | Một workflow live thật đi qua UI mới, có regression và rollback |
| **R11D — Feature Parity** | Mở rộng theo từng feature được chứng minh (messages → contacts → file/group/sync/notifications → calling) | Ma trận feature có trạng thái riêng, không tuyên bố hỗ trợ chung chung |
| **R12 — Windows Hardening & Delivery** | Security, release lineage, installer/portable, accessibility/IME/DPI, signing | Report test thật, các mục NOT RUN/UNSIGNED được giữ nguyên cho tới khi xử lý |

**Gate cứng:** Không chuyển toàn bộ ứng dụng sang bridge mới nếu R11B chưa chứng minh ít nhất một tích hợp thực tế. Phải bảo tồn chế độ mock và build chạy được trong suốt quá trình chuyển đổi.

---

## 5. R11A — Runtime Boundary Audit (điểm bắt đầu ngay)

### Mục tiêu

Trả lời trong phạm vi bằng chứng: **Zalo chính thức có ranh giới tích hợp nào mà UI riêng có thể sử dụng ổn định và phù hợp điều kiện truy cập hay không?**

### Việc Agent phải thực hiện

1. Đọc bằng chứng R6–R11 và danh sách artefact trước; không quét lại toàn bộ dự án theo token count nếu không có câu hỏi mới.
2. Kiểm kê thành phần **Zalo Windows**, phiên bản, cây process, module native, file giao diện, cơ chế gọi/nhận event và vòng đời khởi động bằng REA và quan sát hợp lệ.
3. Phân tách các đường đi: Renderer ↔ Preload ↔ Main ↔ native/runtime ↔ network; xác định nơi đặt login, sync, media và call signaling.
4. Kiểm chứng giả thuyết rằng một runtime chính thức có thể chạy cùng giao diện ngoài, thay vì mặc định “đã có thể host”.
5. Đối chiếu với quyết định F7: không có capture trong JS không đồng nghĩa với thiếu media native; ghi rõ phạm vi.
6. Đánh giá từng ranh giới: công khai/được hỗ trợ, private/unstable, cần bí mật phiên, yêu cầu sửa binary, quyền phân phối, khả năng kiểm thử.
7. Không log dữ liệu cá nhân; mọi ảnh chụp/bản ghi phải dùng tài khoản hoặc hội thoại test có đồng thuận và che nội dung nhạy cảm.

### Sản phẩm

- `reports/R11V3_RUNTIME_BOUNDARY.md`
- `reports/R11V3_INTEGRATION_OPTIONS.md`
- `docs/ADR_RUNTIME_FIRST.md`

### Exit criteria

Một trong hai:
- `CANDIDATE_FOUND`: Có giao diện tích hợp phù hợp cùng cách thử cụ thể; chuyển R11B.
- `NO_SUPPORTED_CANDIDATE_YET`: Ghi đúng bằng chứng và blocker; không chế tạo adapter giả định. Có thể xét phương án B/Companion riêng biệt.

---

## 6. R11B — PoC bắt buộc: một thao tác thật trước, báo cáo sau

**Chỉ chọn một vertical slice nhỏ; không bắt đầu bằng voice/video.**

### PoC đề xuất

1. Khởi chạy hoặc kết nối tới **Zalo chính thức trong phiên người dùng của chính mình** bằng cơ chế được hỗ trợ, không chỉnh sửa ứng dụng.
2. Xác nhận có thể nhìn thấy trạng thái hội thoại test do người dùng kiểm soát qua ranh giới được phép.
3. Thực hiện thao tác đơn giản và kiểm chứng được (ví dụ mở hội thoại test; nếu cơ chế cho phép, gửi một tin nhắn thử tới chính mình hoặc người nhận đồng ý).
4. Đối chiếu trạng thái hiển thị trong Zalo gốc và app Apple Glass; ghi lỗi/timeout/khôi phục.
5. Ghi nguồn/runtime version, cách tích hợp, test command, exit code, bằng chứng đã làm sạch, hậu quả nếu Zalo gốc tắt hoặc được cập nhật.

### Định nghĩa kết quả

- `RUNTIME_POC_PASS`: PoC thực sự đi qua Zalo gốc qua cơ chế phù hợp; có bằng chứng kiểm thử. **Chưa đồng nghĩa tất cả features live pass.**
- `COMPANION_POC_PASS`: Chỉ điều khiển được UI Zalo qua OS automation. Tách biệt khỏi runtime-hosted app.
- `BLOCKED`: Không có đường tích hợp phù hợp; ghi rõ missing prerequisite.
- `NOT_RUN`: Chưa thực thi; không được chuyển thành PASS.

Không gọi `LIVE_PASS` cho một thao tác chỉ là mô phỏng, hay cho một cơ chế chưa được xác minh quyền sử dụng.

### Sản phẩm

- `poc/runtime-bridge/` (nếu có PoC hợp lệ)
- `reports/R11V3_RUNTIME_POC.md`
- `reports/executed/` bằng chứng lệnh và artefact đã làm sạch

---

## 7. R11C — Chuyển đổi kiến trúc sau khi PoC đạt

**Chỉ làm khi R11B đủ bằng chứng.**

### Giữ nguyên

- Apple Glass UI, theme, motion và screen hiện tại.
- Application Services và core model.
- `IZaloClient` với 11 ports, `ClientResult<T>` / async contract hiện có nếu phù hợp.
- Mock Adapter và test regression; giữ `MOCK_PASS` riêng.
- Bảo mật Electron: context isolation, sandbox, typed IPC, sender/frame/document/allowlist validation.

### Thay đổi

- Bổ sung `IRuntimeBridge` và `RuntimeBridgeAdapter` dưới ranh giới application service/adapter, không import implement vào Renderer.
- Tách `RuntimeCapabilities` để UI chỉ bật chức năng được chứng minh hỗ trợ; calling có thể giữ `unavailable`.
- Xử lý startup/shutdown runtime, version detection, lỗi khi runtime không sẵn, reconnect và upgrade incompatibility.
- Nếu bridge cần IPC giữa Electron Main và Preload, phải tạo IPC typed, validate sender + payload; IPC `window:action` hiện có không đồng nghĩa đã có IPC `IZaloClient`.
- Nếu phụ thuộc Zalo gốc cài trên máy, app phải hiển thị phụ thuộc này và hướng dẫn cụ thể; không giả vờ app là client hoàn toàn standalone.

### Sản phẩm (cấu trúc dự kiến; kiểm tra repo trước khi tạo)

```text
src/
  adapters/
    types.ts                 # 11 ports hiện có
    mock/                    # giữ
    runtime-bridge/          # chỉ tạo sau PoC
  application/               # giữ
  renderer/                  # UI Apple Glass, không import adapter impl
  runtime/                   # runtime lifecycle, capability contracts nếu cần
electron/
  main/
  preload/
docs/
  ADR_RUNTIME_FIRST.md
reports/
  R11V3_*.md
```

### Exit criteria

Một thao tác **thật** được khởi tạo từ Apple Glass UI, được quan sát ở Zalo, kiểm chứng lại sau app restart, có test và failure handling. Không đòi full parity để đánh dấu milestone một tính năng đã đạt.

---

## 8. R11D — Feature parity: triển khai theo capability

| Thứ tự | Nhóm chức năng | Điều cần chứng minh |
|---|---|---|
| 1 | Runtime lifecycle + session visibility | Zalo gốc xử lý phiên; app không sao chép token; trạng thái chính xác |
| 2 | Conversations + Messaging | Mở/đọc được trạng thái cho phép, thao tác gửi/nhận với dữ liệu test, lỗi được xử lý |
| 3 | Contacts + Groups | Danh sách và hành động có cơ chế hỗ trợ, phân biệt nhóm/nhãn |
| 4 | Files + Media | Tải lên/xuống, preview, permission file, giới hạn kích thước |
| 5 | Sync + Notifications | Đồng bộ trạng thái, duplicate/out-of-order handling, notification routing |
| 6 | Voice/Video | Xác nhận native media boundary, camera/mic, signaling và hỗ trợ bridge; không tự gắn PASS vì F7 quét JS |

Mỗi feature có bảng: `EVIDENCE`, `TECHNICAL_FEASIBILITY`, `AUTHORIZATION`, `MOCK_TEST`, `RUNTIME_TEST`, `LIVE_TEST`, `UNKNOWN/BLOCKED`. Có thể một feature chỉ khả thi ở Companion Mode; phải ghi rõ.

---

## 9. A1–A4 và quyền dùng Zalo: giữ nguyên hệ thống gate

Thay đổi sang runtime-first **không tự mở A1–A4**. Nếu mô hình sử dụng giao diện OS công khai để điều khiển ứng dụng người dùng đã cài, ghi nhận đó là một loại tích hợp khác với việc tự gọi backend nội bộ; nhưng vẫn phải kiểm tra điều kiện sử dụng, cấp quyền và dữ liệu người dùng. Mọi tích hợp private/không được phép tiếp tục bị chặn.

Phân tách status:

- `OBSERVED`: phát hiện kỹ thuật có bằng chứng.
- `INFERRED`: suy luận chưa kiểm chứng.
- `MOCK_PASS`: chạy thành công trên mock.
- `RUNTIME_POC_PASS`: thử thành công thông qua Zalo gốc, đúng phạm vi PoC.
- `COMPANION_POC_PASS`: chỉ hoạt động qua UI Automation/OS integration.
- `AUTHORIZED`: quyền tích hợp liên quan đã được chứng minh.
- `LIVE_PASS`: chức năng backend thật đã kiểm thử thành công qua phương thức được phép.
- `BLOCKED` / `NOT_RUN`: ghi đúng điều kiện.

**Không thêm nút cấu hình “enable real adapter” như lối tắt vượt qua gate.**

---

## 10. R12 — Packaging & Windows Hardening (sau/đồng thời nhánh độc lập)

- Kiểm thử Windows thật: titlebar kéo bằng chuột, IME Telex/VNI, screen reader có tiếng, nhiều màn hình và DPI thật — không tự đánh dấu PASS từ simulated tests.
- Kiểm tra cài đặt và nâng cấp Zalo gốc không làm mất dữ liệu, không phá app Apple Glass.
- Kiểm tra lifecycle: Zalo không cài / không chạy / bị update / phiên đăng xuất / app Apple Glass crash.
- Có thể phát hành app như một **companion phụ thuộc Zalo** nếu đúng thiết kế; nói rõ yêu cầu cài Zalo.
- Tự động tải thành phần Zalo chỉ khi nguồn tải, quyền và cơ chế sử dụng được xác minh; không phát tán lại bundle tùy tiện.
- Build có stdout/stderr, exit code thực tế, SHA-256, manifest, ASAR parity, smoke trên **đúng file EXE**.
- `UNSIGNED` nếu chưa code signing; không tuyên bố release fully ready.

---

## 11. Lệnh triển khai giao OpenCode / Claude Code

> Có thể sao chép toàn bộ phần dưới làm prompt nhiệm vụ. Giữ nguyên phạm vi; tránh biến R11 thành nghiên cứu không điểm kết thúc.

```text
TASK: ZALO APPLE GLASS — R11-V3 RUNTIME-FIRST PIVOT
Workspace: D:\Zalo

MISSION
Switch R11 from building a new Zalo network protocol client to evaluating and,
only where supported and authorized, integrating the official Zalo runtime
with our existing Apple Glass UI.

BASELINE
- Preserve R6–R10 artifacts and tests.
- R10: MOCK_PASS, not LIVE_PASS.
- A1–A4: 0/4. LIVE_PASS: 0.
- Current UI: Electron + React + TypeScript + Tailwind v4 + Zustand + Motion.
- REA is the sole reverse-engineering tool.
- Keep the existing IZaloClient 11-port abstraction.
- Use the user's Olaz description only as motivation, not as proof of Olaz internals.

NOW EXECUTE R11A
1. Read existing R6–R11 evidence; do not repeat completed audits.
2. Using REA on the official Zalo Windows installation, determine UI/runtime/native
   boundaries, process lifecycle, and candidate supported integration surfaces.
3. Separate OBSERVED from INFERRED, and technical interfaces from authorized ones.
4. Do not patch/inject the official app, copy its bundles into our product,
   capture secrets, bypass auth, replay sessions, or call unauthorized internal APIs.
5. Choose at most two concrete integration candidates, including a Windows OS
   integration/Companion option only if appropriate. Document their limitations.
6. For each candidate define ONE minimal, safe real-action PoC and acceptance test.
7. Produce:
   - reports/R11V3_RUNTIME_BOUNDARY.md
   - reports/R11V3_INTEGRATION_OPTIONS.md
   - docs/ADR_RUNTIME_FIRST.md

THEN R11B (ONLY IF A VALID CANDIDATE EXISTS)
- Implement the smallest supported proof of concept.
- Test against the actual unmodified Zalo installation with user-controlled test data.
- Capture sanitized evidence, test command, exit code, result and rollback.
- Distinguish RUNTIME_POC_PASS from COMPANION_POC_PASS, MOCK_PASS and LIVE_PASS.
- If blocked, report the exact unmet prerequisite; do not fabricate a bridge.

DO NOT YET
- Rewrite all application services.
- Throw away mock adapter or old reports.
- Claim full native functionality based on Olaz marketing.
- Begin voice/video before a smaller integration proof.
- Implement an unauthorized private transport.

STOP/GO RULE
Only start R11C bridge-to-UI integration after R11B produces a verified PoC.
R11D feature parity comes after that. Keep R12 security/release work separate.

FINAL REPORT
List changes, evidence, exact tests, proof of real operation, limitations,
A1–A4 status, and one concrete next action. No unverified PASS claims.
```

---

## 12. Quy tắc dừng và quyết định cuối

R11 không được kéo dài vô hạn bằng cách viết thêm báo cáo tổng quát. Sau R11A, chọn tối đa **hai** hướng có cơ sở để PoC. Sau R11B:

- **Runtime-hosted PoC đạt:** Chuyển sang R11C, giữ UI Apple Glass và thay adapter.
- **Chỉ Companion PoC đạt:** Đánh giá rõ hạn chế; không tuyên bố đã có client native đầy đủ.
- **Không có phương thức phù hợp:** Ghi blocker và giữ bản mock hoạt động, không tự ý khai thác API nội bộ.

**Tiêu chí quyết định là một hành động Zalo thật có thể tái lập từ ứng dụng của chúng ta, không phải số lượng module đã quét.**
