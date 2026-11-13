# Đối chiếu `docs/zalo-ui-plan-v2.md` với mã nguồn hiện tại

Date: 2026-11-08. Đối tượng: plan v2 (§1–§12). Phương pháp: đọc mã, chạy các cổng
kiểm thử, và chạy app thật trên Fedora 45. Không có lần gọi server Zalo nào trong
quá trình đối chiếu này.

**Cách đọc:** mỗi mục ghi *trạng thái* theo đúng ba mức plan §2 dùng cho
`zca-capabilities.md` — `CÓ`, `KHÔNG`, `CHƯA THỬ` — cộng thêm `CÓ NHƯNG CHƯA NỐI`
cho trường hợp code tồn tại mà không có đường gọi tới. Không dùng chữ "xong" cho
bất cứ thứ gì cần một phiên Zalo thật.

---

## 1. Bảng tổng

| Giai đoạn | Trạng thái | Bằng chứng |
| --- | --- | --- |
| 0. Chuẩn bị | **XONG** | Node 24 trên Fedora ([LINUX_PORT](LINUX_PORT.md)); tài khoản Zalo phụ **đã xác nhận 2026-11-08** (QR + phiên lưu) |
| 1. Spike giao thức | **PASS MỘT PHẦN** | Login QR + khôi phục phiên + socket `connected` có bằng chứng trên đĩa; **nhận/gửi tin chưa có bằng chứng** — [R12](R12_PHASE5_LIVE_MODE.md) §"Lần chạy thật đầu tiên" |
| 2. Electron + bảo mật | **XONG** | `electron/main.ts`, `tests/ipc-contract.test.ts`, smoke xác nhận sandbox/contextIsolation |
| 3. `protocol/` + ChatService | **XONG CODE, CHƯA THỬ** | `electron/protocol/zalo-client.ts` (520 dòng), `mapper.ts`, `session.ts` |
| 4. UI dữ liệu giả | **XONG** | 26/26 E2E, 136/136 unit, `npm run check` sạch |
| 5. Nối Zalo thật | **`LIVE_PASS = 1` — 5/5** | 18:02–18:03 trên bản cài 17:59: `send` trả `msgId` 1-1, `inbound` 1-1 khớp `threadId`, và **hai dòng tin nằm trong `cache-*.db` với đúng `msg_id`/`client_id`**. Trước đó: QR, khôi phục phiên, nhận tin nhóm — [R12](R12_PHASE5_LIVE_MODE.md) |
| 6. Đồng bộ / SQLite | **MỘT PHẦN — có catch-up giới hạn; Sync V2 xong code, chưa chạy thật** | `electron/db/` chạy với tài khoản thật: 132 hội thoại, 2 tin, `sync_state` đúng. Checkpoint catch-up, xử lý reconnect và trạng thái chưa xác nhận có test giả; chưa xác minh đủ với Zalo thật và chưa có gap detection — xem §4 |
| 7. Tính năng mở rộng | ~15% | Xem §4 |
| 8. Hiệu năng, độ bền | ~20% | Có single-instance lock + log xoay vòng; không FTS5, không nén `evMessageUpsert` |
| 9. Bảo trì / REA | ~30% | `docs/zca-capabilities.md` + [ADR-004](../docs/ADR-004-zca-js-integration.md); **không có canary** |
| 10. Đóng gói | **XONG** (Windows + Linux) | [AGENT_DELIVERY](AGENT_DELIVERY.md), [LINUX_PORT](LINUX_PORT.md) |

Nghẽn duy nhất của toàn bộ phần còn lại là **giai đoạn 1 / 5 cần một phiên thật**.
Mọi ô `CHƯA THỬ` bên dưới đều chờ đúng một bước đó.

---

## 2. Giai đoạn 5 — từng mục của checklist

