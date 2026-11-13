# R18 — Sync V2: ba sửa của R17 trên bản chạy thật

Date: 2026-11-10 (Asia/Saigon). Tài khoản: **phụ**. Nối tiếp
[R17](R17_SYNC_V2_PHONE_CONFIRMED.md).

Trạng thái: **đã build, đã đo trên app thật**. Ba việc R17 liệt kê đều đã vào
mã và chạy đúng trên dây. Đo thêm được **một lỗi thật** mà test mới bắt được:
`591` chưa bao giờ tới máy chủ vì `releaseServer` bị truyền mất `this`. Nhưng
bức tranh về máy chủ **đổi theo hướng không mong đợi**: phiên `conversation` mở
được, mà điện thoại lần này **không gửi `transfer_status` nào** — khác hẳn R17.

Và chính lượt đo đó lộ ra **lỗi thứ hai, nặng hơn**: hạn 180 s của R18 được cài
như một hạn **một lần** tính từ lúc mở phiên, trong khi Zalo PC dùng nó như một
**watchdog im lặng** được đặt lại ở mỗi dấu hiệu sống. Người dùng báo đúng triệu
chứng: *"tôi thấy thông báo và ấn vào chả thấy gì"* — phiên đã bị giải phóng
trước khi ngón tay kịp chạm màn hình. §3 và §4 ghi lại phép đo và cách sửa.

---

## 1. Đã sửa gì

### (a) `592` không còn là cổng của phiên

`electron/protocol/sync-v2-session.ts`: `start()` **gửi rồi đi tiếp**, không chờ
phản hồi `592`; kết quả có/không được ghi thành một dòng chẩn đoán kèm
`elapsedMs`. Thêm `wakeupTimeoutMs` — `WAKE_SESSION_TIMEOUT_MS = 180_000`
(`electron/protocol/wake-mobile.ts`), tương đương
`SessionManager.options.wakeupTimeout: 18e4` của Zalo PC.

Hạn này là **watchdog im lặng**, không phải hạn một lần: xem §4. Không có gói
nào và không có `transfer_status` nào trong 180 s thì phiên sang `FAILED`, tức
là có trạng thái cuối và có `591`.

### (b) `591` đi ở mọi đường thoát

- `setPhase('done' | 'failed')` → `591` với `SyncSuccess` / `Error` — như cũ.
- `SyncV2Session.cancel()` → `591` với `UserCancel`.
- `SyncV2Controller.dispose()` gọi `session.cancel()`; `stopListener()` của
  `zalo-client.ts` gọi `controller.dispose()` thay cho `detach()` — nên **thoát
  app, đăng xuất, hay bị thay thế** đều đi qua đây. `cancel()` tự chống hai lần.
- `SyncV2Controller.sweepStaleSessions()` lúc gắn socket: dội `OutDated` cho mọi
  `syncId` còn dấu trong `kv` từ lần chạy trước — tương đương
  `SessionManager.cleanOldSyncSession`. Hàm `dispose()` là **async** nên dấu
  phiên không bị xoá trước khi `591` kịp đi.

Trạng thái sống qua các lần chạy: `electron/protocol/sync-v2-store.ts`, trong
bảng `kv` của `cache-<ownId>.db` (mỗi tài khoản một file). Dấu phiên được ghi
**trước** `590` — nếu app chết trong lúc yêu cầu đang bay, lần chạy sau vẫn biết
phải dọn phiên nào.

### (c) Đường conversation chạy trước đường message

`SyncV2Controller.syncAll()`:

```
chưa có danh sách hội thoại
  → phiên database "conversation", queries [{partition:"", from:0, to:MAX, limit:2147483647}]
  → chờ session.drain() + session.settled
  → phiên database "message", mỗi hội thoại một query
    partition = "oneone/<convId>" hoặc "group/<convId>"  (nhóm ⇔ convType === 2)
```

`sync-v2-batch.ts` có `decodeConversationMetadataBatch` /
`decodeConversationBatch` (cùng phong bì, cùng khoá, chỉ khác schema thân bản
ghi); `sync-v2-session.ts` rẽ nhánh theo `this.database` ở cả metadata lẫn gói
tin. Danh sách hội thoại được gộp vào `kv`, nên lần đồng bộ sau bỏ được bước
đầu — đó là mục đích của nó: **chỉ mục**, không phải dữ liệu người dùng.

### (d) `syncId` trong log

Dòng `control` của `watchFrames` mang thêm `syncIdPrefix` (8 ký tự đầu), nên mỗi
khung `transfer_status` quy được về đúng phiên. R17 §3 nêu đây là lỗ hổng bằng
chứng thật, không phải chi tiết vụn.

## 2. Lỗi thật mà test bắt được

`openSession()` truyền `disposeSession: this.releaseServer` **trần**. Phiên gọi
`this.deps.disposeSession(...)`, nên `this` bên trong `releaseServer` là `deps`
của phiên — object đó không có `.deps` — và **mọi** lần `591` ném

```
Cannot read properties of undefined (reading 'deps')
```

Trên log nó chỉ hiện thành `{"step":"session-dispose-threw"}`. Đây đúng kiểu
hỏng im lặng đã tốn ba vòng ở R13/R15/R17: phiên không được giải phóng, không
triệu chứng nào khác, và triệu chứng duy nhất là "lần sau không có gì để đẩy".
Sửa bằng một arrow bọc ngoài (`electron/protocol/sync-v2-controller.ts`).

Test `dispose controller: huỷ phiên đang mở với UserCancel` bắt được nó ở lần
chạy đầu.

## 3. Đo trên app thật

Log: `~/.config/zalo-apple-glass-ui/.glass-demo-data/live-listener.log`.
Build sau `npm run build:electron`; `ps aux | grep -c "[e]lectron/dist/electron"`
= 0 trước khi chạy.

### Lượt 1 — 13:04:06 → 13:07:06

```
13:04:06.047  sync-v2 {"step":"conversations-first"}
13:04:06.047  sync-v2 {"step":"start","tempKeySource":"empty","tempKeyChars":0,
                       "database":"conversation"}          ← (c) sống trên dây
13:04:06.053  sync-v2 {"phase":"requested",…}
13:04:06.067  request-sync {"ok":true,"cmd":590,"sent":true,"code":0}
13:04:06.067  sync-v2 {"step":"requested","syncId":"t9HemTDjYtR5ESsI3SyhDh4LGHY2N9WK",
                       "database":"conversation","tempKeyChars":0}
13:04:09.070  wake-mobile {"ok":false,"reason":"no-reply","timeoutMs":3000}
13:04:09.071  sync-v2 {"step":"wake-failed","code":"no-reply","elapsedMs":3004}   ← (a)
13:07:06.091  sync-v2 {"phase":"failed","received":0,…}                          ← đúng 180 s
13:07:06.092  sync-v2 {"ok":false,"reason":"không có gói nào trong 180000 ms",
                       "syncId":"t9HemTDjYtR5ESsI3SyhDh4LGHY2N9WK"}
13:07:06.093  sync-v2 {"ok":false,"reason":"no-conversations"}
13:07:06.124  sync-v2 {"step":"session-disposed","reason":2}                      ← (b) 591!
```

