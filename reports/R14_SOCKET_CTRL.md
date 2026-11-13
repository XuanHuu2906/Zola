# R14 — Socket điều khiển: đo trước khi viết

Date: 2026-11-09 (Asia/Saigon). Tiếp [R13](R13_SYNC_V2.md).
Trạng thái: **đo xong, kết quả đổi hướng A.**

R13 để lại một câu chưa trả lời: `temp_key` đến trên `cmd 601`, `601` chưa từng
thấy trong log, và tôi đề xuất hai hướng. Hướng B (đo `wpz_ws`) chạy trước, và
nó không chỉ trả lời câu hỏi — nó **bác bỏ giả định** mà hướng A dựa vào.

## Trước hết: một kết luận cũ của tôi là sai

Tôi đã nói "`cmd 601` chưa từng xuất hiện trong 711 dòng log" và coi đó là bằng
chứng máy chủ không gửi. **Sai.** `frame` và `frame-summary` nằm sau
`GLASS_REQUEST_SYNC_PROBE` (`electron/protocol/zalo-client.ts:1197`), mà lần chạy
khi đó chỉ có `GLASS_PHONE_SYNC`. Phép đo chưa từng được bật. Con số 0 đó là
"không ai đếm", không phải "không có gì để đếm".

Đây là dạng lỗi đáng nhớ: một phép đo không chạy và một phép đo trả về 0 trông
giống hệt nhau trong log.

## Đo lại: `601` **có** đến

Chạy với `GLASS_REQUEST_SYNC_PROBE=1`, sau khi gửi `cmd 590`:

```
request-sync-probe {"ok":true,"cmd":590,"sent":true}
frame {"version":1,"cmd":590,"subCmd":0,"bytes":253,
       "shape":{"encrypt":2,"errorCode":0},"inner":{"reason":"inflate"}}
frame {"version":1,"cmd":621,"subCmd":0,"bytes":393}
frame-summary {"frames":[{"key":"1/590/0","count":1},{"key":"1/621/0","count":1}]}
```

Không có `1/601/0`. Nhưng lần này phép đo **đang chạy**, nên đây là kết quả
thật: trong cửa sổ 15 giây sau `cmd 590`, máy chủ trả lời trên `590` và đẩy
`621` (cloud need-verify), **không** đẩy `601`.

Ghi chú phụ: `inner.reason: "inflate"` — thân `590` có `encrypt: 2`, và bản giải
`describeDecodedPayload` thất bại ở bước inflate. Đây là một lỗ hổng riêng, chưa
sửa, xem "Còn mở" bên dưới.

## Đo `zpw_ws`: bảy endpoint, **toàn socket tin nhắn**

`reportWsEndpoints` (`electron/protocol/ws-endpoints.ts`) đọc `ctx` qua
`client.custom` — cửa duy nhất zca-js mở cho việc này — và ghi hình dạng:

```json
{"count":7,
 "endpoints":[
   {"origin":"wss://ws1-msg.chat.zalo.me","path":"/"},
   {"origin":"wss://ws2-msg.chat.zalo.me","path":"/"},
   {"origin":"wss://ws3-msg.chat.zalo.me","path":"/"},
   {"origin":"wss://ws4-msg.chat.zalo.me","path":"/"},
   {"origin":"wss://ws5-msg.chat.zalo.me","path":"/"},
   {"origin":"wss://ws8-msg.chat.zalo.me","path":"/"},
   {"origin":"wss://ws12-msg.chat.zalo.me","path":"/"}],
 "enableChatSocket":true,"enableCtrlSocket":true,
 "serviceMapKeys":45,"controlish":["sync_action","reaction"],
 "loginInfoConnectionFields":["gmap_url","qos_url","zpw_ws"]}
```

Ba điều:

1. **Không có endpoint điều khiển riêng.** Cả bảy là `-msg` — họ tin nhắn. Host
   khác nhau chỉ để cân tải, không phải phân loại chức năng.
2. `enable_ctrl_socket: true` **trong tài khoản này** (khác giá trị `!1` ghi
   trong R12 — cái đó là mặc định cứng, máy chủ ghi đè theo tài khoản).
3. `loginInfo` chỉ có ba tên trường liên quan kết nối: `zpw_ws`, `gmap_url`,
   `qos_url`. **Không có `ctrl_ws` hay tương đương.** Nếu máy chủ có cấp socket
   điều khiển, nó không nằm trong dữ liệu đăng nhập.

