# R7 — Protocol & Feature Map (Ma trận tương thích tính năng)

**Trạng thái:** HOÀN THÀNH phần **đánh giá tĩnh**. **Kết luận: 0/9 tính năng đạt PASS.**
Không tính năng nào được coi là khả thi để *kết nối thật* cho tới khi có **quyền sử dụng API** và
**kiểm thử runtime có kiểm soát**.
**Ngày:** 2026-11-06 · **Công cụ RE duy nhất:** REA
**Đối tượng:** Zalo PC `26.10.20` (VNG GROUP JSC) · `renderer` 20.927.993 B · `preload` 1.990.534 B
`renderer SHA-256 6ec041177948ea3254f6b72d485cd72f48a4f7634116dee698c327178faaf415`
`preload  SHA-256 24c5ecb873c7667630ecda923c966574e32baeac8a51dc78243c7508f2f61602`

> Báo cáo này **không** thực thi Zalo, **không** sửa `Zalo.exe`/`app.asar`, **không** inject, **không**
> đăng nhập, **không** gọi bất kỳ endpoint nào. Mọi kết luận là **đọc tĩnh byte do REA trích xuất**.
> Không có tuyên bố tương thích runtime nào. Không ghi credential, cookie, token hay dữ liệu cá nhân.

---

## 1. Quy ước trạng thái

| Nhãn | Nghĩa | Điều kiện để gán |
|---|---|---|
| **OBSERVED** | Hình dạng giao thức đọc được tĩnh, đầy đủ | Có literal endpoint + registry + luồng dữ liệu |
| **PARTIAL** | Có hình dạng nhưng thiếu một phần then chốt | Thiếu schema body, hoặc thiếu một phía của luồng |
| **BLOCKED** | Có cơ chế nhưng bị chặn bởi yếu tố ngoài static analysis | Cần quyền truy cập / phụ thuộc thành phần bên ngoài |
| **UNKNOWN** | Không suy ra được từ byte tĩnh | Cần runtime test |
| **PASS** | **Không dùng trong báo cáo này** | Sẽ chỉ có sau khi có kiểm thử runtime được phép |

**Nguyên tắc:** một tính năng *có endpoint* **không** có nghĩa là *được phép dùng*. R7 tách bạch
hai trục: **khả năng kỹ thuật** (đo được) và **quyền sử dụng** (không đo được bằng RE).

---

## 2. Bảng tổng hợp

| # | Tính năng | Hình dạng | Khả năng kỹ thuật | Quyền sử dụng | Runtime |
|---|---|---|---|---|---|
| F1 | Đăng nhập | **OBSERVED** | PARTIAL — thiếu ngữ nghĩa body | **BLOCKED** | **UNKNOWN** |
| F2 | Danh bạ / Contacts | **OBSERVED** | PARTIAL | **BLOCKED** | **UNKNOWN** |
| F3 | Hội thoại / Conversations | **OBSERVED** | PARTIAL | **BLOCKED** | **UNKNOWN** |
| F4 | Gửi/nhận tin nhắn | **OBSERVED** | PARTIAL | **BLOCKED** | **UNKNOWN** |
| F5 | Gửi/nhận file | **OBSERVED** | PARTIAL | **BLOCKED** | **UNKNOWN** |
| F6 | Chat nhóm | **OBSERVED** | PARTIAL | **BLOCKED** | **UNKNOWN** |
| F7 | Gọi thoại / video | **OBSERVED — bị tắt mặc định** | **BLOCKED** | **BLOCKED** | **UNKNOWN** |
| F8 | Đồng bộ | **OBSERVED** | PARTIAL | **BLOCKED** | **UNKNOWN** |
| F9 | Thông báo | **OBSERVED** | PARTIAL — phụ thuộc main | **BLOCKED** | **UNKNOWN** |

**Tổng: 0 PASS / 9 PARTIAL-or-worse.** Đây là kết quả đúng theo đề bài: chưa có tính năng nào
được kiểm thử thật, nên **không** được ghi PASS.

---

## 3. F1 — Đăng nhập (Login)

