# Kế hoạch v2: Desktop UI mới cho Zalo (chi tiết từ giai đoạn 5)

> **Trạng thái:** UI (giai đoạn 0-4) đã xong. Tài liệu này tóm tắt phần nền, rồi đi chi tiết từ giai đoạn 5: nối UI với Zalo thật, đồng bộ dữ liệu, tính năng mở rộng, hiệu năng, bảo trì, đóng gói.

---

## Mục lục

1. [Nền tảng đã có (tóm tắt giai đoạn 0-4)](#1-nền-tảng-đã-có-tóm-tắt-giai-đoạn-0-4)
2. [Sự thật đã xác nhận và phần chưa xác minh](#2-sự-thật-đã-xác-nhận-và-phần-chưa-xác-minh)
3. [Giai đoạn 5: Nối UI với Zalo thật](#3-giai-đoạn-5-nối-ui-với-zalo-thật)
4. [Giai đoạn 6: Đồng bộ dữ liệu](#4-giai-đoạn-6-đồng-bộ-dữ-liệu)
5. [Giai đoạn 7: Tính năng mở rộng](#5-giai-đoạn-7-tính-năng-mở-rộng)
6. [Giai đoạn 8: Hiệu năng và độ bền](#6-giai-đoạn-8-hiệu-năng-và-độ-bền)
7. [Giai đoạn 9: Bảo trì và điều tra bằng REA](#7-giai-đoạn-9-bảo-trì-và-điều-tra-bằng-rea)
8. [Giai đoạn 10: Đóng gói và phân phối cá nhân](#8-giai-đoạn-10-đóng-gói-và-phân-phối-cá-nhân)
9. [Bảo mật: checklist](#9-bảo-mật-checklist)
10. [Kiểm thử](#10-kiểm-thử)
11. [Rủi ro và cách xử lý](#11-rủi-ro-và-cách-xử-lý)
12. [Ước tính thời gian và thứ tự làm](#12-ước-tính-thời-gian-và-thứ-tự-làm)

---

## 1. Nền tảng đã có (tóm tắt giai đoạn 0-4)

| Giai đoạn | Nội dung | Trạng thái |
|---|---|---|
| 0 | Chuẩn bị: tài khoản Zalo phụ, Node LTS, đọc docs zca-js, cài REA | Cần xác nhận |
| 1 | Spike giao thức: `loginQR()`, nhận tin, gửi tin bằng script | Cần xác nhận |
| 2 | Khung Electron + bảo mật cơ bản | Cần xác nhận |
| 3 | Lớp `protocol/` + `ChatService` | Cần xác nhận |
| 4 | UI với dữ liệu giả | **Xong** |

**Kiến trúc (không đổi):**

```
Renderer (UI)  ──IPC──►  Main process
 không biết Zalo         ├─ ipc.ts            validate + route
                         ├─ chat-service.ts   implement ChatService
                         ├─ sync/             engine đồng bộ (mới, giai đoạn 6)
                         ├─ db/               SQLite cache
                         ├─ session.ts        safeStorage
                         └─ protocol/         DUY NHẤT nơi import zca-js
                                   │
                                   ▼ HTTPS / WebSocket
                              Server của Zalo (nguồn dữ liệu chuẩn)
```

**Nguyên tắc cốt lõi:**
1. Server Zalo là nguồn chuẩn. SQLite cục bộ chỉ là cache.
2. Chỉ `protocol/` được import `zca-js`.
3. Renderer không bao giờ thấy cookie, IMEI hay token.
4. UI chỉ đọc từ DB/store, không đọc trực tiếp từ zca-js. Mọi dữ liệu từ Zalo đi qua sync engine rồi mới vào DB.

> **Việc cần làm trước khi sang giai đoạn 5:** xác nhận giai đoạn 1 và 3 thực sự chạy được (đăng nhập QR, nhận và gửi tin bằng tài khoản phụ). Nếu chưa, làm trước, vì mọi thứ phía sau phụ thuộc vào đó.

---

## 2. Sự thật đã xác nhận và phần chưa xác minh

### Đã xác nhận (từ README/npm của zca-js)

- Là Zalo API **không chính thức, cho tài khoản cá nhân**, hoạt động bằng cách **giả lập trình duyệt** tương tác với Zalo Web.
- README cảnh báo dùng có thể khiến tài khoản bị khóa hoặc ban.
- Đăng nhập: `const api = await zalo.loginQR()`.
- Nhận tin: `api.listener.on("message", handler)`; `message.type` (ví dụ `ThreadType.User`), `message.data.content`.
- Gửi tin: `api.sendMessage(payload, threadId, threadType)`; payload có `msg`, tùy chọn `quote`.
- **Chỉ một web listener chạy được cho mỗi tài khoản.** Mở Zalo Web trong trình duyệt khi listener đang chạy sẽ làm listener tự dừng.
- Từ v2.0.0, muốn gửi ảnh/GIF bằng đường dẫn file phải tự cung cấp `imageMetadataGetter` khi khởi tạo `Zalo`.
- Có error class riêng, phân biệt bằng `instanceof`.
- Tài liệu API: `https://tdung.gitbook.io/zca-js`.

### Chưa xác minh (phải kiểm tra trước khi code phần liên quan)

| Câu hỏi | Ảnh hưởng đến | Cách kiểm tra |
|---|---|---|
| Có hàm lấy danh sách hội thoại không? | Giai đoạn 5, 6 | Đọc docs GitBook, `api.*` trong TypeScript types |
| Có hàm lấy lịch sử tin nhắn theo mốc thời gian/ID không? | Giai đoạn 6 (backfill, catch-up) | Như trên; nếu không có, dùng REA + HAR |
| Tên và ý nghĩa các trường ID (`msgId`, `cliMsgId`), `ts`, `uidFrom`... | Khóa upsert, sắp xếp | In ra payload thật từ tài khoản phụ |
| Listener có sự kiện ngắt/kết nối lại rõ ràng không? | Giai đoạn 6 (state machine) | Docs + thử mở Zalo Web khi listener chạy |
| Có sự kiện thu hồi, xóa, reaction, đã đọc, đang gõ không? | Giai đoạn 6, 7 | Docs + thử thực tế |
| Giới hạn tốc độ gọi API | Giai đoạn 6 (throttle) | Không có số chính thức; làm chậm và quan sát |

> Mọi tên hàm trong tài liệu này cho các mục trên chỉ là **hình dạng dự kiến**. Phải đối chiếu với zca-js thật.

**Cách ghi nhận kết quả:** tạo file `docs/zca-capabilities.md` trong repo, liệt kê từng tính năng là "có / không / chưa thử", kèm ví dụ payload đã ẩn thông tin cá nhân. Giai đoạn 6 dựa vào file này.

---

## 3. Giai đoạn 5: Nối UI với Zalo thật

**Mục tiêu:** dùng app nhắn tin 1-1 qua lại với một người thật (tài khoản phụ), UI hiển thị dữ liệu thật.
**Thời gian:** 2-3 ngày. **Đây là mốc MVP.**

### 5.1. Hợp đồng IPC

Định nghĩa một file dùng chung giữa main, preload và renderer:

```ts
// src/shared/ipc-contract.ts
export const IPC = {
  // request/response (invoke)
  login: 'chat:login',
  logout: 'chat:logout',
  listConversations: 'chat:listConversations',
  getMessages: 'chat:getMessages',
  sendMessage: 'chat:sendMessage',
  retryMessage: 'chat:retryMessage',
  markRead: 'chat:markRead',
  // event (main → renderer)
  evLoginState: 'ev:loginState',
  evConnection: 'ev:connection',
  evMessageUpsert: 'ev:messageUpsert',
  evThreadUpsert: 'ev:threadUpsert',
} as const
```

**Quy tắc:**
- Dùng `ipcRenderer.invoke` / `ipcMain.handle` cho request/response; dùng `webContents.send` cho sự kiện đẩy xuống UI.
- **Validate đầu vào ở main** bằng schema (ví dụ zod): `threadId` là chuỗi không rỗng, `text` giới hạn độ dài, `kind` chỉ `'user' | 'group'`.
- Không bao giờ truyền object zca-js thô qua IPC. Luôn qua mapper sang model của bạn (`Message`, `Conversation`).

### 5.2. Preload

```ts
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-contract'

const on = <T>(ch: string, cb: (p: T) => void) => {
  const h = (_: unknown, p: T) => cb(p)
  ipcRenderer.on(ch, h)
  return () => ipcRenderer.removeListener(ch, h) // trả về hàm hủy đăng ký
}

contextBridge.exposeInMainWorld('chat', {
  login: () => ipcRenderer.invoke(IPC.login),
  logout: () => ipcRenderer.invoke(IPC.logout),
  listConversations: () => ipcRenderer.invoke(IPC.listConversations),
  getMessages: (threadId: string, before?: string) =>
    ipcRenderer.invoke(IPC.getMessages, { threadId, before }),
  sendMessage: (threadId: string, kind: string, text: string, quoteId?: string) =>
    ipcRenderer.invoke(IPC.sendMessage, { threadId, kind, text, quoteId }),
  onLoginState: (cb: (s: unknown) => void) => on(IPC.evLoginState, cb),
  onConnection: (cb: (s: unknown) => void) => on(IPC.evConnection, cb),
  onMessageUpsert: (cb: (m: unknown) => void) => on(IPC.evMessageUpsert, cb),
  onThreadUpsert: (cb: (t: unknown) => void) => on(IPC.evThreadUpsert, cb),
})
```

Không expose `ipcRenderer` thô. Mỗi hàm một mục đích.

### 5.3. Luồng đăng nhập thật

```
Mở app
  │
  ├─ có phiên đã lưu? ──có──► khôi phục phiên ──thành công──► logged-in
  │                                   │
  │                                   └─ thất bại/hết hạn ──┐
  └─ không ─────────────────────────────────────────────────┤
                                                            ▼
                                              loginQR() → hiển thị QR (state 'qr')
                                                            │
                                         quét thành công ──► lưu phiên (safeStorage) ──► logged-in
                                         QR hết hạn ───────► tạo QR mới (giới hạn số lần)
                                         lỗi ──────────────► state 'error' + nút thử lại
```

Chi tiết cần làm:
- [ ] Main phát `LoginState` (`logged-out` / `qr` / `logged-in` / `error`) qua `evLoginState`; UI chỉ render theo state này.
- [ ] Ảnh QR chuyển thành data URL ở main rồi gửi xuống UI (renderer không cần thư viện Zalo).
- [ ] Lưu phiên chỉ sau khi đăng nhập thành công; xóa phiên khi đăng xuất hoặc khi server từ chối.
- [ ] Phân biệt lỗi bằng error class của zca-js: lỗi mạng (thử lại được) khác lỗi xác thực (phải quét QR lại).
- [ ] Giới hạn số lần tự thử lại, tăng dần khoảng chờ. Không lặp đăng nhập liên tục vì dễ bị Zalo nghi ngờ.

### 5.4. Luồng nhận và gửi tin (phiên bản MVP, chưa có DB)

**Nhận:**
1. `listener.on("message")` → mapper → `Message`.
2. Phát `evMessageUpsert` xuống UI.
3. UI cập nhật store: thêm vào khung chat đang mở, cập nhật tin cuối và số chưa đọc ở danh sách hội thoại.

**Gửi (gửi lạc quan):**
1. UI tạo tin tạm: `{ clientId, status: 'sending', ts: now }` và hiển thị ngay.
2. Gọi `sendMessage` qua IPC.
3. Thành công: thay tin tạm bằng tin chính thức (có `msgId` từ server), `status: 'sent'`.
4. Lỗi: `status: 'failed'`, hiện nút "Gửi lại" (gọi `retryMessage` với cùng `clientId`).

> Ở MVP, chưa có DB nên danh sách hội thoại và lịch sử chỉ gồm những gì lấy được khi app mở. Giai đoạn 6 sẽ giải quyết phần này.

### 5.5. Xử lý lỗi và trạng thái kết nối

`ConnectionState`: `connected` | `connecting` | `disconnected` | `replaced` (listener bị thay thế, ví dụ khi Zalo Web mở nơi khác).

- UI hiển thị banner theo state: "Đang kết nối...", "Mất kết nối", "Đã dừng vì Zalo đang mở ở nơi khác" kèm nút **Kết nối lại**.
- State `replaced`: **không** tự kết nối lại. Chỉ kết nối khi người dùng bấm.
- Mất mạng: tự thử lại với khoảng chờ tăng dần (ví dụ 2s, 4s, 8s... tối đa 60s).

### Checklist hoàn thành giai đoạn 5
- [ ] Đăng nhập QR trong UI, khôi phục phiên sau khi tắt mở app.
- [ ] Nhận tin realtime hiển thị đúng hội thoại.
- [ ] Gửi tin, thấy trạng thái đang gửi → đã gửi; ngắt mạng rồi gửi thì thấy lỗi và gửi lại được.
- [ ] Banner trạng thái kết nối hoạt động, kể cả trường hợp mở Zalo Web.
- [ ] Không có cookie/IMEI/token nào xuất hiện ở renderer (kiểm tra bằng DevTools).

---

## 4. Giai đoạn 6: Đồng bộ dữ liệu

**Mục tiêu:** mở app lên có ngay dữ liệu cũ, dữ liệu luôn khớp với server, không trùng, không mất, không lệch thứ tự.
**Thời gian:** 4-6 ngày (phụ thuộc zca-js có sẵn hàm lấy lịch sử hay không).

### 6.1. Mô hình tổng thể

Ba luồng chạy cùng nhau, tất cả đi qua một **sync engine** ở main process và ghi vào SQLite:

| Luồng | Khi nào | Nguồn |
|---|---|---|
| **Backfill** | Lần đầu đăng nhập; khi người dùng mở hội thoại; khi cuộn lên xem tin cũ | API lấy lịch sử |
| **Realtime** | Liên tục khi đang kết nối | `listener.on(...)` |
| **Catch-up** | Sau khi offline, kết nối lại, hoặc listener bị gián đoạn | API lấy lịch sử, từ mốc đã đồng bộ |

```
            ┌────────────── Sync Engine ──────────────┐
 listener ─►│ realtime  ─┐                            │
 API lịch sử►│ backfill  ─┼─► hàng đợi ─► upsert DB ───┼─► phát sự kiện ─► UI
 API lịch sử►│ catch-up  ─┘   (tuần tự,   (idempotent)  │   (evMessageUpsert...)
            └──────────────  có throttle)  ────────────┘
```

**Lý do một hàng đợi:** tránh hai luồng ghi cùng lúc gây lệch, và dễ kiểm soát tốc độ gọi API.

### 6.2. Schema SQLite

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE threads (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('user','group')),
  title         TEXT,
  avatar_url    TEXT,
  last_msg_id   TEXT,
  last_ts       INTEGER,            -- ts của tin cuối (server)
  last_preview  TEXT,
  unread        INTEGER NOT NULL DEFAULT 0,
  muted         INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL    -- thời điểm ghi cục bộ
);

CREATE TABLE messages (
  thread_id     TEXT NOT NULL,
  msg_id        TEXT NOT NULL,       -- ID từ server
  client_id     TEXT,                -- ID tạm khi gửi, để gộp tin lạc quan
  sender_id     TEXT NOT NULL,
  from_me       INTEGER NOT NULL,
  ts            INTEGER NOT NULL,    -- thời gian server
  text          TEXT,
  attachments   TEXT,                -- JSON
  quote_json    TEXT,
  status        TEXT NOT NULL DEFAULT 'sent'
                CHECK (status IN ('sending','sent','failed')),
  recalled      INTEGER NOT NULL DEFAULT 0,
  edited_at     INTEGER,
  PRIMARY KEY (thread_id, msg_id)
);
CREATE INDEX idx_messages_thread_ts ON messages(thread_id, ts DESC);
CREATE UNIQUE INDEX idx_messages_client ON messages(thread_id, client_id)
  WHERE client_id IS NOT NULL;

CREATE TABLE sync_state (
  thread_id          TEXT PRIMARY KEY,
  last_synced_ts     INTEGER,        -- mốc tin mới nhất đã đồng bộ
  oldest_loaded_ts   INTEGER,        -- mốc tin cũ nhất đã tải
  has_more_older     INTEGER NOT NULL DEFAULT 1,
  last_full_sync_at  INTEGER
);

CREATE TABLE contacts (
  id TEXT PRIMARY KEY, name TEXT, avatar_url TEXT, updated_at INTEGER NOT NULL
);

CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT);  -- cờ nhỏ: schema_version...
```

Quản lý phiên bản schema bằng bảng `kv` (`schema_version`) và các file migration đánh số, chạy tuần tự khi mở app.

### 6.3. Quy tắc để dữ liệu không lệch

1. **Upsert idempotent theo `(thread_id, msg_id)`.** Cùng một tin đến từ backfill lẫn realtime chỉ ghi một dòng.
2. **Sắp xếp theo `ts` của server**, không theo thời điểm nhận. Nếu `ts` trùng nhau, dùng `msg_id` làm tiêu chí phụ.
3. **Gộp tin lạc quan:** khi tin thật về (có `msg_id`) và khớp `client_id` đã có, cập nhật dòng tạm thay vì thêm dòng mới.
4. **Sự kiện sửa đổi cập nhật dòng cũ:** thu hồi đặt `recalled = 1` (giữ dòng, bỏ nội dung nếu muốn), sửa tin đặt `edited_at`, reaction/đã đọc cập nhật cột tương ứng.
5. **Không xóa dữ liệu chỉ vì "không thấy trên server lần này".** Chỉ xóa khi nhận sự kiện xóa rõ ràng hoặc người dùng yêu cầu.
6. **Server thắng khi xung đột** (cùng `msg_id` nhưng nội dung khác): ghi đè bằng bản từ server.
7. **Ghi theo transaction** cho mỗi lô tin, để lỗi giữa chừng không để lại trạng thái nửa vời.

```ts
// Ý tưởng upsert (better-sqlite3)
const upsertMessage = db.prepare(`
  INSERT INTO messages (thread_id, msg_id, client_id, sender_id, from_me, ts,
                        text, attachments, quote_json, status, recalled)
  VALUES (@threadId, @msgId, @clientId, @senderId, @fromMe, @ts,
          @text, @attachments, @quote, 'sent', @recalled)
  ON CONFLICT(thread_id, msg_id) DO UPDATE SET
    text = excluded.text,
    attachments = excluded.attachments,
    recalled = excluded.recalled,
    status = 'sent'
`)

const applyBatch = db.transaction((msgs: Message[]) => {
  for (const m of msgs) upsertMessage.run(toRow(m))
})
```

Gộp tin tạm: trước khi upsert, tìm dòng có `(thread_id, client_id)` trùng và đang `sending`; nếu có, cập nhật `msg_id` thật vào dòng đó (hoặc xóa dòng tạm rồi chèn dòng thật trong cùng transaction).

### 6.4. Backfill

**Danh sách hội thoại (lần đầu):**
1. Lấy danh sách hội thoại gần đây từ API (hoặc suy ra từ dữ liệu có sẵn nếu zca-js không có hàm riêng).
2. Upsert vào `threads`. Chưa tải tin nhắn của từng hội thoại.
3. UI hiển thị danh sách ngay.

**Lịch sử theo yêu cầu (lazy):**
1. Người dùng mở hội thoại → hiển thị ngay tin đã có trong DB.
2. Song song, nếu `sync_state` cho thấy chưa tải hoặc cần làm mới, gọi API lấy trang mới nhất.
3. Khi người dùng cuộn lên gần đầu danh sách và `has_more_older = 1`, tải trang cũ hơn (dùng `oldest_loaded_ts` làm mốc), cập nhật `oldest_loaded_ts`.
4. Khi API trả ít hơn một trang (hoặc rỗng), đặt `has_more_older = 0`.

**Tải nền tùy chọn:** sau khi đăng nhập, có thể tải trước vài trang cho N hội thoại gần nhất, với throttle (xem 6.7). Đừng tải toàn bộ mọi hội thoại.

> **Lưu ý:** nếu zca-js không có hàm lấy lịch sử, toàn bộ 6.4 và 6.6 không làm được qua thư viện. Phương án: dùng REA ghi lại phiên Zalo Web (HAR) để tìm endpoint tải lịch sử rồi thêm vào `protocol/`. Nếu cũng không được, chấp nhận chỉ lưu những gì nhận được khi app đang chạy và hiển thị rõ khoảng trống cho người dùng.

### 6.5. Realtime

```ts
// Ý tưởng: bọc listener, đưa mọi sự kiện vào hàng đợi
api.listener.on('message', (raw) => {
  queue.push({ kind: 'message', msg: mapMessage(raw) })
})
// Các sự kiện khác (thu hồi, reaction, đã đọc...) tùy zca-js hỗ trợ
```

Worker lấy từ hàng đợi theo gói nhỏ (ví dụ gom trong 50-100 ms), ghi DB bằng một transaction, sau đó:
- Phát `evMessageUpsert` cho UI.
- Cập nhật `threads` (`last_msg_id`, `last_ts`, `last_preview`, `unread`).
- Nếu hội thoại đang mở và cửa sổ đang focus, đánh dấu đã đọc và `unread = 0`.
- Cập nhật `sync_state.last_synced_ts` lên `ts` mới nhất.
- Gọi thông báo hệ thống nếu cửa sổ không focus và hội thoại không bị tắt tiếng.

### 6.6. Catch-up sau khi offline

Listener chỉ cho sự kiện đang diễn ra, không phát lại tin đã lỡ. Vì vậy mỗi lần kết nối lại phải bù:

1. Khi `ConnectionState` chuyển sang `connected` (sau lần đầu), sync engine chạy catch-up.
2. Chọn hội thoại cần bù: ưu tiên hội thoại đang mở, rồi các hội thoại có hoạt động gần đây (theo `threads.last_ts`).
3. Với mỗi hội thoại: lấy lịch sử từ `sync_state.last_synced_ts` trở đi, upsert, cập nhật mốc.
4. Nếu số tin mới vượt ngưỡng (ví dụ nhiều trang), lấp đầy phần mới nhất trước và đánh dấu khoảng trống cũ hơn chưa bù được.
5. Sau khi bù xong, phát sự kiện để UI tải lại phần hiển thị.

**Khoảng trống (gap):** nếu không thể bù đủ, lưu thông tin đoạn thiếu (từ ts nào đến ts nào) để UI hiển thị "Có thể thiếu tin nhắn trong khoảng này". Trung thực với người dùng tốt hơn là giả vờ dữ liệu đầy đủ.

### 6.7. Throttle và hành vi "giống người dùng"

Zalo có thể coi hành vi dồn dập là bot. Zalo không công bố giới hạn, nên hãy bảo thủ:

- Hàng đợi tuần tự, mỗi lần chỉ một request lịch sử đang chạy.
- Khoảng nghỉ giữa các request (ví dụ vài trăm ms đến 1-2 giây), có jitter ngẫu nhiên nhỏ.
- Tải nền chỉ vài hội thoại gần nhất; phần còn lại tải khi người dùng mở.
- Nếu gặp lỗi giới hạn hoặc lỗi lạ, **dừng và tăng khoảng chờ**, không thử dồn.
- Không gửi tin hàng loạt, không tự động trả lời.

### 6.8. State machine kết nối

```
        ┌───────────┐  login ok   ┌────────────┐
        │ logged-out├────────────►│ connecting │◄────────────┐
        └───────────┘             └─────┬──────┘             │
                                        │ listener sẵn sàng  │ thử lại
                                        ▼                    │ (backoff)
                                  ┌───────────┐  mất mạng   ┌┴───────────┐
                                  │ connected ├────────────►│disconnected│
                                  └─────┬─────┘             └────────────┘
                                        │ listener bị thay thế
                                        ▼
                                  ┌───────────┐  người dùng bấm "Kết nối lại"
                                  │ replaced  ├──────────────► connecting
                                  └───────────┘
```

- `connected` (không phải lần đầu) → chạy catch-up trước khi UI coi dữ liệu là mới nhất.
- `replaced` → chờ người dùng, không tự chiếm lại.
- Mọi chuyển trạng thái đều được phát cho UI (`evConnection`) và ghi log (đã lọc dữ liệu nhạy cảm).

### 6.9. Quan hệ giữa UI và dữ liệu

- UI đọc từ DB qua `ChatService` (`listConversations`, `getMessages`), không đọc từ listener trực tiếp.
- Sự kiện `evMessageUpsert` / `evThreadUpsert` chỉ báo "có gì thay đổi"; store UI cập nhật phần thay đổi (hoặc truy vấn lại hội thoại đang mở).
- Hiển thị trạng thái đồng bộ: biểu tượng nhỏ "đang đồng bộ", banner khi mất kết nối, thông báo khoảng trống.

### 6.10. Tình huống biên cần test

| Tình huống | Hành vi đúng |
|---|---|
| Cùng một tin đến từ realtime và backfill | Chỉ một dòng trong DB |
| Tin đến không đúng thứ tự | Sắp xếp theo `ts` server khi hiển thị |
| Gửi tin rồi mất mạng trước khi nhận phản hồi | Tin ở `failed` hoặc `sending`; khi kết nối lại, đối chiếu với lịch sử để tránh gửi trùng |
| Ngắt mạng nhiều giờ rồi kết nối lại | Catch-up chạy, UI không bị đơ, có thông báo nếu còn khoảng trống |
| Mở Zalo Web khi app chạy | State `replaced`, không tự chiếm lại |
| Hội thoại có hàng nghìn tin | Tải theo trang, UI mượt |
| Thu hồi tin sau khi đã lưu | Dòng giữ nguyên, `recalled = 1`, UI hiển thị "Tin nhắn đã thu hồi" |
| Đăng xuất | Hỏi người dùng giữ hay xóa dữ liệu cục bộ |
| Đổi tài khoản | Mỗi tài khoản một file DB riêng (đặt tên theo ID tài khoản), không trộn dữ liệu |
| App bị tắt đột ngột giữa transaction | Dữ liệu nhất quán (nhờ transaction và WAL) |

### Checklist hoàn thành giai đoạn 6
- [ ] Ghi nhận xong `docs/zca-capabilities.md` (hàm lịch sử, sự kiện, trường ID).
- [ ] Schema và migration chạy được; mỗi tài khoản một DB riêng.
- [ ] Sync engine với hàng đợi tuần tự và throttle.
- [ ] Backfill danh sách hội thoại và lịch sử theo trang.
- [ ] Realtime ghi DB và phát sự kiện cho UI.
- [ ] Catch-up khi kết nối lại; xử lý khoảng trống.
- [ ] Gộp tin lạc quan bằng `client_id`.
- [ ] Test tất cả tình huống biên ở bảng 6.10.
- [ ] Mở app lần hai thấy dữ liệu ngay, không chờ mạng.

---

## 5. Giai đoạn 7: Tính năng mở rộng

**Cách làm mỗi tính năng (lặp):**
1. Kiểm tra zca-js (hoặc HAR/REA) có hỗ trợ không → ghi vào `docs/zca-capabilities.md`.
2. Mở rộng model và schema (migration mới) nếu cần.
3. Mở rộng `ChatService`, IPC contract, preload.
4. Cập nhật sync engine (realtime/backfill/catch-up cho loại dữ liệu mới).
5. Làm UI.
6. Viết test.

### 7.1. Nhóm chat (ưu tiên cao)
- [ ] Danh sách nhóm, thông tin nhóm, thành viên.
- [ ] Hiển thị tên/avatar người gửi trong tin nhắn nhóm.
- [ ] Đồng bộ thay đổi thành viên, đổi tên nhóm (nếu có sự kiện).
- [ ] Cache thông tin thành viên trong `contacts`, làm mới có giới hạn.

### 7.2. Ảnh
- [ ] Gửi ảnh: cần `imageMetadataGetter` (thường dùng `sharp`, cài thêm và cấu hình khi tạo `Zalo`).
- [ ] Hiển thị ảnh trong khung chat với kích thước giữ chỗ (tránh nhảy bố cục), tải ảnh lazy.
- [ ] Xem ảnh phóng to, chuyển ảnh trong cùng hội thoại.
- [ ] Cache ảnh đã tải trong thư mục cache riêng, có giới hạn dung lượng và dọn dẹp theo LRU.
- [ ] Dán ảnh từ clipboard và kéo thả.

### 7.3. File
- [ ] Gửi file: kiểm tra kích thước tối đa mà Zalo cho phép (xác minh bằng thử nghiệm).
- [ ] Nhận file: hiển thị tên, kích thước, nút tải; tiến trình tải; mở thư mục chứa.
- [ ] **Bảo mật:** không tự mở file; cảnh báo với file thực thi; làm sạch tên file (chặn `../`, ký tự lạ).
- [ ] URL file có thể hết hạn: nếu tải lỗi, báo rõ và cho thử lại.

### 7.4. Sticker, emoji, reaction
- [ ] Emoji trong ô soạn (bộ chọn riêng, hoặc dùng bộ emoji hệ thống).
- [ ] Hiển thị sticker nếu zca-js trả URL/ID dùng được; nếu không, hiển thị placeholder dạng "[Sticker]".
- [ ] Reaction: chỉ làm nếu có sự kiện và API gửi.

### 7.5. Danh bạ và bạn bè
- [ ] Danh sách bạn bè, tìm kiếm theo tên.
- [ ] Mở hội thoại mới từ danh bạ.
- [ ] Làm mới danh bạ định kỳ nhưng thưa (ví dụ khi mở app và mỗi vài giờ).

### 7.6. Tìm kiếm
- [ ] Tìm trong hội thoại và toàn cục, dựa trên SQLite FTS5 (xem giai đoạn 8).
- [ ] Làm rõ với người dùng rằng chỉ tìm được trong dữ liệu đã tải về máy.

### 7.7. Thông báo và tích hợp hệ điều hành
- [ ] Thông báo hệ thống cho tin mới khi cửa sổ không focus; bấm vào thì mở đúng hội thoại.
- [ ] Badge số chưa đọc trên icon (dock/taskbar).
- [ ] Khay hệ thống (tray), chạy nền khi đóng cửa sổ.
- [ ] Tắt tiếng theo hội thoại.
- [ ] Khởi động cùng máy (tùy chọn).
- [ ] Chế độ "Không làm phiền".

### 7.8. Trả lời, chuyển tiếp, thu hồi
- [ ] Trả lời trích dẫn (`quote`) — zca-js đã có tham số này.
- [ ] Thu hồi tin của mình, chuyển tiếp: kiểm tra API.

### 7.9. Những thứ gần như không làm được
- Gọi thoại và video.
- Zalo Pay, các tính năng thanh toán.
- Zalo OA, mini app, nhật ký (timeline): chỉ xem xét nếu zca-js hoặc HAR cho thấy khả thi.

Hãy hiển thị rõ trong UI nếu tin nhắn thuộc loại chưa hỗ trợ (ví dụ cuộc gọi nhỡ, tin có định dạng lạ), thay vì bỏ qua âm thầm.

---

## 6. Giai đoạn 8: Hiệu năng và độ bền

### 8.1. Hiệu năng
- [ ] **Cuộn ảo** danh sách tin nhắn và danh sách hội thoại (hàng nghìn mục).
- [ ] Phân trang truy vấn DB bằng khóa `(ts, msg_id)` (keyset), không dùng `OFFSET`.
- [ ] Chỉ giữ trong bộ nhớ renderer phần tin đang xem (cửa sổ trượt).
- [ ] Gom (debounce) các cập nhật UI khi nhiều tin đến cùng lúc.
- [ ] Ghi DB theo lô trong transaction; chuyển việc nặng sang worker nếu thấy giật.
- [ ] Hình ảnh: tạo thumbnail, tải lazy, giới hạn kích thước giải mã.
- [ ] Đo bằng dữ liệu thử lớn (ví dụ 100k tin) và đặt ngưỡng chấp nhận (mở hội thoại dưới ~200 ms, cuộn không rớt khung hình).

### 8.2. Tìm kiếm FTS5
```sql
CREATE VIRTUAL TABLE messages_fts USING fts5(
  text, content='messages', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2'
);
-- Trigger giữ FTS đồng bộ với bảng messages (insert/update/delete)
```
- `remove_diacritics` giúp tìm tiếng Việt không dấu khớp có dấu. Hãy kiểm tra kỹ với dữ liệu tiếng Việt thực tế.

### 8.3. Độ bền
- [ ] Sao lưu DB trước khi chạy migration; nếu migration lỗi thì khôi phục.
- [ ] Kiểm tra tính toàn vẹn khi mở (`PRAGMA integrity_check` định kỳ hoặc khi nghi ngờ), có đường lui là xóa cache và đồng bộ lại (vì server là nguồn chuẩn).
- [ ] Nút "Xóa cache và đồng bộ lại" trong cài đặt.
- [ ] Giới hạn dung lượng cache media, dọn dẹp tự động.
- [ ] Ghi log có xoay vòng, **đã lọc** cookie, IMEI, nội dung tin nhắn.
- [ ] Chặn mở nhiều bản app cùng lúc (`app.requestSingleInstanceLock`) vì chỉ một listener cho mỗi tài khoản.
- [ ] Bắt lỗi toàn cục (main và renderer), hiển thị thông báo hữu ích thay vì treo.

### 8.4. Quyền riêng tư dữ liệu cục bộ
- DB chứa nội dung tin nhắn dạng rõ nếu không mã hóa. Cân nhắc:
  - Đặt DB trong thư mục dữ liệu người dùng của app với quyền hạn chế.
  - Mã hóa toàn DB (SQLCipher) với khóa lưu bằng `safeStorage`, nếu mô hình đe dọa của bạn cần.
- Cung cấp "Đăng xuất và xóa toàn bộ dữ liệu cục bộ".

---

## 7. Giai đoạn 9: Bảo trì và điều tra bằng REA

**Khi nào dùng:** zca-js thiếu tính năng bạn cần, hoặc hỏng sau khi Zalo cập nhật.

### 9.1. Phát hiện sớm
- [ ] Script "canary" chạy định kỳ trên tài khoản phụ: đăng nhập từ phiên đã lưu, nhận/gửi một tin tự gửi cho chính mình (nếu được), kiểm tra lấy danh sách hội thoại. Hỏng thì báo cho bạn.
- [ ] Theo dõi issue và release của zca-js.
- [ ] Trong app: nếu lỗi mapper (trường mong đợi không còn), ghi nhận kiểu lỗi và hiển thị thông báo "Zalo có thể đã thay đổi giao thức", thay vì crash.

### 9.2. Quy trình điều tra
1. **Xác định triệu chứng:** lỗi đăng nhập, listener im lặng, endpoint lỗi, payload đổi.
2. **Kiểm tra upstream:** issue, PR, release mới của zca-js; thường đã có bản vá.
3. **Ghi HAR từ Zalo Web** (tài khoản phụ), rồi dùng REA (workflow phân tích website và capture mạng) để đọc endpoint, tham số, header, luồng đăng nhập, định dạng request/response.
4. **Phân tích bản Zalo PC** (Electron) bằng workflow JavaScript/Electron của REA: modules, preload, IPC, cách renderer gọi main. Mình chưa kiểm tra cấu trúc thật nên chưa biết app có bị che giấu (obfuscate) hay mã hóa ASAR hay không.
5. **So sánh với mã nguồn zca-js** để xem thư viện xử lý thế nào.
6. **Vá vào `protocol/`** hoặc đóng góp ngược lên zca-js. Thêm test với dữ liệu mẫu đã ẩn danh.

```bash
# cài REA cho agent (restart agent sau khi cài)
npx rea-agents setup

# ví dụ phân tích một thư mục ứng dụng JavaScript/Electron đã giải nén
npx -y rea-agents@latest analyze-javascript-application /duong/dan/tuyet/doi --json
```

### 9.3. Quy tắc khi dùng REA và dữ liệu capture
- REA nêu rõ chỉ dùng cho nghiên cứu hợp pháp, interoperability, hoặc phần mềm bạn sở hữu hoặc được phép phân tích. Hãy tự đọc tuyên bố miễn trừ của REA và điều khoản của Zalo.
- **File HAR chứa cookie, token và nội dung tin nhắn thật.** Không chia sẻ, không commit vào git, không dán nguyên văn vào chat. Làm sạch (xóa cookie, token, nội dung) trước khi lưu làm dữ liệu mẫu.
- Chỉ phân tích dữ liệu của tài khoản phụ do bạn sở hữu.
- Chỉ tải REA từ nguồn chính thức (repo `morluto/rea`, `rea.tools`, hoặc npm `rea-agents`), vì README cảnh báo có repo giả mạo.

### 9.4. Giữ `protocol/` dễ thay thế
- Mọi thứ đặc thù Zalo nằm trong `protocol/`: gọi API, mapper, xử lý lỗi.
- Có bộ test hợp đồng cho `ZaloClient` (interface nội bộ): nếu đổi sang fork zca-js hoặc tự viết, chỉ cần chạy lại test này.
- Ghim phiên bản zca-js (khóa phiên bản chính xác), nâng cấp có chủ đích và có canary kiểm tra sau mỗi lần nâng.

---

## 8. Giai đoạn 10: Đóng gói và phân phối cá nhân

- [ ] `electron-builder` cho hệ điều hành bạn dùng (Windows/macOS/Linux).
- [ ] Đóng gói native module (ví dụ `better-sqlite3`, `sharp`) đúng kiến trúc; kiểm tra bản build chạy được trên máy sạch.
- [ ] Ký ứng dụng nếu cần (macOS notarization, Windows code signing); với dùng cá nhân có thể chấp nhận cảnh báo.
- [ ] Tự cập nhật: chỉ làm nếu cần, và chỉ từ kênh bạn kiểm soát.
- [ ] Kiểm tra bản đóng gói: đăng nhập, khôi phục phiên, đồng bộ, gửi/nhận, thông báo, tray.
- [ ] Đặt tên và biểu tượng riêng, **không** dùng logo hay tên thương hiệu Zalo, để tránh gây nhầm lẫn và vấn đề nhãn hiệu.
- [ ] **Không** đăng bản build công khai nếu chưa cân nhắc rủi ro pháp lý và rủi ro cho người dùng (họ có thể bị khóa tài khoản).

---

## 9. Bảo mật: checklist

- [ ] `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- [ ] CSP chặt, không tải script từ nguồn ngoài.
- [ ] Chặn `will-navigate` và `setWindowOpenHandler`; mở link ngoài bằng trình duyệt hệ thống sau khi kiểm tra giao thức (`https:` / `http:`).
- [ ] Preload chỉ expose hàm cụ thể, không expose `ipcRenderer` thô.
- [ ] Validate mọi dữ liệu IPC ở main bằng schema.
- [ ] Phiên đăng nhập lưu bằng `safeStorage`, không gửi sang renderer.
- [ ] Không log cookie/IMEI/nội dung tin nhắn.
- [ ] Hiển thị tin nhắn dạng text đã escape; không render HTML thô từ nội dung tin.
- [ ] Link trong tin nhắn: hiển thị đích thật, cảnh báo khi khác với văn bản hiển thị.
- [ ] Tải file: làm sạch tên, không tự mở, cảnh báo file thực thi.
- [ ] Ảnh/media tải từ URL của Zalo: tải ở main, kiểm tra loại nội dung và kích thước, rồi mới đưa cho UI (qua giao thức nội bộ hoặc đường dẫn file cục bộ).
- [ ] Nút "Đăng xuất và xóa dữ liệu cục bộ".
- [ ] Cập nhật Electron thường xuyên.
- [ ] `app.requestSingleInstanceLock()` để tránh nhiều tiến trình dùng chung một phiên.

---

## 10. Kiểm thử

| Loại | Phạm vi | Công cụ |
|---|---|---|
| Unit | mapper, upsert/gộp tin lạc quan, tính mốc đồng bộ, throttle, state machine kết nối | Vitest |
| Tích hợp (DB) | schema, migration, FTS, transaction, catch-up với `ZaloClient` giả | Vitest + SQLite in-memory/tệp tạm |
| Hợp đồng `protocol/` | `ZaloClient` giả lập các hành vi: tin trùng, sai thứ tự, ngắt kết nối, lỗi mạng | Vitest |
| Component | thành phần UI với dữ liệu giả | Testing Library / Storybook |
| E2E | mở app, đăng nhập giả, gửi/nhận (mock `ChatService`) | Playwright cho Electron |
| Thủ công | luồng thật với tài khoản phụ | checklist bên dưới |
| Canary giao thức | đăng nhập + nhận/gửi định kỳ | script cron + thông báo |

**Xây `FakeZaloClient`:** một bản giả của lớp `protocol/` cho phép tạo ra các tình huống ở bảng 6.10 một cách lặp lại được (tin đến trùng, sai thứ tự, ngắt mạng giữa chừng...). Đây là công cụ quan trọng nhất để test đồng bộ, vì tình huống thật khó tái tạo.

**Checklist thủ công mỗi bản phát hành:**
- [ ] Đăng nhập QR; khôi phục phiên sau khi tắt mở app.
- [ ] Nhận/gửi 1-1; nhóm; ảnh; file.
- [ ] Ngắt mạng rồi có lại: catch-up đúng, không trùng, không mất.
- [ ] Mở Zalo Web khi app chạy: banner `replaced`, không tự chiếm lại.
- [ ] Gửi tin khi mất mạng: báo lỗi, gửi lại không bị trùng.
- [ ] Hội thoại dài: cuộn ảo mượt, tải thêm cũ hơn đúng.
- [ ] Thông báo, badge, tray.
- [ ] Đăng xuất: xóa/giữ dữ liệu đúng lựa chọn.

---

## 11. Rủi ro và cách xử lý

| Rủi ro | Mức độ | Cách xử lý |
|---|---|---|
| Tài khoản bị khóa/ban | Cao | Dùng tài khoản phụ khi phát triển; throttle; không tự động hóa gửi tin; giữ app Zalo chính thức làm dự phòng |
| Zalo đổi giao thức, app hỏng | Cao | Canary; `protocol/` mỏng; quy trình REA (giai đoạn 9) |
| zca-js không còn được bảo trì | Trung bình | Ghim phiên bản; test hợp đồng; sẵn sàng fork hoặc tự viết |
| Thiếu API lịch sử | Trung bình-cao | Dùng REA + HAR tìm endpoint; hoặc chấp nhận khoảng trống và nói rõ với người dùng |
| Dữ liệu cục bộ bị lộ | Trung bình | Thư mục riêng, cân nhắc mã hóa DB, nút xóa dữ liệu |
| Lệch/trùng/mất tin | Trung bình | Upsert idempotent, transaction, catch-up, khoảng trống minh bạch, test bằng `FakeZaloClient` |
| Vi phạm điều khoản dịch vụ | Trung bình-cao | Chỉ dùng cá nhân; không phát hành rộng; liên hệ VNG nếu muốn đi chính thức |
| Xung đột listener (một listener/tài khoản) | Trung bình | State `replaced`, không tự chiếm lại; single instance lock |
| Lộ dữ liệu qua file HAR/log | Trung bình | Không commit, làm sạch trước khi lưu, lọc log |

---

## 12. Ước tính thời gian và thứ tự làm

(1 người làm toàn thời gian; làm bán thời gian có thể gấp 2-3 lần.)

| Giai đoạn | Thời gian | Phụ thuộc |
|---|---|---|
| 5. Nối UI với Zalo thật (MVP) | 2-3 ngày | Giai đoạn 1, 3 chạy được |
| 6. Đồng bộ dữ liệu | 4-6 ngày | Ghi nhận xong khả năng zca-js; nếu thiếu API lịch sử, cộng thêm 2-4 ngày điều tra bằng REA |
| 7. Tính năng mở rộng | 1-3 tuần | Mỗi tính năng độc lập, làm theo thứ tự ưu tiên |
| 8. Hiệu năng và độ bền | 3-4 ngày | Sau giai đoạn 6 |
| 9. Bảo trì (REA) | Liên tục | Dành thời gian định kỳ mỗi tháng |
| 10. Đóng gói | 1-2 ngày | Cuối cùng |

### Thứ tự làm đề xuất
1. **Xác nhận giai đoạn 1, 3** (nếu chưa): đăng nhập QR, nhận/gửi bằng tài khoản phụ.
2. **Viết `docs/zca-capabilities.md`:** thử và ghi lại zca-js làm được gì (hội thoại, lịch sử, sự kiện, ID).
3. **Giai đoạn 5:** nối UI, đạt MVP.
4. **Dựng `FakeZaloClient`** và khung test trước khi viết sync engine.
5. **Giai đoạn 6:** schema → upsert → realtime → backfill → catch-up → state machine.
6. **Giai đoạn 7:** nhóm → ảnh → file → thông báo/tray → phần còn lại.
7. **Giai đoạn 8:** hiệu năng, FTS, độ bền.
8. **Giai đoạn 10:** đóng gói.
9. **Giai đoạn 9:** duy trì xuyên suốt, dựng canary sớm (ngay sau MVP).

---

## Phụ lục: Tham khảo

- zca-js: `https://github.com/RFS-ADRENO/zca-js`; tài liệu: `https://tdung.gitbook.io/zca-js`
- REA: `https://github.com/morluto/rea`, `https://rea.tools`
- Zalo Developers (API chính thức, hạn chế hơn): `https://developers.zalo.me`
- Electron Security: tài liệu Security chính thức của Electron
- SQLite FTS5 và WAL: tài liệu chính thức của SQLite