Một lỗi trong chính phép đo, đã sửa: `ctx.zpwServiceMap` không tồn tại — service
map nằm trên `api` (`node_modules/zca-js/dist/apis.js:159`). Lần đo đầu báo
`serviceMapKeys: 0`, trông như "máy chủ không cấp gì" nhưng thực ra là đọc sai
chỗ. Sửa xong ra 45.

## Đọc mã Zalo PC: kênh ctrl — **cùng một socket, chọn theo `cmd`**

Một khẳng định trước đó trong chính báo cáo này — "`connectCtrSocket()` chỉ gọi
`connectCtrPolling()`, nên không có socket điều khiển" — **sai**. Đọc đúng chỗ
(`367269-367286`):

```js
connectCtr(e) {
  this.connectCtrSocket = () => {
    const t = i.default.getCtrlHandler();   // = k = new P(), tức ctr-handler
    this.dispatchEvent(new b(this._ctrlHandler, t));
    t.connect(e);
    this._ctrlHandler = t;
    this.ctrlConnectType = E.WEBSOCKET;
  };
  this.connectCtrPolling = () => { ... t.start(); this.ctrlConnectType = E.LONG_POLLING; };
  this.enableCtrlSocket ? this.connectCtrSocket() : this.connectCtrPolling();
}
```

Hai thân hàm khác nhau, và nhánh **socket** gọi `t.connect(e)` — không phải
`t.start()`. Không có lời gọi `connectCtrPolling` nào bên trong `connectCtrSocket`.

Ba dòng nối tiếp chứng minh `e` là **chính socket đó**, không phải kết nối mới:

```js
async init(e) {                     // 131167 — thân của lớp socket U extends s.a
  v.a.init(e, this);                // chat handler   nhận socket này
  k.init(e, this);                  // ctrl handler   nhận **cùng** socket này
  ...
}
_getDataHanlder(e, t) {             // 131217 — dispatch khung đến
  return ... v.a.isChatCommand(e) ? v.a : k.isCtrlCommand(e) && (n = k), n;
}
```

Và `doGetOffline` gửi bằng `this.socket._send(i)` (`166034`) — chính `_send` của
socket dùng chung.

**Kết luận:** không có endpoint ctrl riêng, nhưng cũng không cần. Zalo PC phân
luồng theo `cmd` trên **một** WebSocket: `501`/`521` cho tin nhắn, `601`/`602`/
`603`/`610`/`611`/`612` cho điều khiển. Gửi `603` qua socket zca-js là **đúng
đường**. Phép đo ngày 2026-11-09 xác nhận: phản hồi `603` về với `reqId` khớp.

Đó cũng là lý do `fallback_LP` (`hws.chat.zalo.me`) không phải chìa khoá: nó là
đường lui khi WS hỏng, không phải kênh ctrl thường trực.

## Vì sao `601` không đến: nó không phải push không điều kiện

`handleTransferAfterLoginCtrlEvents` (`main-startup:23402`) chỉ xử lý sự kiện
`transfer_msg` trong `controls` — mà `controls` là thân của phản hồi **`603`**.
Không gửi `603` thì không có `601`. Lần đo trước không gửi, nên con số 0 là hệ
quả của việc không hỏi, không phải "máy chủ không đẩy".

Nhưng gửi `603` **cũng không đủ**. `temp_key` chỉ đến khi điện thoại đã được
đánh thức và có phiên chuyển:

```
requestMobileWakeUp(e)  →  cmd 592  (SYNC_MESSAGE.REQUEST_MOBILE_WAKE_UP)
requestSyncMessage(e)   →  cmd 590  (SYNC_MESSAGE.REQUEST)
ackDeleteSyncSession(e) →  cmd 591
```

`592` là bước ta **chưa có** (`grep` toàn repo: 0 kết quả). Đó là khoảng trống
thật, và nó giải thích toàn bộ chuỗi thay vì để lại một câu hỏi mở.

## Đo 45 khoá service map: cái nào là long-poll

`serviceMapNames` ghi đủ 45 tên, `serviceMapOrigins` ghi origin từng khoá (không
path, không query). Hai khoá nói được điều gì đó:

| Khoá | Origin | Đọc ra |
| --- | --- | --- |
| `fallback_LP` | `https://hws.chat.zalo.me` | **`LP` = long-poll.** `hws` = host-webservice |
| `sync_action` | `https://action-sync-wpa.chat.zalo.me` | `wpa`, không phải long-poll |
| `backuppcmobile` | `https://bkpc2mb.zaloapp.com` | đúng chiều PC → phone, xem R12 |

Ban đầu tôi đọc `fallback_LP` là "ứng viên sáng giá nhất cho kênh `603`". **Sai**
— và phần đọc mã bên dưới cho thấy vì sao: không cần endpoint nào cả. `603` đi
qua chính socket đang mở; `fallback_LP` là đường lui khi **socket** hỏng (đúng
tên nó: `enable_fallback_lp`, `MsgSources.POLLING`), không phải kênh ctrl.

Giá trị thật của phép đo này là **phủ định**: trong 45 khoá không có khoá nào
tên `ctrl`, `control`, hay `ws`/`socket` riêng. Không có endpoint ctrl để tìm —
phù hợp với việc Zalo PC chọn handler theo `cmd` trên một socket.

## `590` và `603`: máy chủ trả lời **đúng request của ta**

Đo lần hai, sau khi sửa bộ giải nén:

```
request-sync-probe {"ok":true,"cmd":590,"sent":true,"reqIdChars":19,"bodyBytes":51}
ctrl-poll-probe    {"ok":true,"cmd":603,"sent":true}
frame {"cmd":590,"bytes":253,
       "inner":{"ok":true,"keys":["data","error_code","error_message"],
                "errorCode":0,"reqIdChars":19,"innerDataChars":0}}
frame {"cmd":603,"bytes":381,
       "inner":{"ok":true,"keys":["data","error_code","error_message"],
                "errorCode":0,"reqIdChars":18,"innerDataChars":0}}
```

`reqIdChars: 19` cho `590` khớp đúng `reqIdChars: 19` của request đã gửi;
`18` cho `603`. Đây là **bằng chứng định danh**, không phải suy luận từ kích
thước: `reqId` chỉ có thể nằm trong thân nếu ta mở được phong bì, và nó chỉ khớp
nếu máy chủ đang trả lời request đó.

Điều này chốt ba việc:

1. `cipher_key` của phiên **đúng** cho cả hai kênh. GCM có tag xác thực — sai
   khoá không thể qua lớp AES.
2. Gửi `603` qua socket zca-js là **đúng đường**, không phải gửi nhầm cửa.
3. `errorCode: 0` là mã máy chủ trả cho request này, đọc ở **trong** phong bì —
   khác hẳn `error_code: 0` ở tầng ngoài, vốn chỉ nói "phong bì nguyên vẹn".

Cả hai phản hồi đều rỗng nghĩa (`innerDataChars: 0`): máy chủ nhận và chấp nhận,
nhưng không có gì để đẩy xuống — đúng như dự đoán khi điện thoại chưa được đánh
thức bằng `592`.

## Vì sao trước đó đọc không ra: gzip, không phải zlib

`plainKind` đo được: `'gzip'`, 98 byte cho `590` và 193 byte cho `603`.
`inflateSync` của Node chỉ nhận zlib/deflate, nên nó ném trên **mọi** phản hồi
`encrypt: 2` — và lỗi đó bị đọc thành "không giải được". Thật ra chỉ là chọn sai
bộ giải. Đổi sang `unzipSync` (tự nhận cả gzip và zlib) là xong.

Đây là lần thứ hai trong báo cáo này một **công cụ đo hỏng** trông giống hệt một
**kết quả đo bằng 0**. Lần đầu là `601`; lần này là `inflate`. Cùng một bài học.

## `cmd 592`: đã gửi, chưa được trả lời — và một thứ tự tôi làm ngược

Đo ngày 2026-11-09, ba lần chạy liên tiếp sau khi nối `592` vào đường phiên:

```
# lần 1 — 592 gửi một mình, không có 590 trước
wake-mobile {"ok":false,"reason":"no-reply","timeoutMs":3000}
wake-probe  {"ok":false,"code":"no-reply","elapsedMs":3102,"syncIdChars":21}
frame-summary {"frames":[{"key":"1/1/1","count":1},{"key":"1/621/0","count":1}]}

# lần 2 — 590 mở phiên trước, chờ 1,2 s, rồi 592
wake-probe  {"ok":true,"step":"opened","cmd":590}
frame {"cmd":590,"subCmd":0,"bytes":265,"inner":{"ok":true,"errorCode":0,"reqIdChars":19}}
wake-mobile {"ok":false,"reason":"no-reply","timeoutMs":3000}
wake-probe  {"ok":false,"code":"no-reply","elapsedMs":3001}
frame-summary {"frames":[{"key":"1/1/1","count":1},{"key":"1/590/0","count":1},{"key":"1/621/0","count":1}]}
```

