# R17 — Sync V2: điện thoại **thực sự đã xác nhận**; còn hai chỗ chặn

Date: 2026-11-10 (Asia/Saigon). Tài khoản: **phụ**. Nối tiếp
[R16](R16_SYNC_V2_DATABASE_TYPE.md).

Trạng thái: **đã đo lại trên app thật**. R16 đúng — `req.type` giờ là `"message"`
trên dây. Nhưng bức tranh đổi hẳn: **điện thoại đã đánh thức và bấm xác nhận**
(lần đầu tiên trong toàn bộ quá trình), rồi vẫn không có gói nào. Nguyên nhân
không còn nằm ở phía request nữa.

---

## 1. Kết quả đo (log thật, không suy đoán)

Nguồn: `~/.config/zalo-apple-glass-ui/.glass-demo-data/live-listener.log`,
phiên 2026-11-10T10:14:10Z → 10:20:11Z, build mới sau `npm run build:electron`.

```
10:14:39.684  sync-v2      {"step":"start","tempKeySource":"empty","tempKeyChars":0}
10:14:39.698  frame        {"cmd":590, …, "inner":{"errorCode":0,"reqIdChars":37}}
10:14:39.698  request-sync {"ok":true,"cmd":590,"sent":true,"code":0}
10:14:42.702  wake-mobile  {"ok":false,"reason":"no-reply","timeoutMs":3000}
10:14:42.702  sync-v2      {"phase":"receiving","received":0,…}
10:14:42.702  sync-v2      {"step":"requested","database":"message",…}   ← R16 ĐÚNG
10:16:23.186  frame        {"cmd":601,"control":{"acts":["transfer_status"],
                            "actTypes":["transfer_sync2"],"hasTempKey":false}}
10:16:23.186  sync-v2      {"status":3,"from":0}    ← WAITING_CONFIRM, từ MOBILE
10:16:24.357  frame        {"cmd":601,"control":{"acts":["transfer_status"]…}}
10:16:24.357  sync-v2      {"status":4,"from":0}    ← CONFIRMED
… không gói nào …
```

Ba điều đo được, mỗi điều đều ngược với giả định cũ:

1. **`database: "message"`** — sửa của R16 sống trên dây. Yêu cầu được nhận với
   `error_code: 0` và `reqId` được dội lại (37 ký tự = `sync_` + 32).
2. **`592` không có phản hồi trong 3 s — nhưng điện thoại vẫn thức.** Hai khung
   `601` `transfer_status` tới sau **104 giây**, `status: 3` rồi `status: 4`,
   `fromDevice: 0` (Mobile). Zalo PC đặt `wakeupTimeout: 18e4` (**180 s**,
   `shared-worker` `SessionManager.options`). Ta bỏ chờ ở 3 s và coi `wakeup`
   hỏng — **cổng đó là của ta, không phải của máy chủ** (đúng loại lỗi R15 đã
   mắc với `no-temp-key`).
3. **Sau khi CONFIRMED vẫn không có `upload_batch`.** Máy chủ không đẩy gì.

## 2. Vì sao không có gói — hai lỗi cấu trúc, không phải kích thước request

### (a) `cmd 591` chưa bao giờ được gửi

Đếm trên **toàn bộ** log (849 dòng, nhiều phiên): `session-disposed` = **0**,
`session-dispose-failed` = **0**; trong khi `"phase":"failed"` có xuất hiện.
Lý do đọc được từ `SyncV2Session.setPhase`: `591` chỉ nổ khi phase chạm `DONE`
hoặc `FAILED`. Ở lượt 10:14, phiên **không bao giờ chạm trạng thái cuối** — nó
nằm `receiving` cho tới khi tiến trình thoát — nên không có lần `setPhase` nào
để gửi `591`. R16 thêm đúng cái khung, nhưng nhánh trong điều kiện đó không chạy.

Đây là lần thứ ba (R13, R15, giờ) mà một phiên mở bị bỏ lại. Zalo PC dọn khi
`sync-full` kết thúc, và còn dội `OutDated` cho mọi phiên lưu từ lần chạy trước
(`SessionManager.cleanOldSyncSession`). Ta không làm cả hai.

### (b) `(type: "message", partition: "")` không phải hình dạng Zalo từng gửi

Đọc thẳng bộ dựng query trong `shared-worker.cfeba43a9a8e4e40dda3.js`:

```js
static createMessageQuery(e){ … const a = Uc.getPartitionFromConversation(
    e.globalNoisedId, e.isGroup);          // ← luôn có partition
  return Yo.createGetAllQuery().usePartition(a)… }

static createConversationQuery(e){          // ← chỉ cái này không partition
  return Yo.createGetAllQuery().inRange(…)… }
```

