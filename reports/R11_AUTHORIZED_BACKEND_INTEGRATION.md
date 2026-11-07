# R11 — Authorized Backend Integration

**Trạng thái:** **KHÔNG ĐẠT mục tiêu "kết nối Zalo thật". Số `LIVE_PASS` = 0.**
Phần hợp đồng (contract) đã hoàn thành và có bằng chứng chạy lại được.
**Ngày:** 2026-11-06 (Asia/Saigon) · **Phạm vi:** `D:\Zalo` · **Sản phẩm:** Glass Messenger Demo `0.3.0`

> **Câu trả lời thẳng cho câu hỏi trọng tâm của R11** — *"báo cáo rõ tính năng nào đã hoạt động
> với Zalo thật"* — là: **không tính năng nào.** Không có lời gọi nào rời khỏi máy này tới Zalo
> trong suốt R7 → R11. Cổng uỷ quyền A1–A4 vẫn **đóng 0/4**
> ([API_AUTHORIZATION_GAP](../docs/API_AUTHORIZATION_GAP.md)). Mọi kết quả "PASS" trong báo cáo
> này là `MOCK_PASS` hoặc `PASS (loopback)`; hai nhãn đó **không** phải `LIVE_PASS`.

---

## 1. Kết luận trong một khung

| Câu hỏi | Trả lời | Bằng chứng |
|---|---|---|
| Đã kết nối được Zalo thật chưa? | **Chưa. 0 tính năng.** | §5, §6 |
| Có mã nào gọi mạng tới Zalo không? | **Không.** 0 match trong toàn bộ `src/`. | §3.6 |
| Test "live" duy nhất chạy được là gì? | M2 — **server của chính repo** trên `127.0.0.1`, không phải Zalo. | §4.3, ADR-003 |
| Vì sao dừng? | A1 (quyền API) chưa xác định → A2/A3/A4 phụ thuộc A1. | §5 |
| Có phải chỉ thiếu giấy phép? | **Không.** F7 (gọi thoại) còn bị chặn ở **tầng kiến trúc** — không một bundle JS nào trong 116 tệp gọi capture thiết bị; media stack nằm ở binary native. | §7 |
| R11 để lại gì dùng được? | 3 lớp hợp đồng đã kiểm (M0/M1/M2), 89 unit + 26 E2E chạy xanh, ranh giới lớp bị test cưỡng chế. | §4, §3 |

**Nguyên tắc đã giữ:** `OBSERVED ≠ AUTHORIZED ≠ LIVE_PASS`, và `MOCK_PASS ≠ LIVE_PASS`
([Master Plan §10](../docs/ZALO_APPLE_GLASS_MASTER_PLAN_V2.md)). R11 **không** nâng bất kỳ trạng thái
nào chỉ vì mã đã tồn tại.

---

## 2. Ma trận ba chiều (Master Plan §10)

| Hạng mục | Evidence | Authorization | Testing |
|---|---|---|---|
| Hợp đồng `IZaloClient` (11 cổng) | `OBSERVED` | `AUTHORIZED` (là thiết kế của mình) | `MOCK_PASS` |
| Application Services (M1) | `OBSERVED` | `AUTHORIZED` | `MOCK_PASS` |
| `TransportPort` + loopback double (M2) | `OBSERVED` | `AUTHORIZED` | `MOCK_PASS` (loopback) |
| Adapter `authorized` (M3) | `UNKNOWN` | `BLOCKED` | `NOT_TESTED` |
| Sync + `secureChannel` (M4) | `UNKNOWN` | `BLOCKED` | `NOT_TESTED` |
| F1–F9 với Zalo thật | `OBSERVED` (hình dạng) | `BLOCKED` | `NOT_TESTED` |

Ba dòng đầu `AUTHORIZED` nghĩa là **được phép xây**, không phải **được phép nói chuyện với Zalo**.
Đó là lý do cột Testing của chúng dừng ở `MOCK_PASS`.

---

## 3. Năm cổng bằng chứng — chạy lại trong R11

Tất cả log nằm trong `reports/executed/`. Mỗi dòng dưới đây là kết quả **của lần chạy thật trong
phiên này**, không phải trích từ báo cáo cũ.

