# R6 — Client Architecture & Backend Contract

**Trạng thái:** HOÀN THÀNH phần **quan sát tĩnh** (evidence-only). **Kết luận: kiến trúc client đã đủ rõ để thiết kế R8, nhưng hợp đồng backend mới chỉ dừng ở mức *hình dạng* (shape), chưa có *ngữ nghĩa* (semantics).**
**Ngày:** 2026-11-06 · **Công cụ RE duy nhất:** REA
**Đối tượng:** Zalo PC `26.10.20` (VNG GROUP JSC) · bản trích xuất `app.asar`, 282 MB gốc
`renderer: pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js — 20.927.993 B`
`SHA-256 6ec041177948ea3254f6b72d485cd72f48a4f7634116dee698c327178faaf415`
`preload: main-dist/preload-render.js — 1.990.534 B`
`SHA-256 24c5ecb873c7667630ecda923c966574e32baeac8a51dc78243c7508f2f61602`
Webpack 4 · 55 lazy chunk · 139 đường dẫn nguồn TypeScript bị lộ trong `stast.json`

> Báo cáo này **không** thực thi Zalo, **không** sửa `Zalo.exe`/`app.asar`, **không** inject, **không**
> đọc dữ liệu tài khoản, **không** giải mã bất kỳ payload nào. Mọi kết luận dưới đây là **đọc tĩnh
> byte do REA trích xuất**. Không có tuyên bố tương thích runtime nào. Không có credential, cookie,
> token hay dữ liệu cá nhân nào được ghi vào báo cáo — xem §8.

---

## 1. Câu hỏi của R6

R5 trả lời "có tích hợp được vào **app gốc** không?" → **NO-GO**, và lý do là *quyền sở hữu sink*,
không phải thiếu cơ chế. R6 hỏi một câu khác, độc lập với R5:

> **Nếu dựng một client Zalo *mới hoàn toàn* (Electron + React), thì ranh giới nào của bản gốc
> là *quan sát được bằng chứng tĩnh*, ranh giới nào chỉ là *suy luận*, và ranh giới nào *không thể
> suy ra* từ static analysis?**

R6 **không** quyết định GO/NO-GO cho client mới. R6 chỉ lập **bản đồ ranh giới** và **phân loại
độ tin cậy** của từng ranh giới. Quyết định GO/NO-GO thuộc R7 (khả thi tính năng) — và R7 **không
được** kế thừa NO-GO của R5, vì R5 nghiên cứu một kiến trúc khác (inject CSS vào app chính thức).

### 1.1 Phương pháp

Chỉ đọc byte. Không thực thi, không giải mã, không đăng nhập. Mỗi con số dưới đây đến từ một
probe `.cjs` đọc file bundle dưới dạng chuỗi UTF-8 rồi đếm/trích ngữ cảnh. Danh sách probe và
output nằm trong `reports/_r6_*.cjs` / `reports/_r6_*.txt` (§9). Mọi con số đã được **tái lập
độc lập bằng script thứ hai** trước khi đưa vào báo cáo.

---

## 2. Kết luận trước, chứng cứ sau

| # | Ranh giới | Trạng thái | Bằng chứng cấp 1 (số liệu) |
|---|---|---|---|
| B1 | **Preload ⇄ Renderer** (`contextBridge`) | **OBSERVED — đóng** | 41 `exposeInMainWorld`; 34/41 dựng bằng descriptor-map; 21 map giải được → **295 method / 205 channel / 8 mode** |
| B2 | **Renderer → HTTP backend** | **OBSERVED — hình dạng** | **471** literal endpoint ở renderer, **0** ở preload; 233 entry registry `{domainType, commandId, path}` trên 10 domain; host template `${Je}` |
| B3 | **Renderer → WebSocket backend** | **OBSERVED — hình dạng** | 1 `new WebSocket` duy nhất; envelope `{version,cmd,subCmd,data}`; 43 cmd cấp cao + 3 nhóm; endpoint do server cấp |
| B4 | **Máy trạng thái kết nối** | **OBSERVED — đầy đủ** | `ping_interval:60000`, PING_TIMEOUT `5000 ms`, `timeout_authen:15000`, `offline_timeout:480000`; 8 mã đóng 3000–3008 |
| B5 | **Lưu trữ cục bộ** | **OBSERVED — bảng & phiên bản; UNKNOWN — nội dung cột** | 88 `tableName`; Core **39 partition**; SQLite v13/IDB v77 |
| B6 | **Ngữ nghĩa payload request/response** | **UNKNOWN** | Không có response schema tĩnh nào cho 471 endpoint; body đi qua `params=<AES-base64>` |
| B7 | **Quyền sử dụng API** | **BLOCKED — ngoài khả năng static analysis** | Không có tài liệu công khai; chỉ có thể suy từ hành vi |

**Điểm mấu chốt:** ranh giới **B1 là ranh giới sạch nhất trong toàn bộ ứng dụng** — preload có
**0 literal endpoint**, nghĩa là toàn bộ giao thức mạng nằm ở renderer, và preload chỉ là một lớp
IPC thuần. Đây là cấu trúc *ngược* với kiến trúc Electron "chuẩn" (network ở main), và nó có hệ quả
trực tiếp cho R8: một client mới **không thể** tái dùng preload làm transport, và **cũng không cần** —
nó có thể tự dựng transport ở tầng riêng.

