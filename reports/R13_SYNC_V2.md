# R13 — Sync V2: đồng bộ lịch sử từ điện thoại lên PC

Date: 2026-11-09 (Asia/Saigon). Trạng thái: **code xong, chạy thật chưa làm.**

Tài khoản: **phụ** (máy này). Điện thoại thử: **iOS 26.11.01**. Wasm lấy từ bộ cài
Zalo trên máy (`~/.local/opt/zalo/Zalo.AppImage` → `AppDir/app/pc-dist/libs/`).

Báo cáo này nối tiếp [R12](R12_PHASE5_LIVE_MODE.md), nơi phần đo được ghi lại.
R12 dừng ở: `cmd 590` có phản hồi, `pull_mobile_msg` trả `code: 0`, nhưng **chưa
có `temp_key`, chưa có đồng bộ nào chạy**. Đây là phần biến điều đó thành đường
chạy trong app.

## Một chỗ R12 chưa nói rõ, và nó làm sai hướng đi

Trước R12 tôi mô tả Sync V2 như "tải một file backup mã hoá rồi giải bằng một
khoá", đặt cạnh `backup_pc2mb`. **Đó là hai tính năng khác nhau**, và gộp chúng
làm hỏng cả hướng tiếp cận:

| | `backup_pc2mb` | **Sync V2 (`transfer_sync2`)** |
| --- | --- | --- |
| Hướng | PC → điện thoại | **điện thoại → PC** (thứ người dùng cần) |
| Dạng | file `.db` mã hoá, tải nguyên khối | phiên trao đổi khoá, **nhiều gói**, mỗi gói tự giải |
| Khoá | một khoá suy từ `backup_key` | ed25519 tạm (`ek`) + ed25519 định danh (`ik`) + **bản ghi phiên** sinh ra trong lúc chạy |
| Endpoint | `POST /api/backuppc2mb/upload` | `GET /api/transfer-sync-v2/request-sync` |
| Điều khiển | HTTP | HTTP để xin, **WS `cmd 601`** để nhận gói |

Tên tính năng trong Zalo PC vẫn là "Sao lưu" ở một số chỗ UI, nên đọc nhãn mà
suy ra cơ chế là chỗ sai đã xảy ra. Đường đúng là `transfer_sync2`.

## Kiến trúc

```
điện thoại ──gói đã niêm phong──► máy chủ ──msgUrl đã ký──► PC
                                    ▲                        │
                     HTTP request-sync                    fetch trần
                                    │                        ▼
              ┌─────────────────────┴────────────┐   [uint32 len][ciphertext]…
              │  SyncV2Controller                │           │
              │   ├ giữ cửa sổ sự kiện 601       │      giải → zstd → protobuf
              │   └ SyncV2Session (state machine)│           │
              └──────────────────────────────────┘     SyncChunk → LiveMessage
```

Bảy file, mỗi file một lớp, không file nào import `zca-js` hay `electron`
(trừ `sync-v2-wasm.ts`, nơi duy nhất cần `app.getAppPath()`):

| File | Dòng | Việc |
| --- | --- | --- |
| `sync-v2-proto.ts` | 456 | protobuf `SyncChunk` viết tay (không sinh code) |
| `sync-v2-crypto.ts` | 566 | binding wasm-bindgen viết lại; ed25519, niêm phong/giải |
| `sync-v2-batch.ts` | 196 | khung `[len][ciphertext]`, zstd, ghép chunk |
| `sync-v2-map.ts` | 104 | `SyncChunk` → `LiveMessage` |
| `sync-v2-request.ts` | 196 | dựng `params` AES, gọi `request-sync` |
| `sync-v2-session.ts` | 571 | máy trạng thái: hai hàng đợi, giải, đếm |
| `sync-v2-controller.ts` | 313 | nối socket ↔ phiên, tải gói, khoá tạm |
| `sync-v2-identity.ts` | 63 | khoá ed25519 định danh, lưu trong `kv` |
| `sync-v2-wasm.ts` | 62 | tìm đường dẫn wasm cho dev / asar / ngoài asar |

## Những chỗ sai mà không có triệu chứng

Phần lớn công sức nằm ở đây: mỗi lỗi dưới **không ném lỗi**, không log, và
trông giống hệt "máy chủ không trả gì".

1. **zca-js bỏ qua `transfer_*` trong im lặng.** `dist/apis/listen.js:213-258`
   chỉ định tuyến `file_done`, `group`, `fr`. Mọi `act_type` bắt đầu bằng
   `transfer_` bị nuốt, nên không có sự kiện nào để bám vào — phải nghe trên
   chính `listener.ws` thô, cùng cách `watchFrames` đã làm.