### 3.1 Module liên quan
- HTTP registry domain `authDomain` → `wpa.${Je}`
- `$zlogin`: 10 method / 6 channel (`SUBSCRIPTION` + `RAW_SEND`)
- Preload: `login`, `login-step`, `login-after-install`, `login-success`
- Main: keychain bridge `zproto-decrypt-with-keychain` / `zproto-encrypt-with-keychain`

### 3.2 Bề mặt quan sát được

**Endpoint — 24 `/api/login/*` + 7 `/api/register/*` + 3 `/api/enterprise/*`:**

| commandId | Path | Vai trò suy ra từ tên |
|---:|---|---|
| 11133 | `/api/login/reqqr` | yêu cầu QR |
| 11325 | `/api/login/getCaptcha` | lấy captcha |
| 11176 | `/api/login/loginByPasswv2` | đăng nhập bằng mật khẩu (v2) |
| 11177 | `/api/enterprise/login/emailPassword` | đăng nhập doanh nghiệp |
| 11323 | `/api/login/getServerInfo` | thông tin server |
| 11134 | `/api/login/getLoginInfo` | lấy thông tin phiên sau đăng nhập |
| 11135 | `/api/login/logOut` | đăng xuất |
| 11343 / 11341 | `/api/login/getFbAuthInfo`, `/api/login/fbAuth` | xác thực Facebook |
| 11336 / 12601 | `loginByFacebook`, `loginByFacebookWithSecure` | đăng nhập Facebook |
| 11322 | `/api/login/getSupportCountry` | quốc gia hỗ trợ |
| 11329 / 12113 / 12033 | `/api/login/setting`, `/api/setting/me`, `/api/setting/update` | cài đặt |
| 12066 | `/api/update/setting/2FA` | bật/tắt 2FA |
| 11330 / 11347 / 11331 / 11332 | `/api/register/verifyPhone`, `verifyExt`, `getActiveCodeBySms`, `getActiveCodeByVoice` | đăng ký |
| 11333 / 11334 | `/api/register/signUpWithPwd`, `validateActiveCode` | tạo tài khoản |

### 3.3 Luồng dữ liệu

```
QR:      reqqr → (poll/WS) → login thành công
Mật khẩu: getCaptcha → loginByPasswv2 (phone_num, iso_country_code, password, cptch_*)
          → response chứa UIN + khóa giải mã phiên (field `zpw_enk`)
          → getLoginInfo → UIN, decryptKey, config
          → setUIN / setDecryptKey / setCredentials
          → setEndpoints(zpw_chts_new, zpw_ctrs_new, zpw_service_map_new, zpw_conf, zpw_ws)
          → WS AUTHEN → nhận _cipherKey trong r.key
```

**Cơ chế đóng gói:** `encryptParam(obj, scope)` → `{params, enk}`; `params = AES(JSON(obj))` được
base64 + URL-encode; `enk` là khoá theo từng request.

**Bước băm mật khẩu phía client:** tồn tại một bước `encryptPassword(password)` kèm `salt` khi
`enable_encrypt_param` bật. **Không ghi giá trị.**

### 3.4 Khả thi qua API được phép — **BLOCKED**
Không có tài liệu công khai, không có API key, không có OAuth client công bố. Toàn bộ flow là
giao thức riêng của ứng dụng (`zpw_ver=694`).

### 3.5 UNKNOWN / BLOCKED
- **UNKNOWN:** schema response của `getLoginInfo` ngoài các field đã nêu; ngữ nghĩa `auth_ext_info`.
- **BLOCKED:** quyền sử dụng; chính sách tài khoản; điều khoản dịch vụ.
- **BLOCKED:** khả năng dùng phiên đăng nhập trên client thứ ba (không kiểm chứng được bằng static).

### 3.6 Điều kiện cần để kiểm thử thật
1. Văn bản cho phép sử dụng API từ nhà cung cấp.
2. Tài khoản thử nghiệm tách biệt, có đồng ý của chủ tài khoản.
3. Môi trường mạng kiểm soát được, ghi log phía client.
4. Không tái sử dụng phiên của app thật.