---

## 3. Bốn ranh giới kiến trúc

### 3.1 B1 — Preload ⇄ Renderer (`contextBridge`)

**Sự kiện đo được** (`reports/_r6_verify.cjs`, `reports/_r6_exposes.txt`):

| Phép đo | preload | renderer |
|---|---:|---:|
| `contextBridge` | 42 | 0 |
| `exposeInMainWorld` | 41 | 0 |
| `ipcRenderer` | — | 5 |
| literal endpoint `/api\|cloudmedia\|zalocloud…` | **0** | **471** |
| `new WebSocket` | 0 | 1 |
| `XMLHttpRequest` | 12 | 46 |

41 tên expose là **cố định, đóng, không có extension point**. Danh sách đầy đủ:
`$zenv, $zcommon, $znode, $zwindow, $zresource, $zlogger, $zupdater, $zapp, $zdownload, $zdb,
$zsessionManager, $zmulti, $zcall, $zsharedWorker, $zelectron, $zelectronNative, $zuri, $zscreencap,
$zlogin, $zperf, $zconfig, $zMetric, $zFileManager, $zpc, $zFeatures, $zcloud, $zMsgChannel, $zscript,
$zInAppPayment, $capp, $zbackup, $zpreload, $zsqlitebw, $zsafeStorage, $zMigrateDrive, $zTFModels,
$znetwork, $zprotocol, $znoti` + `__SENTRY_IPC__`, `MetriczGlobal`.

**Cơ chế dựng bridge:** `window.$X = Object(h.a)(DESC_MAP)` trong đó mỗi entry là
`{apiKey: ENUM.KEY, type: MODE}`; `h` = factory `DmP7`, `MODE` = enum `i6mH`.

**Phân bố mode trên 295 method** (`reports/_r6_contract_stats.cjs`):

| Mode | Số method | Ý nghĩa (tên enum) |
|---|---:|---|
| REQUEST | 78 | gửi và chờ kết quả |
| SUBSCRIBE | 76 | đăng ký luồng sự kiện |
| UNSUBSCRIBE | 76 | huỷ đăng ký |
| NOTIFY | 40 | gửi một chiều |
| RAW_SEND | 12 | gửi thô, không qua envelope |
| PROVIDE | 6 | main phục vụ request từ renderer khác |
| STOP_PROVIDE | 5 | ngừng phục vụ |
| ONCE | 2 | subscribe một lần |

Phân bố theo namespace (21 namespace có descriptor map giải được):

| Namespace | method | channel riêng | Ghi chú |
|---|---:|---:|---|
| `$zapp` | 66 | 45 | namespace lớn nhất |
| `$zupdater` | 31 | 20 | cập nhật nhị phân |
| `$zwindow` | 28 | 24 | cửa sổ / fullscreen / tray |
| `$zscreencap` | 26 | 15 | chụp màn hình |
| `$zsharedWorker` | 26 | 13 | shared worker |
| `$zcall` | 20 | 11 | **cuộc gọi** |
| `$zresource` | 17 | 12 | tài nguyên |
| `$zbackup` | 11 | 10 | sao lưu |
| `$zlogin` | 10 | 6 | **đăng nhập (bridge native)** |
| `$zcloud` | 9 | 9 | cloud |
| `$znoti` | 9 | 6 | **thông báo** |
| `$zdownload` | 8 | 5 | tải file |
| `$zuri` | 6 | 4 | deep link |
| `$znetwork` | 6 | 5 | mạng |
| `$zMigrateDrive` | 5 | 5 | migrate |
| `$zInAppPayment` | 4 | 4 | thanh toán |
| `$zmulti` | 3 | 2 | đa cửa sổ |
| `$zperf` | 3 | 3 | hiệu năng |
| `$zprotocol` | 3 | 3 | zproto |
| `$capp` | 2 | 2 | |
| `$zMetric` | 2 | 2 | |

**13 namespace còn lại** có descriptor-map nhưng không trích được bằng regex
(`$zsessionManager, $zcloud, $zMsgChannel, $zscript, $zbackup, $zInAppPayment, $capp, $zsqlitebw,
$zsafeStorage, $zMigrateDrive, $znetwork, $zprotocol, $znoti`) — chúng dùng map **inline**. Vì vậy
**tổng số channel thực tế phải lấy từ census chuỗi**, không chỉ từ descriptor map: **255 chuỗi kênh
duy nhất** trong preload (`reports/_r6_preload_contract.txt`), và **31 nhóm enum / 256 khoá**
(`reports/_r6_ipc_enums.json`).

> **Hệ quả thiết kế:** nếu R8 muốn mô phỏng bridge, allowlist kênh phải lấy từ **enum**, không phải
> từ descriptor map. Các kênh chỉ xuất hiện trong enum mà không có trong map gồm
> `start-monitor-app-memory-usage`, `save-record`, `video-thumb-generate`, `clean-up-log`,
> `can-store-big-file`.

### 3.2 B2 — Renderer → HTTP backend