| Mục plan | Trạng thái | Vị trí | Ghi chú |
| --- | --- | --- | --- |
| 5.1 Hợp đồng IPC | **CÓ** | `src/shared/ipc-contract.ts` + bản sao `electron/ipc-contract.ts` | Có test parity giữa hai bản (`tests/ipc-contract.test.ts`) |
| 5.2 Preload hẹp | **CÓ** | `electron/preload.ts` | Chỉ expose hàm cụ thể; `ipcRenderer` thô không lộ |
| 5.3 Main phát `LoginState` | **PASS** | `zalo-client.ts:136` (`emitLogin`), `:377-410` | Đủ 4 state; đã thấy `qr` → `logged-in` thật ngày 2026-11-08 |
| 5.3 QR thành data URL ở main | **PASS** | `zalo-client.ts:386` | Quét được QR hiển thị trong app thật |
| 5.3 Lưu phiên bằng `safeStorage` | **PASS** | `electron/protocol/session.ts:39` | `zca-session.bin` 2707 B, mode 0600, `gnome_libsecret`; lần chạy sau vào thẳng `connected` không cần QR |
| 5.3 Phân biệt lỗi mạng vs xác thực | **CÓ CODE, CHƯA THỬ** | `zalo-client.ts:83` (`isRetryable`) | Ngưỡng `>=500 / -1 / -2` vẫn là **suy đoán**; lần chạy thật không gặp lỗi nào |
| 5.3 Giới hạn retry QR + backoff | **CÓ** | `QR_RETRY_LIMIT=2`, `BACKOFF_START_MS=2000` → `MAX=60000` | |
| 5.4 Nhận tin realtime | **PASS** | `zalo-client.ts` (`handleInbound`) | 7 dòng `inbound` 17:27–18:03: 5 nhóm + 2 một-một. Tin 1-1 từ **người khác** (`self:false`) chưa có |
| 5.4 Gửi lạc quan + nối tin thật | **PASS** | `useDemoStore.ts` (`sendLive`), `src/renderer/live/echo.ts`, `db/messages.ts` (`upsertMessages`) | `send {"ok":true,"msgId":…}` hai lần; DB có đúng hai dòng `sent` với `client_id` khớp — bong bóng tạm đã được gộp, không nhân đôi |
| 5.4 Gửi lại cùng `clientId` | **CÓ CODE, CHƯA THỬ** | `useDemoStore.ts:430` (`retryLive`) | |
| 5.5 Bốn state kết nối | **CÓ** | `LiveConnection` trong `ipc-contract.ts` | Giữ riêng khỏi `ConnectionState` của demo — có lý do ghi ở R12 |
| 5.5 `replaced` không tự nối lại | **CÓ CODE, CHƯA THỬ** | `zalo-client.ts:79` (`isReplaced`), `:289` | Nhánh 3000/3003 **chưa thấy mã thật** |
| 5.5 Backoff 2s→60s | **CÓ** | `zalo-client.ts:166` (`scheduleReconnect`) | |
| **Checklist §5 (5 ô)** | **5/5 — `LIVE_PASS = 1`** | | Đăng nhập QR, khôi phục phiên, socket thật, nhận tin realtime, gửi tin |

**Kết luận:** giai đoạn 5 đã đóng. Lần chạy 18:02–18:03 trên bản cài 17:59 là
lần **đầu tiên** mã của cả ngày hôm nay (L1–L3, phân trang lịch sử, cache SQLite)
chạy với máy chủ thật, và nó khép kín chuỗi bằng chứng: `send` trả `msgId` máy chủ
→ `inbound` dội về cùng `threadId` → hai dòng `sent` trong `cache-*.db` với
`client_id` khớp. Xem [R12](R12_PHASE5_LIVE_MODE.md) để biết đúng những gì **vẫn
chưa** chứng minh (tin 1-1 từ người khác, `replaced`, thu hồi, gửi nhóm).

---

## 3. Ba lỗi đã sửa (2026-11-08)

Đây không phải "chưa làm", mà là code đã có nhưng nối sai chỗ — sẽ gây dữ liệu sai
khi dùng với tài khoản thật. Cả ba đã sửa; nhưng trạng thái vẫn là **chưa thử với
máy chủ Zalo thật**, vì không có phiên thật trong lần đối chiếu này.

### L1 — Lịch sử tin nhắn chết ở cả hai đầu — **ĐÃ SỬA**

Trước: `zalo-client.ts` có `getMessages`, nhưng **renderer không bao giờ gọi** (chỉ
khai báo trong `src/renderer/env.d.ts`); UI hiện nút lịch sử ở trạng thái `disabled`
với nhãn "Lịch sử chỉ tải khi mở app". Hệ quả: mở app chỉ thấy tin đến trong lúc
đang chạy — trái với lời hứa in trên nút.

Đã sửa ở cả bốn tầng:

| Tầng | Thay đổi | Vị trí |
| --- | --- | --- |
| Hợp đồng | `LiveMessagePage.hasMore` đổi `false` → `boolean` ở **cả hai** bản; sửa một bản là `tests/ipc-contract.test.ts` fail | `src/shared/ipc-contract.ts:70`, `electron/ipc-contract.ts:60` |
| Main | `fetchUserHistory`: gọi `listener.requestOldMessages(ThreadType.User, cursor)`, chờ `old_messages` với hạn 5 s, giữ con trỏ `msgId` cũ nhất, đệm tin của hội thoại khác trong cùng trang (trang 510 trộn mọi hội thoại), và **hàng đợi** vì sự kiện này không mang `threadId` nên không chạy song song được | `electron/protocol/zalo-client.ts:241`, `:481` |
| Main | Nhóm: dùng `getGroupChatHistory(groupId, count)` tăng dần 50 → 500, `hasMore` lấy từ trường `more` của API — trước đây gọi không truyền `count` và bỏ luôn `more` | `zalo-client.ts:483-497` |
| Renderer | Hàm thuần `prependHistory` chèn trang cũ lên đầu, khử trùng theo `msgId`; action `loadLiveHistory` + `liveHistory` trong store; nút lịch sử bật, có nhãn "Đang tải tin cũ…" / "Đã hết lịch sử Zalo" | `src/renderer/live/map.ts:127`, `useDemoStore.ts:386`, `ChatPane/index.tsx:110` |

Hai chi tiết dễ sai, đã ghi lại trong code:

- **Id số phải cấp mới cho tin chèn vào**, không tái dùng id cũ. `ChatPane` phân biệt
  "chèn lên đầu" với "thêm xuống cuối" bằng `messages[0].id` có đổi hay không; giữ
  nguyên id đầu mảng thì nó tưởng là tin mới và nhảy xuống cuối, đúng lúc người dùng
  đang đọc lịch sử.