---

## 4. F2 — Danh bạ / Contacts

### 4.1 Module
- `/api/friend/*` **24**, `/api/social/*` **40**, `/api/lan/*` **5**, `/api/alias/*` **4**,
  `/api/friendboard/*` **4**
- Registry: FRIEND **24**, ALIAS **4**
- Partition DB: `Friend`, `FriendsInfo`, `Label`, `DeviceList`, `FriendBlocked` (Storage)

### 4.2 Bề mặt quan sát được

**Quan hệ bạn bè** — `/api/friend/`: `accept`, `reject`, `undo`, `remove`, `block`, `unblock`,
`blocklistv2`, `sendreq`, `requested/list`, `recommendsv2/list`, `recommends/remove`,
`search/by-user-name`, `profile/get`, `profile/multiget`, `context/multiget`, `reqstatus`,
`mget-qr`, `group/related`, `closefr/update`, `feed/block`, `last-read-contact-tab`,
`read-contact-tab`.

**Hồ sơ xã hội** — `/api/social/friend/`: `getfriends`, `getminiprofiles`, `getprofiles`,
`getprofiles/v2`, `getclosedfriends`, `get-bizacc`, `active-pcweb`, `onlines`, `phonebook`,
`phonebook/v2`, `verify`. Và `/api/social/profile/`: `me`, `me-v2`, `extra`, `avatar`,
`avatar-url`, `lastOnline`, `status`, `update`, `getmute`, `setmute`, `getrank`, `mode`, `ping`,
`deactive`, `updatelang`, `verification/status`.

**Alias** — `/api/alias/list`, `list/v2`, `update`, `remove`.

**Bạn bè cùng LAN** — `/api/lan/friends`, `status`, `submit`, `samemacs`, `leave`
(bị điều khiển bởi cờ cấu hình `isOffLanFriends`).

### 4.3 Luồng dữ liệu

```
getfriends ─┐
getprofiles ┼→ normalize → partition Friend / FriendsInfo → UI danh bạ
getprofiles ┘                 ↓
                        Label (nhãn) · DeviceList
WS PUSH_STATUS_* chỉ cập nhật trạng thái online, không tạo bản ghi mới
```

### 4.4 Đánh giá
- **Hình dạng: OBSERVED** — 77 endpoint liên quan, registry khớp.
- **Khả năng kỹ thuật: PARTIAL** — thiếu schema body của `getprofiles/v2`.
- **Quyền sử dụng: BLOCKED.**
- **UNKNOWN:** ngữ nghĩa `phonebook/v2` (dữ liệu danh bạ điện thoại — nhạy cảm về quyền riêng tư).

### 4.5 Điều kiện kiểm thử
Như F1, cộng thêm: **chỉ dùng tài khoản thử nghiệm có danh bạ tổng hợp**, không dùng danh bạ thật.

---

## 5. F3 — Hội thoại / Conversations

### 5.1 Module
- `/api/conv/*` **8**, `/api/convlabel/*` **6**, `/api/pinconvers/*` **3**,
  `/api/hiddenconvers/*` **4**, `/api/archivedchat/*` **2**, `/api/preloadconvers/*` **2**,
  `/api/recentsearch/*` **2**, `/api/suggestconvers/*` **1**, `/api/subtab/*` **1**
- Registry: CONVERSATION **17**
- Partition DB: `Message`, `UnreadConv`, `PreviewMsg`, `Conversation`, `missing_message_range`

### 5.2 Bề mặt quan sát được

| Nhóm | Endpoint |
|---|---|
| Ẩn/hiện hội thoại | `hiddenconvers/add-remove`, `get-all`, `reset`, `update-pin` |
| Ghim | `pinconvers/list`, `update`, `updatev2` |
| Lưu trữ | `archivedchat/list`, `update` |
| Nhãn | `convlabel/get`, `update`, `manage/{add,delete,reorder,update}` |
| Đánh dấu chưa đọc | `conv/addUnreadMark`, `getUnreadMark`, `removeUnreadMark` |
| Tự xoá | `conv/autodelete/{getConvers,updateConvers}` |
| Chặn chia sẻ | `conv/blocksharing/{getConvers,updateConvers}` |
| Tải trước | `preloadconvers/get-last-msgs`, `get-last-seen` |
| Tìm gần đây | `recentsearch/list`, `update` |