Đối chiếu `kv` sau lượt 1: `sync_v2_open_session:t9Hem…` **đã bị xoá** — dấu
đi cùng `591`. `kv` chỉ còn `sync_v2_identity_private`. Đây là lần **đầu tiên**
trong toàn bộ quá trình (`session-disposed` từng bằng 0 trên 849 dòng log).

### Lượt 2 — 13:08:02 → 13:11:02

```
13:08:02.495  sync-v2 {"step":"conversations-first"}
13:08:02.495  sync-v2 {"step":"start","database":"conversation"}
13:08:02.545  request-sync {"ok":true,"cmd":590,"sent":true,"code":0}
13:08:02.546  sync-v2 {"step":"requested","syncId":"o4pMPTC3f9FA2jqrxAQMoGIJjD0KV8NY"}
13:08:05.548  sync-v2 {"step":"wake-failed","code":"no-reply","elapsedMs":3003}
13:11:02.646  sync-v2 {"phase":"failed","received":0,…}
13:11:02.646  sync-v2 {"ok":false,"reason":"không có gói nào trong 180000 ms"}
13:11:02.646  sync-v2 {"ok":false,"reason":"no-conversations"}
13:11:02.652  sync-v2 {"step":"session-disposed","reason":2}
```

`kv` sau khi `590` đi: `sync_v2_open_session:o4pMPT…` — dấu được ghi **trước**
yêu cầu, đúng như thiết kế (app chết giữa `590` vẫn dọn được ở lần sau). Sau
`591`: `kv` **không còn** dấu phiên nào.

Chuỗi được tái lập **hai lần liên tiếp**, cùng kết quả: 180 s → `FAILED` → `591`
`Error` → dấu xoá. Đây không phải một lần may.

### Điều KHÔNG đo được ở lượt này

**Không có khung `601` nào** trong cả hai cửa sổ: lọc log theo
`2026-11-10T13:0[4-9]` rồi `grep frame` = **0**. R17 (10:14:39 → 10:16:24) có
`transfer_status` `status:3` rồi `status:4` sau **104 s**. Lần này điện thoại
không báo gì trong 180 s, hai lượt liền.

Đó **không** phải hồi quy của ba sửa trên — chúng nằm ở đường nhận, và không có
gì để nhận. Ba khả năng, chưa cái nào được chứng minh:

1. Điện thoại không nhận được `592` lần này (màn hình khoá, app bị kill, mạng).
   `wake-mobile` báo `no-reply` ở cả hai lượt, giống R17 — nhưng R17 im lặng mà
   vẫn thức, nên "no-reply" **không** nói được gì về việc điện thoại có thức.
2. Máy chủ đang giữ trạng thái phiên của một client khác (`backup_pc2mb` /
   `transfer_sync2` từ lần chạy Zalo PC), nên yêu cầu không vào hàng đợi chuyển.
3. `database: "conversation"` bị máy chủ xử lý khác `"message"` — chưa từng đo
   được một phiên conversation nào có phản hồi, nên đây là giả thuyết mở.

Không có bằng chứng nào phân biệt được ba khả năng này từ log hiện có.

### Bằng chứng từ phía con người — thứ log không nói được

Giữa hai lượt đo, người dùng báo: **"tôi thấy thông báo và ấn vào chả thấy gì"**
— thông báo đồng bộ **có hiện** trên điện thoại, nhưng bấm vào thì không có gì
xảy ra. Đó là một phép đo độc lập với mọi suy luận ở trên, và nó phủ định cả
ba khả năng: điện thoại **có** thức và **có** hiện thông báo.

Hai mốc thời gian khớp nhau tới mức không thể là trùng hợp:

```
phiên mở      13:07:06.047 → phiên giải phóng 13:07:06.124   (đúng 180 s)
phiên mở      13:11:02.495 → phiên giải phóng 13:11:02.652   (đúng 180 s)
```

Điện thoại cần **104 s** chỉ để hiện `transfer_status` (R17 §1). Cộng thời gian
đọc và bấm, 180 s là vừa đủ để phiên chết đúng lúc ngón tay chạm màn hình.
Máy chủ nhận `591 Error` cho một phiên mà người dùng đang bấm xác nhận — nên
phía điện thoại không còn gì để xác nhận, và thông báo "không làm gì".

## 4. Hạn 180 s phải là watchdog, không phải hạn một lần

Ba khả năng ở §3 đều sai. Đọc bundle của Zalo PC
(`shared-worker.cfeba43a9a8e4e40dda3.js`) thì `SyncSession` dùng
`wakeupTimeout` theo một cách khác hẳn:

```js
wakeup(){ return this.syncChanel.requestWakeUp({…}).then(e => (
  0 == e.code && ( …, this.startTimeoutReceiveBatch(this.options.wakeupTimeout, WakeupTimeout) ),
  new wo.m(e.code, e.message))) }

onConnectionChanged = e => { switch (t.status) {
  case WaitingConfirm: startTimeoutReceiveBatch(this.options.connectTimeout, ConnectTimeout)
  case Confirmed: case BypassConfirmed: startTimeoutReceiveBatch(this.options.batchTimeout, BatchTimeout)
  case Active:  startTimeoutReceiveBatch(this.options.batchTimeout, BatchTimeout)
  case Idle:    clearTimeoutReceiveBatch() } }
```

`startTimeoutReceiveBatch` **xoá rồi hẹn lại**. Mỗi gói nhận được cũng gọi nó.
Nghĩa là:

- Hạn không chạy từ lúc mở phiên — nó **chỉ được bật** khi `592` trả `code: 0`.
- Mỗi `transfer_status` **đặt lại** hạn. Thời gian người dùng cầm điện thoại
  bấm (`WaitingConfirm`) không bị tính.
- Mỗi gói nhận được cũng đặt lại. Một lần đồng bộ dài không bị cắt ngang.

Bản R18 đầu tiên bật hạn một lần lúc mở phiên rồi bắn thẳng. Đó là mô hình sai,
và triệu chứng người dùng thấy chính là hệ quả trực tiếp.

### Sửa

- `armWakeTimer()` → **xoá rồi hẹn lại**; không bắn khi phase đã chạm trạng thái
  cuối, và không hẹn lại được khi phiên đã đóng (`armWakeTimer` trả về sớm nếu
  phase không còn `REQUESTED`/`RECEIVING` — nếu không, một `transfer_status` tới
  muộn sẽ hồi sinh hẹn giờ của phiên đã chết).
- `countBatch()` → **hẹn lại** thay vì huỷ (trước đây gói đầu tiên tắt hẳn hạn).
- `handleControlEvents()` → hẹn lại ở **mỗi** `transfer_status`.
- Bỏ điều kiện `receivedBatches > 0` trong callback: hạn giờ là "im lặng trọn
  một hạn", nên dòng chảy dừng giữa đường **phải** làm phiên hỏng — đó đúng là
  ca R17 ghi lại (phiên nằm `receiving` mãi, không trạng thái cuối, không `591`).