Query mặc định của `Zo` là `database: "unspecified"`, `partition: ""` — **không
phải** `"message"`. Nghĩa là `("message", "")` là một ô trống trong ma trận:
không builder nào sinh ra nó. Máy chủ nhận (chỉ kiểm phong bì — đúng như R16 nói)
và không có gì để phục vụ. Yêu cầu #1 mà Zalo PC gửi là **conversation**, và
thứ tự bắt buộc là:

```
determining_initial_sync_state → sync_conversations (type "conversation", partition "")
  → prepare_sync_preview_and_recent_messages → sync_preview_messages
  → sync_other_messages (partition oneone/<id> / group/<id>)
```

Repo đã có `decodeConversationChunk`, nhưng `SyncV2Session` vẫn không rẽ nhánh
theo `req.type`, nên kể cả khi xin conversation thì gói về cũng không được giải.

## 3. Việc của phiên sau — đúng thứ tự

1. **Nới `wakeup` lên 180 s** (`SyncV2Session` / `wake-mobile.ts`), hoặc bỏ hẳn
   khỏi đường tới hạn của phiên: `592` im lặng **không** phải lỗi, đã chứng minh
   bằng chính hai khung `601` ở trên. Ghi `elapsedMs`.
2. **Gửi `591` cả khi phiên không chạm trạng thái cuối.** Gắn vào `dispose()` của
   controller (đang chạy khi app thoát / đổi tài khoản) với `UserCancel`, và gọi
   `cleanOldSyncSession`-tương đương lúc khởi động (`OutDated`). Không có bước
   này thì mỗi lần bấm lại để lại một phiên.
3. **Làm đường conversation trước**, không phải message:
   `type: "conversation"`, `queries: [{partition:"", from:0, to:MAX, limit:2147483647}]`,
   và một nhánh `decodeConversationChunk` trong `sync-v2-batch.ts`. Chỉ sau khi có
   danh sách hội thoại mới có `globalNoisedId` để xin tin.
4. **Ghi `syncId` (dạng hash/tiền tố) vào dòng `control`** của `watchFrames`: hai
   khung `transfer_status` ở §1 khớp về thời gian với phiên của ta, nhưng log
   **không** chứng minh được chúng thuộc `syncId` nào. Đây là lỗ hổng bằng chứng
   thật, không phải chi tiết vụn.

### Không nên làm lại

- Đổi thêm hình dạng `req` — đã khớp **từng trường** với `SyncSession.requestSync`
  của Zalo PC (`syncId, syncType, ek, ik, toDevice, tempKey, deviceName, req{type,
  priority, queries, batchSize}, ver, ussidx`), kể cả `tempKey: ""`.
- `ik` là cặp sinh mới mỗi lần — R15 đã rút lại, và nay đã có `CONFIRMED`, nên
  giả thuyết "điện thoại không có khoá của ta" cũng yếu đi.

## 4. Ràng buộc giữ nguyên

- Chỉ **tài khoản phụ**; zca-js không chính thức.
- **Không copy** `zca-session.bin` ra khỏi dot-folder; dùng
  `PORTABLE_EXECUTABLE_DIR="$HOME/.config/zalo-apple-glass-ui"`.
- Log chỉ metadata.
- ADR-004: chỉ `session.ts`/`zalo-client.ts` import `zca-js`.
- `npm run build:electron` sau mỗi lần sửa; kiểm `ps aux | grep -c "[e]lectron/dist/electron"`
  trước khi chạy (một tiến trình cũ giữ cổng 9222 sẽ làm CDP lái build cũ).

## 5. Lệnh chạy lại (đã dùng, đã đúng)

```bash
cd "/home/nguyenhuu/Hoc Tap/Zola"
npm run build:electron
PORTABLE_EXECUTABLE_DIR="$HOME/.config/zalo-apple-glass-ui" GLASS_PHONE_SYNC=1 \
  nohup npx electron . --disable-gpu --remote-debugging-port=9222 > /tmp/r17/glass-run.log 2>&1 &
node /tmp/r17/cdp-eval.mjs "(()=>{document.querySelector('.live-entry button.subtle-btn').click();return 'live'})()"
node /tmp/r17/cdp-eval.mjs "(()=>{[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Đăng nhập Zalo thật').click();return 'login'})()"
node /tmp/r17/cdp-eval.mjs "window.chat.syncFromPhone()"
# chờ ≥ 120 s trước khi kết luận: điện thoại cần ~104 s để xác nhận
```

`/tmp/r17/cdp-eval.mjs` là bộ đánh giá CDP tối thiểu (dùng `fetch` +
`WebSocket` của Node, không phụ thuộc gói ngoài).