Hai điều đọc được, cả hai đều là **sửa một kết luận cũ của tôi**:

1. **`592` phải đi sau `590`, không phải trước.** Tôi đã nối theo thứ tự ngược.
   Mã Zalo PC nói rõ vì sao: `sessionManager.wakeup()` lấy `this.syncSessions[0]`
   (`CdmT.js:8779-8781`) — một phiên **đã tồn tại** — mà phiên chỉ vào danh sách
   đó trong `create()`, tức *sau* `a.start()` tức sau `590` (`CdmT.js:8694`).
   Không có phiên thì `592` chỉ là một khung nói về một `syncId` máy chủ chưa
   từng thấy. Đã đảo thứ tự trong `SyncV2Session.start` và cập nhật 5 test.
2. **Nhưng `590` một mình vẫn chưa đủ để `592` có phản hồi.** `590` tối thiểu
   (`{ data: { lastId: 0 } }`) được nhận — `errorCode: 0`, `reqId` khớp 19 ký tự
   — mà `592` vẫn im trong cả ba lần. Nghĩa là "máy chủ nhận `590`" ≠ "máy chủ
   đã tạo transfer session để mà đánh thức". Đây là chỗ duy nhất còn hở.

Một chi tiết hình dạng đáng ghi: phản hồi `592` mà Zalo PC chờ không đến trên
`601` như tôi từng giả định, mà trên **chính `592`** — `isApiCommand` định tuyến
nó vào handler api, `onData` tra `n.data.reqId` (`compact-app-pc:630456-630465`).
Và `reqId` của `592` nằm **một tầng** (`data.reqId`, do `addCommonParams` chèn
`{ ...e.data, reqId }`, `:630522-630525`), khác `590` hai tầng
(`data.data.reqId`). `sendWakeMobile` nay gắn bộ nghe trước khi gửi, so khớp
`reqId`, rồi mới đọc `code` — đúng `0 == e.code` của `wakeup()`.

## `1/1` có `ctrl_qCmds` — và probe đầu tiên đọc sai tầng

Đo tiếp ngày 2026-11-09, sau khi nghi ngờ "`ctrl_qCmds` không có ở `1/1`" được
xác nhận **sai**:

```
auth-probe {"subCmd":1,"bodyBytes":410,"encrypt":2,"ok":false,"reason":"no-data"}
```

Đó là lỗi của probe, không phải của giả thuyết. `1/1` có `encrypt: 2`: `data` là
**chuỗi đã mã hoá**, không phải object. `_processAuthData` của Zalo PC
(`sync-v2-sub-worker`) gọi `JSON.parse` **sau** `_decrypt` + `_decompress`, và
zca-js gán `cipherKey` trong chính lượt xử lý `1/1` của nó
(`dist/apis/listen.js:151-158`). Sửa probe: hoãn một macrotask (để chắc chắn
qua được cả hai thứ tự đăng ký listener), rồi `unwrapPayload(encrypt, data,
cipherKey)`. Kết quả:

```
auth-probe {"subCmd":1,"bodyBytes":410,"encrypt":2,"ok":true,
  "keys":["bk_cmds","ctrl_qCmds","qCmds"],
  "ctrlQCmds":3,"ctrlQCmdIds":[610,611,603],
  "queueDetail":[
    {"cmd":610,"subCmd":1,"keys":["cmd","queueName","subCmd"]},
    {"cmd":611,"subCmd":1,"keys":["cmd","queueName","subCmd"]},
    {"cmd":603,"subCmd":1,"keys":["cmd","queueName","subCmd"]}],
  "qCmds":5,"qCmdIds":[515,517,518,510,511],
  "backupCmds":null}
```

Ba hàng điều khiển, đúng enum: `610 = CTRL_PULL_REACT`,
`611 = CTRL_PULL_REACT_BIG_GR`, `603 = CTRL_PULL_CTRL`. Năm hàng còn lại là
`qCmds` — hàng E2EE, do `E2eeQueueOfflineController` long-poll riêng; không
phải đường của `transfer_after_login`.