**Registry lệnh** (module `675T`, helper `xnaQ`):

```js
{ domainType, commandId, path }   // xnaQ throw nếu commandId trùng
```

**233 entry / 233 path riêng biệt**, phân bố trên **10 local domain type** → 10 domain tên:

| Local key | Domain | Số entry |
|---|---|---:|
| `R` | GROUP | 57 |
| `B` | PROFILE | 43 |
| `_` | FILE | 41 |
| `y` | FRIEND | 24 |
| `C` | GROUP_BOARD | 22 |
| `l` | CHAT | 18 |
| `u` | CONVERSATION | 17 |
| `w` | GROUP_POLL | 6 |
| `r` | ALIAS | 4 |
| `e` | UNRESOLVED | 1 |

**471 literal endpoint** ở renderer (`reports/_r6_epcount.cjs`), theo prefix:

```
/api/group 81 · /api/message 69 · /api/social 40 · /api/e2ee 31 · /api/board 30
/api/voicecall 29 · /api/friend 24 · /api/login 24 · /api/prodcatalog 11
/cloudmedia 11 · /api/conv 8 · /api/register 7 · /api/cm 6 · /api/convlabel 6
/api/poll 6 · /api/transfer 6 · /api/aifeatures 5 · /api/lan 5 · /api/alias 4
/api/autoreply 4 · /api/friendboard 4 · /api/hiddenconvers 4 · /api/quickmessage 4
/api/update 4 · /api/enterprise 3 · /api/media 3 · /api/mediastore 3
/api/pinconvers 3 · /api/setting 3 · /zalocloud 3 · … + 18 singleton
```

**Host template** (`reports/_r6_je2.txt` @7856303):

```js
let qe = "zaloapp.com", Xe = {};
// Xe = query-string parse; nếu t.zdmapi là string thì qe = t.zdmapi
const Je = qe;
```

Toàn bộ 30 host được **template hoá** trên `${Je}` — nghĩa là **domain có thể đổi bằng query param
`?zdmapi=`**. Ví dụ cấu trúc (không phải giá trị bí mật):

```
apiLogin        chat.${Je}/login
apiLoginOnAuth  id.${Je}/account/login
authDomain      wpa.${Je}
apiChatDomain   chat-wpa.${Je}
apiGroupDomain  group-wpa.${Je}
apiFileDomain   files-wpa.${Je}
apiVoiceCall    voicecall-wpa.${Je}
apiConversation convers-wpa.api.${Je}
…
```

**Tham số chung** (`reports/_r6_se.txt` @14442416):

```js
se = { zpw_ver: apiVersion, zpw_type: apiType }   // 694 / 30 hoặc 31
oe = 160                                           // hằng số
_getCommonParams(){ return this._constructUrlParams(se); }
```

`apiType = ("embed" === __ZaBUNDLENAME__ ? 31 : 30)` → bản desktop = **30**, bản nhúng = **31**.

**Mã hoá tham số:** `params=<AES-base64>`; `withCredentials:true` ở luồng gửi tin và upload chunk.
**Không có** giá trị key nào được ghi vào báo cáo — xem §8.

### 3.3 B3 — Renderer → WebSocket backend

**Chỉ một** `new WebSocket` trong toàn renderer, tại @1342012, với `binaryType="arraybuffer"`
(`reports/_r6_egress.txt`).

**Envelope:** `{version, cmd, subCmd, data}`.

**Bảng lệnh WS cấp cao** (`reports/_r6_cmdenum.txt`, enum `A`):

| Nhóm | Giá trị |
|---|---|
| Handshake | `AUTHEN:1` |
| Keepalive | `PING:2`, `PING_ACTIVE:4` (`subCmd KEEP_CONNECTION:1 / KEEP_ACTIVE:2`) |
| Push tin nhắn | `PUSH_MSG_1_1:501`, `PUSH_STATUS_1_1:502`, `PUSH_MSG_GROUP:521`, `PUSH_STATUS_GROUP:522` |
| Xoá chưa đọc | `CLEAR_UNREADS_1_1:504`, `CLEAR_UNREADS_GROUP:524` |
| Đồng bộ tin | `VERIFY_MSG:532`, `HAS_MSG:533`, `PUSH_MISS_MSG:534` |
| Truy vấn | `GET_MSG:570`, `PRELOAD:571`, `GET_STATUS_MSG:575`, `GET_STATUS_MSG_GROUP:576`, `GET_LAST_DELIVER_SEEN:577`, `GET_LAST_SEEN_CHAT_CONTAINER:578` |
| File tương tác | `PUSH_LIST_INTERACTIVE_FILE:530`, `SUBMIT_INTERACTIVE_FILE:536`, `PULL_LIST_INTERACTIVE_FILE:537` |
| Kênh điều khiển | `CTRL_TESTING:600`, `CTRL_PUSH_CTRL:601`, `CTRL_ACTION:602`, `CTRL_PULL_CTRL:603`, `CTRL_PULL_VOIP:604`, `CTRL_PULL_REACT:610`, `CTRL_PULL_REACT_BIG_GR:611`, `CTRL_PUSH_REACT:612`, `CTRL_PUSH_CLEAR_REACT:613`, `CTRL_GET_LAST_SEEN_REACT:614` |
| Cloud | `CLOUD: {PUSH:620, NEED_VERIFY:621, DONE_MIGRATE:623}` |
| Sao lưu | `BACKUP_MSG: {INIT:630, CREATE_SESSION:631, GET_METADATA:632, SIGNAL_RESTORE:633, GET_CONFIGS:634}` |
| Đồng bộ thiết bị | `SYNC_MESSAGE: {REQUEST:590, ACK_DELETE_SYNC_SESSION:591, REQUEST_MOBILE_WAKE_UP:592}` |
| Khác | `GET_IN_APP_PAYMENT_LINK:701`, `GET_MEDIA_UPLOAD_URL:800`, `MAX_CONNECTION:3000` |