- Không hẹn lại ở bất cứ thứ gì khác: frame `601` chở hàng chục loại sự kiện
  không liên quan tới phiên, và chúng không phải dấu hiệu nó còn sống.

### Chưa làm: hai con số thay vì một

Zalo PC tách `connectTimeout` (10 s, lúc chờ **người bấm**) khỏi `batchTimeout`
(10 s, lúc đang nhận gói). Repo hiện dùng **một** `wakeupTimeoutMs = 180 s` cho
cả hai, cố ý rộng hơn cả hai con số của Zalo PC. Tách ra chỉ đáng làm khi có
phép đo cho thấy một trong hai hạn bị bắn nhầm — chưa có. Ghi lại ở đây để
phiên sau không phải suy lại từ đầu.

## 4b. Lượt đo thứ ba — cùng một lỗi mốc thời gian, ở chỗ khác

Sau khi sửa watchdog, đo lại (`syncId vf6DnY1U…`, mở 13:28:41). Lần này điện
thoại **có** báo trạng thái, và app của ta lại tự giết phiên:

```
13:28:41.244  start → database "conversation"
13:28:41.896  590 gửi, code 0
13:28:44.900  wake-failed no-reply (bình thường — xem §1a)
13:30:27.609  {"status":5,"from":0}                 ← +106 s, người dùng bấm xác nhận
13:30:29.659  phase "failed", received:2
13:30:29.659  {"reason":"thiếu bản ghi phiên","idx":1}
13:30:29.667  session-disposed, reason 2             ← ta gửi 591 Error
13:30:29.692  conversation-batch idx 0, conversations:0   ← metadata giải xong SAU 33 ms
```

Người dùng mô tả đúng: *"ấn vào thì hiện đang đồng bộ luôn không có nút đồng ý
và chạy 1s thì mất luôn"*.

Đọc log: hai gói tới cùng lúc. Gói tin (`idx 1`) chạy trên chuỗi tin, gói
metadata (`idx 0`) chạy trên chuỗi metadata — hai chuỗi **tách rời có chủ đích**
(chú thích của class giải thích vì sao: một hàng đợi chung sẽ tự khoá). Gói tin
`await this.recordReady`, mà promise đó đã tự trả `null` **từ 13:29:41** — hạn
60 s cài trong **constructor**, tức là tính từ lúc dựng object, chứ không phải
từ lúc có gói.

Cùng một sai lầm như §4: hạn neo vào lúc mở phiên thay vì vào dấu hiệu sống.
Và ở đây nó *chắc chắn* sai, vì R17 đã đo điện thoại cần 104 s mới đẩy được gói
đầu tiên — một hạn 60 s tính từ lúc mở phiên **luôn** hết trước khi dòng dữ liệu
bắt đầu.

### Sửa

`ensureRecordTimer()` — hạn bật **lười**, ở gói đầu tiên cần bản ghi phiên, và
bật **một lần** (không đặt lại theo từng gói: một dòng gói tin không bao giờ có
metadata đi kèm phải hỏng, không phải chờ vô hạn và kẹt cả hàng đợi).

Hai chi tiết dễ sai, đều do test bắt:

- Hẹn giờ **không** `unref` — nó là thứ duy nhất làm `recordReady` kết thúc, bỏ
  khỏi vòng lặp sự kiện thì `drain()` treo.
- `setPhase(DONE|FAILED)` **không** đóng `recordReady`: gói metadata có thể đang
  giải lúc phiên chạm trạng thái cuối, và `drain()` phải chờ nó trước khi
  controller đọc danh sách hội thoại.

Test mới `gói tin tới trước metadata: chờ bản ghi từ LÚC CÓ GÓI, không phải từ
lúc mở phiên` dựng lại đúng ca này bằng hạn 300 ms: mở phiên, chờ 450 ms (quá
hạn kiểu cũ), rồi mới đẩy gói tin + metadata; bản ghi vẫn phải cứu được phiên.

## 4c. Lượt đo thứ tư — dữ liệu thật chảy về

Sau hai sửa (hạn bản ghi lười, chia 30 query/nhóm), `14:02:52`:

```
14:02:52.537  message-groups  conversations:363  groups:13      ← 30/nhóm
14:02:52.537  start  database:"message"
14:02:52.571  request-sync {"ok":true,"cmd":590,"code":0}       ← nhận, không còn 1009
14:02:52.571  phase "receiving",  syncId fdlh5BWU…
14:02:55.575  wake-failed no-reply (bình thường)
14:02:58.705  {"status":5,"from":0}                             ← điện thoại xác nhận
14:03:00      batch idx 0 … 38  — 39 gói trong ~6 s,
              20 480 tin đã ghi, skipped 3 190 (trùng trong cache)
```

Ảnh chụp điện thoại cùng lúc hiện băng **"Đang đồng bộ tin nhắn…"** và giữ
nguyên — trước đó băng này tắt sau ~1 s vì app gửi `591` giết phiên. Đây là lần
đầu tiên chuỗi `conversation → message` chạy trọn trên app thật với dữ liệu thật.

### 4d. Vì sao một `590` với 363 partition làm hỏng cả lượt

R18 v1 mở phiên tin với **một** `590` chứa 363 `partition`. Máy chủ không từ
chối bằng mã lỗi — nó **đóng kết nối**:

```
13:49:50.264  phase "requested"            ← bắt đầu bước tin
13:49:50.273  session-disposed reason 2     ← phiên hội thoại đóng muộn
13:49:50.279  disconnected {"code":1009}    ← frame quá lớn
13:49:52.797  attached, sweep stale:1
13:49:55.800  session-dispose-failed  no-reply
13:50:00.265  request-sync no-reply (10 s)
13:50:00.265  request-rejected  no-reply
```

`1009` là mã WebSocket "message too big". Và lỗi lan: `591` cũng không gửi được
(`no-reply`), nên phiên cũ còn treo và lần gắn socket sau phải `sweep` nó.

Chặn đúng nằm ở bundle, `buildPrepareQuery`:

```js
e.params.queries.forEach(e=>{
  const r=t.get(s.priority)||[], i=r.find(e=>e.getQueryCount()<30);
  if(i) i.addQuery(e), … else { const i=Yo.createPrepareAllQuery(); i.addQuery(e); r.push(i) }
});
…
for(let t=0;t<i.length;t++){ … await this.sessionManager.prepareSession(s.getQuery()) }
```

**30 query mỗi nhóm, một `590` mỗi nhóm, các nhóm tuần tự.** Đó là
`SYNC_MAX_QUERIES_PER_REQUEST` (`sync-v2-request.ts`); `syncAll` chia bằng
`chunk()` và chạy nhóm đầu ở tiền cảnh (giữ hợp đồng cũ: trả về khi yêu cầu đã
được nhận), các nhóm còn lại nối tiếp trong nền.

## 4e. `isLast` không phải `true` — và hạn giữa hai gói là 10 s

Lượt 14:03 lộ thêm hai chỗ sai, cả hai đều đo được chứ không phải suy đoán:

**(1) `isLast` không tới dạng boolean.** 39 gói, `idx` đủ `0..38`, dữ liệu đúng,
mà **không gói nào** mang `isLast === true`. Zalo PC đọc cờ bằng **truthiness**:

```js
checkRequestfulfilled(e){ this.responsedBatchIds.add(e.idx),
  e.isLast && (this.totalBatch=e.idx+1), … }
```

Ta so `isLast === true`, nên phiên không bao giờ biết mình đã xong. Sửa bằng
`readFlag()`: `true`, `1`, `'1'`, `'true'` đều là bật.

**(2) Hai hạn, hai ý nghĩa.** `SessionManager.options` của Zalo PC là
`{connectTimeout:1e4, batchTimeout:1e4, wakeupTimeout:18e4}`. Bản R18 dùng 180 s
cho tất cả:

- `wakeupTimeout` (180 s) → khoảng **chưa có gì**: mở phiên → gói đầu tiên.
  Đây là khoảng điện thoại cần >104 s để hiện thông báo, rồi còn chờ người bấm.
- `batchTimeout` (10 s) → khoảng **giữa hai gói** một khi dòng đã chảy. Mỗi gói
  nhận được hẹn lại bằng con số này (`startTimeoutReceiveBatch(batchTimeout)`).

Với 180 s cho cả hai, một nhóm 30 hội thoại đẩy xong trong 6 s vẫn bắt ta chờ
thêm 180 s: đo được ở lượt 14:03 — nhóm 1 im từ 14:03:04 và chỉ đóng ở 14:09:02,
rồi mới mở nhóm 2. **13 nhóm ⇒ ~39 phút cho một lần đồng bộ.**

Thêm `BATCH_TIMEOUT_MS = 10_000` (`wake-mobile.ts`) và `batchTimeoutMs` trong
`SyncV2SessionOptions`; `armWakeTimer()` chọn hạn theo `receivedBatches > 0`.
Mặc định `batchTimeoutMs` bằng `wakeupTimeoutMs` khi không truyền, để hành vi cũ
của test giữ nguyên.

## 4f. Lượt 14:26 — lần đầu đồng bộ TRỌN VẸN, và lỗi lộ ra ngay sau đó

Đây là lượt đầu tiên đi hết đường: điện thoại hiện thông báo, **có nút xác nhận**,
bấm vào thì chạy, và chạy xong.

```
14:26:24.307  status:1   (ACTIVE)
14:26:24.823  status:5   (CONFIRMED)      ← người dùng bấm xác nhận
14:26:28.171  phase:"done"  received:46  written:7959  skipped:497
```

Điện thoại báo **"Đồng bộ thành công"**; 7 959 tin nhắn vào DB. Ba lỗi ở §4/§4b/§4e
đều đã đóng góp vào kết quả này: hạn 180 s không còn cắt phiên đang chờ người bấm,
bản ghi phiên không còn hết hạn trước khi có gói cần nó, và `isLast` dạng số được
đọc đúng.

**Nhưng nhóm kế tiếp mở sai thời điểm.** Cùng một giây:

```
14:26:28.171  phase:"done"        ← nhóm 3 xong
14:26:28.171  step:"start"        ← nhóm 4 mở sau ĐÚNG 0 ms
14:26:28.183  disconnected 1006   ← socket đóng sau 11 ms
14:26:38.173  request-sync no-reply (10 s)
14:26:38.173  message-group-failed group:4
```

Nguyên nhân nằm ở thứ tự trong `setPhase`: `settledResolver?.(phase)` chạy **trước**
`releaseOnServer(phase)`, và `releaseOnServer` là `void` — không ai chờ `591` xong.
`waitForSession()` chỉ chờ `settled`, nên nhóm 4 mở phiên mới khi phiên nhóm 3 **còn
mở trên máy chủ**. Máy chủ trả lời bằng cách đóng socket.

Sửa: thêm `closed` (promise hoàn tất khi lần `591` cuối cùng có câu trả lời), và
`waitForSession()` chờ nó sau `settled`. `closed` **luôn** hoàn tất — không có
`disposeSession`, `591` hỏng, hay phiên bị bỏ giữa đường đều mở nó — vì người gọi
cần nó như một **nhịp** giữa hai nhóm, không phải như điều kiện thành công.

Kèm theo một sửa thứ hai, cùng gốc "đừng chờ thứ đã biết là chết": `runRemainingGroups`
giờ **dừng cả chuỗi** khi phiên trước chạm `failed`. Trước đó nó vẫn đi tiếp nhóm 5,
6, … Mỗi nhóm treo đủ 180 s rồi bỏ — đo được ở lượt 14:14–14:23: **13 nhóm × 180 s
= 36 phút chờ cho một phiên đã biết là hỏng.** Lý do hỏng (mất kết nối, phiên cũ treo)
là điều kiện chung của cả chuỗi, không phải của riêng một nhóm.

## 5. Trạng thái mã

- `npm run typecheck` — sạch.
- `npm run lint` — sạch (đã thêm `tests/sync-v2-store.test.ts` vào danh sách).
- `npm test` — **498/498**.
- Test mới: 6 nhóm ở `tests/sync-v2-session.test.ts` + `sync-v2-controller.test.ts`
  (chuỗi hai bước, dấu phiên, dọn cũ, huỷ, hạn 180 s, fire-and-forget `592`),
  3 ở `tests/sync-v2-batch.test.ts`, 17 ở `tests/sync-v2-store.test.ts`,
  1 ở `tests/wake-mobile.test.ts` (180 s ≠ 3 s và > 104 s).
- Hai test khoá đúng mô hình watchdog (§4): `transfer_status` đặt lại hạn (nên
  chờ người bấm không bị coi là im lặng), và gói hỏng cũng đặt lại hạn.
- Ba test khoá `closed` (§4f): chờ `591` trả lời, vẫn mở khi `591` hỏng, vẫn mở
  khi bị bỏ giữa đường.
- Bốn test khoá hai không gian id (§4g): `from` theo `ownNoisedId` chứ không
  theo uid, `oneone/<id nhiễu>` → uid, không tra được thì giữ nguyên (không
  đoán), nhóm giữ nguyên `convId` — test cuối **đã bị thay** ở §4h vì chính nó
  khoá lại hành vi sai.
- Năm test mới của §4h: `group/<id nhiễu>` → `groupId` số (kind vẫn lấy từ tiền
  tố, không từ bảng ánh xạ), nhóm chưa có id nhiễu thì giữ nguyên, `globalIds`
  chứa cả nhóm, bỏ `"0"`/chuỗi rỗng, `counts` tách "không có dòng nào" khỏi "có
  dòng nhưng thiếu `globalId`".
- Hai test cho `Idle` (§6.4): không hẹn lại hạn, nhưng cũng không giết phiên
  ngay; `Active` thì hẹn lại như mọi trạng thái khác.
- Một test cho `unresolved`: đếm theo **phân vùng**, không theo từng tin, và
  không lẫn với `skipped`.
- Hai test khoá phần trăm đồng bộ: chưa biết tổng thì trả `null` (không vẽ thanh
  0% trông như treo), và kẹp ở 100 vì gói có thể tới sau `isLast`.