| # | Cổng | Lệnh | Exit | Log |
|---|---|---|---:|---|
| 3.1 | Typecheck renderer | `npx tsc --noEmit` | **0** | [`r11-typecheck.log`](executed/r11-typecheck.log) |
| 3.2 | Typecheck Electron | `npx tsc -p tsconfig.electron.json --noEmit` | **0** | [`r11-typecheck-electron.log`](executed/r11-typecheck-electron.log) |
| 3.3 | Lint | `npx eslint <glob của package.json>` | **0** | [`r11-lint.log`](executed/r11-lint.log) |
| 3.4 | Unit | `npm test` | **0** | [`r11-unit.log`](executed/r11-unit.log) |
| 3.5 | E2E | `npx playwright test` | **0** | [`r11-e2e.log`](executed/r11-e2e.log) |

### 3.1–3.3 Typecheck và lint

Hai lệnh `tsc` và `eslint` in ra **0 byte** khi thành công, nên log ghi rõ cả exit code lẫn
`STDOUT_BYTES=0` để người đọc phân biệt được "không có lỗi" với "không chạy gì". Một log rỗng
không kèm exit code là bằng chứng vô giá trị.

### 3.4 Unit — 89/89

```
ℹ tests 89   ℹ pass 89   ℹ fail 0   ℹ cancelled 0   ℹ skipped 0   ℹ todo 0
UNIT_EXIT=0
```

Census theo file, tổng khớp đúng 89:

| File | Test | Nội dung |
|---|---:|---|
| `tests/logic.test.cjs` | 7 | helper cũ (escape HTML, bỏ dấu, lọc, tên file an toàn) |
| `tests/core.test.ts` | 20 | state core: history, transfer, call, network, preferences |
| `tests/design-system.test.ts` | 21 | token ladder + **ranh giới lớp** (§4.4) |
| `tests/adapters.test.ts` | 17 | 11 cổng mock, kể cả "disabled port từ chối mọi method" |
| `tests/services.test.ts` | 8 | optimistic send, retry, khử echo, dispose |
| `tests/transport.test.ts` | 10 | loopback socket thật (§4.3) |
| `tests/composition.test.ts` | 6 | seam UI ↔ Services |

### 3.5 E2E — 26/26

```
26 passed (56.5s)
E2E_EXIT=0
```

| Spec | Số case | Ghi chú |
|---|---:|---|
| `accessibility.spec.ts` | 2 | axe WCAG 2.1 AA + contrast lấy mẫu, dark & light |
| `demo.spec.ts` | 21 | 18 workflow + 3 viewport (1920×1080, 1600×900, 1366×768) |
| `extended-qa.spec.ts` | 3 | contrast tại 4 biên kính × 2 theme + IME tiếng Việt |

Test `OS reduced motion and demo call screen; no external traffic`
(`tests/e2e/demo.spec.ts:177`) đăng ký listener cho **mọi** request và assert chỉ có
`http://127.0.0.1:4173/` — tức là **nếu** bản dựng gọi ra ngoài, case này đỏ. Nó xanh.

### 3.6 Không có primitive mạng nào trong `src/`

```
grep -rn "fetch(\|XMLHttpRequest\|WebSocket\|new EventSource\|https\?://" \
  src/adapters/ src/services/ src/transport/ src/composition/ src/renderer/
→ 0 matches
```

`src/transport/loopback.ts` là ngoại lệ duy nhất về mặt khái niệm — nó **có** `fetch`, nhưng qua
`deps.fetchImpl ?? fetch` và bị `assertLoopback()` chặn trước khi mở socket (§4.3). Nó không nằm
trong danh sách trên vì grep ở trên tìm literal `fetch(`, còn file này gọi `this.fetchImpl(...)`.
Danh sách host được phép là **bốn** giá trị, tất cả đều là loopback:

```ts
const isLoopback = host === '127.0.0.1' || host === '::1' || host === '[::1]' || host === 'localhost';
if (!isLoopback) throw new Error(`Từ chối host không phải loopback: ${host}`);
```

---

## 4. Những gì đã xây, và mỗi thứ được kiểm bằng gì

### 4.1 M0 — hợp đồng 11 cổng

`src/adapters/types.ts:307` khai báo `IZaloClient` với `mode: 'mock' | 'authorized'`, và doc comment
trên `mode` nói thẳng: `authorized` **chỉ** được dùng khi A1 và A2 đã mở.

`CapabilityState = 'mock' | 'unverified' | 'authorized' | 'unavailable'` — cố ý **không** có
`'ready'`. Một trạng thái tên `ready` sẽ bị đọc thành "đã sẵn sàng nói chuyện với Zalo"; bốn nhãn
hiện tại không cho phép cách đọc đó.