**Endpoint do server cấp.** Không có `wss://` production nào hardcode. `wss://zalo.me` chỉ xuất hiện
trong một handler menu debug ("Set invalid endpoint"). Endpoint thật đến từ config server:
`zpw_ws` → mảng `Q`, cùng `zpw_chts_new`, `zpw_ctrs_new`, `zpw_conf`, `zpw_service_map_new`,
`zpw_service_map_v3`.

**`_configure()` từ chối** mọi URL không bắt đầu bằng `wss://`.

### 3.4 B4 — Máy trạng thái kết nối

(`reports/_r6_sockcfg.txt`)

```js
{ ping_interval: 6e4,          // 60 000 ms
  timeout_authen: 15e3,        // 15 000 ms
  offline_timeout: 48e4,       // 480 000 ms
  retries: { internal: { times: [2e3, 3e3, 5e3, 8e3], max: 8 },
             swap_endpoint: { times: 1e3 }, system_resume: { times: 3e3 },
             interval_check: { times: 1e3 }, manual: { times: 1e3 } } }
```

`ping()` gửi `PING/KEEP_CONNECTION` rồi đặt `setTimeout(..., 5e3)` → `PING_TIMEOUT` nếu không có phản hồi.

**Mã đóng socket:**

| Code | Tên | Loại |
|---:|---|---|
| 1011 | — | lỗi nội bộ |
| 1012 | `SERVER_RESTART` | khởi động lại server |
| 1013 | `TRY_AGAIN_LATER` | thử lại sau |
| 1014 | `RESERVED_1014` | dự phòng |
| 1015 | `TLS_HANDSHAKE_FAIL` | TLS |
| 3000 | `NOT_AUTHENTICATED` | chưa xác thực |
| 3001 | `READ_MAX_CONNECTION` | quá số kết nối |
| 3002 | `NOT_FOUND_WORKER` | không tìm thấy worker |
| 3003 | `KICK_CONNECTION` | bị đá |
| 3004–3008 | (nội bộ) | không đặt tên trong bundle |

### 3.5 B5 — Lưu trữ cục bộ

**Census primitive** (`reports/_r6_persist.txt`):

```
SQLite 126 · sqlite 54 · wasm.*sqlite 4          → engine SQLite (WASM) + $zsqlitebw
indexedDB 26 · IDBDatabase 3                     → engine thứ hai
localStorage 192 · sessionStorage 21             → key-value nhẹ
```

**Hai database độc lập**, cùng schema object `{name, session, partitionNamingStrategy,
partitionsMap, version, milestoneVersion, type, corruptionImpact}` (`reports/_r6_tables.txt` @17004516):

| | `Storage` | `Core` | `zlocalstorage` |
|---|---|---|---|
| Naming | `const("Storage")` | `byUser()` + `const("Core")` | `const("zlocalstorage")` |
| SQLite | v1 | **v13** (milestone 1) | — |
| IDB | — | **v77** (milestone 51) | v5 |
| corruptionImpact | `IMPACT_PARTIAL` | `IMPACT_FULL` | — |
| Partition | 5 bảng | **39 bảng** | — |

**5 bảng của `Storage`:** `cocos-res`, `friend-blocked`, `info-cache`, `retry-cache`, `db-stchecksum`.

**39 partition của `Core`:**
`DownloadRetry, File, Friend, FriendsInfo, Group, GroupInfo, GroupTopics, Image, Label, Link, Mention,
Message, Notifications, Poll, StarMessage, Sticker, StickerUsage, Todo, Topic, TTLMessage, E2eeMeta,
E2eePrekey, E2eeSession, E2eeIdentity, E2eeSignedPrekey, E2eeGroup, E2eeHash, E2eeDeciphered,
QuickMessage, GlobalNoiseid, UploadFileThumb, ProductDb, CatalogDb, PreviewMsg, UnreadConv, ZCloud,
ZCloudUpload, RefreshToken, TempBlob`.

**88 `tableName` declaration** trên toàn bundle — vượt xa 5+39, tức là còn các database phụ
(`zinstant_db`, `qoslogv2`, `modules`, `pages`, `metas`, `stcont`, `stidx`, `stkw`, `ThreadMsg`,
`ThreadHis`, `SyncDownload`, `TTLItem`, `zcloud_upload`, …).