- **Hết hạn 5 s không phải "hết lịch sử"**. Đường listener không trả cờ "còn nữa";
  nếu coi timeout là hết thì mạng chậm sẽ khoá nút tải vĩnh viễn, nên hàm trả
  `hasMore: true` và chỉ đánh dấu hết khi ba vòng liên tiếp không có tin của hội thoại
  đó.

Thêm: `sendLive`/`retryLive` không đổi; mở hội thoại tự nạp trang đầu
(`selectThread` và nhánh `seedLive` chọn hội thoại đầu tiên). Một chi tiết nữa:
`ChatPane` coi "hội thoại từ 0 tin thành N tin" là lần nạp đầu và cuộn xuống cuối
(`ChatPane/index.tsx:51`) — nếu không, hội thoại thật mở ra sẽ đứng ở tin cũ nhất
thay vì tin mới nhất, khác hẳn hành vi quen thuộc của khung chat.

### L2 — Đính kèm trong chế độ thật tạo bong bóng giả — **ĐÃ SỬA**

Trước: `attach` không có guard `liveMode`, composer chỉ disable nút tệp/ảnh khi
`offline`. Đang chat thật mà chọn file → chèn một tin "tệp demo" vào **hội thoại
thật**, không gửi lên server, không có thật; người dùng tưởng đã gửi.

Đã sửa ở hai lớp, vì một lớp là chưa đủ (store có thể bị gọi từ nơi khác):

- `useDemoStore.ts:247` — `attach` ở chế độ thật chỉ hiện toast "Chưa gửi được tệp
  trong chế độ Zalo thật", không đụng `chats`.
- `MessageComposer/index.tsx:14` — `filesOff = offline || live`; nút "Chọn tệp demo"
  và "Chọn hình ảnh demo" disable ở chế độ thật.

### L3 — Thao tác chỉ đổi store trong chế độ thật — **ĐÃ SỬA (phạm vi hẹp hơn tôi ghi ban đầu)**

Đính chính: menu "Tùy chọn hội thoại" **đã** rẽ nhánh từ trước — ở chế độ thật nó chỉ
còn "Thông tin hội thoại", `togglePin`/`markUnread` không lộ ra (`ChatPane/index.tsx:93`).
Chỗ rò duy nhất là **nút thả cảm xúc** trên từng bong bóng: nó luôn hiện và gọi
`react()`, mà `react` chỉ `set()` store, không có kênh IPC, không gọi
`addReaction` của zca-js.

Đã sửa: nút cảm xúc không render ở chế độ thật (`ChatPane/index.tsx:149`). Hai action
`togglePin`/`markUnread` vẫn để nguyên trong store cho bản demo, nhưng không còn
đường UI nào gọi chúng khi `liveMode === 'live'`.

---

## 4. Giai đoạn 6 — Đồng bộ

**Trạng thái: nền xong và đã nối, chưa có catch-up.** Ngày 2026-11-08.

> **Cập nhật 2026-11-09:** đồng bộ điện thoại (**Sync V2**, `transfer_sync2`) nay
> có đường chạy đầy đủ sau cờ `GLASS_PHONE_SYNC=1` — xem
> [R13](R13_SYNC_V2.md). Đây **không** phải `pull_mobile_msg` mà bảng dưới gọi
> tên: `pull_mobile_msg` là chỗ kéo một gói đã có; Sync V2 là phiên trao đổi khoá
> với `temp_key` và bản ghi phiên. Catch-up và gap vẫn còn thiếu.

| Hạng mục | Trạng thái |
| --- | --- |
| SQLite | **CÓ** — `node:sqlite` (`DatabaseSync`) có sẵn trong Electron 45/Node 22+, **không** dùng `better-sqlite3`: không module native, không `electron-rebuild`, test được bằng node thường. Đã đo trong Electron 45.2.3: SQLite 3.53.4 |
| Schema `threads`/`messages`/`sync_state`/`contacts`/`kv` (§6.2) | **CÓ** — `electron/db/schema.ts` |
| Migration đánh số + `schema_version` | **CÓ** — chạy trong một transaction, không hạ cấp |
| Upsert idempotent theo `(thread_id, msg_id)` | **CÓ** — `upsertMessages`, ghi theo lô trong transaction |
| Gộp tin lạc quan bằng `client_id` | **CÓ** — ở DB (xoá dòng `pending:` rồi chèn tin thật cùng transaction) |
| Server thắng khi xung đột | **CÓ** — cùng `msg_id` khác nội dung thì ghi đè |
| Thu hồi (§6.10) | **CÓ** — `listener.on('undo')` đã đăng ký; dòng giữ nguyên, `recalled = 1`, `text = ''`; trang cũ không hồi sinh nội dung; thu hồi tới trước tin gốc được nhớ trong bộ nhớ rồi áp lại lúc ghi. UI hiện "Tin nhắn đã thu hồi" |
| Backfill danh sách hội thoại | **CÓ** — đọc cache phát lên UI **trước**, rồi mới gọi mạng; mạng trả rỗng thì giữ cache |
| Backfill lịch sử theo trang | **CÓ** — trang đầu đọc từ cache; bấm "Tải tin nhắn cũ hơn" mới hỏi máy chủ; trang nhận được ghi lại vào cache |
| Catch-up sau offline (§6.6) | **CÓ MỘT PHẦN** — lúc kết nối lại gửi `cmd 510` và `cmd 511` từ checkpoint riêng cho 1-1/nhóm trong `kv`, lưu rồi phát tin; endpoint chưa có cờ hoàn tất và chưa xác minh đủ với Zalo thật |
| Khoảng trống (gap) minh bạch | **KHÔNG** |
| Hàng đợi tuần tự + throttle (§6.7) | **CÓ** — `electron/protocol/throttle.ts`: một yêu cầu một lúc, nghỉ 400–1000 ms **có jitter** sau mỗi lần (kể cả lần lỗi), dùng chung cho nhóm và 1-1. 8 test bằng đồng hồ giả |
| State machine §6.8 | **CÓ MỘT PHẦN** — 4 state + backoff và yêu cầu catch-up khi reconnect có; chưa có bảo đảm hoàn tất trước khi UI coi dữ liệu là mới |
| `FakeZaloClient` (§12) | **CÓ** — `tests/fake-zalo.ts`; bơm qua `ClientOptions.connect` (`createZaloClient`) |
| Test bảng §6.10 (10 tình huống) | **7/10** — xem bảng dưới |

