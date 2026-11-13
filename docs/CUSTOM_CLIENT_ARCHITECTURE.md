# Kiến trúc client Zalo độc lập (R8)

> Archived (2026-11-12): this mock/adapter design was superseded by the live-only Electron IPC client. It is not a description of current source.

**Trạng thái:** HOÀN THÀNH phần **thiết kế hợp đồng** (types + ranh giới + lộ trình).
**Chưa có mã mạng.** Adapter duy nhất được dựng là **mock offline**.
**Ngày:** 2026-11-06
**Cơ sở:** [R6 — kiến trúc & hợp đồng backend](../reports/R6_CLIENT_ARCHITECTURE.md) ·
[R7 — ma trận 9 tính năng](../reports/R7_PROTOCOL_AND_FEATURE_MAP.md)
**Cổng quyền:** [`API_AUTHORIZATION_GAP.md`](API_AUTHORIZATION_GAP.md) — hiện **chưa có cổng nào mở**.

> Tài liệu này mô tả **thiết kế của chúng ta**. Nó không mô tả cách đăng nhập vào Zalo, không chứa
> endpoint, host, khóa hay credential, và không tuyên bố tương thích runtime với Zalo. Bản dựng được
> phép trong repo là **mock adapter**. Không có dòng nào trong tài liệu này là hướng dẫn kết nối.

---

## 1. Mục tiêu và phạm vi

R8 trả lời một câu hỏi duy nhất: **nếu** về sau có quyền sử dụng hợp lệ, thì client mới phải được
chia tầng thế nào để phần UI và phần nghiệp vụ không bao giờ phải biết giao thức?

R8 **không** trả lời: cách gọi API Zalo, cách xác thực, cách giải mã payload. Ba câu hỏi đó nằm sau
cổng quyền và không thể trả lời bằng static analysis (R6 §6.3).

**Ràng buộc kế thừa từ R6 §7:** Zalo PC gốc **không có kiến trúc phân tầng** — nó là một khối
renderer 20.9 MB gộp UI + nghiệp vụ + transport + persistence. Vì vậy R8 **không** sao chép cấu trúc
của Zalo; nó dựng kiến trúc phân tầng mà Zalo không có.

---

## 2. Bốn lớp

```text
┌───────────────────────────────────────────────────────────────────────┐
│ 1. React UI                      src/renderer/**                      │
│    • render, nhập liệu, accessibility, glass design system            │
│    • KHÔNG biết endpoint · KHÔNG gọi mạng · KHÔNG giữ session          │
└──────────────────────────────┬────────────────────────────────────────┘
                               │ typed hooks + events
┌──────────────────────────────▼────────────────────────────────────────┐
│ 2. Application Services          src/services/**       (M1, mock)     │
│    • use case: gửi tin, mở hội thoại, tải tệp, đồng bộ                │
│    • sở hữu: optimistic state, hàng đợi gửi, retry, chính sách cache  │
└──────────────────────────────┬────────────────────────────────────────┘
                               │ IZaloClient  (src/adapters/types.ts)
                               │ lắp ráp tại src/composition/ui-bridge.ts
┌──────────────────────────────▼────────────────────────────────────────┐
│ 3. IZaloClient Adapter           src/adapters/**                      │
│    • ánh xạ use case → lời gọi port                                   │
│    • MOCK adapter (đang dùng)  │  AUTHORIZED adapter (chưa được phép) │
└──────────────────────────────┬────────────────────────────────────────┘
                               │ TransportPort
┌──────────────────────────────▼────────────────────────────────────────┐
│ 4. Authorized Transport          (chưa triển khai)                    │
│    • HTTP + kênh push, phiên, reconnect, nhiều domain                 │
│    • CHỈ tồn tại sau khi cổng A1 + A2 của tài liệu quyền đã mở        │
└──────────────────────────────┬────────────────────────────────────────┘
                               ▼
                         Zalo Backend
```

