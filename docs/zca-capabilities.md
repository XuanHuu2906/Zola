# Khả năng của zca-js 2.2.0 — kết quả đối chiếu

Ngày: 2026-11-07 (Asia/Saigon). Nguồn: khảo sát tĩnh `node_modules/zca-js@2.2.0/dist/**`
(`zalo.d.ts`, `apis.d.ts`, `apis/*.d.ts`, `apis/*.js`, `models/*.d.ts`, `context.d.ts`, `Errors/*`).
Giai đoạn 6 đọc file này.

## Cách đọc bảng

Ba mức, **không trộn**:

| Mức | Nghĩa |
|---|---|
| **có (khai báo)** | Hàm/kiểu **tồn tại** trong bản 2.2.0 đã cài. Đọc từ `.d.ts` + `.js`. Chưa gọi với tài khoản thật. |
| **không** | Không có hàm/sự kiện nào làm được việc đó trong toàn bộ bề mặt `dist/`. |
| **chưa thử** | Cần một lần chạy thật (tài khoản phụ) mới biết payload và hành vi. |

> Không có mức "đã chạy". Mọi dòng dưới đây là **khảo sát tĩnh**; chưa có lần gọi server Zalo nào.

## 0. Bề mặt gốc

| Hạng mục | Kết quả | Chi tiết |
|---|---|---|
| Entry CJS | **có** | `require('zca-js')` chạy được (`exports.require → ./dist/cjs/index.cjs`). Đã kiểm bằng `node -e`. |
| `Zalo` class | **có** | `new Zalo(options?: Partial<Options>)`; `login(credentials)`, `loginQR(options?, callback?)`. |
| `login` / `loginQR` là **method của `Zalo`** | **có** | Không phải hàm top-level như một số ví dụ trên mạng viết. |
| `Options` | **có** | `{ selfListen, checkUpdate, logging, apiType, apiVersion, agent?, polyfill, imageMetadataGetter? }`. |
| `checkUpdate` mặc định | `true` | `loginCookie()` gọi `checkUpdate()` → GET `registry.npmjs.org/zca-js` trước khi đăng nhập. **Phải đặt `checkUpdate: false`** để không có request ngoài ý muốn. |
| `selfListen` mặc định | `false` | Tin do chính mình gửi **không** phát qua `listener.on('message')`. Gửi lạc quan ở UI là đường duy nhất để thấy tin của mình. |

## 1. Đăng nhập

| Hạng mục | Kết quả | Chi tiết |
|---|---|---|
| QR login | **có (khai báo)** | `Zalo.loginQR({userAgent?, language?, qrPath?}, callback?)`. Mặc định UA Firefox 133 / `language: 'vi'`. |
| Sự kiện callback QR | **có** | `LoginQRCallbackEventType`: `QRCodeGenerated=0`, `QRCodeExpired=1`, `QRCodeScanned=2`, `QRCodeDeclined=3`, `GotLoginInfo=4`. |
| Ảnh QR | **có** | `QRCodeGenerated.data.image` là data URL. `apis/loginQR.js` **đã bỏ** tiền tố `data:image/png;base64,` trước khi đưa vào callback → payload là base64 trần. |
| Base64 QR lấy ở đâu | — | Nếu cần data URL cho `<img>`, phải **tự ghép lại** `data:image/png;base64,` + chuỗi nhận được. |
| Hết hạn QR | **có** | Timer nội bộ 100 000 ms → `QRCodeExpired`. |
| Từ chối trên điện thoại | **có** | `error_code == -13` → `QRCodeDeclined`. |
| `actions` | **có** | `{ saveToFile, retry, abort }` cho 4 sự kiện đầu; `GotLoginInfo.actions === null`. |
| Khôi phục phiên bằng cookie | **có (khai báo)** | `login({imei, cookie, userAgent, language?})`. Cookie nhận được ở `GotLoginInfo.data.cookie` (mảng `SerializedCookie[]`). |
| Phiên hết hạn phát hiện thế nào | **chưa thử** | `loginCookie` ném `ZaloApiError("Đăng nhập thất bại")` khi `login`/`getServerInfo` trả rỗng. Cần đo error code thật (401/`-201`…) để phân biệt với lỗi mạng. |
| Error class | **có** | `ZaloApiError { code: number \| null }`, `ZaloApiLoginQRAborted`, `ZaloApiLoginQRDeclined`, `ZaloApiMissingImageMetadataGetter`. Phân biệt bằng `instanceof`. |