### §6.10 — tình huống biên

| Tình huống | Trạng thái | Test |
| --- | --- | --- |
| Trùng realtime + backfill → một dòng | **CÓ** | `db.test.ts` "upsert idempotent" |
| Tin đến sai thứ tự → sắp theo `ts` server | **CÓ** | `db.test.ts` "sắp xếp theo ts server" |
| Gửi rồi mất mạng → `failed`/`sending`, có đường gửi lại | **CÓ** | `zalo-cache.test.ts` "gửi hỏng", "gửi lại gộp một dòng" |
| Ngắt mạng nhiều giờ → catch-up, báo gap | **MỘT PHẦN** — có yêu cầu catch-up và trạng thái chưa xác nhận; chưa phát hiện đủ gap | `zalo-cache.test.ts` "kết nối lại bắt kịp tin mới" |
| Mở Zalo Web → `replaced`, không tự chiếm lại | **CÓ** (từ trước) | `zalo-client.ts` `isReplaced` |
| Hội thoại hàng nghìn tin → tải theo trang | **MỘT PHẦN** — phân trang keyset ở DB có test; UI chưa cuộn ảo (§8). Phân trang lùi nay chia hai đường **đúng như Zalo PC**: **nhóm** thử `/api/cm/getoldv2` trước rồi mới rơi về `getGroupChatHistory`; **1-1 đọc DB SQLite cục bộ, không gọi cloud** (`pageFromCache`), khớp nhánh `if (!m) return …` của Zalo PC mà mã 26.11.10 trên máy cho thấy. `cmd 510` là hàng đợi *catch-up* (`lastActionId`), không phải API lịch sử; nó chỉ còn chạy khi cache rỗng, với vai trò *đổ thêm vào cache* — thay cho đồng bộ điện thoại (`pull_mobile_msg` + E2EE) mà Zalo PC dùng để làm dày DB, và app này **chưa có**. Đó là chỗ duy nhất cố ý khác Zalo, vì dừng y hệt sẽ làm người dùng thấy ít hơn trước. Test `tests/zalo-cache.test.ts` khoá đường đi: bơm `fetch` đếm số lần gọi và đòi `0` trên nhánh 1-1. Nhánh nhóm đã gọi thật (2026-11-08): **vẫn `604`**, nên nhóm hiện phân trang bằng `getGroupChatHistory`. Giả thuyết `ParamCipher` đã **bị bác bỏ**. Đường cloud nằm sau cờ `GLASS_CLOUD_HISTORY` (`group` cho nhóm, `all` cho cả hai để đối chứng). Chi tiết: [R12](R12_PHASE5_LIVE_MODE.md) |
| Thu hồi sau khi lưu → giữ dòng, `recalled = 1` | **CÓ** — đăng ký `listener.on('undo')` (chưa chạy thật, xem R12); 3 test DB + 5 test tích hợp + 6 test renderer |
| Đăng xuất → hỏi giữ/xoá dữ liệu cục bộ | **KHÔNG** — hiện **giữ** cache, và không có câu hỏi nào trong UI |
| Đổi tài khoản → mỗi tài khoản một file DB | **CÓ** | `db.test.ts` "hai tài khoản"; `zalo-cache.test.ts` "đổi tài khoản" |
| Tắt đột ngột giữa transaction → nhất quán | **CÓ** | `db.test.ts` "một tin hỏng giữa lô" (ROLLBACK) + WAL |

### Khác plan có chủ ý

- **`node:sqlite` thay `better-sqlite3`.** Plan §6.3 viết ví dụ bằng
  `better-sqlite3`. Electron 45 nhúng Node 24 có sẵn `node:sqlite`, nên bỏ được
  module native — thứ plan §10 (đóng gói) coi là rủi ro kiến trúc.