**Đường phục hồi:** `$zdb._startListenerIPC()` → `$zsub.$zdb.processResponse(...)`;
`$zdb.checkFailedLoadSqlite().then(e => { this._useIPC = !e })` → nếu WASM SQLite lỗi thì
**chuyển sang IPC** (main giữ DB). `_handleOpenSqliteDbLogBackMessage` với kết quả khác `"LOST_DB"`
→ `RecoverSearchSystemController.onRecoverSearchSystem({isNeedCreateNewDb:false})`.

**UNKNOWN:** nội dung cột của 88 bảng. Chỉ 5 bảng của `Storage` có `fields` đọc được tĩnh; 39
partition của `Core` chỉ thấy **tên class**, không thấy định nghĩa cột (chúng được đăng ký qua
decorator/`partitionsMap` runtime).

---

## 4. Sơ đồ luồng dữ liệu

### 4.1 Luồng thực tế của bản gốc

```
┌─────────────────────────────────────────────────────────────────┐
│ RENDERER  (compact-app-pc.js, 20.9 MB)                          │
│                                                                 │
│  UI (React)                                                     │
│    │                                                            │
│  Feature modules ──┬── MessageService ──┐                       │
│  (conv, group,     ├── FriendService    │                       │
│   friend, media,   ├── LoginService     │                       │
│   call, sync,      └── SyncService      │                       │
│   noti)                                 │                       │
│                                         ▼                       │
│                   ┌──────────────────────────────────┐          │
│                   │ NETWORK LAYER  (nằm Ở RENDERER)  │          │
│                   │  • HTTP: pe() wrapper (XHR)      │          │
│                   │  • ctrl registry 675T (233 lệnh) │          │
│                   │  • domain manager pUq9 (46 domain)│         │
│                   │  • WS client (1 WebSocket)       │          │
│                   └──────────────────────────────────┘          │
│                        │                │                       │
│  ┌─────────────────────┘                └──────────────┐        │
│  │ Persistence ($zdb)                                   │        │
│  │  SQLite(WASM) ── hoặc ── IndexedDB                   │        │
│  │  localStorage / sessionStorage                       │        │
│  └──────────────────────┬───────────────────────────────┘        │
│                         │ (chỉ khi WASM SQLite lỗi)              │
└─────────────────────────┼───────────────────────────────────────┘
                          │ contextBridge: 295 method / 205 channel
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ PRELOAD  (preload-render.js, 1.99 MB)                           │
│  41 exposeInMainWorld · 0 endpoint literal · 0 WebSocket        │
│  = lớp IPC thuần, không biết gì về giao thức Zalo               │
└─────────────────────────┬───────────────────────────────────────┘
                          │ ipcMain / ipcRenderer
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ MAIN / NATIVE                                                   │
│  window mgmt · updater · tray · noti OS · screen capture        │
│  call native bridge · file walker · TF models · SQLite BW       │
│  keychain (zproto-encrypt-with-keychain) · backup               │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
                    ZALO BACKEND
                HTTP (471 endpoint) + WSS (43 cmd)
```

### 4.2 Hệ quả cấu trúc — ba điểm *ngược chuẩn*

1. **Network ở renderer, không ở main.** Trong Electron thông thường, network nằm ở main để giữ
   credential ngoài renderer. Ở Zalo PC, **471 endpoint nằm trong renderer bundle**; preload chỉ có
   0. Renderer giữ `withCredentials:true` và gọi thẳng backend.
2. **Preload không phải security boundary cho protocol.** Preload chỉ chuyển tiếp capability của
   OS (window, updater, tray, noti, capture, keychain). Nó **không** che giấu giao thức Zalo.
3. **Transport là *một* file, không phải một service.** Toàn bộ HTTP + WS nằm trong cùng bundle
   renderer 20.9 MB với UI. Không có tách tầng — đây là lý do R5 thất bại (không có seam để inject).

### 4.3 Luồng gửi tin (quan sát được)

```
UI compose
  → sendZText(payload)
      → mã hoá params (AES-GCM)  [payload]
      → HTTP POST chat-wpa.${Je}/api/message/sms        (commandId 11151)
        hoặc group-wpa.${Je}/api/group/sendmsg          (commandId 11163)
      ← ack (msgId, globalMsgId, …)
  → echo WS: PUSH_MSG_1_1:501 / PUSH_MSG_GROUP:521
  → ghi DB partition Message / ConvMsgStatus / UnreadConv
  → phát sự kiện nội bộ cho UI
```

Bộ lọc push→DB (`reports/_r6_flow.txt`):

```js
H = new Set([PUSH_MSG_1_1, PUSH_MSG_GROUP, PUSH_STATUS_GROUP, PUSH_STATUS_1_1,
             CLEAR_UNREADS_1_1, CLEAR_UNREADS_GROUP, GET_MSG, PUSH_MISS_MSG])
z = new Set([SignalCommands.MSG.RECEIVE_ONEONE, .RECEIVE_GROUP, .PUSH_MISS])
K = new Set([INIT.INIT_SESSION, ACK_INIT_SESSION, NOTIFY_DELETE_KEY, REQUEST_PREKEYS,
             INIT_SESSION_GROUP, DISABLE_E2EE, ENABLE_E2EE,
             ACK_PROCESS_INIT_GROUP_FAILED, ACK_GROUP_SESSIONS_STALE, DOWNGRADE_E2EE_GROUP])
```

