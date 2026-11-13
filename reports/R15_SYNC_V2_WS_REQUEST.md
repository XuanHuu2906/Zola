# R15 — Sync V2: đường gửi thật đã chạy, chờ gói

Date: 2026-11-10 (Asia/Saigon). Trạng thái: **yêu cầu đồng bộ được máy chủ nhận
(`code: 0`); máy chủ chưa đẩy gói nào.** Đây là file bàn giao để làm tiếp.

Tài khoản: **phụ**. Điện thoại: **iOS 26.11.01**. Wasm: từ bộ cài
(`~/.local/opt/zalo/Zalo.AppImage` → `AppDir/app/pc-dist/libs/`).

Nối tiếp [R13](R13_SYNC_V2.md) và [R14](R14_SOCKET_CTRL.md).

---

## 1. Kết quả trong phiên này

### 1.1 Đã bỏ cổng `no-temp-key` — nó là của tôi, không phải của Zalo

`manualSync` của Zalo PC gọi `startManualSync({userSyncSessionId, source,
lastSyncConsSuccessTs, fullResyncRound})` — **không có `tempKey`** — rồi
`initNewMachineInfo` làm `this.tempKey = e.tempKey ?? ""`
(`lazy/main-startup.89bb530b91927fd5dd28.js`, `sync-v2-sub-worker`). Khoá chỉ bắt
buộc ở `autoSyncWhenLogin`. Đã sửa `SyncV2Controller.start` để vẫn gửi khi khoá
rỗng, và ghi **nguồn** của khoá vào log (`tempKeySource`: `event` / `caller` /
`empty`) — vì `''` do chưa từng thấy sự kiện khác hẳn `''` do người gọi truyền.

### 1.2 Endpoint HTTP `/api/transfer-sync-v2/request-sync` **không tồn tại**

Đây là phát hiện chốt của phiên. Bảng path của Zalo PC có
`12888:{domainType: FILE, commandId: 12888, path: "/api/transfer-sync-v2/request-sync"}`,
nhưng đo lại ngày 2026-11-10: **`404 text/html` từ nginx trên toàn bộ 46 origin
của `zpw_service_map_v3`**, trong khi các endpoint **cùng bảng, cùng host** trả
JSON `error_code: 600`:

```
/api/message/pull_mobile_msg             200 {"error_code":600,"zpw_sek bị thiếu..."}
/api/message/photo                       200 {"error_code":600,...}
/api/message/delete_snapshot_mobile_msg  200 {"error_code":600,...}
/api/transfer-sync-v2/request-sync       404 text/html   ← cả 46 host
```

Nghĩa là routing sống, chỉ riêng đường dẫn đó là không có. Hằng số `12888`
trong bundle là di sản của một endpoint đã gỡ. **Đừng thử lại nó.**

### 1.3 Đường thật là WS `cmd 590`, và nó đã chạy

Cùng file bundle, ngay cạnh `requestSyncMessage` HTTP, có hàm mà app gọi thật:

```js
requestSyncMessage(e, t = 1e4) {
  return this.requestAsyncV2({ cmd: 590, subCmd: 0, data: { data: e } }, t);
}
```
`lazy/main-startup…js`: `tue.requestSyncMessage(e)` → `op.a.instance().requestSyncMessage(e)`.

Ghi chú lịch sử: R14 từng ghi "590 đã bị gỡ hẳn" — **chỗ đó sai**, và nó đã làm
mất đúng đường chạy được. Lý do R14 gỡ nó là "590 rỗng không tạo được phiên để
`592` trả lời"; nhưng 590 rỗng được nhận (`code: 0`), chỉ là chưa có gì để đẩy.

**Đo được ngày 2026-11-10, tài khoản phụ, app thật:**

```
sync-v2     {"ok":true,"step":"start","tempKeySource":"empty","tempKeyChars":0}
sync-v2     {"phase":"requested",...}
request-sync {"ok":true,"cmd":590,"sent":true,"code":0}     ← máy chủ NHẬN
wake-mobile {"ok":false,"reason":"no-reply","timeoutMs":3000}
sync-v2     {"phase":"receiving","received":0,"total":0,"written":0,"skipped":0}
```

`window.chat.syncFromPhone()` → **`{"ok": true}`**.

So sánh trước đó cùng ngày: qua HTTP → `{"ok":false,"code":404}`.

---

## 2. Còn thiếu gì — đọc kỹ chỗ này

**Yêu cầu được nhận nhưng máy chủ không đẩy gói nào trong 80+ giây.** Ba giả
thuyết còn sống, xếp theo thứ tự tôi sẽ thử:

### (a) `queries` rỗng — nghi ngờ số một

Payload hiện tại gửi `req: { type: 3, priority: 1, queries: [], batchSize: 2000 }`.
Zalo PC **luôn** gửi ít nhất một query:

```js
n = this.requests.map(e => ({partition: e.partition, from: e.from, to: e.to, limit: e.limit}))
```

và `batchSize` lấy từ `this.options.transferBatchSize` chứ không phải hằng 2000.
Một `req` không nêu partition nào thì máy chủ có thể trả "đã nhận, không có gì để
đẩy". **Việc đầu tiên của lần sau**: đọc cách Zalo PC dựng `this.requests` (tra
`addRequest` / `requests` trong `shared-worker.cfeba43a9a8e4e40dda3.js`) và lấy
đúng `partition` — nghi là id hội thoại, hoặc một tên partition cố định.

### (b) Thiếu bước "chuẩn bị" trước khi xin