- **Khoá ngoại TẮT.** Plan §6.2 bật `foreign_keys = ON`. Thực tế tin realtime có
  thể tới **trước** khi metadata hội thoại backfill xong, và FK sẽ làm rơi đúng
  những tin đó. Có test "hội thoại lạ vẫn ghi được tin trước khi metadata về".
- **`upsertMessages` không nhận `kind`.** Bảng `messages` khoá theo `thread_id`;
  loại hội thoại chỉ được tra lúc đọc.
- **Mốc đồng bộ theo `msgId`, không theo `ts`.** Plan §6.2 dùng
  `last_synced_ts`/`oldest_loaded_ts`. Đường 1-1 (`cmd 510`) dùng `msgId` làm con
  trỏ, và `ts` không đơn điệu theo `msgId` khi tin đến lệch. Đổi tên cột là
  để lần đọc sau không hiểu sai.
- **Bong bóng tạm chưa được khôi phục lên UI.** `pendingMessages` tồn tại và có
  test, nhưng renderer chèn trang lịch sử lên **đầu** hội thoại
  (`prependHistory`), nên trả chúng trong trang sẽ làm chúng nhảy lên trên tin cũ.
  Đây là việc của renderer, không phải của DB.

### `cmd 510` đã được đo — và giả định của §6.6 sai

Ba lần gọi liên tiếp lúc 18:59 giờ máy (UTC+7), từ [R12](R12_PHASE5_LIVE_MODE.md):

| Lần | `hasCursor` | Kết quả |
|---|---|---|
| 1 | `false` | `count:10`, `first 8465385062022`, `last 8465431983954` |
| 2 | `true` | `count:9`, `first 8465385707624`, `last 8465431983954` |
| 3 | `true` | `count:9`, **giống hệt lần 2** |

Ba điều rút ra, và điều thứ ba làm đổi cách viết §6.6:

1. **Một trang nhỏ và hữu hạn** (9–10 tin), không phải cả lịch sử.
2. **Có lặp.** Gọi lại với cùng mốc trả lại đúng trang đó. Không có cờ "hết lịch
   sử": `fetchUserHistory` giữ mốc cũ nhất và nhận ra lặp qua khác biệt giữa các
   trang — đó là cách duy nhất đúng, và nó đang làm đúng.
3. **`lastId` không mở ra một mốc để hỏi "tin từ X trở đi".** Gửi `lastId` cũ hơn
   vẫn nhận về `first 8465385707624`. Nghĩa là **catch-up không thể nhảy thẳng tới
   mốc đã lưu** như §6.6 bước 3 giả định ("lấy lịch sử từ `last_synced` trở đi").
   Phải đi từ trang mới nhất xuống cho tới khi gặp tin đã có trong DB, rồi dừng.

Chưa đo được: với `lastId` **rất** cũ thì trang có khác không. Phép thử trên chỉ
dùng mốc vừa nhận, nên chưa loại trừ được khả năng máy chủ bỏ qua `lastId` hoàn
toàn.

### Cập nhật 2026-11-11 — catch-up khi kết nối lại

Zola tự xin lần lượt hàng đợi `ThreadType.User` (`cmd 510`) và
`ThreadType.Group` (`cmd 511`) qua `requestOldMessages` sau khi socket kết nối,
kể cả reconnect. Mỗi loại có checkpoint riêng trong DB tài khoản; tin được lưu
trước khi đẩy checkpoint, trang được xử lý theo thứ tự `msgId`, và phát lại an
toàn nhờ upsert/khử trùng. Luồng dùng chung hàng đợi với thao tác tải lịch sử để
`old_messages` không bị hai waiter tranh nhau. UI hiện trạng thái đang kiểm tra
và báo khi nhận tin hoặc khi yêu cầu chưa xác nhận được.

Đây mới là **lần thử bắt kịp**, không phải bằng chứng đã lấy đủ: `cmd 510` không
cung cấp cờ hết dữ liệu, còn kết quả đo thật cho thấy trang có thể lặp. Test giả
kiểm tra checkpoint, tin ở nhiều hội thoại và phát lại, nhưng chưa thay thế phép
đo với Zalo thật. Nhóm và gap detection vẫn chưa được xác minh; đồng bộ lịch sử
cũ vẫn là luồng Sync V2 do người dùng chủ động bật.

Đo trên tài khoản thật ngày 2026-11-11: cache có ID nội bộ `syncv2:*` cùng ID
máy chủ số; khi không có checkpoint, phép so sánh từ điển đã chọn ID nội bộ và
`zca-js` lỗi khi đọc phản hồi `cmd 510`. Con trỏ giờ chỉ nhận ID số, và ID nội bộ
được loại khỏi tìm kiếm dự phòng. Sau sửa, server trả trang gồm hai sự kiện
`chat.undo` (không có nội dung tin mới); Zola áp các thu hồi nhưng báo catch-up
chưa xác nhận thay vì báo thành công. Phản hồi này cho thấy thiếu một đường:
catch-up trước đây chỉ hỏi 1-1, dù ảnh người dùng gửi chỉ ra tin bị thiếu ở nhóm.
Nay reconnect hỏi thêm `cmd 511` với checkpoint nhóm riêng. Đo live tiếp theo
nhận được tin `chat.sticker`; payload chỉ có `id`, `catId`, `type`, nên trước đây
mapper bỏ tin đó hoàn toàn. Zola hiện tra URL qua sticker-detail API, lưu tin vào
cache rồi tải media; đã xác nhận một sticker được tải về. Ngày 2026-11-11, người
dùng xác nhận sau khi cài bản sửa thì các tin nhắn còn thiếu đã xuất hiện. Tiếp
theo, lỗi mở lịch sử nhóm offline được truy về việc hỏi API trước khi đọc trang
cũ trong cache; thứ hai trở đi API lỗi làm mất đường hiển thị những tin đã lưu.
Giờ các trang cache nhóm được đọc trước, rồi mới hỏi mạng khi hết phần cục bộ.
Đây là xác nhận và sửa chữa thực tế cho ca đã điều tra, không phải bảo đảm cho
mọi trường hợp: hai cmd vẫn không cho biết đã lấy hết tin hay chưa, nên không
thể cam kết phục hồi mọi tin bị lỡ trong tương lai.