Payload QR đã ẩn (hình dạng thật, không phải giá trị):

```jsonc
// type = QRCodeGenerated (0)
{ "type": 0, "data": { "code": "<chuỗi QR>", "image": "<base64 png>",
  "options": { "enabledCheckOCR": false, "enabledMultiLayer": false }, "token": "<token>" },
  "actions": { "saveToFile": "fn", "retry": "fn", "abort": "fn" } }
// type = GotLoginInfo (4)
{ "type": 4, "data": { "cookie": ["<SerializedCookie>…"], "imei": "<uuid>", "userAgent": "<UA>" },
  "actions": null }
```

## 2. Nhận tin realtime

| Hạng mục | Kết quả | Chi tiết |
|---|---|---|
| Listener | **có** | `api.listener` (class `Listener extends EventEmitter<ListenerEvents>`). |
| `message` | **có** | `(message: Message)` với `Message = UserMessage \| GroupMessage`. |
| Định tuyến thread 1-1 | **có** | `UserMessage.threadId = data.uidFrom === "0" ? data.idTo : data.uidFrom`. |
| Định tuyến thread nhóm | **có** | `GroupMessage.threadId = data.idTo`. |
| Tin của chính mình | **có nhưng bị lọc** | `isSelf = data.uidFrom === "0"`; nếu `!selfListen` thì `continue` — **không** phát `message`. |
| `old_messages` | **có** | `(messages: Message[], type: ThreadType)`; cmd 510/511 subCmd 1. |
| `undo` (thu hồi/xóa) | **có** | `(data: Undo)`; `content.deleteMsg` tồn tại. |
| `reaction` | **có** | `(reaction: Reaction)`; `old_reactions(reactions, isGroup)`. |
| `seen_messages` | **có** | `(messages: SeenMessage[])`; cmd 601 controls. |
| `delivered_messages` | **có** | `(messages: DeliveredMessage[])`. |
| `typing` | **có** | `(typing: Typing)`; cmd 602. |
| `friend_event` / `group_event` | **có** | Sự kiện quan hệ bạn bè / thành viên nhóm. |
| `upload_attachment` | **có** | `{ fileUrl, fileId }` trong lúc upload. |
| `cipher_key` | **có** | `(key: string)` — **khóa phiên WebSocket**. Tuyệt đối không đưa xuống renderer. |
| Payload thật của `message` | **chưa thử** | Cần một tin thật để xác nhận `content` là chuỗi hay object cho từng `msgType`. |

Hình dạng `TMessage` (đã ẩn giá trị):

```jsonc
{ "msgId": "<số dạng chuỗi>", "cliMsgId": "<số dạng chuỗi>", "msgType": "<chuỗi số>",
  "uidFrom": "<uid | '0' nếu là mình>", "idTo": "<uid | '0'>", "dName": "<tên hiển thị>",
  "ts": "<epoch ms dạng chuỗi>", "content": "<chuỗi hoặc object>", "ttl": 0,
  "propertyExt": { "color": 0, "size": 0, "type": 0, "subType": 0, "ext": "" },
  "quote": { "ownerId": "<uid>", "msgId": "<id>", "msg": "<text>", "ts": 0 } }
```

## 3. Gửi tin