`calling` và `sync` có `capability: 'unavailable'` và mọi method trả `kind: 'unsupported'`
(`src/adapters/mock.ts:384`, `:391`). `tests/adapters.test.ts:128` kiểm đúng điều đó — chúng là
*unavailable*, **không** phải mock giả vờ chạy được.

### 4.2 M1 — Application Services

`src/services/messaging.ts` giữ outbox, optimistic state, retry có giới hạn và khử echo theo
`clientMessageId`. `tests/services.test.ts` có 8 case, trong đó ca quan trọng nhất là
*"a push echo with the same clientMessageId does not duplicate the bubble"* — đây là lỗi sẽ xuất
hiện thật khi có backend, nên nó được kiểm trước khi có backend.

### 4.3 M2 — loopback transport (test "live" duy nhất)

`tests/transport.test.ts` dựng một `node:http` server thật trên cổng loopback tạm, rồi chạy
transport thật lên đó: handshake, 401 → `unauthorized` (không retry), session rỗng bị từ chối
**trước khi** mở socket, connection-refused → `network` retryable, SSE frame thật, backoff rồi
thành công, cạn retry, disconnect phát đúng một event, và signal đã abort từ trước cho `cancelled`
mà không mở socket.

**Peer của phép thử này là server của chính repo.** Vì vậy nhãn đúng là `PASS (loopback)`, không
phải `PASS (live)`. Lý do và các phương án bị loại ghi ở
[ADR-003](../docs/ADR-003-loopback-transport.md).

### 4.4 Ranh giới lớp được cưỡng chế bằng test, không bằng quy ước

`tests/design-system.test.ts:15` resolve **đường dẫn thật** của mỗi import tương đối rồi mới so
ranh giới — vì so chuỗi specifier sẽ bỏ lọt `../../services/...` từ một file sâu trong
`src/renderer/components/`. Test `:44` kiểm thêm: chỉ **một** file được import cả adapter lẫn
service, và file đó phải là `src/composition/ui-bridge.ts`.

Tính không-vacuity đã được chứng minh: tạo tạm `src/renderer/store/__violation.ts` import
`src/services/messaging.ts` thì test báo đúng một vi phạm
(`src/renderer/store/__violation.ts:1 -> src/services/messaging.ts`); xoá file thì xanh lại. Một
test ranh giới không từng đỏ là một test chưa được chứng minh.

---

## 5. Vì sao `LIVE_PASS` = 0

`docs/API_AUTHORIZATION_GAP.md` định nghĩa bốn cổng phải mở **theo thứ tự**. Trạng thái hiện tại:

| Cổng | Câu hỏi | Trạng thái |
|---|---|---|
| **A1** | Zalo/VNG có cấp quyền dùng API cho client bên thứ ba? | **CHƯA XÁC ĐỊNH** |
| **A2** | Phạm vi được cấp là gì? | **CHẶN BỞI A1** |
| **A3** | Có tài khoản kiểm thử hợp lệ? | **CHƯA CÓ** |
| **A4** | Cô lập & rollback được định nghĩa? | **CHƯA ĐỊNH NGHĨA** |

**Số cổng mở: 0/4.** A2, A3 và A4 đều không thể tiến trong khi A1 chưa có câu trả lời, vì không
ai biết phạm vi nào cần tài khoản thử, hay cần cô lập cái gì, nếu chưa biết được cấp API nào.

Bốn việc bị cấm trong khi cổng đóng, và R11 không làm việc nào trong số đó:

| Bị cấm | R11 đã làm? |
|---|---|
| Gọi bất kỳ endpoint Zalo nào, kể cả "chỉ một lần để xem" | **Không** |
| Đăng nhập bằng tài khoản thật hay tài khoản thử | **Không** |
| Nhúng host/domain/tham số giao thức vào mã nguồn | **Không** (§3.6) |
| Dựng khung kết nối "để đó, chưa bật" | **Không** — không có nhánh mã `authorized` nào chờ sẵn |

---

## 6. Chín tính năng R7 với Zalo thật

Nguồn: [`R7_PROTOCOL_AND_FEATURE_MAP.md`](R7_PROTOCOL_AND_FEATURE_MAP.md) §2. Cột `R11` là những
gì R11 **thay đổi** được so với R7.