2. **`encrypt: 0` bọc thêm một lớp `data`.** `decodeEventData`
   (`dist/utils.js:337-374`) trả `JSON.parse(parsed.data)`; nơi gọi đọc
   `.data.controls`. Nên frame plaintext có `data` là **chuỗi** chứa
   `{data: {controls: []}}`. Đọc thẳng `parsed.data.controls` ra `undefined` —
   đúng triệu chứng "không sự kiện nào được nhận".
3. **`ussidx` là số đếm, không phải chuỗi.** `Ao.nextIndex(userSyncSessionId)`
   trả `0, 1, 2…` (`CdmT.js:8273`). Gửi chuỗi 16 ký tự `userSyncSessionId` vào
   đây thì máy chủ nhận request mà phiên không bao giờ khép.
4. **Bản ghi phiên phải lấy từ gói metadata ĐẦU TIÊN.** Mỗi lần
   `createMetadataCipher` sinh **một phiên mới**; dùng bản ghi của lần thứ hai
   thì mọi gói tin giải hỏng AEAD. Test `wrong-session-record` khoá điều này.
5. **Hai hàng đợi, không phải một.** Gói metadata mở khoá cho gói tin. Một hàng
   đợi chung sẽ **tự khoá**: gói tin xếp trước metadata thì chờ bản ghi phiên,
   mà bản ghi phiên do chính hàng đợi đó xử lý. Test "gói tin tới TRƯỚC gói
   metadata" canh đúng thứ tự này.
6. **`temp_key` sống 600 s và có thể tới TRƯỚC khi người dùng bấm.** Nó đến trên
   `transfer_after_login` ngay sau đăng nhập. Giữ cửa sổ 200 sự kiện rồi tra lúc
   bấm, thay vì buộc người dùng bấm đúng 10 phút đầu.
7. **Tải gói không cần cookie.** `msgUrl` đã ký sẵn; Zalo PC gọi
   `fetch(url, {keepalive: true})` trần. Gắn cookie vào là gửi thông tin đăng
   nhập tới một host không cần nó.

## Quyết định thiết kế

**Thử lại tải gói 3 lần, 60 s/lần.** Một gói hỏng làm mất cả một khoảng lịch sử,
không phải một tin. Bỏ một lần thử vì lỗi mạng tạm thời là đánh đổi sai.

**Khoá định danh chỉ lưu nửa riêng.** Khoá công khai suy lại được
(`derivePublicKey`). Lưu cả hai thì một lần ghi hỏng làm hai bản lệch nhau, và
một cặp lệch nhau không giải được gói nào — không triệu chứng nào ngoài "đồng bộ
hỏng". Bản lưu cụt (≠ 32 byte) bị bỏ và sinh cặp mới.

**Không đụng `unread`, không bắn thông báo cho tin lịch sử.** Đây là lỗi tôi
tìm thấy **sau khi** đã nối xong đường IPC, đọc lại `applyIncoming`: nó tăng
`unread` cho tin của người khác và `reduceLive` bắn một thông báo hệ điều hành
cho mỗi tin như vậy. Một lần đồng bộ đầu là hàng nghìn tin của nhiều năm trước
⇒ hàng nghìn thông báo và toàn bộ lịch sử hiện thành chưa đọc. Tin đồng bộ nay
mang cờ `backfill`, và `insertBackfill` chèn **theo thời điểm** thay vì nối vào
cuối — nối vào cuối sẽ đặt tin 2022 dưới tin vừa nhận hôm nay.

**Gói tin không có text bị BỎ, không ghi rỗng.** `upsertMessages` coi chuỗi rỗng
là nội dung hợp lệ; ghi rỗng thì mỗi ảnh trong lịch sử thành một bong bóng trống.
Số tin bị bỏ đi vào `stats.skipped` — im lặng bỏ qua sẽ khiến "đồng bộ xong 0 tin"
trông như lỗi mạng.

**Cả tính năng sau `GLASS_PHONE_SYNC=1`.** Không có cờ thì không đọc wasm, không
gắn thêm listener, không chạm gì. Lý do không phải thẩm mỹ: đường này đã có
`GLASS_SYNC_PROBE`/`GLASS_REQUEST_SYNC_PROBE` từ R12, và ba cờ đo khác nhau chạy
cùng lúc trên một tài khoản thật là cách nhanh nhất để không biết lỗi từ đâu.

## Những gì đã kiểm được, và những gì chưa