**Vì sao bốn lớp chứ không phải hai:** R6 §4 cho thấy trong Zalo gốc, lớp UI và lớp mạng nằm chung
một bundle; điểm nối duy nhất (`preload`) lại là lớp OS-capability, **không** phải lớp giao thức.
Nếu client mới lặp lại cấu trúc đó, nó sẽ thừa hưởng đúng khuyết điểm khiến R5 thất bại. Bốn lớp
buộc mọi lời gọi mạng phải đi qua một interface duy nhất, và interface đó là thứ duy nhất cần thay
khi trạng thái quyền thay đổi.

---

## 3. Ranh giới cứng giữa các tầng

| Tầng | Được phép | Bị cấm | Cách thực thi |
|---|---|---|---|
| **1. React UI** | Đọc state đã chuẩn hoá; phát intent | Import `src/adapters/**` hoặc `src/services/**`; giữ token; biết host | Test giải đường dẫn import, `tests/design-system.test.ts` (xem §9) |
| **2. Services** | Gọi `IZaloClient`; giữ optimistic state | Tự tạo request HTTP; đọc `localStorage` làm nguồn sự thật | Chỉ nhận `IZaloClient` qua tham số khởi tạo |
| **3. Adapter** | Dịch domain model ↔ port; kiểm tra `ClientResult` | Chứa UI; giữ credential lâu hơn phiên | Không import từ `src/renderer/**` |
| **4. Transport** | HTTP, push, reconnect, domain rotation | Quyết định nghiệp vụ; retry vô hạn | Chỉ nhận `SessionHandle` từ adapter |

**Quy tắc một chiều:** tầng trên không bao giờ import tầng dưới; tầng dưới chỉ trả dữ liệu đã đóng
gói qua kiểu của tầng trên. Kiểu đó nằm ở `src/adapters/types.ts` và **không** chứa kiểu UI.

---

## 4. Hợp đồng `IZaloClient` — 11 cổng

Mỗi cổng tương ứng một vùng chức năng đo được ở R6 §5 / R7 §2. Cột **Khả năng** lấy nguyên trạng
thái từ R7 — không nâng cấp nhãn nào.

| Cổng | R7 | Module Zalo quan sát được (R6 §5) | Khả năng v1 |
|---|---|---|---|
| `auth` | F1 | `/api/login/*` 24, `/api/register/*` 7, `/api/enterprise/*` 3 | `mock` |
| `contacts` | F2 | `/api/friend/*` 24, `/api/social/*` 40, `/api/alias/*` 4 | `mock` |
| `conversations` | F3 | `/api/conv/*` 8, `/api/convlabel/*` 6, `/api/pinconvers/*` 3 | `mock` |
| `messaging` | F4 | `/api/message/*` 69 | `mock` |
| `media` | F5 | `/cloudmedia/*` 11, `/api/mediastore/*` 3 | `mock` |
| `groups` | F6 | `/api/group/*` 81, `/api/board/*` 30, `/api/poll/*` 6 | `mock` |
| `calling` | F7 | `/api/voicecall/*` 29 — **renderer Zalo không có media stack** | `unavailable` |
| `sync` | F8 | `SYNC_MESSAGE`, `BACKUP_MSG`, `CLOUD` | `unavailable` |
| `notifications` | F9 | `$znoti` 9 method / 6 channel — phát bởi **main process** | `mock` (main-side) |
| `secureChannel` | F4/F5/F6/F8 | `/api/e2ee/*` 31, 9 bảng `e2ee_*`, Signal Protocol | `unavailable` |
| `transport` | — | handshake, keepalive, domain rotation | `mock` (in-process) |

**Ba quyết định cần giải thích:**

1. **`calling` là `unavailable`, không phải `mock`.** R7 §9 chứng minh renderer Zalo **không** chứa
   lời gọi capture thiết bị nào; `RTCPeerConnection` chỉ dùng cho `getLocalIP()` với
   `iceServers: []`. R11 đo lại trên **toàn bộ 116 bundle** (R6 chỉ quét một tệp): 7 hit
   `getUserMedia` đều là định nghĩa shim Emscripten trong `libsignal-protocol.static.js`, **0** lời
   gọi thật (`navigator.mediaDevices`/`enumerateDevices`/`srcObject`), và 24 hit
   `RTCPeerConnection` vẫn là *một* hàm `getLocalIP()` lặp trong 4 bundle. Không có gì để mô hình
   hoá trung thực bằng mock — dựng mock sẽ tạo ấn tượng sai rằng tính năng đã sẵn sàng.