| # | Tính năng | Hình dạng (R7) | Quyền | R11 | Vì sao không nhúc nhích |
|---|---|---|---|---|---|
| F1 | Đăng nhập | `OBSERVED` | `BLOCKED` | `NOT_TESTED` | A1 + A3 đóng |
| F2 | Danh bạ | `OBSERVED` | `BLOCKED` | `NOT_TESTED` | A1 đóng |
| F3 | Hội thoại | `OBSERVED` | `BLOCKED` | `NOT_TESTED` | A1 đóng |
| F4 | Gửi/nhận tin | `OBSERVED` | `BLOCKED` | `NOT_TESTED` | A1 đóng; thêm E2EE (R7 §12) |
| F5 | Gửi/nhận file | `OBSERVED` | `BLOCKED` | `NOT_TESTED` | A1 đóng; thêm E2EE |
| F6 | Chat nhóm | `OBSERVED` | `BLOCKED` | `NOT_TESTED` | A1 đóng; thêm E2EE |
| F7 | Gọi thoại/video | `OBSERVED — tắt mặc định` | `BLOCKED` | `NOT_TESTED` | **A1 + chặn kiến trúc** (§7) |
| F8 | Đồng bộ | `OBSERVED` | `BLOCKED` | `NOT_TESTED` | A1 đóng; rủi ro mất tin cao nhất |
| F9 | Thông báo | `OBSERVED` | `BLOCKED` | `NOT_TESTED` | A1 đóng; hiển thị ở main process |

**Tổng: 0/9 `LIVE_PASS`.** R11 không mở thêm tính năng nào so với R7 — điều đó là **đúng**, vì
không có cổng nào mở. Một R11 mở được tính năng trong điều kiện 0/4 cổng sẽ là dấu hiệu một giới
hạn đã bị vượt.

Bản demo **có** UI cho phần lớn các màn này (gọi thoại, đính kèm, nhóm, thông báo), nhưng chúng chạy
trên `demoAdapter` và tự nhãn là demo: overlay nói *"Không kết nối Zalo"*
(`src/renderer/components/Overlays/index.tsx`, kiểm bởi `tests/design-system.test.ts:265`). UI tồn
tại **không** phải bằng chứng backend.

---

## 7. F7 — bằng chứng chặn ở tầng kiến trúc

Đây là phát hiện có sức nặng nhất mà R11 xác nhận lại được, và nó khác về **loại** so với tám tính
năng còn lại: F7 không chỉ thiếu giấy phép, nó thiếu **mã**.

R6 chỉ quét **một** bundle (`pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js`). Một khẳng định vắng
mặt dựa trên 1 tệp là đúng loại over-reach mà dự án này cấm, nên R11 quét lại **toàn bộ** 116 tệp
`.js` trong thư mục đã giải nén và phân loại từng hit theo ngữ cảnh:

| Quan sát | Giá trị | Nguồn |
|---|---|---|
| Bundle `.js` đã quét | **116 / 116** | [`_r11_f7_media_sweep.txt`](_r11_f7_media_sweep.txt) |
| `getUserMedia` (đếm token) | **7**, tất cả trong **cùng một** định nghĩa shim Emscripten của `pc-dist/libs/libsignal-protocol.static.js` | `_r11_f7_media_sweep.txt`, [`_r11_f7_media_context.txt`](_r11_f7_media_context.txt) |
| Lời gọi capture thật (`navigator.mediaDevices`, `mediaDevices.getUserMedia`, `enumerateDevices`, `srcObject`) | **0** | `_r11_f7_media_context.txt` |
| `getDisplayMedia` | **0** | `_r11_f7_media_sweep.txt` |
| `RTCPeerConnection` | **24** hit, nhưng chỉ **một** hàm `getLocalIP()` lặp lại ở 4 bundle | `_r11_f7_media_context.txt` |
| `iceServers` trong các site đó | `[]` | `_r6_rtc.txt` |
| `RTCRtpSender` / `MediaStream` | **0 / 0** | `_r11_f7_media_sweep.txt` |
| `call-send-to-native` trong renderer | **NOT IN RENDERER** | `_r6_rtc.txt` |
| `call-init` trong renderer | **NOT IN RENDERER** | `_r6_rtc.txt` |
| `call-server-request` trong renderer | **NOT IN RENDERER** | `_r6_rtc.txt` |
| `call_active_native_app` trong renderer | **NOT IN RENDERER** | `_r6_rtc.txt` |
| `enableCall` / `enableVideoCall` (default config) | **`false` / `false`** | R7 §9.3 |

