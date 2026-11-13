# R12 — Giai đoạn 5: chế độ Zalo thật (zca-js)

Date: 2026-11-07 (Asia/Saigon). Cập nhật: 2026-11-08 17:00 (Asia/Saigon) sau lần chạy thật đầu tiên.

Scope: `docs/zalo-ui-plan-v2.md` §5, dưới điều kiện của [ADR-004](../docs/ADR-004-zca-js-integration.md).

## Trạng thái tổng

| Hạng mục | Trạng thái | Bằng chứng |
| --- | --- | --- |
| Code hoàn tất (main, preload, IPC, protocol, renderer) | `IMPLEMENTED` | `npm run typecheck`, `npm test`, `npm run lint`, `npx playwright test` |
| Đăng nhập QR thật | **`PASS`** | `zca-session.bin` 2707 byte ghi lúc 14:45:14 — `SessionStore.save()` chỉ chạy **sau** `loginQR` thành công (xem §"Lần chạy thật đầu tiên") |
| Khôi phục phiên sau khi tắt mở app | **`PASS`** | Phiên 16:07:12 vào thẳng `connected`, không có khung `qr` nào trong log — nghĩa là `restore` đọc được phiên đã lưu |
| Nhận tin realtime | **`PASS`** | Log 17:27–18:03 (giờ máy, UTC+7): 5 dòng `inbound` nhóm + 2 dòng 1-1, `mapped:true` cả 7. Không có nội dung tin trong log — chỉ `kind`/`threadId`/`msgType` |
| Nhận tin 1-1 | **`PASS`** | `inbound {"kind":"user","self":true,"threadId":"8979626095460235814"}` lúc 18:02:51 và 18:03:31 |
| Nhận tin tự gửi từ thiết bị khác | **`PASS`** | Cùng hai dòng trên: `self:true` trên hội thoại 1-1. Đây là lý do `selfListen: true` |
| **Gửi tin + trạng thái** | **`PASS`** | `send {"ok":true,"kind":"user","len":29,"msgId":"8465875514057"}` lúc 18:03:31 (và 18:02:51 với `len:1`). `msgId` là id **máy chủ** trả về, không phải id cục bộ |
| **Lưu bền xuống SQLite** | **`PASS`** | `cache-188436612101457701.db`: đúng hai dòng, `msg_id` = hai `msgId` trên, `status:"sent"`, `client_id` khớp, `text` 29 ký tự. Kiểm bằng `readOnly` sau khi app đã thoát — dữ liệu đã qua WAL về file chính |
| Banner bốn trạng thái | `PASS` (logic) / `NOT_RUN` (UI live) | `tests/live.test.ts`; không có phiên để kích `replaced` |
| Không lộ secret ở renderer | `PASS` | `tests/protocol-boundary.test.ts` — quét `src/**` và `electron/preload.ts` |
| **`LIVE_PASS`** | **1** | **5/5** mục của ADR-004 §5 có bằng chứng trên đĩa |

### Lần chạy thật đầu tiên — bằng chứng và giới hạn của nó

Người dùng báo đã quét QR và chat được, trên bản cài `~/.local/opt/glass-messenger`
(build lúc 14:44, từ mã ở commit `55e2c7d`). Hai file trên đĩa là bằng chứng khách quan:

```
~/.config/zalo-apple-glass-ui/.glass-demo-data/
  zca-session.bin    2707 B   14:45:14   (safeStorage, mode 0600)
  live-listener.log   320 B   16:07:12
```

```
2026-11-08T07:45:14.775Z start {"ok":true}
2026-11-08T07:45:14.775Z connection {"state":"connecting"}
2026-11-08T07:45:14.809Z connection {"state":"connected"}
2026-11-08T09:07:12.165Z start {"ok":true}
2026-11-08T09:07:12.166Z connection {"state":"connecting"}
2026-11-08T09:07:12.210Z connection {"state":"connected"}
```

Đọc được từ đây:

1. **Đăng nhập QR thành công.** `save()` chỉ được gọi sau khi `loginQR` trả về
   cookie/imei/userAgent — không có nhánh nào khác ghi file đó.
2. **Khôi phục phiên hoạt động.** Lần 16:07 không có `qr`, và vẫn `connected` sau
   45 ms. Nếu phải quét lại QR thì cửa sổ đã đứng ở màn QR.
3. **Socket WebSocket của Zalo thật đã mở.** `connected` chỉ phát khi zca-js báo
   listener sẵn sàng, sau khi xác thực bằng phiên thật.

### Cập nhật 17:48 — nhận tin đã có bằng chứng

Log dài thêm sau lần đọc lúc 17:00. Đoạn mới (giờ máy, UTC+7 → UTC trong file):

```
17:25:04  disconnected {"code":1006,"manualStop":false}
17:25:06  start        {"ok":true}          ← tự kết nối lại sau 2 s
17:25:11  connection   {"state":"connected"}
17:27:19  inbound {"kind":"group","self":false,"mapped":true}
17:27:52  inbound {"kind":"group","self":false,"mapped":true}
17:28:05  inbound {"kind":"group","self":true,"mapped":true}
17:41:15  inbound {"kind":"group","self":false,"mapped":true}
17:48:03  inbound {"kind":"group","self":false,"mapped":true}
```

Đọc thêm được từ đoạn này:

4. **Nhận tin realtime chạy.** `handleInbound` ghi một dòng cho **mọi** tin, kể cả
   tin bị mapper loại (`mapped: false`); cả 5 dòng đều `mapped: true`, nên đúng 5
   tin đã đi hết đường map → `events.message`.
5. **Backoff tự kết nối lại chạy với máy chủ thật.** `disconnected 1006` (đóng bất
   thường) → `start` sau **2 s** → `connected` sau 5 s nữa. Không có thao tác tay.
6. **Nhận được tin tự gửi từ thiết bị khác** (`self:true`). Đây chính là trường hợp
   `selfListen: true` được bật để xử lý.

**Chưa** đọc được:

- **`sendMessage` chưa có bằng chứng.** Dòng `self:true` là **nhận** một tin do
  thiết bị khác gửi, không phải kết quả `send()` trả `msgId`. Đã kiểm `app.asar`
  đang cài (14:44): `dist-electron/protocol/zalo-client.js` **không có** chuỗi
  `'send'` trong `events.debug`, tức bản này chưa có log gửi. Cần một lần chạy bản
  mới có nó.
- **Chưa có bằng chứng cho tin 1-1.** Cả 5 dòng đều `kind:"group"`, cùng một
  `threadId`. Không suy ra được gì về đường 1-1 (`cmd 510`), cũng chưa đo được
  `requestOldMessages` (§10.3).

Ghi nhận này quan trọng vì đúng loại sai lầm mà ADR-004 §5 dựng ra để chặn: "khôi
phục phiên" và "đã gửi được một tin" trông giống nhau trên UI nhưng chỉ một cái có
bằng chứng.

**Bản đang cài là bản cũ.** `app.asar` lúc 14:44 không có `awaitOldMessages`,
`HISTORY_ROUNDS` hay `userHistoryBuffer` — tức là **trước** bản sửa L1. Nên các bản
sửa L1–L3 và bản phân trang lịch sử **chưa từng chạy với Zalo thật**. Muốn đo câu
hỏi §10.3 (`old_messages` trả gì) thì phải cài lại bản mới trước.

### Lần chạy thứ hai — bản có cache, 18:02–18:03

Bản cài được dựng lại lúc **17:59**, nên lần chạy này là lần **đầu tiên** mã hôm
nay chạy với Zalo thật: L1–L3, phân trang lịch sử và cache SQLite cùng có mặt.

```
17:59:43  cache  {"op":"open","ok":true}          ← mở DB trước khi gọi mạng
17:59:48  connection {"state":"connected"}
17:59:51  history-request {"hasCursor":false}
17:59:51  history {"ok":true,"count":10,"first":"8465385062022",…}
18:02:51  send  {"ok":true,"kind":"user","len":1,"msgId":"8465873274814"}
18:02:51  inbound {"kind":"user","self":true,"threadId":"8979626095460235814"}
18:03:31  send  {"ok":true,"kind":"user","len":29,"msgId":"8465875514057"}
18:03:31  inbound {"kind":"user","self":true,"threadId":"8979626095460235814"}
```