2. **`secureChannel` là cổng riêng, không phải cờ trên `messaging`.** R7 §12.1: E2EE là subsystem
   độc lập. Là cổng riêng, nó buộc tầng Services phải quyết định rõ ràng khi một hội thoại yêu cầu
   mã hoá mà kênh an toàn chưa sẵn sàng — thay vì âm thầm gửi dạng rõ.

3. **`transport` là cổng thứ 11.** Handshake, keepalive và chuyển domain là cross-cutting: chúng
   ảnh hưởng mọi cổng còn lại nhưng không thuộc cổng nào. R6 §10 gọi đây là "cổng thứ 8" theo cách
   đếm 7 module chức năng ở §5; bảng trên đếm đủ 9 tính năng R7 cộng `secureChannel` và `transport`.

### 4.1 Ba kiểu nền

```ts
type ClientResult<T> = { ok: true; value: T } | { ok: false; error: ClientError }
```

Mọi phương thức trả `ClientResult`, **không** trả `T` trần và **không** ném lỗi mạng. Lý do:
R7 §12.2 — Zalo trả **HTTP 200 cho cả lỗi ứng dụng** (`error_code !== 0` nằm trong body). Một API
trả `Promise<T>` sẽ khiến tầng trên hiểu nhầm mọi phản hồi là thành công. `ClientError.kind` tách
`'application'` khỏi `'network'` để Services xử lý khác nhau.

```ts
type Unsubscribe = () => void
```

Mọi đăng ký sự kiện trả hàm huỷ. Không có `removeListener` theo tên — nó dễ rò rỉ và khó suy luận.

```ts
type CapabilityState = 'mock' | 'unverified' | 'authorized' | 'unavailable'
```

`unverified` nghĩa là **hình dạng đã biết nhưng quyền chưa có**; `authorized` chỉ được gán khi tài
liệu quyền chứng minh được. Không có giá trị `'ready'` — "ready" là kết luận cần kiểm thử runtime,
không phải trạng thái thiết kế.

---

## 5. Luồng dữ liệu

### 5.1 Gửi tin nhắn văn bản

```text
UI: người dùng nhấn gửi
  → Services.sendText(conversationId, text)
      • tạo clientMessageId (idempotency)
      • chèn bong bóng optimistic, trạng thái 'sending'
  → IZaloClient.messaging.send({ conversationId, text, clientMessageId })
  → Adapter: kiểm tra capability; nếu không phải 'mock'|'authorized' → ok:false, kind:'unsupported'
  → Transport: gửi qua kênh đã cấp quyền
  ← ClientResult<SendAck>
  → Services: ok → đổi trạng thái 'sent', thay id tạm bằng id thật
              !ok → 'failed' + retry theo chính sách, KHÔNG xoá bong bóng
```

**Đã nối vào Glass UI (2026-11-06).** `src/composition/ui-bridge.ts` dựng `MessagingService` trên
`MockZaloClient` và là nơi **duy nhất** import cả hai tầng. `useDemoStore` gọi bridge, giữ bảng
`clientMessageId → { chatId, messageId số, epoch }`, và chỉ đổi trạng thái bong bóng khi Services
phát `upsert` — không còn bộ hẹn giờ nào tự báo "sent". Trạng thái `failed`/`sent` của bong bóng
đến từ outbox thật; kết nối lại chỉ giải phóng những tin outbox đã có kết quả cuối.

**Echo trùng lặp:** kênh push có thể trả lại chính tin vừa gửi (R6 §4.3 — `PUSH_MSG_1_1:501`).
Services khử trùng theo `clientMessageId` trước khi thêm vào danh sách; nếu không, tin sẽ hiện hai lần.