Hai dòng cần giải thích, vì đếm token thô sẽ đọc sai:

- **7 hit `getUserMedia` không phải call site.** Cả 7 nằm trong một khối duy nhất của
  `libsignal-protocol.static.js` — runtime Emscripten đi kèm thư viện mã hoá:
  `getUserMedia:function(e){window.getUserMedia||(window.getUserMedia=navigator.getUserMedia||navigator.mozGetUserMedia),window.getUserMedia(e)}`
  và `Module.getUserMedia=function(){Browser.getUserMedia()}`. Kiểm bằng
  [`verify-f7-emscripten-calls.cjs`](../tools/verify-f7-emscripten-calls.cjs) trên cả 116 tệp:
  **2** token dạng định nghĩa, **1** tự tham chiếu nằm *bên trong* thân shim (nó gán
  `window.getUserMedia = navigator.getUserMedia` rồi gọi lại chính biến đó), và **0** lời gọi từ mã
  gọi. Đây là shim cũ (`navigator.getUserMedia` đã bị gỡ khỏi Chromium), nằm lại trong thư viện
  vendored — **định nghĩa, không phải sử dụng**.
- **24 hit `RTCPeerConnection` vẫn là đúng một hàm.** Bốn bundle (`compact-app-pc`,
  `lazy/default-login-main-startup-shared-worker-znotification`, `search-worker`,
  `sync-v2-sub-worker`) nhúng cùng một bản `getLocalIP()`; 6 hit/bundle × 4 = 24. Vẫn là kỹ thuật
  lấy IP LAN, không phải đường truyền media.

Đoạn mã tĩnh quan sát được của `RTCPeerConnection` (rút gọn, giữ nguyên literal):

```js
static getLocalIP(e){ if(this.isWeb()) try{
  window.RTCPeerConnection = window.RTCPeerConnection || ... ;
  let t = new RTCPeerConnection({iceServers: []}), n = () => {};
  t.createDataChannel(""); t.createOffer(t.setLocalDescription.bind(t), n);
  t.onicecandidate = a => { /* regex lấy IPv4/IPv6 nội bộ */ };
} catch(t){ ... e("") } ...
```

`iceServers: []` + `createDataChannel("")` + đọc candidate để lấy IP **nội bộ** = kỹ thuật lấy địa
chỉ LAN, **không** phải đường truyền media. Toàn bộ 24 hit là cùng một hàm, lặp theo bundle.

**Xác nhận bằng hệ thống tệp.** Ba binary native có mặt trong thư mục cài đặt:

```
plugins\capture\ZaloCall.exe    19,588,136 B
plugins\capture\ZaviMeet.exe    19,822,120 B
plugins\capture\ZaloCap.exe      5,488,240 B
```

Kích thước `ZaviMeet.exe` ngang cỡ `ZaloCall.exe` gợi ý một tiến trình độc lập chứ không phải thư
viện nhúng — đó là **`INFERRED`** từ tên và kích thước, chưa đọc phần đầu PE hay import table.

Kết luận `OBSERVED` chỉ dựa trên những gì đã đo, và phạm vi đo giờ là **toàn bộ** 116 bundle chứ
không phải một tệp: trong toàn bộ JavaScript mà Zalo PC 26.10.20.3253 đóng gói, **không có một lời
gọi capture thiết bị nào** (0 `navigator.mediaDevices`, 0 `mediaDevices.getUserMedia`, 0
`enumerateDevices`, 0 `srcObject`, 0 `RTCRtpSender`, và 0 lời gọi vào shim `getUserMedia`), và bốn
kênh call-native đều `NOT IN RENDERER`.
Nó nằm ở đâu **chính xác** bên trong các binary native là `UNKNOWN` — R11 không mở các file đó.

Lưu ý phạm vi: kết luận này nói về **JavaScript đã đóng gói trong `app.asar`**. Nó *không* phủ định
việc media được xử lý ở tầng native (ba binary `plugins\capture\*.exe` là ứng viên rõ ràng), và nó
*không* chứng minh Zalo không gọi được — chỉ chứng minh rằng **không có đường nào để một client
Electron tái dùng** lớp đó qua hợp đồng renderer.

**Kết luận F7:** một client Electron thuần **không thể** tái dựng tính năng gọi điện chỉ từ hợp
đồng renderer. Nếu về sau có quyền signaling, phía media vẫn phải là WebRTC **dựng mới** — tương
thích ở phía báo hiệu, **không** tương thích với thiết bị Zalo thật ở phía media. Ghi ở
[R7 §9.5](R7_PROTOCOL_AND_FEATURE_MAP.md).