- Bảy test cho §4i (`tests/db-consolidate.test.ts`): bản sao bị bỏ nhưng tin chỉ
  có dưới id nhiễu thì **chuyển chứ không xoá** (khoá thứ tự xoá-trước-chuyển-sau),
  id lạ để nguyên, `sender_id` của thành viên trong nhóm cũng được ánh xạ,
  `sync_state` dồn không mồ côi, và chạy hai lần đổi thêm 0 hàng.

## 4g. `from_me` sai vì so hai không gian id — và mọi thứ khác đi theo

Đo 16:18 sau khi sửa: **2 010 / 62 094** tin được nhận là của mình. Trước đó là
**0 / 4 768**. Nhưng con số chỉ là hệ quả; gốc là ta đang so hai thứ không cùng
đơn vị.

**Zalo có hai không gian id, và Sync V2 chỉ nói bằng không gian thứ hai.**

| | uid | `globalId` (id nhiễu) |
|---|---|---|
| Dạng | số thập phân, 18 ký tự (`188436612101457701`) | base62, 32 ký tự (`2M03I0I068…`) |
| Nguồn | `getOwnId()`, `getAllFriends().userId`, DB của repo | `profile.globalId` của zca-js |
| Dùng ở | mọi API khác của zca-js, `LiveThread.id` | `Sync2.Message.senderId`, `Sync2.Conversation.convId`, `partition` |

Bản web thật giải nhiễu trước rồi mới so — `MessageTransformer` gọi
`pcNoised2gNoisedMulti(ids)`, và `resolveMyGlobalNoisedId()` lấy id nhiễu của
chính mình bằng `getGlobalIdsFromUserIds(uid)`. Hàm cuối cùng ấy đọc đúng
`profile.globalId` (`lazy/main-startup.89bb530b91927fd5dd28.js`, `_getGlobalIdsFromUserIds`).

Ta thì so thẳng `senderId` (32 ký tự) với `ownId` (18 số). Kết quả là tất yếu,
không phải dữ liệu xấu: `senderChars=32, emptySender=0, selfMessages=0` trên
4 768 tin — giả thuyết "gói thiếu người gửi" bị bác bỏ.

**Cùng lỗi đó làm hỏng cả tên hội thoại.** Đo trên app: 250 hội thoại,
116 mang id nhiễu, và **cả 116 đều tên "Người dùng Zalo"/"Nhóm Zalo"** — vì ta
tra `threads` bằng id nhiễu, không khớp uid nào, nên rơi về nhãn mặc định.

Sửa:
- `RawUser.globalId` được giữ lại (trước bị cắt ở `buildThreadsFromServer`).
- `buildThreadsWithIds` dựng `globalIds: Map<globalId, uid>` từ `getAllFriends`.
- `fetchAccountInfo().profile.globalId` cho `ownNoisedId` — id nhiễu của mình.
- `IdResolver` (`sync-v2-map.ts`) bắc cầu; `chunkToMessages` đổi
  `oneone/<id nhiễu>` về uid, và `from` suy từ `ownNoisedId`, không từ `ownId`.
- Nhóm giữ nguyên `convId`: `getAllGroups().groupId` vốn đã cùng không gian id.

**Không tra được thì giữ nguyên id nhiễu, không đoán.** Đoán bừa là gán tin của
người này sang hội thoại người kia — hỏng theo cách không nhìn thấy được.

Đo sau khi sửa (`global-ids`: **132** người bạn có id nhiễu):

| | trước | sau |
|---|---|---|
| tin nhận là của mình | 0 / 4 768 | **2 010 / 62 094** |
| hội thoại có tin rơi **đúng** hội thoại thật | — | 33 (7 132 tin) |
| hội thoại ma (tin không có `threads`) | — | **0** |
| còn tên mặc định | 116 | **118** (81 người + 37 nhóm) |

Hai giới hạn còn lại, ghi rõ để không ai tưởng đã xong:
1. **116 hội thoại không có `globalId`** trong `getAllFriends` — không phải bạn
   bè (người lạ, OA, nhóm đã rời). Tin của họ vẫn về đúng chỗ (không tạo hội
   thoại ma) nhưng tên vẫn là nhãn mặc định.
2. **118 nhãn mặc định vẫn hiện**, vì `upsertThreads` giữ tên cũ và bản ghi
   `threads` mang id nhiễu không bao giờ khớp `getAllFriends`. Đường sửa: bỏ
   hẳn bản ghi `threads` mang id nhiễu khi `globalIds` đã có uid tương ứng.

## 4h. Nhóm chưa bao giờ vào bảng id — vì `getGroupInfo` luôn thất bại

§4g nói "nhóm giữ nguyên `convId`" và điều đó **sai**. Đo 2026-11-11 00:57:
bảng `globalId` đúng bằng số bạn bè, `groups: 0`, dù `gridIds: 106`. Nguyên nhân
không phải thiếu trường (`GroupInfo.globalId` có trong model của zca-js) mà là
lời gọi **luôn hỏng và bị `.catch(() => null)` nuốt mất**:

```
sync-v2 {"step":"group-list","gridIds":106,"info":0,"error":"Tham số không hợp lệ"}
```

106 id trong **một** tham số `gridVerMap` là quá lớn. Zalo PC gọi `getmg-v2`
theo lô. Gọi theo lô 20:

```
sync-v2 {"step":"group-list","gridIds":106,"got":106,"failed":0,"error":null}
sync-v2 {"step":"global-ids","count":238,"friends":132,"groups":106}
```

**132 → 238.** Hệ quả trước bản sửa: mọi `partition` dạng `group/<id nhiễu>`
không tra được, nên 35 nhóm / 81 619 tin nằm trong hội thoại ma tên "Nhóm Zalo"
— in đậm hơn hẳn phía người (81 tin).

Sửa:
- `RawGroupInfo.globalId`; `buildThreadsWithIds` đưa nhóm vào cùng bảng.
- `chunkToMessages` tra **cả hai** loại phân vùng, không chỉ `oneone/`.
- `getGroupInfo` gọi theo lô 20, lỗi từng lô chỉ mất lô đó; log `group-list`
  ghi `gridIds`/`got`/`failed` để lần sau không phải đoán.

### Đo sau khi sửa — 82 525 tin trong hội thoại nhiễu KHÔNG phải tin mới

`messages` có `PRIMARY KEY (thread_id, msg_id)`, nên một tin đã ghi dưới id
nhiễu **không** bị ghi lại dưới uid: hai hàng khác khoá. Đối chiếu `msg_id`:

| | số tin |
|---|---|
| tin trong hội thoại id nhiễu | 82 525 |
| … đã có bản đúng dưới uid (bản sao cũ) | **79 139** |
| … chỉ tồn tại dưới id nhiễu | 3 386 (117 hội thoại) |

Bộ đếm `unresolved` mới trong log `batch` xác nhận cùng điều đó trên dây: 23
phân vùng không nối được trên 58 gói của lượt cuối — đúng cỡ 3 386 tin của
người lạ/OA/nhóm đã rời. Nghĩa là **đường ghi mới đã đúng**; 79 139 hàng kia là
rác của các lượt trước bản sửa, phải dọn chứ không tự biến mất (xem §6.5).