| Hạng mục | Kết quả | Chi tiết |
|---|---|---|
| `sendMessage` | **có (khai báo)** | `(message: MessageContent \| string, threadId: string, type?: ThreadType)` → `Promise<{ message: {msgId:number} \| null, attachment: {msgId:number}[] }>`. |
| `threadId` cho 1-1 | **có** | Là `uid` của người kia (`message.threadId` ở trên). |
| `msgId` trả về | **có** | `number`. Cần đối chiếu với `data.msgId` (string) của listener — **chưa thử**. |
| Không có `cliMsgId` trả về | **không** | `SendMessageResult` chỉ có `msgId`. Muốn nối tin tạm ↔ tin thật, dùng `msgId`, **không** dùng `cliMsgId`. |
| Đánh dấu đã đọc | **có (khai báo)** | `sendSeenEvent(messages \| messages[], type?)`; cần đủ `msgId, cliMsgId, uidFrom, idTo, msgType, st, at, cmd, ts` của tin cuối. Giới hạn 50 tin/lần (`MAX_MESSAGES_PER_SEND`). |
| Đang gõ | **có** | `sendTypingEvent`. |
| Gửi ảnh/tệp bằng đường dẫn | **có, có điều kiện** | Phải cấp `imageMetadataGetter` khi `new Zalo(...)`, nếu không → `ZaloApiMissingImageMetadataGetter`. |
| **MVP dùng gì** | — | Chỉ `sendMessage(plain string, threadId, ThreadType.User)` + `sendSeenEvent`. |

## 4. Danh sách hội thoại — **KHÔNG có hàm trực tiếp**

Đây là câu hỏi mở lớn nhất của plan §2. Kết quả:

| Hạng mục | Kết quả | Chi tiết |
|---|---|---|
| `getConversations()` | **không** | Không tồn tại trong `dist/apis/`. |
| `getAllFriends()` | **có** | `(count?, page?, avatarSize?) → User[]` (`userId`, `displayName`, `zaloName`, `avatar`, …). |
| `getAllGroups()` | **có nhưng chỉ id** | → `{ version, gridVerMap: Record<groupId, string> }`. **Không có tên nhóm.** |
| `getGroupInfo(ids)` | **có** | → `gridInfoMap[groupId] = { name, avt, fullAvt, memberIds, totalMember, … }`. Phải ghép từ `getAllGroups().gridVerMap`. |
| `getPinConversations()` | **có (khai báo)** | → `{ conversations: string[], version }`. |
| `getUnreadMark()` | **có (khai báo)** | → `{ data: { convsGroup: UnreadMark[], convsUser: UnreadMark[] } }`, `UnreadMark { id, cliMsgId, fromUid, ts }`. |
| `getArchivedChatList()` | **có** | Danh sách lưu trữ. |
| Tin cuối của hội thoại | **không** | Không có API "lấy preview". Phải lấy từ `message`/`old_messages` sau khi mở kết nối. |
| **Kết luận cho MVP** | — | Dựng danh sách = `getAllFriends` + `getAllGroups→getGroupInfo`, bổ sung `pinned`/`unread` từ `getPinConversations`/`getUnreadMark`. Preview ban đầu để trống cho tới tin đầu tiên. |

## 5. Lịch sử tin nhắn

| Hạng mục | Kết quả | Chi tiết |
|---|---|---|
| `getGroupChatHistory(groupId, count?)` | **có** | → `{ more, groupMsgs: GroupMessage[], lastActionId, … }`. **Chỉ nhóm.** |
| API lịch sử 1-1 | **không** | Không có `getUserChatHistory`/tương đương trong `dist/apis/`. |
| Lịch sử 1-1 qua listener | **có (khai báo)** | `listener.requestOldMessages(ThreadType.User, lastMsgId?)` → server trả `old_messages` (cmd 510). Đây là **đường duy nhất**. |
| Lịch sử nhóm qua listener | **có** | `requestOldMessages(ThreadType.Group, lastMsgId?)` → cmd 511. |
| Trang bao nhiêu tin / lần | **chưa thử** | Payload gửi `{ first: true, lastId, preIds: [] }`; số tin server trả về chưa đo. |
| `before` theo *thời gian* | **không** | Chỉ phân trang theo `lastMsgId` (con trỏ id), không theo mốc `ts`. Giai đoạn 6 phải lưu `msgId` cuối làm con trỏ. |
| Phân biệt "hết lịch sử" với "lỗi" | **chưa thử** | Không có cờ `more` trên đường listener. |