### 5.2 Nhận tin qua push

```text
Transport nhận sự kiện
  → Adapter chuẩn hoá thành domain event
  → Services: khử trùng → cập nhật hội thoại → đánh dấu chưa đọc
  → UI: re-render qua store
```

**Giới hạn đã biết:** ngữ nghĩa `data` của push là **UNKNOWN** (R6 §6.3). Adapter v1 định nghĩa
`Message` (qua `onIncoming` / `onStatus`) theo *nhu cầu của UI*, không theo schema Zalo — vì chưa có
schema. Khi có quyền và
có kiểm thử runtime, đây là nơi phải sửa đầu tiên.

### 5.3 Đăng nhập

```text
UI → Services.signIn(method) → auth.*
  ← ClientResult<SessionState>
Services KHÔNG giữ token; Adapter giữ SessionHandle và chuyển cho Transport
```

Token không bao giờ đi vào React state, không vào `localStorage`, không vào log.

### 5.4 Tải tệp

```text
Services.upload(file) → media.createUpload(...) → media.putChunk(...) → media.complete(...)
```

Ba bước tách rời vì R6 §4 / R7 §7 cho thấy luồng thật có tạo URL, chia chunk, rồi hoàn tất. Gộp
thành một hàm sẽ che mất chỗ có thể hỏng giữa luồng. Giới hạn kích thước là **tham số cấu hình**,
không phải hằng số nhúng — R7 §7 ghi nhận các giá trị mặc định của Zalo, nhưng chúng là dữ liệu của
server và có thể đổi.

### 5.5 Đồng bộ

```text
Services.sync(signal) → sync.pull(cursor) → ClientResult<SyncPage>
```

**Chưa dựng trong v1.** R7 §10 xếp F8 là rủi ro cao nhất: sai thứ tự áp dụng có thể làm mất tin trên
thiết bị thật. Cổng `sync` tồn tại trong type để chỗ nối nằm đúng chỗ, nhưng trạng thái là
`unavailable` và mọi lời gọi trả `kind:'unsupported'`.

---

## 6. Quyền sở hữu state

| State | Chủ sở hữu | Bền vững ở đâu | Ghi chú |
|---|---|---|---|
| Bong bóng đang gửi, hàng đợi | Services | bộ nhớ | mất khi đóng app là chấp nhận được |
| Danh sách hội thoại, tin nhắn | Services | cache cục bộ | cache là **bản sao**, server là nguồn sự thật |
| Session handle | Adapter | keychain của OS (khi có quyền) | không bao giờ ở renderer |
| Tùy chọn UI (theme, ngôn ngữ) | UI store | `localStorage` | dữ liệu của chúng ta, không phải của Zalo |
| Cursor đồng bộ | Services | cache cục bộ | phải khôi phục được sau crash |

**Nguyên tắc:** bất cứ thứ gì lấy từ server đều là **bản sao có thể bị từ chối**; UI phải render
được khi cache rỗng hoặc cũ. R6 §3.5 cho thấy Zalo gốc dùng 88 bảng và 3 schema; R8 **không** sao
chép schema đó.

---

## 7. Những gì adapter **không** chứa

Đây là phần quan trọng nhất của R8, vì nó là phần giữ dự án trong ranh giới hợp pháp.

| Không có | Lý do |
|---|---|
| Host, domain, endpoint path | Thuộc tầng Transport, và chỉ sau khi có quyền |
| `zpw_ver` / `zpw_type` / tham số chung | Chi tiết giao thức nội bộ, không phải hợp đồng của chúng ta |
| Khóa mã hoá, `_cipherKey`, `zpw_enk` | R6 §8 — không ghi credential |
| Cookie, token, viewerkey | R6 §8 |
| Cách dựng `params` / `enk` | Không cần cho thiết kế; và R6 §6.3 xác định key do server cấp |
| Bảng DB của Zalo | Persistence của chúng ta là của chúng ta |
| Logic E2EE | `secureChannel` là **port**, không phải implementation |