## 4i. Dọn 79 139 hàng rác — và vì sao phải dọn chứ không chờ

Hàng rác không tự biến mất: `messages` khoá bằng `(thread_id, msg_id)`, nên bản
sao dưới id nhiễu và bản đúng dưới uid là **hai hàng khác khoá**. Đường ghi đã
đúng từ §4g/§4h, nhưng dữ liệu cũ vẫn nằm đó và vẫn hiện trong UI.

`electron/db/consolidate.ts` — `consolidateNoisedThreads(db, globalIds)`, ba
điều kiện an toàn có test riêng ở `tests/db-consolidate.test.ts` (7 test):

1. **Chỉ đụng vào id có trong `globalIds`.** Bảng đó đến từ máy chủ
   (`getAllFriends` + `getGroupInfo`). Id nhiễu không có trong bảng là người lạ,
   OA hoặc nhóm đã rời — không biết nó thuộc về ai thì gộp là đoán.
2. **Bản sao chỉ bị bỏ khi `msg_id` đã có dưới uid; tin chưa có thì `UPDATE`,
   không `DELETE`.** Thứ tự **xoá trước, chuyển sau** là điều kiện sống còn —
   chuyển trước thì mọi tin vừa chuyển khớp chính nó ở bước xoá và mất sạch.
   Một test giữ đúng thứ tự đó.
3. **Chạy sau khi bảng đã có nhóm**, nếu không `group/<id nhiễu>` không gộp được.

Gọi từ `zalo-client.ts` trong `activate()`, **một lần mỗi tài khoản** (cờ
`kv.consolidate_noised_v1`, ghi **sau** khi gộp xong — ghi trước là tự khoá khỏi
lần sửa sau nếu lần này hỏng giữa đường). Đặt sau `upsertThreads` và trước khi
phát danh sách, để UI không nhận một danh sách có hàng vừa bị xoá.

Đo trên máy thật 2026-11-11 00:35 (`{"step":"consolidate"}`):

```
threadsMerged: 78, messagesMoved: 0, duplicatesDropped: 79139, threadsLeftAlone: 117
```

`messagesMoved: 0` là con số quan trọng nhất: **không tin nào bị chuyển**, tức
là không có lịch sử nào phải di chuyển và không có gì để mất. 79 139 khớp đúng
con số đo ở §4h.

Trước / sau (đo trực tiếp trên `cache-188436612101457701.db`):

| | trước | sau |
|---|---|---|
| tin dưới id nhiễu | 82 525 (195 hội thoại) | **3 386** (117 hội thoại) |
| hội thoại nhóm dưới id nhiễu | 35 | **0** |
| hội thoại người dưới id nhiễu | 160 | 117 (toàn người lạ) |
| tên mặc định | 195 | **117** |
| tin mồ côi | 0 | **0** |

Lượt đồng bộ kế tiếp (17:37) xác nhận đường ghi vẫn đúng sau khi dọn: **+2 tin
vào hội thoại số, 0 hàng mới dưới id nhiễu**, 15/47 phân vùng không tra được —
đúng cỡ 3 386 tin của người lạ còn lại.

**117 hội thoại vẫn tên mặc định**, và điều đó là **đúng**: chúng là người lạ,
OA, nhóm đã rời — Zalo không trả `globalId` cho họ trong `getAllFriends` hay
`getGroupInfo`. Tin của họ vẫn về đúng hội thoại (0 mồ côi). Muốn có tên thì
phải lấy từ nguồn khác; đây không phải lỗi của bảng ánh xạ.

## 4j. "Tin của tôi thiếu" — 37 955 tin mỗi lượt bị bỏ vì `globalId = "0"`

Người dùng báo: *"tin nhắn vẫn còn thiếu nhiều, và đặc biệt là tin nhắn của tôi"*.
Đúng, và lỗi nằm ở chỗ chưa ai nghĩ tới: **chính sách bỏ tin thiếu id**.

### Phép đo mở đường

Zalo PC trên cùng máy có đủ tin nhắn, nên nó là mốc so sánh thật. Trước đây tôi
kết luận "MsgInfo.db rỗng nên không so được" — sai chỗ tìm: **`ftsm_*.db`** (chỉ
mục tìm kiếm toàn văn, 34 MB) giữ **166 912** tin, và mỗi hàng mang `msgId`,
`fromUid`, `ts`:

| | |
|---|---|
| Zalo PC | 166 912 tin |
| DB của repo | 172 433 id khác nhau |
| giao nhau | 134 495 (**80,6 %**) |
| Zalo PC có, ta không | **32 417** |
| trong đó `fromUid = '0'` (= **của chính mình**) | **30 564** |

`fromUid = '0'` là sentinel "của mình" của Zalo PC: 35 780 tin của chủ tài khoản.
DB của repo chỉ có **5 892** `from_me = 1` — tức **14,5 %**.

### Loại trừ lỗi của ta trước khi đổ cho máy chủ

Hai giả thuyết phải loại, nếu không sửa sẽ sai chỗ:

1. **`isSelf` nhận nhầm người.** Loại: đối chiếu 134 477 tin có ở cả hai nơi —
   5 188 khớp `me`, **0** hàng nói `me` mà Zalo PC nói người khác.
2. **Gộp id bắc cầu nuốt mất tin** (`msg_id` 13 ↔ 17 ký tự). Loại: trong 32 417
   tin thiếu, **chỉ 1** có trong DB ta một hàng cùng nội dung + cùng giây. Không
   phải trùng khoá — chúng **chưa từng được ghi**.

### Nguyên nhân

Log mỗi lượt: `skipReasons {'empty': …, 'no-id': 37 955}` với
`selfSkipped {'no-id': 37 955}` — **mọi** tin bị bỏ vì thiếu `globalId` đều là
tin của chính mình. `globalId = "0"` là chỗ giữ của "chính mình" trong Sync V2:
tin do thiết bị này đẩy lên lịch sử không mang id máy chủ.

Zalo PC **không** bỏ chúng: 0/166 912 hàng thiếu id, và đúng **30 150** tin của
mình mang khoá tự sinh `<13 chữ số>_<000|001|002…>` (`instr` cho thấy `_` luôn ở
vị trí 14, hậu tố là số thứ tự tăng dần). Ta thì bỏ trắng.

Đã kiểm cả hai khoá thay thế khả dĩ, cả hai đều không dùng được:

- **`clientId`**: trên 134 477 tin có ở cả hai nơi, `clientId` của ta xuất hiện
  trong `msgKey` của Zalo PC **0 lần**. Nó là id cục bộ của thiết bị gửi.
- **13 chữ số đầu của khoá tổng hợp**: 29 626/30 150 có trong DB ta, nhưng
  29 470 trong số đó là tin `from_me = 0` lệch thời gian — trùng số, khác tin.

### Sửa