| Hạng mục | Trạng thái | Bằng chứng |
| --- | --- | --- |
| Wasm nạp được trong Node, không `fetch` | **PASS** | `tests/sync-v2-crypto.test.ts` |
| Wasm là bản gốc từ bộ cài | **PASS** | sha256 `398a2016…fc739` khớp file trích lại từ `Zalo.AppImage` hôm nay |
| Niêm phong/giải metadata + tin, khoá sai bị từ chối | **PASS** | cùng file |
| protobuf `SyncChunk` đọc đúng byte khai báo | **PASS** | `tests/sync-v2-proto.test.ts`, 13 test |
| Khung lô + zstd, nhiều chunk một lô | **PASS** | `tests/sync-v2-batch.test.ts`, 12 test |
| Hình dạng payload `request-sync` + `params` | **PASS** | `tests/sync-v2-request.test.ts`, 11 test |
| Máy trạng thái cả phiên (24 kịch bản) | **PASS** | `tests/sync-v2-session.test.ts` |
| Lớp nối socket (18 kịch bản) | **PASS** | `tests/sync-v2-controller.test.ts` |
| UI: nút, banner tiến trình, chèn theo thời điểm | **PASS** (logic) | `tests/live.test.ts`, 31 test |
| **Máy chủ thật nhận `request-sync`** | **CHƯA CHẠY** | cần `temp_key` thật |
| **Điện thoại hiện hộp xác nhận** | **CHƯA CHẠY** | — |
| **Gói thật giải ra tin thật** | **CHƯA CHẠY** | — |

`npm test`: **386/386**. `npm run typecheck`, `npm run lint`, `npm run build`,
`npm run build:electron`: sạch.

## Cách chạy

```bash
GLASS_PHONE_SYNC=1 npm run dev:desktop
```

1. Đăng nhập bằng QR (tài khoản phụ).
2. Chờ kết nối `connected`.
3. Menu tài khoản (biểu tượng người, góc phải khung chat) →
   **"Đồng bộ lịch sử từ điện thoại"**.
4. Điện thoại hiện hộp xác nhận — đồng ý trên máy.
5. Banner dưới thanh tiêu đề chạy `Đang xin lịch sử… → Đang đồng bộ… · N tin`.

Nút **ẩn** khi preload không có kênh; bấm mà không có cờ thì nhận câu trả lời
`disabled` kèm hướng dẫn, không phải "chưa đăng nhập".

## Nếu lần chạy thật hỏng, đọc ở đâu

`live-listener.log` chỉ có số đếm và mã, không nội dung tin:

```
sync-v2 {"ok":true,"step":"attached"}
sync-v2 {"phase":"requested"}
sync-v2 {"ok":true,"step":"requested","syncId":"…","database":3,"tempKeyChars":40}
sync-v2 {"ok":true,"step":"batch","idx":1,"isLast":false,"batchType":2,"written":0,"skipped":0,"partition":"metadata_…"}
sync-v2 {"phase":"receiving"}
sync-v2 {"ok":true,"step":"batch","idx":2,"isLast":true,"batchType":1,"written":1841,"skipped":220,"partition":"oneone/…"}
sync-v2 {"phase":"done"}
```

Ba mã cần phân biệt:

| Dòng | Nghĩa | Không phải |
| --- | --- | --- |
| `reason":"no-temp-key"` | chưa thấy `transfer_after_login`, hoặc đã quá 600 s | lỗi mạng |
| `reason":"frame-decode"` | phong bì `601` sai hình dạng | máy chủ im lặng |
| `reason":"batch-failed"` | một gói `err !== 0` | cả phiên hỏng — các gói khác vẫn chạy |

`written` cao mà `skipped` cũng cao là bình thường: tin ảnh/tệp bị bỏ (xem trên).

## Chưa làm

- **Chưa có `user_confirm` hiển thị trong UI.** Điện thoại hỏi; app không nói
  "đang chờ bạn đồng ý trên điện thoại" quá hai chữ trong banner. Zalo PC hiện
  hộp riêng.
- **Chưa đồng bộ hội thoại (`req.type = 4`).** Chỉ tin nhắn (`type = 3`). Danh
  sách hội thoại vẫn đến từ `listConversations`.
- **Chưa phân trang khi lịch sử rất lớn.** Một phiên xin `SyncFull`; máy chủ tự
  chia lô 2000 tin. Chưa đo một tài khoản nhiều năm.
- **Chưa có nút "Huỷ".** Phiên dừng khi app tắt hoặc đăng xuất.
- **Chưa ghi `sync_state` từ lần đồng bộ.** Tin vào `messages` nên đọc được ngay,
  nhưng mốc catch-up (`last_synced_msg_id`) chỉ cập nhật qua `persist` của tin
  sống.

## Rủi ro còn lại

`zca-js` là client không chính thức; helper Sync V2 viết tay có thể bị Zalo đổi.
Một lần chạy đồng bộ thật trên tài khoản phụ là phép đo duy nhất nói được điều
đó — và nó chưa chạy. Nếu máy chủ đổi hình dạng phản hồi, triệu chứng là
`receiving` rồi đứng: request được nhận (`ok: true`), nhưng không gói nào tới,
và banner giữ ở "0 gói đã nhận" cho tới khi người dùng tự huỷ bằng cách đăng
xuất. Không có hạn chờ cho "gói đầu tiên phải tới" — biết trước là thiếu, chưa
sửa.