`TransportPort` nhận một `SessionHandle` mờ đục do Adapter tạo. Bản thân nó không biết cách tạo ra
handle đó — đó là việc của adapter `authorized`, và adapter đó chỉ tồn tại sau cổng A1+A2.

---

## 8. Lộ trình

| Mốc | Nội dung | Điều kiện vào | Trạng thái |
|---|---|---|---|
| **M0** | `IZaloClient` types + mock adapter | — | **PASS (mock)** — `src/adapters/mock.ts`, `tests/adapters.test.ts` |
| **M1** | Application Services trên mock; test đơn vị cho optimistic send / khử trùng | M0 | **PASS (mock)** — `src/services/messaging.ts`, `tests/services.test.ts` (8 test) |
| **M2** | `TransportPort` + test double **do mình kiểm soát** (loopback nội bộ, không phải Zalo) — [ADR-003](ADR-003-loopback-transport.md) | M1 | **PASS (loopback)** — `src/transport/loopback.ts`, `tests/transport.test.ts` (10 test) |
| **M3** | Adapter `authorized` | **Cổng A1 + A2 mở** | **chặn** |
| **M4** | Sync + `secureChannel` | M3 + kiểm thử runtime có kiểm soát | **chặn** |
| **—** | `calling` | ngoài phạm vi v1 | **không làm** |

M0 và M1 **không** phụ thuộc cổng quyền và có thể làm ngay. M2 cũng vậy, miễn test double chỉ nói
chuyện với máy của chính mình.

---

## 9. Kiểm thử

| Cấp | Kiểm gì | Công cụ |
|---|---|---|
| Đơn vị | Adapter dịch đúng; `ClientResult` phân loại đúng | `node:test` — `tests/adapters.test.ts` |
| Hợp đồng | Mọi cổng có cùng shape lỗi; `Unsubscribe` idempotent | `node:test` — `tests/adapters.test.ts` |
| Tích hợp | Services trên mock: optimistic send, retry, khử trùng echo | `node:test` — `tests/services.test.ts` |
| Lắp ráp | Composition root nối Services với adapter, pha gửi/nhận, reset | `node:test` — `tests/composition.test.ts` |
| UI | Luồng gửi/nhận trên mock | `tests/e2e/demo.spec.ts` — 26 ca |
| Ranh giới | `src/renderer/**` không import `src/adapters/**` hay `src/services/**`; chỉ một file lắp ráp | `tests/design-system.test.ts` — test giải đường dẫn |

**Ghi chú về hàng cuối:** ranh giới được **thực thi bằng máy** trong `tests/design-system.test.ts`,
không phải bằng ESLint. `no-restricted-imports` chỉ so chuỗi specifier nên đã báo 4 vi phạm giả
(`../../adapters/types.ts` trong `src/renderer/components/` giải ra `src/renderer/adapters/`); một
luật báo sai sẽ bị tắt, nên test giải đường dẫn đã giải là lựa chọn đúng — xem
`docs/GLASS_DESIGN_SYSTEM.md` §1. Test thứ hai khẳng định đúng **một** file
(`src/composition/ui-bridge.ts`) được import cả adapter lẫn service.

**Trùng tên cần biết:** renderer hiện có `src/renderer/adapters/types.ts` + `demo.ts` — hợp đồng của
bản demo offline cũ (`DemoAdapter`, `Chat`, `Filter`). Đây **không phải** `IZaloClient`. Cả hai file
đều tên `types.ts`; đường dẫn mới `src/adapters/**` tách biệt về thư mục nhưng dễ đọc nhầm trong
import. Khi dựng Services ở M1, mọi import phải chỉ đích danh `src/adapters/types.ts`.

### 9.1 Trạng thái kiểm chứng (2026-11-06)