`chunkToMessages` không bỏ tin `globalId = "0"` nữa; nó cấp khoá cục bộ
**tiền định** `syncv2:<timestamp>:<số thứ tự trong cùng giây>` (`localKey`).
Chỉ đọc dữ kiện có sẵn trong gói, nên cùng một tin luôn ra cùng một khoá và
lượt sau ghi vào **đúng dòng cũ**. Tiền tố `syncv2:` giữ khoá này không thể đụng
id máy chủ (thuần chữ số), nên không bao giờ ghi đè tin thật.

`SkipReason` còn đúng **một** giá trị (`'empty'`); `selfSkipped['no-id']` biến
mất cùng lý do của nó. Log có thêm `locallyKeyed`.

### Lỗi thứ hai, do chính bản sửa này gây ra — và đã sửa

Bật khoá cục bộ lúc 18:28 thì 18:29 log có:

```
history-cursor {"round":0,"asked":"syncv2:1790145644615:0","hasBefore":true}
error {"message":"Cannot read properties of undefined (reading 'map')"}
history {"ok":false,"reason":"timeout"}     ← lặp mãi
```

`olderMsgId` kiểm `if (!current) return true` **trước** khi thử `BigInt`, nên
khoá cục bộ **đầu tiên** lọt thẳng vào con trỏ phân trang `cmd 510` và treo mọi
lần xin lịch sử. Sửa: `isServerMsgId` (thuần số) lọc ở cả `olderMsgId` và
`fetchCloudPage`; hàm đặt trong `sync-v2-map.ts` cạnh `localKey` vì đó là hai
nửa của cùng một quy tắc — khoá cục bộ chỉ để **đọc**, không bao giờ đi ra dây.
Test `'chỉ id máy chủ mới được đi ra ngoài'` giữ điều đó.

### Đo sau khi sửa (2026-11-11 18:28)

| | trước | sau |
|---|---|---|
| tin của mình trong DB | 5 892 | **42 487** |
| tin của mình trong nhóm | 1 144 | **5 471** |
| tin của mình 1-1 | 4 748 | **37 016** |
| hàng dùng khoá cục bộ | 0 | **36 676** |
| tổng số tin | 172 436 | **209 111** |

Trong lượt chạy thật: `written` 86 203 với `self` 28 469 (**33 %**, trước đó
3,5 %) và `locallyKeyed` 25 361.

**Chống trùng — đo, không suy luận.** Lượt đồng bộ thứ hai chạy lại trên dữ
liệu đã có khoá cục bộ:

```
total 209 111 · localkey 36 676 · from_me=1 42 487 · nhóm khoá cục bộ lặp: 0
```

Cả ba con số **không đổi**. Khoá tiền định ghi vào đúng dòng cũ.

84 nhóm `(thread, ts, text)` trùng nhau trong DB — **0 nhóm** dính khoá cục bộ,
tất cả là khoá máy chủ từ trước, không liên quan bản sửa này.

### 4j-bis. Phép đo phủ sóng theo nội dung — và hai cái bẫy trong đó

Phép so ở trên chỉ đúng cho tin có **id máy chủ**; 36 676 hàng khoá cục bộ không
so được bằng id. Muốn biết còn thiếu bao nhiêu thì phải so theo nội dung. Phép
so đó có hai cái bẫy, cả hai đều cho ra kết luận sai nếu không phát hiện.

**Bẫy 1 — `searchIndex.content` KHÔNG phải text gốc.** Hiệu chuẩn trên 131 606
cặp **khớp `msgId`** (chắc chắn cùng một tin): chỉ **7 599** trùng tuyệt đối
(5,8 %). Tưởng là ta lưu sai. Không phải: đếm ký tự có dấu — Zalo PC có **77**
dòng, ta có **116 678 trên cùng 131 606 cặp**. Chỉ mục tìm kiếm **bỏ dấu** toàn
bộ. Bỏ dấu cả hai bên thì 97 015/131 606 trùng (73,7 %); phần còn lại lệch do
cắt khoảng trắng và chuẩn hoá dấu câu. **Mọi phép so phải bỏ dấu hai bên.**

**Bẫy 2 — `searchIndex` không có cột hội thoại**, nên chỉ so được theo
`(giây, nội dung)`. Nguy cơ va chạm: đo phân bố số hàng của ta theo khoá đó —
204 364 khoá chỉ có **1** hàng, 2 260 khoá có ≥2. Va chạm có thật nhưng thưa, và
đều là tin của người khác cùng giây cùng chữ (sticker, "ok", "dạ").

### Kết quả

Phủ sóng = khớp `msgId` **hoặc** khớp `(giây ±60, nội dung đã bỏ dấu, cùng phía
gửi)`. Cửa sổ ±60 s không phải để nới cho có: đo riêng, nới từ ±0 lên ±60 chỉ
cứu thêm 17 tin, lên ±1 giờ cứu 113 — tức lệch thời gian **không** phải nguyên
nhân của phần thiếu.

| | Zalo PC có | ta có | phủ sóng | thiếu |
|---|---|---|---|---|
| tin **của mình** | 34 757 | 29 220 | **84,1 %** | **5 537** |
| tin **người khác** | 126 674 | 126 516 | **99,9 %** | 158 |

Trong 131 531 tin khớp qua id, phép so nội dung tìm thêm **24 205** tin mà phép
so id bỏ sót — đúng bằng các hàng dùng khoá cục bộ. **Đó là bằng chứng độc lập
rằng khoá cục bộ trỏ đúng tin thật, không phải bản sao.**

### Phần còn thiếu là gì

5 520 trong 5 537 (17 tin còn lại là tin không phải text). Chúng:

- **là tin text bình thường**: `msgType = 1`, `msgKey` dài 18–20 — **giống hệt**
  phân bố của những tin đã lấy được (18/19/20: 76/4 285/1 159 so với
  104/3 948/990). Không có dấu hiệu nào phân biệt được chúng.
- **rải đều các năm**, không dồn vào một giai đoạn:

  | năm | Zalo PC | ta có | phủ sóng |
  |---|---|---|---|
  | 2020 | 201 | 190 | 94,5 % |
  | 2021 | 7 223 | 6 637 | 91,9 % |
  | 2022 | 5 877 | 5 089 | 86,6 % |
  | 2023 | 4 220 | 2 927 | **69,4 %** |
  | 2024 | 10 752 | 9 159 | 85,2 % |
  | 2025 | 3 233 | 2 585 | 80,0 % |
  | 2026 | 3 282 | 2 677 | 81,6 % |

- **5 498/5 520 mang đúng khoá tổng hợp** `13 chữ số_xxx` của Zalo PC — tức đúng
  loại tin mà Zalo PC phải tự sinh khoá, cùng loại ta vừa sửa.

Nghĩa là: đường ghi đã đúng, nhưng **máy chủ chỉ trả về chừng ấy** cho những
phiên này. Đây không phải lỗi gộp khoá và không phải lỗi nhận diện người gửi —
cả hai đã loại bằng phép đo ở trên.

### Rủi ro trùng lặp của bản sửa — đo, không suy luận