Và trong `cache-188436612101457701.db` (đọc `readOnly` sau khi app thoát):

```
msg_id 8465873274814  client_id 1cc99d64-…  from_me 1  "."                          sent
msg_id 8465875514057  client_id 324279eb-…  from_me 1  "ehu test cái Zalo thôi á Cabi" sent
```

`msgId` trong log và `msg_id` trong DB **trùng khớp**. Đó là bằng chứng khép kín:
`sendMessage` trả id máy chủ → `persist()` gộp bong bóng tạm theo `client_id` →
một dòng `sent`, không phải hai.

### Đo được §10.3 — `cmd 510` trả gì

Đây là câu hỏi đã chặn thiết kế catch-up (§6.6). Nay có số:

| Lần gọi | `hasCursor` | Trang trả về |
|---|---|---|
| 1 | `false` | `count: 10`, `first 8465385062022` → `last 8465431983954` |
| 2 | `true` | `count: 9`, `first 8465385707624` → `last 8465431983954` (**cùng `last`**) |
| 3 | `true` | `count: 9`, **giống hệt lần 2** |

Đọc được:

1. **`count` hữu hạn, không phải "cả lịch sử".** 10 rồi 9 tin mỗi trang — không
   phải một lần trả hết.
2. **Có lặp.** Lần 2 và 3 trả cùng `first`/`last`/`count`. Gọi tiếp với cùng mốc sẽ
   nhận lại đúng trang đó, nên **không có tín hiệu "đã hết lịch sử"** ở tầng API —
   `fetchUserHistory` đang dựa vào việc giữ mốc cũ nhất để tránh lặp, và đó là cách
   duy nhất đúng.
3. **`lastId` không kéo lùi con trỏ.** Lần 3 vẫn `first 8465385707624` dù đã gửi
   `lastId` cũ hơn — trang trả về **không** phụ thuộc `lastId` theo kiểu ta cần cho
   catch-up. Cần đo thêm với một `lastId` thật sự cũ trước khi tin vào §6.6.

Kết luận cho §6.6: **cơ chế phân trang phía mình đã đúng (giữ mốc cũ nhất, dựa vào
khác biệt giữa các trang), nhưng máy chủ không cho một mốc có thể hỏi "tin từ X
trở đi"** — nên catch-up phải làm ngược từ trang mới nhất xuống, chứ không nhảy
thẳng tới mốc. Ghi nhận này thay đổi cách viết §6.6.

### Còn lại sau lần chạy 18:03

Checklist ADR-004 §5 đã **5/5**. Những gì **chưa** có bằng chứng:

1. **Nhận tin 1-1 từ người khác** (`self:false` trên `kind:"user"`). Hai dòng 1-1
   hiện có đều là tin mình gửi quay lại. Cần người kia nhắn vào.
2. ~~**Cuộn thêm lịch sử 1-1 thật.**~~ — **đã đo 12:34, và nó không chạy được**;
   xem §"Đo 2026-11-08 12:34" bên dưới. Không còn là "chưa thử" mà là **giới hạn đã
   biết** của `cmd 510`.
3. **Nhóm: gửi tin.** Hai lần `send` đều `kind:"user"`.
4. **`replaced`** (mở Zalo Web khi app chạy) và **thu hồi** — không có phiên nào kích.
   Thu hồi nay đã có đường xử lý (`listener.on('undo')`, xem
   [PLAN_V2_STATUS](PLAN_V2_STATUS.md) §4 và §7), nhưng **chưa lần nào chạy trên sự
   kiện thật**: hình dạng `data.msgId` của `Undo` mới chỉ đọc từ model của zca-js,
   chưa đối chiếu với payload thật.
5. **Tin dài hơn một trang.** Cache hiện có đúng 2 tin; phân trang thật sự (khi
   cache đã có hàng nghìn tin) chưa được đo — và với 1-1 thì nó còn không lùi
   được (mục 2), nên đây là việc của **nhóm** (`getGroupChatHistory` có `more`).

### Đo 2026-11-08 12:34 — `cmd 510` là *catch-up*, không phải phân trang lùi

Người dùng bấm "Tải tin nhắn cũ hơn" trên bản cài và báo **"ấn vào không được gì"**.
Log (sau khi thêm `history-cursor` ghi đúng `lastId` đã gửi) giải thích:

```
12:34:00.858 history-cursor {"round":0,"asked":null,"hasBefore":false}
12:34:00.906 history {"ok":true,"count":12,"first":"8465385062022","last":"8465875514057"}
12:34:01.932 history-cursor {"round":1,"asked":"8465385062022","hasBefore":false}
12:34:01.932 history {"ok":true,"count":11,"first":"8465385707624","last":"8465875514057"}
```

Gửi con trỏ **cũ nhất** (`8465385062022`), máy chủ trả trang **mới hơn** (`first`
tăng) với cùng `last`. Tức `requestOldMessages(User, lastId)` trả các tin **sau**
`lastId`, không trả các tin **trước** nó. Bấm bao nhiêu lần cũng nhận lại đúng những
tin đã có; `prependHistory` khử trùng hết nên UI không đổi.