Long-poll từng hàng bằng đúng hình dạng `doGetOffline`
(`{first, reqId, lastId:'1', preIds:[]}`) và `subCmd` **lấy từ hàng đợi máy chủ
cấp**:

| hàng | phản hồi | ghi chú |
| --- | --- | --- |
| `610/subCmd:1` | sau ~25 ms | `errorCode: 0`, `innerDataChars: 0` |
| `611/subCmd:1` | sau ~25 ms | `errorCode: 0`, `innerDataChars: 0` |
| `603/subCmd:1` | **không có** trong 30 s | long-poll: `offline_timeout: 48e4` = 480 s |

`603` im **không phải** lỗi: đây là long-poll thật — máy chủ giữ kết nối và chỉ
trả lời khi có sự kiện. Lần đo trước với `603/subCmd:0` trả lời trong 34 ms vì
`subCmd` đó không phải hàng đợi đã đăng ký. **Bài học: `subCmd` phải lấy từ
`ctrl_qCmds`, không được đoán `0`.**

## `temp_key` KHÔNG phải điều kiện của `592`

Đọc `Vo` trong `shared-worker.cfeba43a9a8e4e40dda3.js`:

```js
// constructor
this.oneTimeKey = n;
this.syncKey = s.genSyncKeyPair();

// wakeup()  — chỉ hai trường
wakeup() {
  return this.syncChanel
    .requestWakeUp({ syncId: this.syncId, toDevice: this.toDevice })
    .then(e => (0 == e.code && (this.startTimeoutReceiveBatch(...), ...), new wo.m(e.code, e.message)));
}

// requestSync() — đây mới là chỗ tempKey vào
tempKey: this.oneTimeKey,
```

`requestWakeUp` mang **đúng hai trường** `syncId` và `toDevice` — không `tempKey`,
không `ek`/`ik`. Nên giả thuyết cũ ("`592` im vì thiếu `temp_key`") **sai**.
`temp_key` chỉ cần cho `requestSync`, và `genSyncKeyPair()` không phụ thuộc nó —
`ek`/`ik` sinh từ wasm, `tempKey` là trường độc lập trong payload.

Và trong `sessionManager.create()`:

```js
const n = this.syncSessions.length ? "" : this.oneTimeKey;
```

**Phiên đầu tiên dùng `temp_key`; mọi phiên sau dùng chuỗi rỗng.** Nghĩa là
`tempKey: ""` là một giá trị hợp lệ mà Zalo PC thật sự gửi — không phải một lỗi
cần né.

## Vì sao `592` vẫn im: `590` rỗng không tạo được phiên

`requestSync()` thất bại ngay trên payload tối thiểu mà `runWakeProbe` gửi:

```js
if (this.requests.some((e, t, s) => 0 !== t && e.type !== s[0].type))
  throw new Error("Permission denied, access multi database in one request.");
```

Payload `{ data: { lastId: 0 } }` không có `req.type`/`req.queries`, nên không
dựng nổi `a = { syncId, syncType, ek, ik, toDevice, tempKey, deviceName, req, ver, ussidx }`.
Máy chủ trả `errorCode: 0` cho **phong bì**, nhưng không có phiên nào vào
`syncSessions` — và `wakeup()` đọc `this.syncSessions[0]`, nên
trả `-1, "Wakeup without session"` mà không gửi gì.

Đó là toàn bộ lời giải thích cho ba lần đo "`592` không có phản hồi": không phải
máy chủ từ chối, mà **ta chưa từng gửi `592` cho một phiên tồn tại**.

## Đường đúng: HTTP `request-sync`, không phải WS `590`

Zalo PC có **hai** hàm cùng tên `requestSyncMessage`:

- **WS `cmd 590`** — `requestAsyncV2({cmd: 590, subCmd: 0, data: { data: e }})`,
  dùng bởi đường chat cũ.
- **HTTP `GET /api/transfer-sync-v2/request-sync`** —
  `params = encodeAES({reqId, data: JSON.stringify(payload)})`, dùng bởi Sync V2
  (`sync-v2-sub-worker`). Repo này đã dùng đúng đường HTTP
  (`electron/protocol/sync-v2-request.ts`), nên không cần đổi.