| phép đo | kết quả |
|---|---|
| hàng khoá cục bộ **đồng thời** có hàng id máy chủ cùng hội thoại + cùng nội dung (±60 s) | **1** / 38 848 (0,003 %) |
| nhóm trùng **giữa** các hàng khoá cục bộ (cùng tin về hai gói) | **0** |
| nhóm `(thread, ts, text)` trùng tuyệt đối trong DB | 84 — **0** nhóm dính khoá cục bộ, tất cả là khoá máy chủ từ trước |

Số thứ tự theo gói là ổn định: không có trường hợp nào cùng một tin về trong hai
gói khác nhau rồi nhận hai số thứ tự. Nếu có, bảng trên sẽ thấy hàng dư.

### Còn lại phải làm cho §4j

1. **5 537 tin của mình máy chủ không trả.** Không sửa được ở đường ghi. Hai
   hướng còn lại: (a) xin lại lịch sử với khoảng thời gian hẹp hơn quanh các mốc
   thiếu, (b) chấp nhận và ghi rõ trong tài liệu là có mất mát. Chưa chọn.
2. **Phép đo này so theo `(giây, nội dung)`, không theo hội thoại** — `searchIndex`
   không có cột hội thoại. Va chạm ước ~2 260 khoá có ≥2 hàng, nên con số 84,1 %
   có thể **thấp hơn** thực tế một chút (một tin của mình "khớp" nhầm với tin
   của mình ở hội thoại khác). Muốn chắc phải lấy danh sách hội thoại từ nguồn
   khác — `MsgInfo.db`/`ThreadMsg` đều rỗng nên hiện chưa có.

## 6. Việc của phiên sau

1. **Đo lại trên app thật với watchdog** — đây là việc chính, và là điều kiện
   để coi §4 là đã xác nhận. Mở Zalo trên điện thoại, màn hình sáng, sẵn sàng
   bấm. Chỉ khi log có `transfer_status` **rồi** phiên sống tiếp quá 180 s kể từ
   lúc mở thì mới chứng minh được watchdog hoạt động trên dây (unit test chỉ
   chứng minh logic).
2. **Xác định điện thoại có thức hay không, bằng thứ không phụ thuộc log của ta.**
   R17 đo được `status: 3 → 4` ở một lượt; hai lượt R18 không có gì. Nếu lượt
   sau vẫn không có `transfer_status` mà thông báo vẫn hiện, thì khung `601` bị
   rơi ở đâu đó giữa máy chủ và ta — lúc đó mới đáng soi đường nhận.
3. **Thử `database: "message"` với `partition` thật** (từ danh sách hội thoại đã
   lưu) song song với bước conversation. Nếu phiên message có `transfer_status`
   mà phiên conversation không có, thì giả thuyết 3 được xác nhận — và bước
   conversation chỉ cần chạy khi `kv` trống. Repo đã đủ đường để làm việc này.
4. **Không đổi hình dạng `req` thêm nữa.** Nó đã khớp từng trường với
   `SyncSession.requestSync` của Zalo PC, và ba sửa của R18 đo được trên dây đúng
   như thiết kế.
5. ~~Dọn 79 139 hàng rác~~ — **đã làm, xem §4i**.
6. ~~Bỏ bản ghi `threads` mang id nhiễu~~ — **đã làm cùng lượt, §4i**.
7. **Điện thoại vẫn bỏ qua hộp xác nhận — nay đã có bằng chứng loại trừ phía
   người dùng.** Người dùng xác nhận **chưa bao giờ** bấm "Luôn cho phép". Đếm
   trên toàn bộ log: `status:5` (`BypassConfirmed`) **46** lần, `status:3`
   (`WaitingConfirm`) **1** lần, `status:4` (`Confirmed`) **1** lần. Nếu `5` là
   kết quả của một lựa chọn của người dùng thì nó phải đi kèm `3` rồi `4` ở mỗi
   lần — không phải 46 lần `5` đứng một mình.

   Vậy `status:5` ở đây là **điện thoại tự quyết**, và hai khả năng còn lại, cả
   hai đều nằm ngoài mã của ta: (a) điện thoại đang tiếp tục một phiên
   `transfer_sync2` cũ mà ta không đóng được tử tế (ta giết app giữa lúc chuyển
   — `sweepStaleSessions` chỉ dọn phía ta), hoặc (b) phụ huynh/thiết bị có một
   cài đặt "luôn cho phép" ở tầng Zalo, không phải hộp thoại của phiên này.
   `Idle` giờ **không** đặt lại hạn nên chuỗi đó đóng đúng lúc thay vì treo
   thêm 180 s; muốn đi tiếp thì phải quan sát **màn hình điện thoại** lúc bấm
   "Đồng bộ ngay", không phải log của ta.

## 7. Ràng buộc giữ nguyên

- Chỉ **tài khoản phụ**; zca-js không chính thức.
- **Không copy** `zca-session.bin` ra khỏi dot-folder; dùng
  `PORTABLE_EXECUTABLE_DIR="$HOME/.config/zalo-apple-glass-ui"`.
- Log chỉ metadata — không nội dung tin, không cookie, không IMEI, không `temp_key`.
- ADR-004: chỉ `session.ts`/`zalo-client.ts` import `zca-js`.
- `npm run build:electron` sau mỗi lần sửa; kiểm
  `ps aux | grep -c "[e]lectron/dist/electron"` trước khi chạy.

## 8. Lệnh chạy lại

```bash
cd "/home/nguyenhuu/Hoc Tap/Zola"
npm run build:electron
ps aux | grep -c "[e]lectron/dist/electron"     # phải là 0
PORTABLE_EXECUTABLE_DIR="$HOME/.config/zalo-apple-glass-ui" GLASS_PHONE_SYNC=1 \
  nohup npx electron . --disable-gpu --remote-debugging-port=9222 > /tmp/r18/glass-run.log 2>&1 &
node /tmp/r17/cdp-eval.mjs "(()=>{document.querySelector('.live-entry button.subtle-btn').click();return 'live'})()"
node /tmp/r17/cdp-eval.mjs "(()=>{[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Đăng nhập Zalo thật').click();return 'login'})()"
node /tmp/r17/cdp-eval.mjs "(()=>{window.chat.syncFromPhone();return 'triggered'})()"
# Mở Zalo trên điện thoại TRƯỚC khi chạy bước cuối và sẵn sàng bấm thông báo.
# Đừng kết luận trước 180 s, và sau khi thấy `transfer_status` thì đừng kết luận
# ngay — watchdog phải giữ phiên sống thêm một hạn nữa kể từ dấu hiệu cuối.
```

Dấu hiệu lượt đo thành công (thứ tự trong log):

```
conversations-first → requested → control (transfer_status, syncIdPrefix) …
→ batch/conversation-batch …     ← điện thoại đã bấm, dữ liệu bắt đầu chảy
```

Nếu `phase:"failed"` rơi đúng 180 s sau `requested` **mà không có** dòng
`control` nào ở giữa, thì watchdog vẫn đang chạy đúng — chỉ là không có dấu hiệu
sống nào để đặt lại.

Log nằm ở `~/.config/zalo-apple-glass-ui/.glass-demo-data/live-listener.log`.