Kết luận này **đổi một giả định trong plan** (§5 "phân trang theo `lastMsgId` trượt
lùi"): `cmd 510` chỉ là catch-up. Trên ảnh còn thấy hệ quả thứ hai — hội thoại chưa
có tin nào thì UI ghi **"Đã hết lịch sử Zalo"** và tắt nút, một khẳng định về máy
chủ cho hội thoại chưa hề được hỏi tới (ba vòng không thấy tin của hội thoại đó).

**Hai lỗi đã sửa cùng ngày (lúc đó 235 test, nay 243; 26 e2e):**

| Lỗi | Sửa |
| --- | --- |
| 3 vòng không thấy tin của hội thoại ⇒ `hasMore: false` ⇒ UI tuyên bố "Đã hết lịch sử Zalo" và tắt nút | Trả `hasMore: true` + log `history {reason:'not-in-page'}`. Không thấy tin ≠ máy chủ hết tin. Test: `tests/zalo-cache.test.ts` "hội thoại trống không được tuyên bố 'đã hết lịch sử'" |
| Bấm tải, máy chủ trả tin đã có ⇒ không có gì đổi và **không một lời giải thích** | Store phát hiện "có tin trả về mà chèn không được tin nào", hiện toast giải thích và đặt `hasMore: false` để nút thôi hứa. Test: `tests/store-batch.test.ts` (2 ca: toàn trùng → báo; có tin mới → không báo) |

Phân trang lùi thật cho 1-1 **vẫn chưa có đường**: zca-js 2.2.0 không có
`getUserChatHistory`, và `cmd 510` không lùi. Đây là giới hạn của thư viện, không
phải của mã này; phần cần làm tiếp là xin nhiều phía (group `getGroupChatHistory`,
lịch sử dựng từ cache) hoặc chờ zca-js bổ sung API.

### Đọc mã Zalo PC thật — `cmd 510` là hàng đợi, lịch sử nằm ở `/api/cm/getoldv2`

Bản `Zalo.AppImage` người dùng cài (`~/.local/opt/zalo/`) là **Zalo PC macOS
đóng gói lại**, nên `resources/app.asar` → `app/pc-dist/*.js` là mã nguồn Zalo
chính thức, không phải suy đoán. Đọc nó trả lời dứt điểm ba câu.

**1. `cmd 510` không phải API lịch sử — nó là hàng đợi tin offline.** Con trỏ là
`lastActionId`, và nó chỉ đi *về phía tin mới* để **bắt kịp** (catch-up):

```js
C = new b({ type:"SOCK_MSG", qosId:97107, queueIds:["510_0","511_0"], ... })
msg_11_offline:["510"]
```

Đây khớp chính xác log 12:34: gửi mốc **cũ nhất**, máy chủ trả trang **mới hơn**
với `last` không đổi. Không có giá trị nào của `first` sửa được điều đó, vì không
phải phân trang. ⇒ **Phép đo `GLASS_HISTORY_FIRST=0` đã dựng là vô nghĩa; đã gỡ.**

**2. Phân trang lùi thật là HTTP: `/api/cm/getoldv2`.** Trả đúng cờ `hasMore` và
`lastMsgId` để lật trang:

```js
static getCM(e,t="0",n=0,a=50,s,i=1e4,r={}){
  e.startsWith("g")&&(e=e.slice(1));                       // 1-1 thì không có "g"
  let c={groupId:e,globalMsgId:t,count:a,msgIds:r.localMsgIds||[],imei:...,src:...};
  c=o.default.encodeAES(JSON.stringify(c));
  let d=n?12507:12506,
      u=p.b.getGroupCloudDomain()+(n?"/api/cm/getoldv2?":"/api/cm/getrecentv2?")
        +this._getCommonParams()+"&params="+c;
```

Endpoint anh em: `/api/cm/getrecentv2` (mới hơn), `/api/cm/rgetv2` (nhảy tới tin),
`/api/cm/getpath`. Response: `{groupMsgs, isOld, hasMore, lastMsgId}`.

**3. Nhưng Zalo PC chỉ mở đường cloud này cho *nhóm*.** Cổng chặn nằm ở
`apiEnable`, và nó đòi id hội thoại bắt đầu bằng tiền tố nhóm:

```js
apiEnable(e,t){ ... const o=t.startsWith(i.GROUPID_PREFIX)||t===a.default.sendToMeId&&...;
                return n&&o }
```

Nên với 1-1, `loadTopMessagesForConversation` **không** gọi cloud:

```js
if(!m) return s(R,b,!1), ...      // m = apiEnable(NEW_TO_OLD, convId) ⇒ false
```

`R` ở đó là kết quả `getLastMessageFrom(...)` — **chỉ đọc SQLite trên máy**. Nghĩa
là Zalo PC lấy lịch sử 1-1 cũ từ **đồng bộ với điện thoại**, không phải truy vấn
cloud:

```js
static pullMobileMsg(e,t,n,a=0,s=0,r=""){          // /api/message/pull_mobile_msg
  let l={pc_name:ee,public_key:e,from_seq_id:t,is_retry:a,min_seq_id:s,temp_key:r,imei:...};
```

Đây chính là việc `zalo-for-linux` vá: `cross_setting:{enable:!0,...,isMobileSupport:!0}`
cộng "Route Sync Messages to SyncMessageController (V1) which sends push
confirmation to mobile devices and saves message data via db-cross-v4 / sqlite3".

**Hệ quả cho mã này:** câu "chờ zca-js bổ sung API" ở trên là **sai**. API có thật,
chỉ là (a) không phải `cmd 510`, (b) Zalo PC giới hạn nó cho nhóm, (c) đường 1-1
đòi đồng bộ thiết bị + giải mã E2EE — một hạng mục lớn hơn nhiều so với "thêm một
lời gọi hàm". Điều **chưa** biết: máy chủ có từ chối `globalMsgId` của hội thoại
1-1 hay không. Zalo PC chặn ở phía client, nên phía máy chủ vẫn để ngỏ.

### Đo 2026-11-08 — `/api/cm/getoldv2` trả `604` cho **cả 1-1 lẫn nhóm**

Đã viết `electron/protocol/cloud-history.ts` + `cloud-crypto.ts` và chạy thật trên
tài khoản phụ. Cờ `GLASS_CLOUD_HISTORY=1` (chỉ 1-1) / `=all` (cả nhóm, để lấy đối
chứng), `GLASS_CLOUD_PROBE` để gửi một yêu cầu không qua UI.

**Kết quả đo, nguyên văn từ `live-listener.log`:**

```
cloud-session  {"ok":true,"baseUrl":"https://tt-group-cm.chat.zalo.me","keyBytes":16,
                "cookieNames":["__zi","_zlang","app.event.zalo.me","zpsid","zpw_sek"]}
cloud-query    {"query":"https://tt-group-cm.chat.zalo.me/api/cm/getoldv2?params=<redacted>&zpw_ver=685&zpw_type=30"}
cloud-other    {"ok":true,"count":100}                      ← getAllFriends, cùng phiên
cloud-history  {"kind":"group","threadId":"3571861573406324777","asked":"0",
                "ok":false,"error":604,"message":"Lỗi không xác định"}
cloud-history  {"kind":"user","threadId":"8979626095460235814","asked":"0",
                "ok":false,"error":604,"message":"Lỗi không xác định"}
```

**`604` là gì:** đọc thẳng enum trong gói Zalo PC —

```js
const a={}, s={Common:{UNDEFINED_ERROR:112,SESSION:604}, Fetch:{NOT_FOUND:212,...}}
```

— tức **`SESSION`**, không phải "sai quyền" và không phải "sai loại hội thoại".

**Các biến số đã loại trừ**, mỗi lần một biến, cùng một phiên:

| Biến | Thử | Kết quả |
|---|---|---|
| Transport tự viết | `GLASS_CLOUD_VIA=zca` → `utils.request`/`utils.resolve` của zca-js | vẫn `604` |
| Endpoint | `getrecentv2` thay `getoldv2` | vẫn `604` |
| `zpw_ver` | `695` (đúng số Zalo PC) thay `685` | vẫn `604` |
| Host | `https://group-cm.api.zalo.me` (host cấu hình của Zalo PC) | **`502`** — host sai cho phiên này; service map mới đúng |
| Loại hội thoại | nhóm thay 1-1 | vẫn `604` |
| Cookie | tên cookie cho host cloud ⊇ `zpsid`, `zpw_sek` | đủ, và giống hệt host `chat.zalo.me` |
| Khoá AES | `keyBytes: 16` → AES-128 | **đã sửa một lỗi thật**, xem dưới |
| Phiên còn sống | `getAllFriends` → **100 bạn** | phiên hợp lệ |

**Kết luận:** phiên hợp lệ và mọi API thường vẫn chạy, nhưng `/api/cm/getoldv2`
trả `604 SESSION` cho **cả hai** loại hội thoại. Vì nhóm cũng hỏng, phép đo **không
trả lời được** câu hỏi ban đầu ("máy chủ có chặn 1-1 không") — nó chỉ cho thấy
endpoint này cần một thứ xác thực mà `zca-js` không dựng.

**Đính chính 2026-11-08 (tối): giả thuyết `ParamCipher` ở trên là SAI.** Nó là
suy đoán, không phải phép đo, và khi đọc tiếp thì nó không đứng được:

- `zcid`/`zcid_ext`/`enc_ver` chỉ tồn tại trong **một** module (`fBUP`) và **không
  bao giờ lên dây**. `getParams()` trả chúng cho `encryptParam()`, mà `encryptParam`
  chỉ dùng cho API đăng nhập (`reqqr`, `loginbypassw`, `getcaptcha`, …).
  `getCM` gọi thẳng `_get` với `_getCommonParams()`, mà `_getCommonParams()`
  serialize đúng hai trường: `re = {zpw_ver, zpw_type}`.
- Grep toàn bộ 4.968 module đã khôi phục: không một chỗ nào khác tham chiếu
  `zcid`. Không có tầng chữ ký riêng cho cloud.

Thứ **duy nhất** trong request của Zalo PC mà client này từng thiếu đã là khoá AES,
và khoá đó nay đúng: Zalo PC dùng `s.default.encodeAES`, tức `getSecretKey()` → biến
`le` do `setDecryptKey(t.decryptKey)` đặt từ `data` của response đăng nhập.
`zca-js` đặt `ctx.secretKey = loginInfo.zpw_enk` (`node_modules/zca-js/dist/zalo.js:62`)
— cùng một chuỗi. Nên sau bản sửa AES-128, request của ta và của Zalo PC giống nhau
về khoá, về `zpw_ver`/`zpw_type`, về `params`.

Điều đó đổi cách đọc `604`: **không phải** ta đang thiếu một tầng mã hoá bí mật.
Cái còn khác là đường dẫn và ngữ cảnh phiên — nhiều khả năng Zalo PC lấy domain cloud
từ `config.zpw_service_map_v3` của **chính phiên đó** và chỉ gọi cloud cho id nhóm,
trong khi `604` trả về cho cả id nhóm cho thấy máy chủ từ chối theo *phiên*, không
theo *loại hội thoại*. Chưa có bằng chứng để khẳng định thêm, nên ghi đúng mức đó.


**Một lỗi thật đã tìm ra và sửa trong lúc đo:** `encryptAes` ban đầu ép cứng
`aes-256-cbc`. `zpw_enk` của phiên này **16 byte**, và CryptoJS — thứ zca-js dùng —
chọn biến thể theo độ dài khoá, nên request đầu tiên ném `RangeError: Invalid key
length` trước khi kịp ghi log. Nay chọn `aes-128/192/256-cbc` theo độ dài và từ
chối độ dài lạ (`tests/cloud-history.test.ts` khoá cả ba nhánh).

**Trạng thái (trước bản sửa bên dưới):** đường cloud nằm sau cờ, mặc định tắt, UI
không đổi. Lịch sử 1-1 tiếp tục đi đường cũ (`cmd 510` catch-up + SQLite).

## Zalo đang cài trên máy lùi trang bằng gì (đo 2026-11-08)

Bản đang cài: `~/.local/opt/zalo/Zalo.AppImage`, Zalo **26.11.10**, commit `aa5459b`,
build `2026-11-07T16:35:08Z` — cùng nhánh mã với bản Zalo PC 26.10.20 dùng ở các
mục trên, nên kết luận dưới đây áp cho cả hai. Đọc bằng cách giải nén AppImage
(`--appimage-extract`), rồi khôi phục `pc-dist/compact-app-pc.*.js` (21,7 MB,
webpack) thành **4.968 module đọc được** bằng công cụ `js-sources-restore`. Không
chạy Zalo, không đọc cookie/token/nội dung tin nhắn.

**Câu trả lời ngắn: Zalo lùi trang bằng hai đường khác nhau tuỳ loại hội thoại, và
với 1-1 nó *không* lùi từ cloud.**

### Nhóm: cloud segment (`/api/cm/getoldv2`)

`1EWQ.apiEnable(apiType, conversationId)` là chốt chặn phía client:

```js
const s = t.startsWith(r.GROUPID_PREFIX)              // GROUPID_PREFIX = "g" (1pet.js)
       || t === a.default.sendToMeId && a.default.cloud_send2me.enable
       || t === a.default.sendToMeId && a.default.cloud.OA_enable;
return n && s;                                         // n = cloud.scroll_top_enable
```

Với hội thoại `g` + `scroll_top_enable`, nhánh `NEW_TO_OLD` gọi
`getCM(id, lastVisibleMsgId, isOld=1, count)` → `GET {group_cloud_message}/api/cm/getoldv2`
với `params = encodeAES({groupId, globalMsgId, count, msgIds, imei, src})`, cộng
`_getCommonParams()` = **đúng `zpw_ver` + `zpw_type`**.

### 1-1: nhánh `!m` — dừng ở DB cục bộ, không lên cloud

Trong `loadTopMessageForConversation`, nếu `apiEnable` trả `false` (đúng với mọi id
1-1) thì code lấy tin từ SQLite rồi **return ngay**:

```js
let m = h.a.apiEnable(d.d.NEW_TO_OLD, this.conversationId), p = m;
// … đọc DB …
if (!m) return i(T, y, false), f.revoke(), T;   // T = tin lấy từ DB
```

Tức cuộn lên chỉ chạm tới chừng nào DB cục bộ còn tin. Muốn có thêm tin 1-1 cũ thì
phải có sẵn trong DB — mà DB được đổ từ **đồng bộ điện thoại**.

### Lịch sử 1-1 đến từ DB cục bộ, do đồng bộ điện thoại đổ vào

- `1EWQ` (SQLite của Zalo, `Core/Index.db`): bảng **`cloud_segment`** giữ trạng thái
  phân trang cloud theo từng hội thoại — `conversationId, hasMore, maxCloudMsgId,
  lastCloudVerifiedDttm, cloudSegmentCheck`; bảng `conversation` có
  `syncFromMobile` và `lastActionId` (con trỏ catch-up `cmd 510`). Trên máy bạn
  `cloud_segment` **0 dòng** và chỉ có 1 hội thoại 1-1, nên DB này không có gì để
  lùi — đó là dữ liệu, không phải kết luận về thiết kế.
- `pullMobileMsg(public_key, from_seq_id, …, min_seq_id)` →
  `GET {file}/api/message/pull_mobile_msg?...&params=encodeAES({pc_name, public_key,
  from_seq_id, is_retry, min_seq_id, temp_key, imei})`, gọi từ `main-startup` với
  `{maxSeq, minSeq, publicKey}` của phiên đồng bộ. Body tin nhắn đi qua **E2EE**
  (các bảng `e2ee_*` trong `Core/Index.db`: `e2ee_session`, `e2ee_prekey`,
  `e2ee_identity`, `e2ee_group`, `e2ee_deciphered`).

Nên "lùi trang 1-1" của Zalo = **cuộn trong DB cục bộ**; DB dày lên bằng đồng bộ
điện thoại qua kênh E2EE, không bằng API lịch sử.

### Các endpoint còn lại trong cùng họ

| Endpoint | Dùng cho |
|---|---|
| `getrecentv2` | mới nhất về cũ (`isOld=0`) |
| `getoldv2` | cũ hơn (`isOld=1`) — chỉ mở cho nhóm |
| `rgetv2` | nhảy tới một `msgId` (`msgJump:1`) hoặc tải đáy (`msgJump:0`) |
| `getpath` | đường dẫn giữa hai mốc, `reverse` |
| `mget` | lấy theo danh sách id |

Tất cả ở domain `group_cloud_message` của service map, tất cả đi qua cùng
`encodeAES(params)` + `{zpw_ver, zpw_type}`.

## Đã làm theo Zalo thật (sửa mã, 2026-11-08 tối)

Sau khi đo xong, `electron/protocol/zalo-client.ts` được đổi để **phân nhánh đúng
như Zalo PC**, thay vì đi một đường duy nhất cho cả hai loại hội thoại:

| | Trước | Sau |
|---|---|---|
| Nhóm | thử cloud (nếu bật cờ) → `getGroupChatHistory` | `getoldv2` → `getGroupChatHistory` (giữ nguyên, đúng đường Zalo) |
| 1-1 | `cmd 510` + SQLite | **đọc SQLite trước, không gọi cloud**; `cmd 510` chỉ để *đổ thêm vào cache* |

`pageFromCache()` là đường 1-1 mới: nó chỉ đọc DB, không tự gọi mạng, và `hasMore`
của nó nói về **DB** — đúng thứ `loadTopMessageForConversation` dùng cho 1-1.

**Một chỗ cố ý khác Zalo, và lý do:** Zalo PC `return` hẳn khi DB hết tin, vì DB
của nó đã đầy nhờ đồng bộ điện thoại (`pull_mobile_msg`, E2EE). App này **chưa có**
đồng bộ đó, nên dừng y hệt sẽ làm người dùng thấy ít hơn trước khi sửa. Vì vậy khi
cache không trả được gì, `cmd 510` vẫn chạy — nhưng với vai trò *nguồn đổ vào
cache* (đúng vai trò đồng bộ điện thoại bên Zalo), không phải như API phân trang.
Lần bấm sau đọc lại từ cache. Ghi rõ ở đây vì đây là chỗ duy nhất khác Zalo.

**Nhãn nút đổi theo loại hội thoại** (`ChatPane`): nhóm giữ "Đã hết lịch sử Zalo";
1-1 thành **"Đã hiện hết tin có trên máy"**, vì với 1-1 `hasMore: false` chỉ nói về cache
chứ không phải về máy chủ. Đây là chỗ **duy nhất** đụng vào UI, và là để UI không
nói sai — không phải đổi bố cục.

**Kiểm bằng máy:** `tests/zalo-cache.test.ts` có ca "1-1 lùi trang bằng cache cục
bộ, không gọi endpoint cloud — như Zalo PC": nó bơm một `fetch` đếm số lần gọi và
khẳng định `fetched === 0` trên nhánh 1-1. Đó là thứ khoá được *đường đi*; kiểu
TypeScript không nói được gì về việc một lời gọi mạng có bị chạm hay không.

**Nhánh nhóm vẫn hỏng thật:** chạy lại **bản vừa dựng từ mã mới** với
`GLASS_CLOUD_HISTORY=group GLASS_CLOUD_PROBE=3571861573406324777:group` cho:

```
2026-11-08T16:52:49.340Z cloud-history {"kind":"group","threadId":"3571861573406324777",
  "asked":"0","ok":false,"error":604,"message":"Lỗi không xác định","count":0}
2026-11-08T17:00:23.143Z cloud-history {"kind":"group","threadId":"3571861573406324777",
  "asked":"0","ok":false,"error":604,"message":"Lỗi không xác định","count":0}
```

Dòng thứ hai là bản dựng sau khi sửa (`PASS: 22/22 bundled files byte-identical`,
rồi `npm run install:linux`) — nên đây là kết quả của **mã hiện tại**, không phải
của bản cũ. Tức `fetchCloudPage` trả `null` và nhóm rơi về `getGroupChatHistory`
như trước. Mã nay đã đúng hình dạng Zalo gọi, nhưng **máy chủ vẫn từ chối**; đường
nhóm chạy
thật hiện tại là `getGroupChatHistory`, không phải `getoldv2`.

## Zalo giữ hai cờ phân trang, không phải một (đọc thêm 2026-11-09)

Tham khảo `https://github.com/qnguyen3/zalo-swift-re` (Olaz — client macOS chạy
**chính renderer Zalo** trong WKWebView, GPL-3.0). Nó không giúp đường giao thức —
không tự dựng request nào — nhưng `HostScripts/chat-adapter.js` chỉ ra đúng tên
những thứ cần tìm, và tất cả đều có trong bundle PC đang khôi phục ở `/tmp/zalo-restored`
(kiểm bằng `grep`: `loadTopMessagesForConversation` 4 module, `cacheMessageLoader` 1,
`_loadMoreMessages` 4, `getLastMessagesForConversation` 5).

**Đọc được trong `ZCU6.js` / `iKSP.js` — Zalo có HAI cờ, không phải một:**

```js
// ZCU6.js, loadTopMessagesForConversation
let { messages: T, hasMore: y, fromCache: S } = await g.a.getLastMessageFrom(…);
…
if (!m) return i(T, y, false), … T;              // local hết → vẫn CHƯA phải hết
…
i([...a], y, s);                                  // lần nạp cloud: giữ y, đặt s
```

`i(messages, hasMoreLocal, hasMoreCloud)` là chỗ dispatch `LOAD_MORE_MSG`; reducer
trong `iKSP.js` giữ **hai trường riêng** `hasMoreLocal` và `hasMoreCloud`, và chỉ
dừng khi cả hai cùng hết. Trong `LOADING_MSG_TOP` reducer còn một chỗ Zalo có vẻ
gán nhầm `hasMoreLocal` từ `payload.hasMoreCloud` — có thể là chủ ý, có thể là lỗi
của họ; không đủ bằng chứng để khẳng định.

**Vì sao app này *không* chép mô hình hai cờ:** cờ thứ hai của Zalo đứng trên cloud
segment của nhóm cộng đồng bộ điện thoại. Với 1-1, thứ duy nhất phía ta có để "đổ
thêm" là `cmd 510`, mà phép đo 2026-11-08 cho thấy nó trả tin *mới hơn* mốc
(catch-up), không phải cũ hơn. Bật cờ thứ hai bằng nó là hứa một trang lùi mà không
nguồn nào cấp được: nút bấm được mãi, mỗi lần bấm tốn 5 s × 3 vòng rồi hiện toast
"không có tin cũ hơn". Nên `hasMore` của 1-1 đúng là `hasMoreLocal`. Điều còn thiếu
là làm dày cache (`pull_mobile_msg` + E2EE), không phải một cờ có thể lật.

**Xác nhận độc lập cho phép đo trên máy:** README của Olaz ghi thẳng — *"A fresh PC
session has no message history except My Cloud, because Zalo keeps history on the
phone"* — và liệt kê đồng bộ điện thoại là tính năng riêng, có màn hình tiến trình,
qua máy trạng thái `sync-v2`. Đó đúng là thứ `Sync.db` trên máy bạn nói: một dòng
`missing_message_range` với `reason: first_login`, `fromTs: 0`, `status: 0`.

**Một điểm kỹ thuật đáng ghi để sau:** Olaz ép chạy trên **IndexedDB** thay vì SQLite
(`fail_sqlite3=true`, `canIUseSQLite→false`, `is-migrate-full-done→false`), và
`reanalysis/bridge-spec.md` cho thấy renderer chọn backend qua các kênh
`sqlite-available` / `fail-load-sqlite3`. Nghĩa là đường lưu trữ của Zalo có một
nhánh dự phòng thuần web — nhưng nó cần chạy được renderer của Zalo, không dùng
được trong client tự viết này.


## Đã kiểm chứng bằng máy

- `npm run typecheck` — cả `tsconfig.json` và `tsconfig.electron.json` sạch.
- `npm test` — **243/243** pass (2026-11-09), gồm 15 test cho `src/renderer/live/*` và
  `src/shared/live.ts` (`adoptEcho` 3 ca, nhãn/tông/mức kết nối lại 1 ca, `subscribeLive` 3 ca,
  cộng phần `map.ts`), **25 test DB thật**, **16 test tích hợp** qua `FakeZaloClient`, 8 test
  throttle, 8 test bắt lỗi toàn cục, 16+8+4 test gom cập nhật UI, và **9 test
  `/api/cm/getoldv2`** (gồm ba ca khoá độ dài khoá AES).
- `npm run lint` trên đúng danh sách đường dẫn của script — không lỗi. (Chạy `npm run lint` qua
  wrapper RTK sẽ quét toàn repo và báo hàng nghìn lỗi ở các file `.cjs` khảo sát cũ; đó không phải
  phạm vi của script.)
- `npx playwright test` — **26/26** pass; cửa demo `Vào bản demo` vẫn là lối mặc định, 7 hội thoại,
  `Tên hiển thị demo` vẫn được focus.
- **`ErrorBoundary` chứa lỗi render — kiểm bằng Chromium thật, không chỉ unit test.** Bản dựng
  thật (`npm run build` + `npm run build:electron`) chạy qua Playwright với một `throw` cố ý chèn
  vào `ChatPane`. Kết quả: thẻ `role="alert"` "Không hiển thị được nội dung này" hiện ra, thanh
  tiêu đề còn nguyên. Bấm "Thử lại" **khi lỗi vẫn còn** → thẻ quay lại, cửa sổ **không** trắng.
  (Lần chạy này dùng một spec tạm đã xoá; `VITE_QA_THROW` cũng đã gỡ khỏi `ChatPane` — không có
  mã kiểm thử nào ở lại trong bản chạy.)

## Thay đổi so với plan, và lý do

1. **`ConnectionState` của plan là một type riêng** (`LiveConnection`), không ghi đè
   `ConnectionState = 'online' | 'offline' | 'syncing'` của bản demo. Type demo đã bị
   `tests/core.test.ts` và `tests/e2e/demo.spec.ts` khoá; gộp hai bảng trạng thái sẽ làm hỏng
   hành vi demo đã được kiểm.
2. **Không có đường vào chế độ thật ở màn đăng nhập demo là lỗi, đã sửa.** `enterLive()` tồn tại
   nhưng không nơi nào gọi, nên chế độ thật không thể mở. Nay `LoginScreen` hiện nút phụ
   "Đăng nhập Zalo thật" **chỉ khi `window.chat` tồn tại**, kèm câu cảnh báo bắt buộc nguyên văn.
   Trong trình duyệt thường (`npm run dev`) nút này không render.
3. **Bố cục live dùng lưới hai cột.** `LiveSession` không có `NavigationRail`, nên nếu dùng
   `.app-layout` (ba cột `210px 390px 1fr`) thì danh sách hội thoại rơi vào cột rail 210px. Đã thêm
   `.live-layout` với `390px minmax(0,1fr)`, cùng biến thể 310px/255px cho hai breakpoint, và dời
   `left` của `.live-banner` theo.
4. **Cửa QR chiếm trọn cửa sổ.** Trước khi sửa, `LiveSession` dựng cả `LiveStage` lẫn `LiveLoginScreen`
   làm anh em, nên form QR xếp dưới một cột trống. Nay khi chưa đăng nhập, `LiveSession` chỉ trả
   `LiveOverlays`.
5. **Không còn hộp hồ sơ mở mặc định.** `LiveOverlays` cũ trả `LiveProfileScreen` khi
   `liveOverlay === null`, tức là luôn có modal che màn hình. Nay không có overlay thì không render gì.
6. **Banner ẩn khi chưa đăng nhập.** Trạng thái khởi tạo là `disconnected`; hiện "Mất kết nối" đè lên
   màn QR là báo lỗi sai.

## Lỗi UI đã sửa: nút đăng nhập kẹt ở "Đang mở phiên…" (2026-11-09)

Người dùng báo nút đăng nhập Zalo thật trông như treo. Đo lại thì **không treo**: sau khi bấm, `restore()`
gọi mạng khoảng 10 giây rồi vào thẳng danh sách hội thoại; ở lần chạy sau khi phiên đã ấm thì gần như tức
thì. Ảnh chụp là trạng thái **đang chờ** đó.

Nhưng khi đọc đường trạng thái thì thấy một lỗi thật cùng hình dạng: `loginPending` trong
`src/renderer/store/useDemoStore.ts` **chỉ** được xoá khi có sự kiện `logged-in`. `loginQRFlow` phát
`{status: 'error', retryable: true}` khi mã QR hết hạn hoặc bị từ chối trên điện thoại rồi **trả về bình
thường** — không có `logged-in` nào tiếp theo. Nút "Thử lại" mang `disabled={pending}`, nên nó kẹt
**vĩnh viễn**; chỉ thoát về demo rồi vào lại mới gỡ được.

Đã sửa: mọi trạng thái từ main đều xoá cờ, vì bất kỳ state nào cũng nghĩa là thao tác đang chờ đã có kết
quả. Ba test khoá nhánh này (`tests/store-batch.test.ts`): hết hạn QR, bị từ chối, và vào được phiên.
Đã xác nhận test **bắt được** lỗi: hoàn nguyên dòng sửa thì hai test đầu đỏ, khôi phục thì xanh.

### Hạn thời gian cho đường đăng nhập

Không có hạn thời gian nào cho `login()`. `ctx.options.polyfill` của zca-js mặc định là `fetch` toàn
cục, mà `fetch` của Node **không có hạn thời gian** — một kết nối treo giữa handshake TLS giữ
`login()` mãi mãi, không ngoại lệ, không log. `AbortSignal` không đi qua được đường của zca-js, nên
cách duy nhất còn lại là **bỏ chờ** promise đó và tự trả về một lỗi.

Đã thêm `electron/protocol/deadline.ts` (`withDeadline`), dùng ở hai chỗ:

- **`restore()`** — 30 giây (`LOGIN_TIMEOUT_MS`). Khôi phục bình thường đo được khoảng 10 giây ở lần
  đầu và dưới 1 giây khi phiên đã ấm, nên 30 giây là ba lần biên rộng nhất đã thấy. Hết hạn thì rơi
  xuống đường QR như mọi lần khôi phục thất bại khác, và phiên cũ bị xoá.
- **`loginQRFlow()`** — 360 giây cho **cả** luồng (`LOGIN_FLOW_TIMEOUT_MS`). zca-js tự sinh lại mã QR
  tối đa `QR_RETRY_LIMIT` lần, mỗi mã sống 100 giây, nên một người quét bình thường có khoảng 300
  giây; 360 giây không cắt ngang ai đang thật sự quét mà vẫn có điểm dừng nếu một lần poll bị treo.

Cả hai đều phát một trạng thái `error` có `retryable: true`, nên nút "Thử lại" hiện ra và bấm được —
cùng nhánh với lỗi QR hết hạn ở trên.

`tests/deadline.test.ts` khoá năm tính chất: hết hạn thì từ chối, xong trước hạn thì trả giá trị, lỗi
thật đi qua nguyên vẹn (để `isRetryable` còn phân nhánh đúng), promise từ chối muộn không thành
`unhandledRejection`, và promise gốc **phải có handler lỗi gắn ngay** thay vì chỉ có `.then`.

Hai test cuối viết sai ở lần đầu và đã sửa: bản đầu đếm số lần `.then` được gọi, mà `then(onOk)` một
tham số vẫn làm bộ đếm tăng — một bản `deadline.ts` chỉ có `promise.then(value => ...)` vẫn qua được
phép đếm đó. Bản đã sửa kiểm chính tham số thứ hai là hàm, và đã xác nhận bằng cách gỡ handler: cả ba
test liên quan đỏ.

**Chưa sửa, và nên biết:** hết hạn **không** huỷ được lời gọi bên dưới. Promise gốc vẫn chạy tới khi
mạng tự bỏ cuộc. Nếu nó nối dây muộn sau khi người dùng đã đăng nhập lại, listener của lần mới có thể
bị thay bởi lần cũ. Không kiểm chứng được điều này mà không chặn mạng thật, nên chỉ ghi ra.

## Rủi ro còn mở

- Chưa có lần chạy thật nào: mọi kết luận về payload, thời điểm, hay hành vi server của zca-js vẫn ở
  mức **khai báo** (`docs/zca-capabilities.md`).
- `getMessages` cho hội thoại 1-1 dựa vào `requestOldMessages`; chưa xác minh nó trả về gì trong
  thực tế.
- Đóng gói: zca-js là dependency runtime của main và phải nằm trong asar. `npm run build:desktop`
  chưa được chạy lại sau khi thêm dependency.
- ADR-002 ghi rằng `tests/core.test.ts` khoá chuỗi CSP — **sai**, đã sửa trong ADR. Hiện không có
  test nào so khớp hai bản CSP; đó là nợ kỹ thuật đã ghi nhận.

## Bước tiếp theo để đổi `BLOCKED` thành `PASS`

Chạy bằng tài khoản phụ, rồi làm đúng năm mục checklist gốc, ghi lại từng mục với mốc thời gian và
ảnh chụp DevTools chứng minh không có cookie/IMEI/token trong renderer. Chỉ sau đó mới được đặt
`LIVE_PASS = 1`.

Hiện đã có 3/5 mục có bằng chứng (đăng nhập, khôi phục phiên, socket thật). Thiếu **nhận tin** và
**gửi tin**, và cả hai đều thiếu vì lý do quan sát được: `send()` không ghi log, và lần chạy 16:07
không có tin nào tới.

**Đã vá lỗ hổng quan sát (2026-11-08, sau khi đọc log trên).** Ba dòng log được thêm vào
`zalo-client.ts`; không đổi hành vi, chỉ đổi thứ quan sát được:

| Event | Khi nào | Ghi gì |
| --- | --- | --- |
| `send` | sau `api.sendMessage` (cả thành công lẫn lỗi) | `ok`, `kind`, `len` (độ dài text), `msgId` nếu có; khi lỗi thêm `message` cắt 160 ký tự |
| `history-request` | ngay sau khi gọi `requestOldMessages` | `hasCursor` — tách khỏi `history` để không đọc nhầm "đã gửi yêu cầu" thành "đã nhận trang" |
| `history` | khi `old_messages` **thật sự** tới | `count` (số tin mỗi trang — chính là §10.3), `first`, `last` |

Trước khi sửa, `history {ok:true}` được ghi ngay sau `requestOldMessages` — tức là nó nói "đã hỏi",
không phải "đã nhận". Nếu đọc log đó để trả lời §10.3 thì sẽ kết luận sai. Nay `history` chỉ ghi từ
trong handler `old_messages`.

`npm run typecheck`, `npm test` (129/129 tính đến lúc đó; nay là 243) và `npm run lint` đều sạch sau khi sửa. **Bản cài trên máy
vẫn là bản 14:44**, nên các dòng log mới chỉ có sau khi build + install lại.

## Phép đo cửa vào `pull_mobile_msg` (2026-11-09) — lần đầu SAI, lần hai chạy

Câu hỏi đặt ra trước khi dựng máy trạng thái đồng bộ: đường đồng bộ điện thoại có
cùng số phận với `/api/cm/getoldv2` không? Nếu cũng `604` thì cả hướng chết ở tầng
giao thức.

### Lần một: `114`, và nó không có nghĩa gì

Lần chạy đầu gửi `public_key` là **32 byte X25519** và nhận:

```
sync-probe {"ok":false,"code":114,"message":"Tham số không hợp lệ",
  "url":"https://tt-files-wpa.chat.zalo.me/api/message/pull_mobile_msg
         ?zpw_ver=685&zpw_type=30&params=%3Credacted%3E",
  "publicKeyBytes":32,"verdict":"server-error"}
```

Lúc đó tôi đọc `114` là "máy chủ chấp nhận phiên, chỉ chê tham số". **Đó là kết
luận sai**, và cách sai đáng ghi lại: test của tôi khoá tên trường và thứ tự
`params`, nhưng **không** khoá nội dung `public_key`. Nên `114` không phân biệt
được "máy chủ chê tham số" với "máy chủ không dùng được khoá ta gửi".

### Đọc lại bundle: `public_key` là RSA-2048, không phải X25519

`lazy/main-startup.89bb530b91927fd5dd28.js` có `SyncMessageKeyGenerator`:

```js
generateKey() {
  const e = Hb.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  }, { publicKey: 'base64', privateKey: '' });
  ...
}
decryptKey(e, t, s) { return Hb.privateDecrypt(s.privateKey, Hb.constants.RSA_PKCS1_PADDING, e, {input:'base64', output:t}); }
```

`public_key` là **RSA-2048 `spki`/`der` base64: 294 byte**, và `encrypted_private_key`
mà máy chủ gửi về sau khi người dùng xác nhận trên điện thoại được giải bằng
`privateDecrypt(RSA_PKCS1_PADDING)`. Một khoá X25519 32 byte không giải được gói
đó — `114` là lỗi **của ta**, không phải câu trả lời của máy chủ.

Ba thuộc tính phải đúng cùng lúc (`modulusLength`, `spki`+`der`, `base64`); sai cái
nào cũng ra `114` giống hệt. Đó chính là lỗ hổng đã làm lần đo đầu vô nghĩa, và
`tests/phone-sync-probe.test.ts` nay khoá cả ba (tiền tố DER 20 byte, độ dài 294,
không có header PEM).

Cũng sửa trong cùng lượt: `from_seq_id`. `pullMobileMsg` của Zalo PC lật dấu
(`t < 0 → t = 0; t → t + 1`), nên `-1` phải thành `0` và `7` phải thành `8`.

### Lần hai: `code: 0`

Chạy lại trên bản cài, 2026-11-08T18:12:13Z:

```
sync-probe {"ok":true,"code":0,"message":"Successful.",
  "url":"https://tt-files-wpa.chat.zalo.me/api/message/pull_mobile_msg
         ?zpw_ver=685&zpw_type=30&params=%3Credacted%3E",
  "publicKeyBytes":294,"verdict":"accepted"}
```

**Máy chủ trả lời "Successful."** Nghĩa là endpoint nhận request này: phiên hợp lệ,
định dạng khoá hợp lệ, `params` giải được, `pc_name`/`imei`/`from_seq_id` chấp nhận
được. Khác hẳn `/api/cm/getoldv2`, thứ trả `604` cho **mọi** lời gọi.

### Điều này **chưa** chứng minh

Đây là chỗ dễ tự lừa nhất, nên nói rõ:

- `code: 0` **không** có nghĩa "đã đồng bộ được tin nhắn". Response chưa được đọc
  vào cấu trúc nào; thứ máy chủ trả kèm `data` có thể là "không có gì để đồng bộ",
  và ta chưa biết hình dạng của nó.
- **Không** chứng minh `temp_key` thật chạy. `temp_key` đến từ sự kiện điều khiển
  `transfer_after_login` (cmd 590, đường WS E2EE) — chưa có đường đó.
- **Không** chứng minh giải được `encrypted_private_key`. Khoá trong lần đo này bị
  vứt ngay sau khi gọi; chưa có `privateDecrypt` nào chạy thật.
- Máy chủ trả `Successful` cho một request **rỗng** cũng là chuyện bình thường với
  endpoint kiểu "xin việc gì đó thì nhận việc đó". Đúng phần *nhận* thì đã rõ;
  phần *có dữ liệu trả về* thì chưa.

**Cái đã đổi:** hướng này không chết ở tầng giao thức. `getoldv2` chặn ngay cửa;
`pull_mobile_msg` thì không.

### libsignal — bản thật ở đâu, và sai lệch tìm thấy

Lần dò đầu tôi nói libsignal nằm trong `GpwQ.js`. **Sai.** `GpwQ.js` chỉ *dùng*
biến toàn cục `libsignal`. Bản thật là `pc-dist/libs/libsignal-protocol.static.js`
(629 683 byte), nạp bằng `<script src="libs/libsignal-protocol.static.js">` trong
`index.html` — emscripten, asm.js, không phải wasm.

Chạy được ngoài trình duyệt bằng `node:vm` + `webcrypto`; `Curve.generateKeyPair`,
`Curve.calculateAgreement`, `KeyHelper.*` đều cho kết quả đúng và ECDHE hai chiều
khớp. **Nhưng `Curve.verifySignature` (bản sync) trả ngược**: chữ ký đúng → `false`,
chữ ký sai → `true`. Bản `Curve.async.verifySignature` thì đúng (resolve khi hợp lệ,
reject `Invalid signature` khi sai).

Đây là lỗi có thật trong bản VNG đóng gói, không phải lỗi cách tôi gọi: cùng một
cặp khoá, cùng một message, `Curve.sign` + `Curve.verify` cho kết quả đảo, còn
`Curve.async.sign` + `Curve.async.verify` cho kết quả đúng.

**Quan trọng hơn:** *đường đồng bộ điện thoại không dùng libsignal.*
`lazy/main-startup` — nơi có `pullMobileMsg`, `SyncMessageKeyGenerator`,
`decryptKey` — **không** tham chiếu `libsignal` lần nào (`grep -c` = 0). Nó dùng
`$znode.crypto` (RSA) và `window.crypto.subtle` (AES-GCM). libsignal chỉ xuất hiện
ở đường tin nhắn E2EE thường (`compact-app-pc`, `sync-v2-sub-worker` gọi
`Curve.generateKeyPair`/`calculateSignature`).

Nên kế hoạch "vendor libsignal trước" mà tôi trình bày trước đó **sai thứ tự**:
bước đầu tiên không phải libsignal, mà là đường E2EE của cmd 590.

### Đoạn mã đã thêm

`electron/protocol/phone-sync-probe.ts` — `probePullMobileMsg()` và
`generateSyncPublicKey()`, cùng một mục `fileBaseUrl`/`pcName` trong
`captureCloudSession` và `runSyncProbe()` trong `zalo-client.ts`. Tất cả chỉ chạy
khi có `GLASS_SYNC_PROBE`; mặc định không gọi gì. 9 test khoá hình dạng request,
trong đó 3 test mới sinh ra từ chính lỗi lần một.

## `cmd 590` qua WebSocket — đo được, sau ba lần đọc sai (2026-11-09)

Phần trên đã trả lời "cửa `pull_mobile_msg` có mở không" (`code: 0`). Nhưng
`pull_mobile_msg` chỉ là chỗ **kéo** gói đã có; việc **yêu cầu** điện thoại đẩy
lên là `cmd 590` qua WS. Phần này ghi lại phép đo đó, và ba lần nó cho kết quả
sai trước khi đo được.

### Ba lỗi trong bộ quan sát, mỗi lỗi cho cùng một kết quả giả `frames: []`

1. **Đọc `int32` ở offset 1.** Header là `[version:u8][cmd:u16 LE][subCmd:u8]`.
   `getHeader` của zca-js (`dist/apis/listen.js:420`) đọc `readUInt16LE(1)`.
   Đọc 4 byte từ offset 1 lấn sang `subCmd` và cho ra số không tồn tại.
2. **Chỉ nhận `ArrayBuffer` và `Blob`.** Trong tiến trình chính của Electron,
   `ws` giao `event.data` là **`Buffer`** (lớp con của `Uint8Array`). zca-js xác
   nhận đúng điều này: `if (!(data instanceof Buffer)) return` (`listen.js:158`).
   Hai lần đo trước đó bỏ lỡ **mọi** frame.
3. **Gửi trước khi socket mở.** `sendWs` ném
   `WebSocket is not open: readyState 0 (CONNECTING)`. Lần chạy 18:52 ghi đúng
   lỗi đó; các lần "thành công" trước chỉ là may mắn về thời điểm. Đã thêm
   `waitForSocketOpen()` chờ thật.

Phần đọc header được tách ra `electron/protocol/ws-frame.ts` thành hàm thuần và
khoá bằng `tests/ws-frame.test.ts` (7 test) — chính vì ba lỗi này đều **im
lặng**: cả ba đều cho ra `frames: []`, trùng khớp với "máy chủ không trả lời".
Không có test đọc header đúng thì không phân biệt được hai thứ đó.

Cũng đáng ghi: domain `file` lấy từ `zpw_service_map_v3.file[0]` là
`tt-files-wpa.chat.zalo.me`, khác host cloud của nhóm
(`tt-group-cm.chat.zalo.me`). Nhầm hai host này là một cách hỏng thầm lặng —
endpoint vẫn trả lời, chỉ là trả lời vô nghĩa.

### Kết quả đo được

**Chế độ chỉ nghe** (`GLASS_FRAME_WATCH=1`, không gửi gì, 30 giây):

```
frame {"version":1,"cmd":1,  "subCmd":1,"bytes":410}   ← cipher_key, có xử lý
frame {"version":1,"cmd":621,"subCmd":0,"bytes":393}   ← zca-js KHÔNG xử lý
frame-summary {"frames":[{"key":"1/1/1","count":1},{"key":"1/621/0","count":1}]}
```

**Gửi `cmd 590`** (`GLASS_REQUEST_SYNC_PROBE=1`), ba lần với ba hình dạng thân khác
nhau — vì hai lần đầu mỗi lần chỉ đúng một nửa:

| thân gửi | byte thân | phản hồi | nội dung phong bì |
| --- | --- | --- | --- |
| `{"data":{"data":{"reqId":"probe_…"}}}` | 31 | **có**, sau 6 ms, 229 byte | `["data","encrypt","error_code","error_message"]`, `errorCode: 0`, `reqIdChars: 0` |
| `{"data":{"reqId":"probe_…"}}` | 31 | **không có** trong 15 s | — |
| `{"data":{"data":{"lastId":0},"reqId":"probe_…"}}` | 51 | **có**, sau 5 ms, 253 byte | như trên, `encrypt: 2` |

Dòng thứ ba là hình dạng đúng, lấy từ `addCommonParams` của Zalo PC
(`oQzU.js:107`): `data: { ...e.data, reqId }`, với `e` là `requestSyncMessage`
(`data: { data: e }`). Hai tầng, và `reqId` nằm ở tầng ngoài của `data`.

Cả hai phản hồi đều mang đúng bốn khoá với `error_code: 0`. Không khoá nào mang
`reqId` — và **đó là điều đúng theo thiết kế**, không phải từ chối:

### `encrypt: 2` giải thích vì sao không thấy `reqId` ở tầng ngoài

`decodeEventData` của zca-js (`dist/utils.js:337-374`), dựng lại đúng đường nhận
của Zalo PC, định nghĩa bốn kiểu:

```
encrypt 0 → data là chuỗi JSON thuần
encrypt 1 → data là base64 thuần, không decodeURIComponent
encrypt 2 → decodeURIComponent → base64 → AES-GCM → inflate
encrypt 3 → như 2 nhưng nội dung đã phẳng, không inflate
```

Phản hồi `590` mang `encrypt: 2`. Nghĩa là `data` là **một chuỗi đã mã hoá**;
mọi `reqId` hay `error_code` thật nằm *bên trong* nó, không thể xuất hiện ở tầng
ngoài. Kết luận trước đây trong chính báo cáo này — "frame ta gửi không mang
`reqId` nên không thể khớp chính nó" — đọc đúng sự kiện nhưng suy ra sai: nó dùng
sự vắng mặt ở tầng phong bì để nói về nội dung.

### Đã mở được phong bì, nhưng **chưa** có số đo thật

`electron/protocol/ws-payload.ts` (11 test, `tests/ws-payload.test.ts`) mở cả bốn
kiểu, và **chỉ trả hình dạng**: tên khoá, độ dài `reqId`, `error_code`,
`innerDataChars`. Không một byte nội dung nào đi ra log — nội dung ở đây có thể là
tin nhắn của người dùng, và một phép đo không được phép biến thành bản sao dữ liệu.

Bố cục AES-GCM (`[iv 16][additionalData 16][ciphertext][tag 16]`) đã được **đối
chiếu chéo**: phong bì do test dựng được chính đường `crypto.subtle` của zca-js
giải ra đúng, nên bộ giải mã của ta và của thư viện không cùng sai một kiểu.

**Chưa chạy được lần nào cho ra số `inner`.** Bốn lần chạy sau khi có bộ giải mã
đều không ghi được dòng `frame` nào, vì lý do script đo chứ không phải mã app (hai
lần bấm nhầm nút — có *hai* nút cùng tên "Đăng nhập Zalo thật", một để vào chế độ
thật và một để mở phiên; hai lần sau đó đóng app trước khi log kịp ghi). Vì thế
mục này **không** được đọc thành "đã biết máy chủ trả gì".

### `621` là `CLOUD.NEED_VERIFY`, không liên quan đến đồng bộ

Từ enum trong `Qtro.js`:

```js
CLOUD: { PUSH: 620, NEED_VERIFY: 621, DONE_MIGRATE: 623 }
```

`processCloud` trong `fdn9.js` gọi
`CloudService.onReceiveNeedVerifyEvent` — chuỗi xử lý nằm ở `+4BK.js`, đẩy vào
`taskManager` của hàng đợi **media zCloud**. Trong `iKSP.js` có nguyên văn dòng
UI: `"Mở mobile để hoàn tất truyền key"`. Đây là zCloud key, **không** phải
`temp_key` của đồng bộ tin nhắn. Ghi ra để lần sau không đọc nhầm nó thành tín
hiệu đồng bộ.

### `transfer_after_login` đến trên `cmd 601`, qua một socket riêng

`+Mel.js` là máy trạng thái đầy đủ của đồng bộ, và nó xác nhận toàn bộ mô hình:

```js
isTransferAfterLoginControlEvent: ({act, data}) =>
  act === "transfer_after_login" && !!data.temp_key && data.temp_key.length > 0
  && data.imei === getZaloClientID()
```

Bốn sự kiện còn lại mà máy trạng thái chờ đều đến trên `cmd 601`
(`CTRL_PUSH_CTRL`): `user_confirm` (`user_action` 1/3 = đồng ý, 0 = từ chối,
2 = đang khôi phục), `transfer_error` (`status` 1 = mobile active, 2 = idle),
`syncmsg_info` = xong. Luồng xác nhận trên điện thoại là:

```
PC gửi 590 → máy chủ đẩy "transfer_after_login" (kèm temp_key) xuống máy tính
           → điện thoại hiện yêu cầu; người dùng đồng ý
           → máy chủ đẩy "user_confirm" xuống máy tính
           → PC mới gọi pull_mobile_msg với temp_key nhận được
```

`8RMw.js` cho thấy `601` do **`ctr-handler`** xử lý, và nó có cổng riêng:
`this.isStoped = !config.socket.enable_ctrl_socket`. zca-js chỉ xử lý `601` cho
`file_done` / `group` / `fr`, nên không có đường nào lấy `temp_key` qua thư viện
hiện tại.

### Ba lần đo trước không chứng minh được gì

`e2ee_queues: ["513","514","515","713","715"]` — `cmd 590` **không** nằm trong
đó. Khung WS là `[version:u8][cmd:u16 LE][subCmd:u8]` + JSON UTF-8 thuần, đọc
thẳng trong `_send` của Zalo PC. Nên "đường WS mã hoá phía gửi cho cmd 590" mà
tôi từng trình bày là một bước **không tồn tại**; `sendWs` có sẵn là đủ.

### Điều này **chưa** chứng minh

- Chưa đọc được `temp_key` nào. Chưa có sự kiện `transfer_after_login` nào được
  quan sát — và với zca-js hiện tại thì **không thể** quan sát, vì nó không xử
  lý `601`. Cần một socket `ctr-handler` riêng hoặc một listener thô.
- Chưa có `user_confirm` nào, nên chưa có đồng bộ nào chạy xong.
- Việc điện thoại **nhận được** yêu cầu đồng bộ là do người dùng tự báo, không
  phải do log của app. Đó là bằng chứng thật nhưng không phải bằng chứng tự đo.