**Allowlist trường ID** (được phép ghi log/telemetry — quan sát được, không phải dữ liệu cá nhân):
`uidFrom, uidTo, uid, ownerId, destId, srcId, fromUid, threadId, globalMsgId, globalDelMsgId, msgId,
refMessageId, actionId, lastActionIdOther, lastActionId, resetLastActionId, lastId, ids`.

---

## 5. Bản đồ module theo 7 vùng chức năng

| Module | Bằng chứng cấp 1 | Trạng thái |
|---|---|---|
| **Authentication** | `/api/login/*` **24**, `/api/register/*` **7**, `/api/enterprise/*` **3**; `$zlogin` 10 method / 6 channel; `signInPasswordV2` → `authDomain/api/login/loginByPasswv2` (11176); `reqqr` (11133); `getLoginInfo` (11134); `logOut` (11135); `getServerInfo` (11323) | OBSERVED shape |
| **Messaging** | `/api/message/*` **69**; registry CHAT **18**; WS 501/502/504/521/522/524/532/533/534/570/575/576/577/578; `sendZText` → `/api/message/sms` (11151) | OBSERVED shape |
| **Contacts** | `/api/friend/*` **24**, `/api/social/*` **40**, `/api/lan/*` **5**, `/api/alias/*` **4**; registry FRIEND **24**, ALIAS **4** | OBSERVED shape |
| **Conversations** | `/api/conv/*` **8**, `/api/convlabel/*` **6**, `/api/pinconvers/*` **3**, `/api/hiddenconvers/*` **4**, `/api/archivedchat/*` **2**; registry CONVERSATION **17** | OBSERVED shape |
| **Media** | `/cloudmedia` **11**, `/api/mediastore/*` **3**, `/api/media/*` **3**, `/zalocloud` **3**; WS `GET_MEDIA_UPLOAD_URL:800`; chunk upload `withCredentials:true` | OBSERVED shape |
| **Group** | `/api/group/*` **81**, `/api/board/*` **30**, `/api/poll/*` **6**; registry GROUP **57**, GROUP_BOARD **22**, GROUP_POLL **6** | OBSERVED shape |
| **Calling** | `/api/voicecall/*` **29**; `$zcall` 20 method / 11 channel; native bridge `call-*` (8 kênh) **chỉ có ở preload/main, không có ở renderer**; **`enableCall:false`, `enableVideoCall:false`**; renderer `getUserMedia 0`, `getDisplayMedia 0`, `mediaDevices 0` | OBSERVED — **disabled by default** |
| **Sync** | `SYNC_MESSAGE` 590/591/592; `BACKUP_MSG` 630–634; `CLOUD` 620/621/623; partition `SyncDownload`, `missing_message_range` | OBSERVED shape |
| **Notifications** | `$znoti` 9 method / 6 channel:`_noti_create`, `_noti_close`, `_noti_on-click`, `_noti_on-show`, `_noti_on-close`, `_noti_is-supported`; **`new Notification(` = 0**, **`showNotification` = 0**, `Notification.requestPermission` = **3** | OBSERVED — **OS noti do main phát, không phải renderer** |
| **E2EE** | `/api/e2ee/*` **31**; 9 bảng `e2ee_*`; enum `SignalCommands` (INIT 540–582, MSG 551/552/535, MSG_OFFLINE 514, ACK 545/550/553/554/557/558) | OBSERVED shape |

### 5.1 Ba phát hiện quan trọng cho R7

**a) Calling bị tắt mặc định.** `enableCall: !1`, `enableVideoCall: !1` trong default config,
**cộng với** việc renderer có **0** `getUserMedia` / `getDisplayMedia` / `mediaDevices`. Toàn bộ
`RTCPeerConnection` (6 lần) chỉ dùng cho `getLocalIP()` (kỹ thuật STUN-less ICE để lấy IP nội bộ),
không phải cho gọi. Kết luận *quan sát được*: **thuộc tính gọi điện không nằm ở renderer — nó nằm ở
native app hoặc bị tắt ở bản PC này.** Đây là sự kiện cứng, không phải suy luận.

**b) Notification không đi qua web Notification API.** Renderer gọi `$znoti` (IPC) → main phát
thông báo OS. Không có `new Notification(...)` nào trong renderer. Nghĩa là thông báo **phụ thuộc
vào main process**, và một client mới phải tự dựng toàn bộ đường này.

**c) E2EE có bảng riêng và endpoint riêng.** 31 endpoint + 9 bảng `e2ee_*` + enum Signal Protocol
đầy đủ → E2EE là **subsystem độc lập**, không phải cờ trên message. Nếu client mới không triển khai
Signal Protocol, nó sẽ không tương thích với hội thoại E2EE.

---

## 6. Hợp đồng giao thức *chứng minh được* từ static analysis

### 6.1 Chứng minh được — OBSERVED