### 5.3 Luồng dữ liệu

```
WS PUSH_MSG_* (501/521)  ─→ cập nhật PreviewMsg + UnreadConv
WS CLEAR_UNREADS_* (504/524) ─→ xoá UnreadConv
GET_MSG 570 / PRELOAD 571 ─→ nạp lịch sử → partition Message
pinconvers/update ─→ thứ tự danh sách hội thoại
```

### 5.4 Đánh giá
- **OBSERVED** hình dạng; **PARTIAL** kỹ thuật (thiếu schema `preloadconvers/get-last-msgs`).
- **BLOCKED** quyền; **UNKNOWN** runtime.
- **Ràng buộc cứng:** trạng thái chưa đọc được duy trì **hai phía** (server endpoint + WS push +
  DB cục bộ). Client mới sai một trong ba sẽ lệch trạng thái so với app thật.

---

## 6. F4 — Gửi/nhận tin nhắn

### 6.1 Module
- `/api/message/*` **69**, registry CHAT **18**
- WS: `PUSH_MSG_1_1:501`, `PUSH_STATUS_1_1:502`, `CLEAR_UNREADS_1_1:504`, `VERIFY_MSG:532`,
  `HAS_MSG:533`, `PUSH_MISS_MSG:534`, `GET_MSG:570`, `PRELOAD:571`, `GET_STATUS_MSG:575`,
  `GET_LAST_DELIVER_SEEN:577`
- Partition: `Message`, `ConvMsgStatus`, `MsgInfo`, `MsgUrgency`, `Reaction`, `Quotes`, `Mention`,
  `TTLMessage`, `StarMessage`, `PreviewMsg`

### 6.2 Bề mặt quan sát được

| Nhóm | commandId / endpoint |
|---|---|
| Gửi text | **11151** `/api/message/sms` |
| Đã nhận / đã xem | 11153 `delivered`, 12117 `deliveredv2`, 11150 `seen`, 12118 `seenv2` |
| Đang nhập | 11144 `/api/message/typing` |
| Thu hồi | `undo`, `multi_undo` |
| Chuyển tiếp | `forward`, `mforward` |
| Trích dẫn / liên kết | 11770 `quote`, 11286 `link`, `parselink`, `scanurl` |
| Sticker / GIF | 11154 `sticker`, `gif`, `giphy/*` (6), `guggy/*` (2) |
| Cảm xúc | `reaction`, `react_delivered`, `react_seen`, `/api/react/gLastSn` |
| Đã ghim | 12114 `/api/message/fetchImportant` |
| Kênh giữ sống | 11770 `/api/message/keepalive` |
| Xoá | 11779 `delete`, 11778 `deleteconver` |

**Luồng gửi (quan sát được):**

```
sendZText
  → encryptParam → params=AES-base64
  → POST chat-wpa.${Je}/api/message/sms            (withCredentials:true)
  ← ack {msgId, globalMsgId, …}
  → echo WS PUSH_MSG_1_1:501 → ghi Message + ConvMsgStatus → UI
```

**Bộ lọc push → DB (quan sát được):**

```js
H = Set([PUSH_MSG_1_1, PUSH_MSG_GROUP, PUSH_STATUS_GROUP, PUSH_STATUS_1_1,
         CLEAR_UNREADS_1_1, CLEAR_UNREADS_GROUP, GET_MSG, PUSH_MISS_MSG])
```

### 6.3 Đánh giá
- **OBSERVED** hình dạng — đây là module có bằng chứng đầy đủ nhất.
- **PARTIAL** kỹ thuật: **không** đọc được schema JSON của `sendmsg` / `sms`, chỉ đọc được
  **danh sách tham số đã mã hoá**.