---

## 5. Giai đoạn 7 — Tính năng mở rộng

| Mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| 7.1 Danh sách nhóm + tên nhóm | **CÓ** | `getAllGroups` → `getGroupInfo`, `zalo-client.ts:332` |
| 7.1 Tên/avatar người gửi trong nhóm | **KHÔNG** | `LiveMessage` không có trường `sender`; tin nhóm thật sẽ không hiện ai gửi |
| 7.1 Đồng bộ thay đổi thành viên | **KHÔNG** | `listener.on('group_event')` chưa đăng ký |
| 7.2 Gửi ảnh | **KHÔNG** | Cần `imageMetadataGetter` + `sharp`; chưa cài |
| 7.2 Hiển thị ảnh | **CHỈ DEMO** | Avatar luôn `null` (CSP chặn ảnh từ xa) |
| 7.3 Gửi/nhận file | **CHỈ DEMO** | Chế độ thật đã chặn hẳn (L2), không còn tạo bong bóng giả |
| 7.4 Emoji | **CÓ (demo)** | Chèn chuỗi emoji, không có bộ chọn |
| 7.4 Sticker / reaction | **KHÔNG** | Nút cảm xúc đã ẩn ở chế độ thật (L3); `addReaction` của zca-js chưa được gọi |
| 7.5 Danh bạ | **MỘT PHẦN** | `getAllFriends` đã dùng để dựng hội thoại, nhưng chưa có trang danh bạ thật |
| 7.6 Tìm kiếm | **CÓ (trong RAM)** | `selectChats` + tìm trong hội thoại; không có FTS5, nên không tìm được dữ liệu chưa tải |
| 7.7 Thông báo hệ thống | **CÓ** | `electron/main.ts:176` (`notice:demo`) |
| 7.7 Badge / tray / DND / autostart | **KHÔNG** | |
| 7.8 Trả lời trích dẫn | **KHÔNG** | `mapper.ts:19` khai báo `quote?: unknown` rồi bỏ qua |
| 7.8 Thu hồi | **MỘT PHẦN** | Nhận và hiển thị thu hồi đã có (`undo` → `recalled`, UI hiện "Tin nhắn đã thu hồi"). **Thu hồi tin của chính mình** (gọi `api.undo`) chưa có: UI chưa có nút, và chưa đo được payload `cliMsgId` thật |
| 7.9 Hiển thị loại tin chưa hỗ trợ | **KHÔNG** | `mapper.ts` trả `null` và bỏ im lặng — trái với câu "thay vì bỏ qua âm thầm" |

---

## 6. Giai đoạn 8 — Hiệu năng và độ bền

| Mục | Trạng thái |
| --- | --- |
| Cuộn ảo | **KHÔNG** — render toàn bộ danh sách |
| Phân trang keyset | **CÓ** — `pageMessages` trong `electron/db/messages.ts:230`: `(ts, msg_id)` so sánh, `LIMIT limit+1` để biết `hasMore` mà không `COUNT`, tin `pending:%` loại **trong** SQL. **Lưu ý:** `msg_id < ?` là so **chuỗi** trong điều kiện tie-break; chỉ sai ở các tin trùng đúng một giây (hiếm) và trang vẫn được sắp lại bằng `compareMsgId` trước khi trả, nên thứ tự hiển thị không sai — nhưng đó là chỗ chưa đo trên dữ liệu thật dày. Chưa có `OFFSET` nào trong đường đọc |
| Debounce cập nhật UI | **CÓ** — `src/renderer/live/batch.ts` gom `thread` + `message` trong cửa sổ 50 ms thành **một** `setState`; trần 200 tin thì xả ngay. Xả cưỡng bức ở chỗ người dùng đọc trạng thái: chọn hội thoại, gửi, gửi lại, nạp lịch sử, tháo listener. `src/renderer/live/apply.ts` giữ đúng thứ tự trong lô (echo → thu hồi → tin mới) — 16 test cho bộ gom + 8 test cho phép gộp + 4 test tích hợp chạy **store thật** (chứng minh tin dồn dập không vào state từng cái) |
| FTS5 (`remove_diacritics 2`) | **KHÔNG** |
| Sao lưu/khôi phục trước migration | **KHÔNG** |
| `PRAGMA integrity_check` | **KHÔNG** |
| Nút "Xóa cache và đồng bộ lại" | **KHÔNG** |
| Log xoay vòng | **CÓ** — `electron/log-file.ts` (`createLogFile`, trần 1 MB), `main.ts:80`; `tests/log-file.test.ts` 7 test: ghi/định dạng, xoay ở trần, chỉ giữ một `.1`, file sẵn có đã vượt trần, thư mục thiếu, đường dẫn hỏng, newline trong dữ liệu |
| `app.requestSingleInstanceLock()` | **CÓ** — `main.ts:39-52`; bản thứ hai thoát với mã 0, không đăng ký IPC/protocol, đánh thức cửa sổ bản chính (`restore`/`show`/`focus`). `npm run test:single-instance` (mới, `tools/smoke-single-instance.cjs`) chứng minh: thu nhỏ bản chính → spawn bản hai → nó thoát mã 0 sau ~290 ms, bản chính vẫn đúng 1 cửa sổ và đã bật lại. Khoá gắn profile nên hai bản portable ở hai thư mục vẫn chạy song song. `npm run test:desktop` (hai lần chạy nối tiếp) vẫn PASS, nghĩa là khoá được nhả khi thoát |
| Bắt lỗi toàn cục | **CÓ** — xem §7 dòng "9.1 Không sập khi có lỗi không bắt được". `ErrorBoundary` chỉ bọc phần nội dung; đã kiểm bằng Chromium thật: ném lỗi trong `ChatPane` → thẻ `role="alert"` hiện ra, thanh tiêu đề còn nguyên, bấm "Thử lại" khi lỗi vẫn còn thì thẻ quay lại chứ không trắng cửa sổ |