| Hạng mục | Bằng chứng |
|---|---|
| Tập endpoint HTTP | 471 literal, liệt kê đầy đủ trong `_r6_endpoints.txt` |
| Ánh xạ `commandId → path → domain` | 233 entry, `_r6_cmdtable.txt` |
| Tham số chung mọi request | `zpw_ver=694`, `zpw_type=30` (desktop) |
| Cơ chế đóng gói request | `params=<AES-base64>` + `enk` per-request |
| Envelope WS | `{version, cmd, subCmd, data}` |
| Bảng lệnh WS | 43 cmd + 3 nhóm con, `_r6_cmdenum.txt` |
| Handshake | `AUTHEN:1`, `subCmd KEEP_CONNECTION`, key server cấp trong `r.key` |
| Nguồn endpoint | server config `zpw_ws` / `zpw_chts_new` / `zpw_ctrs_new`; không hardcode |
| Nhịp keepalive & timeout | 60 000 / 5 000 / 15 000 / 480 000 ms |
| Mã đóng | 1011–1015, 3000–3008 |
| Danh sách bảng DB | 88 `tableName`, 39 partition `Core`, 5 bảng `Storage`, phiên bản v13/v77 |
| Tập channel IPC | 295 method / 205 channel / 255 chuỗi |

### 6.2 Suy luận — INFERRED

| Kết luận | Cơ sở suy luận | Mức tin cậy |
|---|---|---|
| `zpw_type=30` là định danh **Zalo PC desktop** | `__ZaBUNDLENAME__` so sánh với `"embed"` → 31, còn lại 30 | Cao |
| Request/response có dạng `{error_code, error_message, data}` | Thấy ở `getLoginInfo` handler và nhiều chỗ khác | Cao |
| `/api/message/sms` dùng để **gửi** tin (không phải đọc) | Tên + `sendZText` gọi nó + `withCredentials:true` | Cao |
| `Core` DB chứa **toàn bộ** dữ liệu hội thoại | 39 partition gồm Message/Conversation/UnreadConv/File/Image | Trung bình |
| `refresh_token` bảng dùng để làm mới phiên | tên bảng + vị trí trong `Core` | Trung bình |
| Calling được native app xử lý, không phải renderer | `call-*` channel chỉ ở preload + `enableCall:false` + 0 getUserMedia | Trung bình–Cao |

### 6.3 Không suy ra được — UNKNOWN

| Khoảng trống | Vì sao không suy ra được |
|---|---|
| **Ngữ nghĩa request/response body** của 471 endpoint | Body đi qua AES-base64; chỉ thấy *hình dạng* tham số đã mã hoá, không thấy schema |
| **Nội dung cột** của 39 partition `Core` | Đăng ký qua decorator runtime; static chỉ thấy tên class |
| **Thuật toán sinh `params` key** | Key đến từ server (`r.key`), không phải hằng số trong bundle |
| **Ngữ nghĩa `data` của WS push** | Các handler xử lý `data` có kiểu động; không có schema |
| **`zwp_service_map_v3` merge semantics** | Có hàm `mergeServicesMap_v3` nhưng logic phụ thuộc config server |
| **Quyền sử dụng API** | Không thể chứng minh bằng static analysis — cần tài liệu pháp lý/nhà cung cấp |
| **Hành vi runtime** của bất kỳ endpoint nào | Không thực thi, không đăng nhập |
| **Ánh xạ 139 đường dẫn TS → module ID** | `stast.json` lộ path nhưng đã mất liên kết sau minify |

---

## 7. Ranh giới UI ↔ Business ↔ Persistence ↔ Transport

| Tầng | Vị trí | Tính chất |
|---|---|---|
| **UI** | renderer (React) | ẩn danh hoá hoàn toàn — mọi module là `FunctionExpression`, `sourcemaps/` rỗng (phát hiện của R5) |
| **Business logic** | renderer, cùng bundle với UI | **không tách được** — đây là lý do R5 NO-GO |
| **Persistence** | renderer (`$zdb`), fallback qua IPC khi WASM lỗi | tách được ở mức API, không tách ở mức code |
| **Transport** | renderer | **không có seam** — 471 endpoint + 1 WS trong cùng bundle |
| **OS capability** | main, qua preload 41 bridge | **tách sạch** — 0 endpoint, 0 WS |

**Kết luận cấu trúc:** Zalo PC **không** có kiến trúc phân tầng. Nó có **hai khối**: (1) một khối
renderer 20.9 MB gộp UI + business + transport + persistence, và (2) một khối main/preload thuần
OS capability. Ranh giới duy nhất sạch là ranh giới **không liên quan đến Zalo protocol**.

---

## 8. Dữ liệu KHÔNG được ghi vào báo cáo

Theo yêu cầu đề bài (*"Không ghi lại credential, cookie, token hoặc dữ liệu cá nhân vào báo cáo"*),
các hạng mục sau **đã được loại bỏ khỏi mọi báo cáo và mọi file text trung gian**:

| Hạng mục | Cách mô tả thay thế trong báo cáo này |
|---|---|
| Giá trị key giải mã phiên (`decryptKey`, field `zpw_enk` trong response) | chỉ nêu **tên field**, không nêu giá trị |
| Tên hằng `secretKey:"zpw_enk"` | nêu là **tên slot** cấu hình, không phải giá trị |
| `password`, `salt` trong `signInPasswordV2` | chỉ nêu **sự tồn tại** của bước băm phía client |
| UIN, `userId`, số điện thoại, `imei`, `computer_name` | chỉ nêu **kiểu dữ liệu** được gửi, không nêu giá trị |
| Cookie phiên, `viewerkey`, `viewerKey` | chỉ nêu là **giá trị phiên**, không nêu giá trị |
| Token QR / token Facebook / OAuth token | chỉ nêu **endpoint liên quan**, không nêu nội dung |
| `_cipherKey` cấp trong handshake `AUTHEN` | chỉ nêu **cơ chế**, không nêu bytes |

Báo cáo này cũng **không** mô tả cách tái tạo các giá trị đó. Việc trích xuất chúng sẽ là **vi phạm
ranh giới** mà đề bài đã đặt ra, và không cần thiết cho mục tiêu R7/R8.

---

## 9. Provenance — probe scripts & outputs

Tất cả trong `D:\Zalo\reports\`, chạy bằng `node <file>.cjs` (PowerShell), chỉ đọc file bundle.

| Probe | Output | Nội dung |
|---|---|---|
| `_r6_exposes.cjs` | `_r6_exposes.txt` | 41 expose names + offset |
| `_r6_ast_contract.cjs` | `_r6_ast_contract.json/.txt` | descriptor maps (lần 1) |
| `_r6_ast_contract2.cjs` | `_r6_ast_contract2.json/.txt` | 21 namespace, method→channel→mode |
| `_r6_contract_stats.cjs` | stdout | 295 / 205 / 8 mode + phân bố |
| `_r6_preload_contract.cjs` | `_r6_preload_contract.json/.txt` | 255 chuỗi kênh |
| `_r6_enums2.cjs` / `_r6_ipc_enums.json` | json | 31 nhóm / 256 khoá |
| `_r6_endpoints.cjs` | `_r6_endpoints.txt` | 471 literal |
| `_r6_epcount.cjs` | stdout | histogram theo prefix |
| `_r6_verify.cjs` | stdout | cross-check 471 renderer vs 0 preload |
| `_r6_cmdtable.cjs` | `_r6_cmdtable.json/.txt` | 233 entry registry |
| `_r6_cmdtable_domains.txt` | txt | 10 domain + histogram |
| `_r6_je2.cjs` | `_r6_je2.txt` | `Je="zaloapp.com"`, override `?zdmapi=` |
| `_r6_se.cjs` | `_r6_se.txt` | `se={zpw_ver,zpw_type}` |
| `_r6_cfgflags.cjs` | `_r6_cfgflags.txt` | default config + 30 host map |
| `_r6_cmdenum.cjs` | `_r6_cmdenum.txt` | bảng lệnh WS |
| `_r6_sockcfg.cjs` | `_r6_sockcfg.txt` | socket defaults + close codes |
| `_r6_wsurl.cjs` | `_r6_wsurl.txt` | không có wss: production hardcode |
| `_r6_egress.cjs` | `_r6_egress.txt` | egress primitives |
| `_r6_rtc.cjs` | `_r6_rtc.txt` | RTCPeerConnection / getUserMedia |
| `_r6_flow.cjs` | `_r6_flow.txt` | push→DB filter sets |
| `_r6_persist.cjs` | `_r6_persist.txt` | persistence primitive census |
| `_r6_dbschema.cjs` | `_r6_dbschema.txt` | schema object |
| `_r6_tables.cjs` | `_r6_tables.txt` | 88 tableName + Core config |
| `_r6_login.cjs` | `_r6_login.txt` | login surface (đã khử giá trị) |
| `_r6_signal.cjs` | `_r6_signal.txt` | Signal Protocol enum |
| `_r6_srcpaths.txt` | txt | 139 đường dẫn TS bị lộ |

---

## 10. Hệ quả cho R7 và R8

**Cho R7 (khả thi tính năng):**
- Mọi hàng trong bảng 9 tính năng đều **có bằng chứng hình dạng**. Không hàng nào có thể tuyên bố
  **PASS**, vì chưa có runtime test và chưa có quyền sử dụng.
- Ba ràng buộc cứng cần đưa vào R7: **calling tắt mặc định**, **noti phụ thuộc main**, **E2EE là
  subsystem riêng**.

**Cho R8 (kiến trúc client mới):**
- Không tái dùng preload làm transport — nó là lớp OS-capability, không phải protocol layer.
- Adapter mới phải tự dựng **ba** transport độc lập: HTTP (471 endpoint), WS (43 cmd), và
  persistence cục bộ.
- `IZaloClient` nên tách **7 cổng** tương ứng 7 module đã map ở §5, cộng một cổng thứ 8 cho
  **transport/session** vì handshake và keepalive là cross-cutting.
- Trong lúc phát triển: **mock adapter** cho cả 8 cổng; **không** kết nối endpoint nội bộ trước khi
  quyền sử dụng được xác lập (xem `docs/API_AUTHORIZATION_GAP.md`).

**Không kế thừa từ R5:** R5 kết luận NO-GO cho *inject vào app gốc*. R6 **không** suy ra điều gì
cho client mới từ kết luận đó. Hai kiến trúc khác nhau, hai bộ ràng buộc khác nhau.