- **BLOCKED** quyền; **UNKNOWN** runtime.
- **Ràng buộc cứng:** `limitMessage:2500` ký tự, `limitMsgByte:3000`, `recallMessageMaxTime:300000 ms`,
  `userTypingTime:8 s`, `numberMessage:15` — đây là **hằng số phía client**, sai sẽ lệch hành vi.

---

## 7. F5 — Gửi/nhận file

### 7.1 Module
- `/cloudmedia/*` **11**, `/api/mediastore/*` **3**, `/api/media/*` **3**, `/zalocloud/*` **3**,
  `/zalocloudqos/*` **2**, `/zfamily/*` **1**
- Registry FILE **41**
- WS: `GET_MEDIA_UPLOAD_URL:800`, `SUBMIT_INTERACTIVE_FILE:536`, `PULL_LIST_INTERACTIVE_FILE:537`,
  `PUSH_LIST_INTERACTIVE_FILE:530`
- Partition: `File`, `Image`, `UploadFileThumb`, `DownloadRetry`, `SyncDownload`, `TempBlob`,
  `ZCloud`, `ZCloudUpload`

### 7.2 Bề mặt quan sát được

**Endpoint upload (theo loại):**

```
/api/message/asyncfile/upload        /api/group/asyncfile/upload
/api/message/video/file/upload       /api/group/video/file/upload
/api/message/video/thumb/upload      /api/group/video/thumb/upload
/api/message/voice/upload            /api/group/voice/upload
/api/message/photo_original/upload   /api/group/photo_original/upload
/api/message/upload/photo            /api/group/upload/photo
/api/message/zcloud-upload/photo     /api/group/zcloud-upload/photo
/api/message/sharefile               /api/group/sharefile
/api/message/sharefile_full          /api/group/sharefile_full
/api/product/upload/photo
```

**Metadata mỗi chunk (quan sát được, chỉ tên trường):**

```js
{ totalChunk, checksum, fileName, clientId, totalSize,
  chunkId, isE2EE, toid | grid, metaData, fileType, jxl, eeType, featureId }
```

`isE2EE = 1` áp dụng cho `Photo`, `File`, `PhotoThumb`, `VideoThumb`, `Voice`.

**Luồng upload:**
```
chia chunk → GET_MEDIA_UPLOAD_URL (WS 800) → URL + headers
          → POST từng chunk (FormData "chunkContent") với withCredentials:true
          → handleSendChunkResp → isLastChunk → gửi message tham chiếu file
```

**Giới hạn cấu hình (quan sát được):** `maxSizePhoto:10 MB`, `maxFileSize:300 MB`,
`maxGifSize:3 MB`, `maxNumberOfFile:9`, `supportPhoto:[jpg,png,gif,jpeg,webp,jxl]`,
`unsupportFile:[exe,cmd,bat,com,lnk,vbs]`.

### 7.3 Đánh giá
- **OBSERVED** hình dạng; **PARTIAL** kỹ thuật (thiếu format response của chunk ack).
- **BLOCKED** quyền; **UNKNOWN** runtime.
- **Phụ thuộc:** download URL từ `/cloudmedia/downloadurls/pc/v1` — CDN riêng, cần phiên hợp lệ.

---

## 8. F6 — Chat nhóm

### 8.1 Module
- `/api/group/*` **81**, `/api/board/*` **30**, `/api/poll/*` **6**
- Registry GROUP **57**, GROUP_BOARD **22**, GROUP_POLL **6**
- WS: `PUSH_MSG_GROUP:521`, `PUSH_STATUS_GROUP:522`, `CLEAR_UNREADS_GROUP:524`,
  `GET_STATUS_MSG_GROUP:576`
- Partition: `Group`, `GroupInfo`, `GroupTopics`, `Topic`, `Poll`, `Todo`, `BoardSuggest`

### 8.2 Bề mặt quan sát được