## 6. Trạng thái kết nối WebSocket

| Hạng mục | Kết quả | Chi tiết |
|---|---|---|
| `connected` | **có** | Khi `ws.onopen`. |
| `disconnected` | **có** | `(code: CloseReason, reason: string)` — luôn phát, kể cả khi sẽ tự retry. |
| `closed` | **có** | Chỉ phát khi **không** tự retry nữa. |
| `error` | **có** | `(error: unknown)` từ `ws.onerror`. |
| `CloseReason` | **có** | `ManualClosure=1000`, `AbnormalClosure=1006`, `DuplicateConnection=3000`, `KickConnection=3003`. |
| Tự retry nội bộ | **có** | `start({ retryOnClose: true })` → đọc `ctx.settings.features.socket.close_and_retry_codes` + `retries[code] = { max, times }` từ server. |
| **Mã 3000/3003 có nằm trong danh sách retry?** | **chưa thử** | Phụ thuộc `settings` server trả về. **Không được giả định.** Tầng protocol phải tự coi 3000/3003 = `replaced` và **không** gọi `start()` lại. |
| `stop()` | **có** | Đóng socket chủ động. |
| Nếu socket đã `start()` rồi gọi lại | `ZaloApiError("Already started")` | Không idempotent — tầng protocol phải tự quản cờ. |

**Quyết định thiết kế (khác mặc định của thư viện):** gọi `start({ retryOnClose: false })` và tự
điều khiển backoff ở tầng protocol. Lý do: cần ánh xạ 3000/3003 → `replaced` (không tự kết nối lại)
và cần backoff 2s→60s do *mình* kiểm soát, không phụ thuộc `settings` server.

## 7. Tài khoản

| Hạng mục | Kết quả | Chi tiết |
|---|---|---|
| `getOwnId()` | **có, đồng bộ** | Trả `string`. Không phải Promise. |
| `fetchAccountInfo()` | **có** | → `{ profile: User }` (tên hiển thị, avatar). |
| `getUserInfo(uid)` | **có** | → thông tin người dùng. |

## 8. Giới hạn và rủi ro

| Hạng mục | Kết quả | Chi tiết |
|---|---|---|
| Rate limit | **không có số chính thức** | Không có hằng số nào trong `dist/`. Phải tự throttle và quan sát. |
| Một listener / một tài khoản | **có (theo README)** | Mở Zalo Web khi listener chạy → listener tự dừng (đúng là `DuplicateConnection`/`KickConnection`). |
| Khóa/ban tài khoản | **cảnh báo của thư viện** | README nêu rõ. Chỉ dùng tài khoản phụ. |
| `checkUpdate` | **1 request ra ngoài** | Xem §0. Đặt `false`. |
| Nhật ký | `logging: true` mặc định | Log có thể chứa uid/threadId. Trong app desktop nên `false`. |

## 9. Những gì đã bị loại khỏi MVP

- Gửi/nhận ảnh, tệp, sticker, voice, video — cần upload + `imageMetadataGetter`.
- Reaction/undo/typing/tin đã xem — `listener` có, nhưng UI hiện tại chỉ có `react()` cục bộ.
- Lịch sử nhóm đầy đủ, lịch sử ảnh, board, poll, reminder, catalog, bank — ngoài phạm vi.

## 10. Việc còn phải đo bằng tài khoản thật (trước khi tin bất kỳ con số nào)

1. Error code thật khi phiên hết hạn (để phân biệt *mạng* vs *xác thực*).
2. `sendMessage` trả `msgId` nào so với `data.msgId` của listener → khóa nối tin tạm.
3. `old_messages` trả bao nhiêu tin/lần, có báo hết lịch sử không.
4. Mã đóng thật khi mở Zalo Web (3000 hay 3003 hay 1006).
5. `close_and_retry_codes` thật từ `settings` server.
6. `content` của `msgType` phổ biến (1 = text?) — cần payload thật.