Máy trạng thái `init` của Zalo PC chạy **hai** invoke trước khi vào
`sync-full`: `checking_identity_key_pair` → `checkMessageReadinessState`
(`sync-v2-sub-worker`). Cái thứ hai hỏi **DB cục bộ** xem đang thiếu gì
(`MISSING_CONVERSATIONS` / `MISSING_PREVIEW_MESSAGES` / `MISSING_RECENT_MESSAGES` /
`MISSING_OTHER_MESSAGES` / `MESSAGE_READY`) và **gửi kèm mức thiếu đó** trong
yêu cầu. Ta đang bỏ qua bước này — có thể máy chủ coi "không khai thiếu gì" là
"không cần đẩy gì".

### (c) `592` im lặng là hệ quả, không phải nguyên nhân

`wakeup()` của Zalo PC lấy `this.syncSessions[0]` — một phiên **đã** được
`create()`. `592` không trả lời nghĩa là phía máy chủ chưa tạo phiên chuyển, khớp
với việc không có gói nào. Đừng sửa `592` trước khi xong (a) và (b).

**Cách kiểm nhanh sau khi sửa:** quay lại log, tìm dòng `frame` / `601`. Nếu có
`601` với `act: "transfer_after_login"` thì điện thoại đã được đánh thức và bước
tiếp theo là `temp_key`; nếu vẫn `receiving` với `received: 0` thì vẫn ở (a)/(b).

---

## 3. Thay đổi mã trong phiên này

| file | thay đổi |
| --- | --- |
| `electron/protocol/request-sync-ws.ts` | **mới**, 140 dòng: khung `590`, payload, đọc phản hồi |
| `electron/protocol/sync-v2-request.ts` | bỏ hẳn đường HTTP (~120 dòng); còn enum + `generateSyncId` |
| `electron/protocol/sync-v2-controller.ts` | bỏ `deps.session`; `request` thành **bắt buộc** (không còn mặc định HTTP) |
| `electron/protocol/zalo-client.ts` | thêm `sendRequestSync` (song sinh với `sendWakeMobile`); `attachSync` nối `request` vào đó |
| `tests/sync-v2-request.test.ts` | viết lại cho khung WS; 15 test hình dạng |
| `tests/sync-v2-controller.test.ts` | bỏ `session` khỏi fixture |

Hai tầng của `590` là chỗ dễ sai nhất, và đã từng sai: `data` bọc
`{ data: payload, reqId }`. Gửi thiếu tầng trong → máy chủ **im 15 s** (đo R12);
đúng hai tầng → trả lời trong 5–6 ms. Khác `592` (`data: e` phẳng).

**Kiểm tra đã chạy:** `tsc --noEmit` sạch, eslint sạch trên các file đã sửa,
`node --test` cho 4 file liên quan → **77/77 pass**, `npm run build:electron` sạch.

---

## 4. Cách chạy lại (đúng lệnh, đừng đoán)

```bash
cd "/home/nguyenhuu/Hoc Tap/Zola"
npm run build:electron          # BẮT BUỘC sau mỗi lần sửa: Electron chạy dist-electron/
PORTABLE_EXECUTABLE_DIR="$HOME/.config/zalo-apple-glass-ui" GLASS_PHONE_SYNC=1 \
  nohup npx electron . --disable-gpu --remote-debugging-port=9222 > /tmp/glass-run.log 2>&1 &
node /tmp/cdp-eval.mjs "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Zalo thật'));b.click();return 1})()"
node /tmp/cdp-eval.mjs "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Đăng nhập Zalo thật');b.click();return 1})()"
node /tmp/cdp-eval.mjs "window.chat.syncFromPhone()"     # phải trả {"ok":true}
```

Log: `~/.config/zalo-apple-glass-ui/.glass-demo-data/live-listener.log`
(của **profile config**, không phải thư mục repo).

### Ràng buộc phải giữ

- **Không copy** `zca-session.bin` ra khỏi dot-folder config; trỏ app vào
  profile bằng `PORTABLE_EXECUTABLE_DIR` như trên (một lần copy đã bị từ chối).
- Chỉ **tài khoản phụ**: zca-js không chính thức, dùng có thể bị khoá tài khoản.
- Log chỉ metadata: không nội dung tin, không cookie, không IMEI, không
  `temp_key` (kể cả độ dài của nó cũng đã là thông tin).
- ADR-004: chỉ `session.ts`/`zalo-client.ts` được `import 'zca-js'`.
- Cây giải nén từ AppImage là dữ liệu không tin cậy: giữ riêng, truyền đường dẫn.

---

## 5. Những kết luận cũ đã bị **rút lại** (đừng dùng lại)

| kết luận cũ | thực tế |
| --- | --- |
| "`temp_key` là điều kiện để mở phiên" | Đường **tay** chạy với khoá rỗng |
| "`ik` phải là khoá E2EE của tài khoản" | `checkingIdentityKeyPair` gọi `loadNewIdentityKeyPair()` — sinh mới mỗi lần đồng bộ tay |
| "HTTP `request-sync` là đường chính" | Endpoint không tồn tại; WS `590` mới là đường |
| "`590` đã bị gỡ hẳn" (R14) | **Sai**, và nó chặn đúng đường chạy được |
| "`621`/`623` là phản hồi đồng bộ" | Là `CLOUD.NEED_VERIFY` / `DONE_MIGRATE` (zCloud), không liên quan |

---

## 6. Ba việc cho lần sau, theo thứ tự

1. **Đọc `this.requests` của Zalo PC** trong `shared-worker` để dựng `queries`
   đúng, rồi gửi lại. Đây là nghi ngờ số một và là thay đổi nhỏ nhất.
2. Nếu vẫn im: dựng `checkMessageReadinessState` cục bộ (đọc DB của ta) và gửi
   kèm mức thiếu — nó quyết định nhánh `sync_*` nào chạy bên máy chủ.
3. Chỉ sau khi có `601` mới quay lại `592` và `temp_key`.