| Nhóm chức năng | Endpoint tiêu biểu |
|---|---|
| Tạo / huỷ | `create`, `create/v2`, `leave`, `disperse`, `change-owner` |
| Thành viên | `invite`, `invite/v2`, `invite/multi`, `kickout`, `kickout/multi`, `pending-mems/list`, `pending-mems/review`, `blockedmems/{add,list,remove}` |
| Quản trị | `admins/add`, `admins/remove`, `setting/update`, `updateinfo`, `upavatar` |
| Lịch sử tin | `getlg`, `getlg/v2`, `getlg/v3`, `getlg/v4`, `getlg/e2ee`, `getmg`, `getmg-v2`, `getgi`, `getgi/v2`, `history` |
| Gửi | `sendmsg`, `sendpt`, `sendlink`, `sendmp3`, `sticker`, `gif`, `quote`, `mention` |
| Trạng thái | `delivered`, `deliveredv2`, `seen`, `seenv2`, `getStatusMsg`, `react_delivered`, `react_seen`, `reaction` |
| Liên kết nhóm | `link/new`, `link/detail`, `link/disable`, `link/ginfo`, `link/join` |
| Hộp thư mời | `inv-box/{list,join,inv-info,mdel-inv}` |
| Bảng tin | `/api/board/list`, `pin`, `pinv2`, `unpin`, `unpinv2`, `topic/*` (9), `personal/*` (8), `oneone/*` (4) |
| Bình chọn | `/api/poll/{create,detail,end,option/add,share,vote}` |
| Cộng đồng | `upgrade/community`, `quota/community`, `quota/members-comm`, `analyse` |

### 8.3 Đánh giá
- **OBSERVED** hình dạng — module lớn nhất (81 endpoint).
- **PARTIAL** kỹ thuật.
- **BLOCKED** quyền; **UNKNOWN** runtime.
- **Ràng buộc cứng:** group có **E2EE riêng** (`getlg/e2ee`, các endpoint `/api/e2ee/pc/group/*`).
  Nhóm E2EE và nhóm thường dùng **endpoint khác nhau** — client mới phải xử lý cả hai.

---

## 9. F7 — Gọi thoại / video

### 9.1 Module
- `/api/voicecall/*` **29** (cá nhân 15 + nhóm 14)
- `$zcall`: 20 method / 11 channel
- Preload native bridge: `call-init`, `call-local-request`, `call-request`,
  `call-response-listDevice`, `call-send-signal`, `call-send-to-native`, `call-server-request`,
  `call-update`, `call_active_native_app` — **8 kênh**
- WS: `CTRL_PULL_VOIP:604`

### 9.2 Bề mặt quan sát được

**Cá nhân:** `requestcall` (11300), `request`, `ringring`, `answer`, `answerack`, `cancel`,
`endcall`, `holdreq`, `holdresp`, `unholdreq`, `unholdresp`, `logendcall`, `conf`,
`requestaudio2video`, `requestsharescreen`.

**Nhóm:** `group/{requestcall,request,ringring,answer,cancel,endcall,finish,join,state,notify,ping,
broadcast,adduser,sharescreen}`.

### 9.3 Ba sự kiện cứng (quan sát được)

1. **`enableCall: false`, `enableVideoCall: false`** trong default config object.
2. **Renderer: `getUserMedia = 0`, `getDisplayMedia = 0`, `mediaDevices = 0`.**
3. **`RTCPeerConnection` xuất hiện 6 lần, tất cả trong `getLocalIP()`** — dùng `iceServers: []` để
   lấy IP nội bộ, **không** dùng để truyền media.

> **R11 quét lại (2026-11-06), toàn bộ 116 tệp `.js` thay vì một bundle.** Kết luận giữ nguyên,
> nhưng hai con số phải viết lại cho đúng phạm vi: `getUserMedia` có **7 hit**, tất cả nằm trong một
> shim Emscripten của `pc-dist/libs/libsignal-protocol.static.js` — là *định nghĩa*, không phải lời
> gọi; số **lời gọi capture thật** (`navigator.mediaDevices`, `enumerateDevices`, `srcObject`) là
> **0**. `RTCPeerConnection` có **24 hit** nhưng vẫn là *một* hàm `getLocalIP()` nhúng lặp trong 4
> bundle. Số **lời gọi** từ mã gọi là **0** (1 hit còn lại là shim tự gọi chính nó). Bằng chứng:
> `reports/_r11_f7_media_sweep.txt`, `reports/_r11_f7_media_context.txt`,
> `reports/_r11_f7_emscripten_calls.txt`.