| Tiêu chí §5.7 | Kết quả | Bằng chứng |
|---|---|---|
| TypeScript compile | **PASS** | `npm run typecheck` → exit 0 |
| Mock triển khai đúng contract | **PASS** | `implements IZaloClient`; test cuối kiểm 11 cổng |
| Happy + failure path mỗi cổng mock | **PASS** | `tests/adapters.test.ts` — 15 test |
| Renderer không truy cập Node trực tiếp | **PASS** | không `node:*` / `electron` trong `src/renderer/**` |
| IPC typed + validation | **PASS (phạm vi hẹp)** | `window:action` kiểm sender + frame + document + allowlist 3 hành động |
| Mock mode không phát request | **PASS** | `src/adapters/**` không có `fetch`/`XMLHttpRequest`/URL/socket |

Tổng bộ kiểm thử repo (2026-11-06, sau khi nối M1 vào UI): `npm test` → **89/89 pass**;
`npm run typecheck` → exit 0; `npm run lint` → exit 0; `npx playwright test` → **26/26 pass**.

**Giới hạn:** "IPC typed + validation" ở trên chỉ nói về IPC **cửa sổ** hiện có. Chưa có IPC nào mang
`IZaloClient`; đó là việc của M2/M3 và bị chặn bởi cổng A1+A2. Không được đọc hàng này là "IPC của
adapter đã xong".

### 9.2 Chỗ cố ý lệch khỏi §5.5 của master plan

§5.5 liệt kê "call states" và "sync scenarios" trong phạm vi mock. Bản dựng này **không** mock hai
thứ đó, và đây là chủ ý — không phải thiếu sót:

| §5.5 yêu cầu | Đã làm | Vì sao |
|---|---|---|
| fake login, conversations, contacts | có | — |
| message send | có (`messaging.send`) | — |
| message receive | có (`simulateIncoming`) | — |
| attachment progress | có (`media.putChunk` + progress event) | — |
| notifications | có | — |
| simulated errors | có (`failNextSend`, `disabled`, abort) | — |
| reconnect | có (`simulateDisconnect` + `transport.connect`) | — |
| **call states** | **không** | R7 §9: renderer Zalo không có media stack. Mock trạng thái cuộc gọi sẽ tạo ấn tượng sai rằng tính năng sẵn sàng. `calling` giữ `unavailable`. |
| **sync scenarios** | **không** | R7 §10: sai thứ tự đồng bộ có thể **mất tin** trên thiết bị thật. Mock một đồng bộ sai rất dễ bị hiểu là "đã kiểm chứng". `sync` giữ `unavailable`. |

Hai dòng cuối là ngoại lệ có ghi chép, không phải khoảng trống im lặng. Nếu chủ dự án muốn mock cả
hai để dựng UI, đó là quyết định riêng cần nêu rõ — mặc định là không.

---

## 10. Ngoài phạm vi

- Không tương thích byte-level với Zalo. Không tuyên bố "100% Zalo".
- Không đọc, sửa, patch hay inject vào `Zalo.exe` / `app.asar`.
- Không trích xuất credential, session token, khóa mã hoá.
- Không vượt qua xác thực, phân quyền server, hay cơ chế bảo vệ.
- Không sao chép bundle Zalo vào repo này.
- Không dùng dự án client Zalo bên thứ ba.

---

## 11. Liên kết

| Tài liệu | Nội dung |
|---|---|
| [R6_CLIENT_ARCHITECTURE.md](../reports/R6_CLIENT_ARCHITECTURE.md) | Ranh giới quan sát được, hợp đồng giao thức, 7 module |
| [R7_PROTOCOL_AND_FEATURE_MAP.md](../reports/R7_PROTOCOL_AND_FEATURE_MAP.md) | 9 tính năng, 0 PASS, ba ràng buộc xuyên tính năng |
| [API_AUTHORIZATION_GAP.md](API_AUTHORIZATION_GAP.md) | Khoảng trống quyền sử dụng và các cổng |
| [ADR-001-integration-strategy.md](ADR-001-integration-strategy.md) | Quyết định không tích hợp vào app gốc |
| [ADR-003-loopback-transport.md](ADR-003-loopback-transport.md) | Vì sao M2 chỉ nói chuyện với loopback của chính mình |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Kiến trúc bản demo offline hiện tại |
| [`src/adapters/types.ts`](../src/adapters/types.ts) | Hợp đồng TypeScript của 11 cổng |