---

## 8. Các bề mặt tích hợp đã khảo sát và bị loại

R11 rà lại bốn đường có thể trở thành "lối vào" hợp lệ. Cả bốn đều bị loại bằng quan sát, không
bằng suy đoán.

### 8.1 Deep link `zalo://` — một chiều

```js
.on("check-arg-link", (() => {
  b.zsymb(4,"8UmKcW",["check arg link","xXrK2t"],Ae),
  Ae && Ae.startsWith(`zalo://${f.getCurrentApiDomain()}`)
    && (Ce.webContents.send("z-uri-request", Ae), Ae = null)
}))
```

([`_r5_census9.txt:24`](_r5_census9.txt)) Main process **nhận** argument rồi **chuyển vào trong**.
`z-uri-open-conv` nằm trong danh sách **subscribe** channel. Không có đường nào đi ra. Đây là cửa
vào, không phải cửa ra.

### 8.2 Native helper `ZaloCall.exe` / `ZaloCap.exe`

[`ZALO_ARCH_RECON.md`](ZALO_ARCH_RECON.md) kết luận: *"native helper components, not an extension
point."* Chúng là tiến trình con của `Zalo.exe` (PID 23444 và 34072, cha PID 18220), không expose
giao diện cho bên thứ ba.

### 8.3 Local socket / IPC server nội bộ

```
grep "net\.|node:net|createServer|net.connect|socket.io" reports/_r5_census*.txt reports/_r6_*.txt
→ chỉ 2 match
```

Hai match đều là `r.net.request(...)` của Electron — **HTTP client đi ra**, tức là chính cơ chế
mà 0/4 cổng đang chặn, không phải một server nội bộ trung gian. **Không có local socket nào để
"đi nhờ".** Đây là phát hiện phủ định, và nó đáng ghi: nếu tồn tại một UNIX socket/named pipe nội
bộ, đó sẽ là bề mặt tích hợp khác về bản chất.

> **Annotation R11A (2026-11-06) — bổ sung, không sửa kết luận trên.**
>
> Câu "không có local socket nào" **đúng cho mục đích đi nhờ**, nhưng **sai nếu đọc như một phát biểu
> tồn tại**: R11A tìm thấy **hai** named pipe nội bộ đang sống —
> `\\.\pipe\PipeZCallRecv` và `\\.\pipe\PipeZCallSend` — do chính main process tạo bằng
> `net.createServer()` (module `"3Zc2"`, logger `call-v2`) và truyền đường dẫn cho
> `plugins\capture\ZaloCall.exe` qua argv (process con PID 23444 quan sát được).
>
> Nguồn của grep cũ chỉ quét `reports/_r5_census*.txt` / `_r6_*.txt` — các bản trích xuất **không phải**
> toàn bộ `main-dist/main.js`, nên bỏ sót. R11A quét đủ 116/116 tệp `.js` và mở từng hit.
>
> **Nhưng chúng không dùng được, và không phải vì "khó":** payload là `JSON.stringify` → mã hoá AES
> bằng `zsecureSecrets().getCallV2TransportAesKey()` (giá trị lấy từ `ZPC_SECRET_VALUES`) → ghi
> `payload + "$"`; phía nhận tách theo `$`, giải mã, bỏ NUL, rồi `JSON.parse`. Dùng pipe = **trích xuất
> khoá mã hoá nhúng trong app** + **nói một giao thức nội bộ không được tài liệu hoá/chấp thuận**.
>
> Vi phạm trực tiếp plan V3 §2.4 #5 ("không trích xuất khoá") và #6 ("không gọi endpoint nội bộ chưa
> được cấp quyền"), và §2.3 ("private IPC access"). Trạng thái: **`BLOCKED`**, không phải `NOT_RUN`.
>
> Chi tiết đầy đủ: [`R11V3_RUNTIME_BOUNDARY.md`](R11V3_RUNTIME_BOUNDARY.md) §8;
> phân loại: [`R11V3_INTEGRATION_OPTIONS.md`](R11V3_INTEGRATION_OPTIONS.md) §2.

### 8.4 `app.asar` / plugin / theme hook

G4 và [ZALO_THEME_FEASIBILITY.md](ZALO_THEME_FEASIBILITY.md) đã khảo sát. Không có hook
theme/plugin/CSS nào được expose. G5 vẫn **NO-GO**; P3 **NOT STARTED**.

**Hệ quả:** ADR-001 giữ nguyên hiệu lực. Không có đường nào trong bốn đường trên biến một endpoint
quan sát được thành một API được phép dùng.

---

## 9. Hiệu chỉnh tài liệu trong R11

Sửa những chỗ tài liệu đã lệch so với thực tế đo được. Mỗi số mới đều lấy từ lần chạy trong §3,
không lấy từ trí nhớ.

| File | Trước | Sau | Cơ sở |
|---|---|---|---|
| `docs/GLASS_DESIGN_SYSTEM.md:12` | `62 unit test` | `89 unit test` | `r11-unit.log` |
| `docs/CUSTOM_CLIENT_ARCHITECTURE.md:257` | `tests/services.test.ts` **(11 test)** | **(8 test)** | lần chạy riêng file: `tests 8 / pass 8` |
| `README.md:5` | `62/62 Node tests` | `89/89 Node tests` | `r11-unit.log` |
| `README.md:37` | `npm test: 62 tests` | `89 tests` + liệt kê bộ mới | `r11-unit.log` |
| `docs/ARCHITECTURE.md:35` | `62/62 tests` | `89/89 tests` | `r11-unit.log` |
| `docs/ADR-002-desktop-security.md:36` | `62/62 tests` | giữ `62/62` + chú thích *"R10-era count; the R11 tree has 89"* | ADR-002 là hồ sơ lịch sử của lần chạy trên cây R10 — sửa số sẽ làm sai bản ghi đó |

Thêm mới: `docs/ADR-003-loopback-transport.md` (đóng tham chiếu treo ở `src/transport/loopback.ts:9`),
nối vào `CUSTOM_CLIENT_ARCHITECTURE.md` §8 và §11, và thêm dòng R11 vào bảng gate của
`docs/ARCHITECTURE.md`.

`docs/CUSTOM_CLIENT_ARCHITECTURE.md:258` ghi M2 là `10 test` — đã đối chiếu, đúng.

Hai dòng sửa thêm trong cùng lượt này, phát sinh từ §7 (không phải từ lỗi đếm test):
`reports/R7_PROTOCOL_AND_FEATURE_MAP.md` §9.3 được giữ nguyên như bản ghi R7 và thêm một khối
trích dẫn ghi kết quả quét lại 116 tệp; `docs/CUSTOM_CLIENT_ARCHITECTURE.md:104` (quyết định
`calling` = `unavailable`) được viết lại để nêu đúng phạm vi — "0 lời gọi capture thật" thay cho
"0 `getUserMedia`", vì con số token thô là 7.

---

## 10. Điều kiện mở khoá — chính xác cái gì còn thiếu

Không có mục nào dưới đây là việc kỹ thuật có thể tự làm trong repo này.

**A1 — câu trả lời của VNG.** Văn bản nêu rõ: API nào, cho ai, phạm vi nào, thời hạn nào. Cho tới
khi có, không endpoint Zalo nào được gọi — kể cả để đọc schema.

**A2 — phạm vi.** Suy ra từ A1. Không có A1 thì không có A2.

**A3 — tài khoản kiểm thử.** Một tài khoản được phép dùng để test, do bên cấp quyền chỉ định.

**A4 — cô lập & rollback.** Định nghĩa được: test chạy ở đâu, hỏng thì hoàn nguyên thế nào, ai chịu
trách nhiệm dữ liệu phát sinh.

**Riêng F7, cần thêm:** hợp đồng media. Ngay cả khi A1–A4 mở, phía media vẫn phải dựng WebRTC mới;
tương thích với thiết bị Zalo thật chỉ có thể ở phía signaling, và điều đó chưa được chứng minh.

---

## 11. Việc độc lập vẫn làm được (không cần cổng nào)

Theo `API_AUTHORIZATION_GAP.md` §5. Đây là những gì một vòng R sau có thể tiến mà không chạm tới
cổng:

1. Hoàn thiện UI glass trên `demoAdapter` — không liên quan Zalo.
2. Mở rộng `IZaloClient` nếu một workflow UI cần cổng mới — vẫn là thiết kế của mình.
3. Viết thêm test cho `MessagingService` trên mock: thứ tự áp dụng, race, dispose giữa retry.
4. Mở rộng loopback double: thêm frame type, timeout, kịch bản server chậm — miễn peer vẫn là máy mình.
5. Viết **contract test** cho M3 *trước* khi M3 tồn tại, miễn chúng chạy trên mock và không giả
   định host nào.
6. Giữ xanh năm cổng của §3 sau mỗi thay đổi.

Việc **không** làm được cho tới khi A1 mở: bất kỳ dòng nào gọi ra ngoài, bất kỳ host/domain nào
trong mã, bất kỳ adapter `authorized` nào — kể cả "để đó chưa bật".

---

## 12. Giới hạn của báo cáo này

- **Không** chứng minh Zalo hoạt động thế nào ở runtime. Mọi kết luận về Zalo là đọc byte tĩnh do
  REA trích xuất, hoặc là metadata hệ thống tệp.
- **Không** đưa ra kết luận pháp lý. A1 là câu hỏi về quyền, không phải về khả năng kỹ thuật.
- **Không** đo hiệu năng, độ bền hay trải nghiệm trên dữ liệu thật — chưa có dữ liệu thật nào được
  dùng.
- `PASS (loopback)` **chỉ** nói rằng server của repo trả lời client của repo. Nó không nói gì về Zalo.
- Các con số R7 (471 endpoint, 43 lệnh WS, 233 ánh xạ commandId) là của bản `26.10.20` đã đo; một
  bản Zalo mới có thể khác và **không** làm thay đổi kết luận quyền.
- **Một khuyết điểm phương pháp của R6 đã được phát hiện và sửa trong R11.** `reports/_r6_rtc.cjs`
  quét **một** bundle, trong khi thư mục giải nén có **116** tệp `.js`. Kết luận của R6 vẫn đúng,
  nhưng nó được rút ra từ 1/116 mẫu. Đây đúng là loại lỗi mà quy tắc "đừng bao giờ nâng trạng thái
  vì mã tồn tại" nhắm tới, chỉ khác chiều: một khẳng định **vắng mặt** cũng cần phủ đủ. Script cũ
  vẫn giữ nguyên làm bản ghi lịch sử; R11 thêm `tools/verify-f7-media.cjs` (đếm toàn bộ) và
  `tools/verify-f7-rtc-context.cjs` (phân loại từng hit là định nghĩa hay lời gọi) — vì đếm token
  thô một mình **sẽ** dẫn tới kết luận sai: nếu chỉ nhìn con số, `getUserMedia = 7` trông như Zalo
  có capture, trong khi cả 7 là shim Emscripten chết trong một thư viện vendored.

---

## Phụ lục — chỉ mục bằng chứng

| Bằng chứng | Đường dẫn |
|---|---|
| Log cổng R11 | `reports/executed/r11-{typecheck,typecheck-electron,lint,unit,e2e,check}.log` |
| Hợp đồng 11 cổng | `src/adapters/types.ts:307` |
| Mock adapter | `src/adapters/mock.ts` — `calling`/`sync` unavailable ở `:384`, `:391` |
| Application Services | `src/services/messaging.ts`, `tests/services.test.ts` |
| Loopback transport | `src/transport/loopback.ts`, `tests/transport.test.ts`, `docs/ADR-003-loopback-transport.md` |
| Seam composition | `src/composition/ui-bridge.ts` |
| Ranh giới lớp | `tests/design-system.test.ts:15`, `:44` |
| CSP production | `index.html:9` — `connect-src 'none'` |
| Cổng quyền | `docs/API_AUTHORIZATION_GAP.md` — 0/4 |
| Ma trận 9 tính năng | `reports/R7_PROTOCOL_AND_FEATURE_MAP.md` §2 |
| Chi tiết F7 | `reports/R7_PROTOCOL_AND_FEATURE_MAP.md` §9, `reports/_r6_rtc.txt` |
| Quét F7 toàn bộ bundle | `reports/_r11_f7_media_sweep.txt` (116 tệp, đếm token), `reports/_r11_f7_media_context.txt` (ngữ cảnh `RTCPeerConnection`), `reports/_r11_f7_emscripten_calls.txt` (định nghĩa vs lời gọi) — tái lập bằng `node tools/verify-f7-media.cjs <root>`, `node tools/verify-f7-rtc-context.cjs <root>`, `node tools/verify-f7-emscripten-calls.cjs <root>` |
| Deep link một chiều | `reports/_r5_census9.txt:24` |
| Native helper | `reports/ZALO_ARCH_RECON.md` |
| Chiến lược tích hợp | `docs/ADR-001-integration-strategy.md` — NO-GO cho P3 |