Ngoài ra, các kênh `call-send-to-native`, `call-init`, `call-server-request`, `call_active_native_app`
**không xuất hiện trong renderer** (kiểm tra chuỗi: `NOT IN RENDERER`).

### 9.4 Đánh giá — **BLOCKED ở tầng kiến trúc, không chỉ ở tầng quyền**

Đây là kết luận quan trọng nhất của R7. Không phải "chưa biết", mà là **quan sát được rằng
renderer không sở hữu media stack**:

- **OBSERVED:** media capture **không** nằm trong renderer.
- **INFERRED:** gọi điện do **native app** xử lý, renderer chỉ điều khiển qua IPC (`$zcall`) và
  nhận tín hiệu qua preload.
- **BLOCKED:** một client Electron thuần **không thể** tái dựng tính năng này chỉ từ renderer
  contract, vì phần media/audio routing/device enumeration nằm ở binary native **không có trong
  bundle JS**.

### 9.5 Điều kiện kiểm thử
Không thể lập kế hoạch kiểm thử F7 cho tới khi:
1. Có tài liệu về cách native app tiếp nhận lệnh gọi (không suy ra được).
2. Có quyền sử dụng API voicecall.
3. Chấp nhận rằng có thể phải dựng **WebRTC hoàn toàn mới** — tức là *không* tương thích với
   thiết bị Zalo thật ở phía media, chỉ tương thích ở phía báo hiệu (signaling).

---

## 10. F8 — Đồng bộ (Sync)

### 10.1 Module
- WS `SYNC_MESSAGE`: `REQUEST:590`, `ACK_DELETE_SYNC_SESSION:591`, `REQUEST_MOBILE_WAKE_UP:592`
- WS `BACKUP_MSG`: `INIT:630`, `CREATE_SESSION:631`, `GET_METADATA:632`, `SIGNAL_RESTORE:633`,
  `GET_CONFIGS:634`
- WS `CLOUD`: `PUSH:620`, `NEED_VERIFY:621`, `DONE_MIGRATE:623`
- HTTP: `/api/syncmsg/confirm`, `/api/sync_action/media`, `/api/transfer-sync-v2/request-sync`,
  `/api/message/pull_mobile_msg`, `/api/message/cancel_pull_mobile_msg`,
  `/api/message/delete_snapshot_mobile_msg`, `/api/message/get_backupmsginfo`,
  `/api/message/get_crossdb`, `/api/backuppc2mb/upload`
- Partition: `SyncDownload`, `missing_message_range`, `RefreshToken`, `modules`

### 10.2 Luồng quan sát được

```
BACKUP_MSG.GET_CONFIGS:634 → BACKUP_MSG.INIT:630 → CREATE_SESSION:631
  → GET_METADATA:632 → SIGNAL_RESTORE:633
SYNC_MESSAGE.REQUEST:590  ⇄  ACK_DELETE_SYNC_SESSION:591
CLOUD.PUSH:620 → CLOUD.NEED_VERIFY:621 → CLOUD.DONE_MIGRATE:623
```

**Kéo tin từ thiết bị khác:** `pull_mobile_msg` / `cancel_pull_mobile_msg` /
`delete_snapshot_mobile_msg`; đánh thức thiết bị qua `REQUEST_MOBILE_WAKE_UP:592`.

### 10.3 Đánh giá
- **OBSERVED** hình dạng: 3 nhóm WS + 9 endpoint HTTP + 4 partition.
- **PARTIAL** kỹ thuật: **không** đọc được thứ tự bắt buộc / điều kiện lỗi của state machine.
- **BLOCKED** quyền; **UNKNOWN** runtime.
- **Rủi ro cao nhất trong 9 tính năng:** sync sai thứ tự có thể **mất tin nhắn** trên thiết bị thật
  của người dùng. Đây là lý do F8 **không** nên là mục tiêu đầu tiên của client mới.