---

## 7. Giai đoạn 9 — Bảo trì

| Mục | Trạng thái |
| --- | --- |
| 9.1 Script canary định kỳ | **KHÔNG** |
| 9.1 Bắt lỗi mapper → "Zalo có thể đã đổi giao thức" | **KHÔNG** — mapper trả `null` im lặng (có ghi `inbound {mapped:false}` vào log, nhưng UI không nói gì) |
| 9.1 Không sập khi có lỗi không bắt được | **CÓ** — ba tầng: `ErrorBoundary` bọc phần nội dung (khung cửa sổ sống sót, có nút "Thử lại"); `installCrashGuard(process)` ghi lỗi main vào nhật ký rồi báo lên UI qua `ev:crash`; `render-process-gone`/`unresponsive` được ghi. Quá 3 lỗi trong 60 s mới thực sự thoát |
| 9.2 Quy trình REA | **CÓ TÀI LIỆU** — `docs/adr`, `tools/r11*` (~80 script khảo sát) |
| 9.4 `protocol/` dễ thay thế | **CÓ** — test ranh giới `tests/protocol-boundary.test.ts` quét import `zca-js` |
| 9.4 Ghim phiên bản zca-js | **CÓ** — `zca-js: 2.2.0` chính xác |
| 9.4 Test hợp đồng `ZaloClient` | **CÓ** — `tests/fake-zalo.ts` (bơm qua `ClientOptions.connect`) + 16 test tích hợp trong `tests/zalo-cache.test.ts` |

---

## 8. Bảo mật (§9 checklist) — 11/14 CÓ, 1 một phần, 2 không

| Mục | Trạng thái | Bằng chứng |
| --- | --- | --- |
| `contextIsolation` / `nodeIntegration` / `sandbox` | **CÓ** | `main.ts:153-156`; smoke đối chiếu `getLastWebPreferences()` |
| CSP chặt | **CÓ** | `electron/security.ts:10` |
| Chặn `will-navigate` / `setWindowOpenHandler` | **CÓ** | `main.ts:157-160` |
| Mở link ngoài bằng trình duyệt hệ thống | **KHÔNG** | Không có `shell.openExternal` — link trong tin nhắn không mở được |
| Preload hẹp | **CÓ** | `preload.ts` |
| Validate IPC ở main | **CÓ** | `electron/ipc-contract.ts` reader |
| Phiên bằng `safeStorage` | **CÓ** | `session.ts:39`; Fedora backend `gnome_libsecret` |
| Không log secret | **CÓ** | `logDebug` chỉ metadata; `cipher_key` nuốt tại `zalo-client.ts:331` (`listener.on('cipher_key', () => undefined)`) |
| Text escape, không render HTML thô | **CÓ** | Không có `dangerouslySetInnerHTML` |
| Cảnh báo link khác văn bản hiển thị | **KHÔNG** | Chưa render link |
| Làm sạch tên file khi tải | **CÓ (demo)** | `safeFileName` trong adapter |
| "Đăng xuất và xóa dữ liệu cục bộ" | **MỘT PHẦN** | `logout` xoá file phiên; chưa có DB để xoá, UI chưa tách hai lựa chọn |
| Cập nhật Electron | **CÓ** | `45.2.3`, ghim chính xác |
| `requestSingleInstanceLock` | **CÓ** | `main.ts:39-52`, chặn lại ở `main.ts:173`; xem §6 |

---

## 9. Kiểm thử (§10)