## Còn mở

- **Chưa có `temp_key` thật** trong bất kỳ lần chạy nào. Nó đến qua
  `601 transfer_after_login`, và `601` chưa từng xuất hiện trong log — kể cả sau
  khi `603` đã long-poll đúng cách. Nghĩa là sự kiện này chỉ tới khi điện thoại
  thật sự mở một phiên chuyển, tức khi người dùng bấm đồng bộ trên app Zalo iOS.
- **Chưa thử một phiên HTTP `request-sync` thật** với `tempKey: ""`. Đây là bước
  kế tiếp rẻ nhất: nó không cần `temp_key`, không cần `601`, và trả mã lỗi đọc
  được.


## Sửa trong lúc đo: ba lỗi của chính bộ quan sát

1. **`describePlain` gọi nhầm `'x'` là zlib.** Bản đầu kiểm `plain[0] === 0x78`;
   `0x78` chính là ký tự `'x'`, nên mọi bản rõ bắt đầu bằng "x" — kể cả tiếng
   Việt "xin chào…" — bị dán nhãn `zlib`. Sửa thành kiểm header 2 byte theo
   RFC 1950: `(b0 & 0x0f) === 8` và `((b0 << 8) + b1) % 31 === 0`.
2. **Regex dải `\u00a0-\uffff` so theo code point, không theo byte.** Thay bằng
   kiểm từng byte — đúng đơn vị của dữ liệu đang phân loại, và không còn vi phạm
   `no-irregular-whitespace`.
3. **Chọn sai bộ giải nén** — xem mục "gzip, không phải zlib". Lỗi này không do
   test bắt (test cũ chỉ dựng zlib, đúng thứ `inflateSync` nhận); nó lộ ra khi
   `plainKind` được thêm vào và đọc được `'gzip'` từ phản hồi thật.

Hai lỗi đầu do test bắt. Lỗi thứ ba cho thấy giới hạn của cách đó: một test dựng
phong bì bằng **chính giả định của bộ giải** thì không thể phát hiện giả định sai.
Cái bắt được nó là một nhãn chẩn đoán đối chiếu với dữ liệu thật.

## Kiểm chứng

| Hạng mục | Trạng thái |
| --- | --- |
| `describeWsEndpoints` (9 test, gồm phần che imei/userAgent) | **PASS** |
| `describeDecodedPayload` (17 test, gồm gzip/zlib/text/binary) | **PASS** |
| `wake-mobile` (16 test: hình dạng `592`, khớp `reqId`, đọc `code`) | **PASS** |
| `sync-v2-session` (29 test, gồm 5 test cho thứ tự `590` → `592`) | **PASS** |
| `npm test` | **420/420** |
| `npm run check` | **exit 0** |
| `601` có đến khi phép đo bật? | **ĐO ĐƯỢC: không** |
| `603` gửi qua socket zca-js có được trả lời? | **ĐO ĐƯỢC: có** — `reqId` khớp, `errorCode: 0` |
| `590` tối thiểu có được nhận? | **ĐO ĐƯỢC: có** — `reqId` khớp 19 ký tự, `errorCode: 0`, thân rỗng |
| `592` có được trả lời khi đã có `590` trước? | **ĐO ĐƯỢC: không** — im 3 s, cả khi `590` đã `errorCode: 0` |
| Máy chủ có cấp endpoint ctrl? | **ĐO ĐƯỢC: không** (7/7 là `-msg`) |
| Zalo PC có mở socket ctrl riêng? | **ĐỌC MÃ: không** — cùng socket, chọn theo `cmd` |
| Thân `encrypt: 2` là gì? | **ĐO ĐƯỢC: gzip**, 98 và 193 byte |

Phép đo chạy được nhiều lần: `GLASS_PHONE_SYNC=1 PORTABLE_EXECUTABLE_DIR=... electron .`
với `GLASS_REQUEST_SYNC_PROBE=1`, `GLASS_CTRL_POLL_PROBE=1` và `GLASS_WAKE_PROBE=1`.

Ghi chú vận hành: log đi vào `./.glass-demo-data/live-listener.log` khi chạy từ
thư mục dự án, và vào `~/.config/zalo-apple-glass-ui/.glass-demo-data/` khi chạy
từ bundle. Đọc nhầm file thì thấy log cũ và tưởng app không chạy — đã xảy ra một
lần trong phiên này.