---

## 11. F9 — Thông báo (Notifications)

### 11.1 Module
- `$znoti`: 9 method / 6 channel — `_noti_create`, `_noti_close`, `_noti_is-supported`,
  `_noti_on-click`, `_noti_on-show`, `_noti_on-close`
- Preload thêm: `noti-create`, `noti-click`, `noti-ready`
- Main: `_noti_*` → OS notification

### 11.2 Ba sự kiện cứng

| Phép đo | Kết quả |
|---|---:|
| `new Notification(` trong renderer | **0** |
| `showNotification` trong renderer | **0** |
| `Notification.requestPermission` | **3** |

### 11.3 Đánh giá
- **OBSERVED:** thông báo đi **renderer → IPC `$znoti` → main → OS**, **không** qua Web Notification API.
- **Suy luận:** renderer xin quyền (3 chỗ) nhưng hiển thị do main đảm nhiệm.
- **PARTIAL** kỹ thuật — thiếu schema payload của `_noti_create`.
- **BLOCKED** quyền; **UNKNOWN** runtime.
- **Hệ quả thiết kế:** client mới phải tự dựng toàn bộ đường thông báo ở main process. Không thể
  "mượn" cơ chế của Zalo vì nó nằm trong binary native.

---

## 12. Ba ràng buộc xuyên tính năng

### 12.1 E2EE là subsystem, không phải cờ
31 endpoint `/api/e2ee/*` + 9 bảng `e2ee_*` + enum Signal Protocol đầy đủ
(INIT 540–582, MSG 551/552/535, MSG_OFFLINE 514, ACK 545/550/553/554/557/558;
DeviceId `{MOBILE:0, WEB:1, PC:2, SYSTEM:3, UNKNOWN:6}`).

**Hệ quả:** client mới **không** thể gửi tin vào hội thoại E2EE nếu không triển khai Signal Protocol
tương thích. Điều này ảnh hưởng F4, F5, F6, F8.

### 12.2 Mã lỗi ứng dụng nằm ở tầng response, không phải HTTP
`_request` kiểm tra `e.data.error_code !== 0` → tăng bộ đếm lỗi và có thể `switchDomain`.
Nghĩa là **HTTP 200 vẫn có thể là lỗi ứng dụng**. Client mới bỏ qua kiểm tra này sẽ hiểu sai trạng thái.

### 12.3 Domain có thể chuyển giữa chừng
`enable_swap_domain` + `switchNextDomain` + debounce 5 s / revert 300 s. Mọi request lỗi 4xx/5xx
đều gọi `f.b.switchDomain(e._url)`. Client mới phải xử lý đa domain hoặc sẽ hỏng khi server chuyển.

---

## 13. Kết luận R7

1. **Cả 9 tính năng đều có hợp đồng hình dạng quan sát được.** Đây là tin tốt cho việc **thiết kế**
   interface (R8): chúng ta biết phải mô hình hoá những gì.
2. **Không tính năng nào đạt PASS**, vì chưa có runtime test và chưa có quyền sử dụng.
3. **F7 (gọi điện) bị chặn ở tầng kiến trúc**, không chỉ tầng quyền — renderer không có media stack.
4. **F8 (đồng bộ) rủi ro cao nhất** — sai thứ tự có thể mất tin trên thiết bị thật.
5. **E2EE là điều kiện tiên quyết** cho F4/F5/F6/F8 nếu muốn tương thích với hội thoại đã mã hoá.
6. **Đường tối thiểu khả thi** cho một client mới (nếu có quyền): F1 → F2 → F3 → F4 → F5 → F6.
   F7 và F8 nên để sau cùng hoặc ngoài phạm vi.

**Không kế thừa R5:** R5 NO-GO cho *inject vào app gốc*. R7 **không** suy ra NO-GO cho client mới
từ đó. Kết luận của R7 là: *chưa thể chứng minh khả thi, và có ba ràng buộc cứng đã biết* — khác với
*không thể*.