| Loại | Plan yêu cầu | Hiện có |
| --- | --- | --- |
| Unit | mapper, upsert, mốc đồng bộ, throttle, state machine | **MỘT PHẦN** — mapper 8 test, `map.ts`/`echo.ts` 17 test, `log-file.ts` 7 test, `node-run.cjs` 7 test; upsert + mốc đồng bộ + thu hồi nay có **25 test DB thật** (`tests/db.test.ts`); throttle 8 test (`tests/throttle.test.ts`); bắt lỗi toàn cục 8 test (`tests/crash.test.ts`); gom cập nhật UI 16 + 8 + 6 test (`tests/batch.test.ts`, `tests/store-batch.test.ts`), đường cloud 9 test (`tests/cloud-history.test.ts`); phép đo `pull_mobile_msg` 12 test (`tests/phone-sync-probe.test.ts`), header + thân frame WS 13 test (`tests/ws-frame.test.ts`), hạn thời gian đăng nhập 5 test (`tests/deadline.test.ts`). Tổng cả bộ **269** |
| Tích hợp DB | schema, migration, FTS, transaction | **MỘT PHẦN** — `db.test.ts` (schema, migration, transaction, phân trang, gộp tin, mốc) + `zalo-cache.test.ts` (16 test chạy `createZaloClient` thật qua `FakeZaloClient`). **FTS chưa có** (§8.2) |
| Hợp đồng `protocol/` | `ZaloClient` giả | **CÓ** — `tests/fake-zalo.ts`, bơm qua `ClientOptions.connect`; không import `zca-js` để giữ ADR-004 §4 (có test ranh giới canh) |
| Component | UI với dữ liệu giả | **CÓ** — qua E2E, không dùng Testing Library |
| E2E Electron | mock `ChatService` | **MỘT PHẦN** — demo flow đủ; live flow chỉ test logic |
| Thủ công | checklist 8 mục | **0/8** |
| Canary | cron + thông báo | **KHÔNG** |

Plan gọi `FakeZaloClient` là "công cụ quan trọng nhất để test đồng bộ". §12 xếp
nó **trước** §6. Thực tế đã làm ngược: schema và repository trước, `FakeZaloClient`
sau, khi nối vào `zalo-client.ts`. Không mất gì — 22 test DB chạy trên DB thật
trong thư mục tạm mà không cần client giả — nhưng đúng thứ tự thì phần nối đã có
test ngay từ dòng đầu.

---

## 10. Ngoài plan: những gì đã làm thêm

- **Port Linux** ([LINUX_PORT](LINUX_PORT.md)): AppImage, installer, profile
  `~/.config/...` thay vì cạnh executable. UI không đổi.
- **Bản demo đầy đủ** với 26 E2E + axe + contrast + DPI/zoom + a11y tree — vượt
  yêu cầu giai đoạn 4.
- **~80 script khảo sát R11** trong `tools/` — phần lớn là dấu vết điều tra, không
  phải sản phẩm chạy.

---

## 11. Thứ tự làm đề xuất (theo §12, có điều chỉnh)

1. **Chạy thật một lần với tài khoản phụ.** Đây là nghẽn duy nhất. Chỉ cần đăng
   nhập QR + nhận/gửi 1 tin để đổi 5 ô `BLOCKED` → `PASS`, và để đo 6 câu hỏi còn
   mở ở `zca-capabilities.md` §10.
2. ~~Sửa L1–L3~~ — **xong 2026-11-08** (§3). Nhưng cả ba mới được kiểm bằng test
   và typecheck, chưa bằng một phiên Zalo thật: L1 vẫn là `CHƯA THỬ` cho tới khi đo
   được `requestOldMessages` thật sự trả gì.
3. ~~`requestSingleInstanceLock`~~ — **xong 2026-11-08** (§6). Còn lại
   **`shell.openExternal`**, nhưng nó đi kèm linkify + cảnh báo link (§8): renderer
   hiện chỉ render `<span>`, không có `<a>`, nên thêm `openExternal` ngay bây giờ là
   code chết. Làm cùng lúc với §8.
4. ~~`FakeZaloClient`~~ — **xong 2026-11-08** (`tests/fake-zalo.ts`), nhưng làm
   **sau** §6 thay vì trước (§9).
5. ~~`§6` schema + repository + nối~~ — **xong 2026-11-08** (§4). ~~throttle (§6.7)~~
   và ~~thu hồi~~ cũng **xong 2026-11-08**. Catch-up reconnect giới hạn có code và
   test từ 2026-11-11; còn phải xác minh hành vi thật và **gap detection**.
6. ~~Bắt lỗi toàn cục (§9.1)~~ và ~~debounce cập nhật UI (§8.1)~~ — **xong
   2026-11-08**. Còn lại của hiệu năng: **cuộn ảo**, **keyset pagination**, **FTS5**.
7. §7 → §8 → canary.

Điểm khác plan duy nhất: plan xếp §6 trước §7. Giữ nguyên như vậy. Nhưng plan
không nói rõ rằng L1 (lịch sử) phải đo trước khi thiết kế schema — đó là bổ sung
ở đây. L1 nay đã có code, nhưng **cách đo vẫn còn nguyên**: phải xem `cmd 510` trả
bao nhiêu tin mỗi trang, có lặp khi cùng `lastId` hay không, và `msgId` có thật sự
đơn điệu tăng (điều `fetchUserHistory` đang giả định khi giữ mốc cũ nhất).
