# R11V3 — Runtime Bridge PoC (R11B)

**Trạng thái:** `NO_SUPPORTED_RUNTIME_BRIDGE_YET` (= plan §6 `BLOCKED`)
**Ngày:** 2026-11-07 (Asia/Saigon) · **Phạm vi:** Zalo PC 26.10.20.3253 trên máy này · **Công cụ RE:** REA (duy nhất)
**Bằng chứng nền:** [`R11V3_RUNTIME_BOUNDARY.md`](R11V3_RUNTIME_BOUNDARY.md) (R11A) · [`R11V3_INTEGRATION_OPTIONS.md`](R11V3_INTEGRATION_OPTIONS.md) · [`ADR_RUNTIME_FIRST.md`](../docs/ADR_RUNTIME_FIRST.md)

> **Không có PoC nào được chạy. Không có `poc/runtime-bridge/`.**
> Không có dòng code nào của Apple Glass nói chuyện với Zalo gốc. Không có credential, session,
> cookie, token, khóa mã hóa, UIN, uid hay nội dung tin nhắn nào bị trích xuất, ghi log hoặc
> chuyển tiếp trong suốt R11B.

---

## 0. Kết luận trong một khung

| Câu hỏi của R11B | Trả lời | Nhãn |
|---|---|---|
| Apple Glass có đọc được dữ liệu hội thoại thật mà **không** hiển thị UI Zalo gốc? | **Không.** Không tồn tại điểm tích hợp nào vừa khả thi vừa được phép | `BLOCKED` |
| Có bề mặt hosting nào bên trong runtime Zalo? | **Không.** 0 `BrowserView`/`WebContentsView`/`webview`/`protocol.handle` trên **116/116** file JS đóng gói | `OBSERVED` |
| Có thể đọc DB cục bộ? | **Không được phép.** DB là SQLCipher; khóa suy ra được từ UIN phiên đăng nhập → plan §2.3/§2.4 #5 | `OBSERVED` → `BLOCKED` |
| Dùng chính tính năng "Xuất dữ liệu" của Zalo? | **Không.** Tính năng có thật, mặc định bật, nhưng kho lưu được mã hoá bằng `sha256(uid)` — uid cũng chính là thứ bị cấm lấy | `OBSERVED` → `BLOCKED` |
| Có adapter/native module nào ta gọi được? | **Không.** `db-cross-v4` chỉ có **1** export PE là `_register_addon_`, 4 phương thức N-API, cả hai hàm giải mã đều cần `password` do bên gọi cấp | `OBSERVED` |
| `RUNTIME_POC_PASS`? | **Không tuyên bố.** | — |
| `COMPANION_POC_PASS`? | **Không.** Nhánh Companion dừng ở `NOT_RUN` theo chỉ thị đổi ưu tiên | `NOT_RUN` |
| `AUTHORIZED`? | **0.** A1–A4 vẫn **0/4** | `BLOCKED` |
| `LIVE_PASS`? | **0** | — |
| `MOCK_PASS`? | **Không đổi** — M0/M1/M2 vẫn xanh | `MOCK_PASS` |

**Một câu:** *Mọi đường dẫn tới dữ liệu hội thoại thật đều tồn tại và đã được xác định chính xác đến
từng offset — nhưng đường nào cũng đi qua một trong ba thứ bị plan cấm: chèn mã vào runtime Zalo (§2.3),
chiếm phiên đăng nhập (§2.3), hoặc trích xuất/đạo hàm khóa mã hoá từ UIN/uid (§2.4 #5). Vì vậy kết quả
đúng là `NO_SUPPORTED_RUNTIME_BRIDGE_YET`, không phải một PoC giả.*

---

## 1. R11B đã thực thi những gì (và không thực thi gì)

| Hoạt động | Đã làm | Ghi chú |
|---|---|---|
| Đọc tĩnh toàn bộ bề mặt JS đóng gói | **Có** | 116/116 file, `node_modules_dirs=0` |
| Băm artifact & so với preflight | **Có** | asar không đổi (`r11b-preservation.log`) |
| Chạy `npm test` | **Có** | 89/89 pass, 0 fail |
| Chạy tiến trình `zalo://` | **Không** | Nhánh Companion đóng băng ở `NOT_RUN` |
| Đọc nội dung DB / giải mã | **Không** | Cấm bởi §2.4 #5 |
| Gọi endpoint/IPC/native của Zalo | **Không** | Cấm bởi §2.3 |
| Chèn mã / patch asar / mở DevTools | **Không** | `NO-GO` theo R11A §2 |
| Tạo `poc/runtime-bridge/` | **Không** | Plan §6: chỉ "nếu có PoC hợp lệ" |

Ba bộ kiểm chứng tái lập được đã chạy, tất cả xanh, và **sẽ đỏ** nếu artifact thay đổi:

| Harness | Kết quả | Tệp |
|---|---|---|
| Trích dẫn trong báo cáo R11A/R11B | **76 PASS / 0 FAIL** | `r11b-citation-verify.log` |
| Offset cơ chế khoá + bề mặt hosting | **27 PASS / 0 FAIL** | `r11b-verify-offsets.log` |
| Định dạng kho "Xuất dữ liệu" | **21 PASS / 0 FAIL** | `r11b-export-archive.log` |
| Quét hosting lặp lại | **giống hệt byte-for-byte** | `r11b-hosting-sweep-recheck.log` |

---

## 2. Chín bề mặt ranh giới, kết luận từng bề mặt

### 2.1 Hosting — UI ngoài chạy trong runtime Zalo

| Primitive | Số lần trong 116 file |
|---|---|
| `BrowserView` | 0 |
| `WebContentsView` | 0 |
| `attachBrowserView` | 0 |
| `<webview` / `webviewTag` | 0 / 0 |
| `protocol.handle` | 0 |
| `registerHttpProtocol` | 0 |
| `registerStreamProtocol` | 0 |
| `interceptHttpProtocol` | 0 |
| `MessagePortMain` | 0 |
| `contextIsolation:!1` | 0 |
| `nodeIntegration:!0` | 0 |
| `webSecurity:!1` | 0 |
| `enableRemoteModule` | 0 |
| `setWindowOpenHandler` | 6 (chỉ `compact-app.js`, `main.js`) |
| `registerFileProtocol` | 2 — scheme `zfile`, nằm trong `if (isDev())` = `if (false)` |
| `postMessage:` | 25 (worker nội bộ) |
| `MessageChannelMain` | 1 (`main.js`) |
| `nodeIntegrationInWorker` | 6 |
| `sandbox:!1` | 10 (5 `main.js`, 5 `compact-app.js`) |

`sandbox:!1` và `nodeIntegrationInWorker` **không** phải lỗ hổng cho ta: chúng thuộc các **renderer ẩn
do Zalo tự tạo** ("Zalo App Usage", "Shared Worker", cửa sổ noti, cửa sổ "SQLite"). Cửa sổ SQLite có
`show(){return"not allowed"}` — chặn cứng ở tầng mã, không phải ở cấu hình.

**Kết luận:** không có điểm móc hosting. `BLOCKED`, thiếu prerequisite — không phải thiếu nỗ lực.

### 2.2 URI scheme `zalo://`

Đăng ký toàn hệ thống: `HKCU\Software\Classes\zalo\shell\open\command = "...Zalo.exe" "--" "%1"`,
`ddeexec=False`, không COM, không autostart, không scheduled task, chỉ verb `open`.

Ngữ pháp: `^zalo:?//conversation/?\?(phone|username|id)=\+?(.+)`. Registrar `$zsub` chỉ hỗ trợ
`SUBSCRIBE`, `UNSUBSCRIBE`, `SUBSCRIBE_V2`; `REQUEST`/`RAW_SEND` bị bỏ.

**Kết luận:** **L1 — một chiều vào (fire-and-forget).** Mở được hội thoại, không đọc được trạng thái
trả về, không lấy được tin nhắn. Là `COMPANION` theo định nghĩa plan §6, không phải runtime bridge.

### 2.3 Cơ sở dữ liệu cục bộ

Bản ghi `_production` cho thấy `MsgInfo.db` (3.06 MB), `Media.db` (99.6 MB), `Meta.db`, `Reaction.db`,
`Res.db`, FTS 39.2 MB — tất cả trong thư mục tài khoản, tất cả **không** mang magic `SQLite format 3`
(đã mã hoá). Các DB cấp hệ thống (`Qos.db`, `Storage.db`, `SecureLocalstorage.db`, `Trust.db`) thì
plaintext nhưng **không chứa tin nhắn**.

Cơ chế khoá đã xác định chính xác (chỉ tên ký hiệu + offset):

| Mảnh | Vị trí |
|---|---|
| Hàm suy khoá FTS `createKey(e,t)` | `preload-shared-worker.js@1090797` |
| Áp `PRAGMA key='…'`, `cipher_compatibility=3` trên win32 | `@1092094`, `@1092152` |
| `getUserScopeKey()` trả `session.UIN` | `@1203563` |
| Gán `cipherKey` từ partition | `@1567622` |

**Kết luận:** khóa **suy ra được** trong JS thuần. Nhưng suy ra nó = đọc UIN phiên đăng nhập =
`chiếm quyền phiên` → plan §2.3; và khoá đó chính là `khóa mã hóa` → §2.4 #5. `BLOCKED`.

### 2.4 Native module `db-cross-v4`

| Sự thật | Giá trị |
|---|---|
| export PE | **đúng 1**: `_register_addon_` @ `0x10103334` |
| sha256 | `0bae75bb99946a7a59642c07f77961742f8b9caf23b2e3ce5930ec21f28cfa27` |
| phương thức N-API | `getVersion`, `parseBinNet`, `decompressAndDecryptDb_V2`, `decompressAndDecryptDb` |
| tham số `password` | **có** (1 lần) — cả hai hàm giải mã đều cần bên gọi cấp |
| `napi_register_module_v1` / `sqlcipher` / `PRAGMA` / `BINNET` | 0 / 0 / 0 / 0 |
| prebuilt | chỉ `electron_x86` (1239552 B) |

**Kết luận:** module không tự tìm khoá. Muốn dùng nó phải **cấp khoá** — quay lại đúng §2.4 #5.

### 2.5 ContextBridge — cái gì lộ ra cho renderer

| Preload | Byte | Namespace độc nhất |
|---|---|---|
| `preload-render.js` | 1,990,534 | 41 (39 `$z*`) |
| `preload-shared-worker.js` | 2,220,254 | 42 (40 `$z*`, thêm `$zsqlite`) |
| `preload-noti.js` | 1,990,530 | 41 (39) |
| `preload-sqlite.js` | 2,830,607 | 1 (`__SENTRY_IPC__`) |
| `compact-app-preload.js` | 2,248,899 | 8 (7 `$z*`) |

**Kết luận:** toàn bộ 41/42 namespace là **first-party**, chỉ tồn tại bên trong renderer do Zalo tạo.
Không có namespace nào được thiết kế để một process ngoài gọi vào. Không có `contextIsolation:!1`
nào để lách `bridge`.

### 2.6 Kênh DB IPC

Nhóm kênh quan sát được: `DB_MIGRATION`; `DAL_UTILITY{CLOSE_DB, DELETE_DB, GET_PARTITION_KEYS,
CLEAR_SESSIONAL_POOLS_UTILITY_TYPE_ID, CLEAR_ALL_POOLS_UTILITY_TYPE_ID}`; `BACK_UP_UTILITY{CREATE_BACK_UP_TYPE_ID,
ABORT_CREATE_BACK_UP_TYPE_ID}`; `DB_ENCRYPTION{START, PAUSE, LISTEN, CHECKSTT}`; `SIGNAL_CORRUPTION`;
`ANALYZE_CORRUPTION`; cờ `OPEN_*`.

Đây là **IPC nội bộ giữa main/renderer của Zalo**. Gọi vào chúng từ ngoài = "cơ chế truy cập IPC riêng"
→ plan §2.3 chặn thẳng. `BLOCKED`.

### 2.7 Nền tảng toast / thông báo Windows

`GetAccessStatus()=Allowed`, nhưng `toast_count=4` và **cả 4** AUMID đều **không** phải Zalo
(`ASUSPCAssistant`, `WindowsFeedbackHub`, `ActionCenter.SmartOptOut`, `Defender.SecurityCenter`).
`Zalo.lnk args=` rỗng; `AppUserModelId` registry: 0 khớp Zalo ở cả HKCU và HKLM.

**Kết luận:** không có kênh push nào của Zalo đi qua nền tảng toast mà ta đọc được. `BLOCKED`.

### 2.8 Named pipe

421 pipe trên máy, **đúng 2** thuộc Zalo: `PipeZCallRecv`, `PipeZCallSend`. `zalo_listen_sockets=0`.

**Kết luận:** pipe gọi thoại nội bộ, payload AES bằng secret riêng của app → plan §2.3 (private IPC)
và §2.4 #5. `BLOCKED`.

### 2.9 Các đường đã bị loại từ R11A, không mở lại

`ZaloCap` capture, DevTools (`devTools:!0` có thật nhưng chỉ mở bằng thao tác UI thủ công và gọi
`ipcMain` nội bộ = private IPC), patch `app.asar`, route Olaz, nút "enable real adapter" — tất cả
`NO-GO` theo [`ADR_RUNTIME_FIRST.md`](../docs/ADR_RUNTIME_FIRST.md) và plan §2.3/§2.4 #9/§9.

---

## 3. Phát hiện quyết định — tính năng "Xuất dữ liệu" của chính Zalo

Đây là bề mặt **hấp dẫn nhất** và là bề mặt cuối cùng được khảo sát kỹ trong R11B, vì nó thoả gần hết
các điều kiện: có thật, do người dùng chủ động bật, không cần quyền đặc biệt, và chứa dữ liệu hội thoại.
**Nó vẫn không phải điểm tích hợp được phép.** Dưới đây là toàn bộ cơ chế, chỉ ghi tên ký hiệu, offset
và thuật toán — **không** có giá trị khoá, uid hay nội dung tin nhắn.

### 3.1 Tính năng có thật và mặc định bật

| Sự thật | Bằng chứng |
|---|---|
| Cờ mặc định `export_import:{is_enable:!0,max_size_media:10737418240,…}` | 5 file, `default_enabled_occurrences=5` |
| Server có thể ghi đè (feature flag) | `server_override_occurrences=4` |
| Nhãn UI "Xuất dữ liệu" | 19 lần, 11 trong `lang-vi.*.js` |
| `canExport` | 12 lần |
| Tên tệp đầu ra | `ORIGIN_EXPORT_FILE_NAME:"backup_zalo"` @4011839 → `backup_zalo_DD_MM_YYYY.zl.zip` |

### 3.2 Chuỗi thực thi

```
startExportDbV2()
  → exportDBToFileV2(A.k, …)          // conversations
  → exportDBToFileV2(A.a, …)          // messages
  → startZip(arType, totalSize)
  → ZDataExportImportIntance.doArchiveExportFolder({arType, totalSizeExport})
  → $zFileManager.achiveBackupFile(this.uin, o, {entries, onProgress, onInitPath, onClose, onError})
```

Nguồn dữ liệu: `this.DB.Core.Message.getAll(...)` qua `loadMessagesForBackup(e,t,n=9e3)`
(`@3811128`) — tức là **chạy bên trong renderer của Zalo, bằng phiên của Zalo**.

### 3.3 Bên trong kho: JSONL thuần (đã sửa lại kết luận cũ)

```js
a.forEach((e=>{let n=this.encrypt(JSON.stringify(e));t.write(n+"\n")}))   // messages  @3821288
a.forEach((e=>{let t=this.encrypt(JSON.stringify(e));i.write(t+"\n")}))   // conversations @3822301
```

Lớp ghi bản ghi có `extends_in_class=0` và `encrypt(e){return e}` **là hàm đồng nhất** (`@3838182`).
⇒ **bản ghi là plaintext JSONL**, ghi bằng `createWriteStream(n,"utf8")` vào
`V.exportDBFolderPath / (V.uid + "_z" + ext + M.V4)`, `V4="zdb"`.

> Đây là chỗ R11B **sửa một kết luận chưa chính xác** của lần khảo sát trước (khi đó ghi rằng từng bản ghi
> bị mã hoá bằng UIN). Sai. Chỉ **vỏ tar** bị mã hoá; ruột là text. Việc sửa lại làm kết luận **mạnh hơn**,
> không yếu đi — xem §3.4.

### 3.4 Cái chặn thật sự: khoá = `sha256(uid)`, IV từ `uid`

```js
class z {
  static getCipherKey(e)   { return C.a.createHash("sha256").update(e).digest() }
  static getCipher(e)      { return C.a.createCipheriv("aes-256-cbc", z.getCipherKey(e), z.getFormattedIv(e)) }
  static getDecipherV2(e)  { return C.a.createDecipheriv("aes-256-cbc", z.getCipherKey(e), z.getFormattedIv(e)) }
  static getFormattedIv(e) { return Buffer.from("zie" + e.slice(0,13)) }
}
```

với `e` = `uid` tài khoản đang đăng nhập. Vỏ được tạo bằng `O.pack(e,{entries})` rồi `e.pipe(r.cipher)`.

Phía nhập ngược lại: `this._dbImportExt = p.b.V4` → `isEncryptedContent()` trả `false` →
`decryptV2` là passthrough, vì `isEncryptedDB(e){return e===p.b.V0}` và `V0="zb"` ≠ `V4="zdb"`.

**Vì sao điều này khoá đường lại một cách dứt khoát:** kho không có mật khẩu do người dùng nhập. Khoá là
một **hàm thuần của uid**. Nên kể cả trong kịch bản hoàn toàn đồng thuận — người dùng tự tay bấm
"Xuất dữ liệu" trong Zalo rồi trỏ Apple Glass vào tệp `.zl.zip` — Apple Glass vẫn phải lấy `uid` để giải mã.
Lấy `uid` = đọc định danh phiên đăng nhập (`§2.3 chiếm quyền phiên`) và tự đạo hàm khoá mã hoá (`§2.4 #5`).
Thêm nữa, tên entry trong tar cũng chứa `uid` (``V.uid+`_z${e}${M.V4}` ``), nên ngay cả metadata cũng buộc
phải chạm vào uid.

**Kết luận:** `BLOCKED` — **thiếu prerequisite về quyền**, không phải thiếu kỹ thuật. Đây chính là trường
hợp plan §2.4 #7 mô tả: *"Khả thi về kỹ thuật ≠ được phép tích hợp."*

---

## 4. "Kỹ thuật khả thi ≠ được phép tích hợp"

Bảng dưới đây là lý do cốt lõi khiến R11B không thể sinh ra `RUNTIME_POC_PASS`:

| Đường | Kỹ thuật | Điều gì chặn | Điều khoản |
|---|---|---|---|
| Hosting UI trong Zalo | Không tồn tại | Không có hook | §2.3, §2.4 #9 |
| `zalo://` | Có, một chiều | Không có chiều về | §6 (chỉ Companion) |
| DB cục bộ | Có, khoá suy ra được | Cần UIN | §2.3, §2.4 #5 |
| `db-cross-v4` | Có | Cần `password` | §2.4 #5, #6 |
| Kho `.zl.zip` | Có, người dùng bật được | Khoá = `sha256(uid)` | §2.3, §2.4 #5 |
| DB IPC / named pipe | Có | Private IPC | §2.3 |
| Toast | Không có AUMID Zalo | Không có kênh | — |
| DevTools / asar patch | Có | Sửa/phá cài đặt gốc | §2.3, §2.4 #1, #9 |

**Không có dòng nào trong bảng trên là "chưa thử".** Tất cả đều đã được đo tới offset hoặc tới số đếm
đầy đủ trên 116/116 file. Việc chúng bị chặn là do **điều khoản**, và plan đã tuyên bố rõ điều khoản
thắng kỹ thuật.

---

## 5. Vì sao không có `poc/runtime-bridge/`

Plan §6 ghi sản phẩm là `poc/runtime-bridge/` **"(nếu có PoC hợp lệ)"**. R11B không có PoC hợp lệ, nên
thư mục **không được tạo** — tạo ra một PoC đọc dữ liệu mock hoặc một PoC dùng khoá uid sẽ là chính
hành vi mà chỉ thị của người dùng cấm ("Không sử dụng dữ liệu mock để chứng minh Runtime Bridge";
plan §12 "không tự ý khai thác API nội bộ").

`poc_dir_exists=false`, `runtime_poc_report_exists` trước khi ghi tệp này là `false` — ghi nhận trong
`r11b-preservation.log`.

---

## 6. Nhánh Companion — dừng đúng chỉ thị

Chỉ thị đổi ưu tiên yêu cầu: nếu đang chạy `zalo://` thì hoàn tất bước hiện tại rồi dừng; nếu chưa bắt đầu
thì bỏ qua. Trạng thái thực tế:

| Hạng mục | Trạng thái |
|---|---|
| `tools/r11b-deeplink-poc.cjs` (357 dòng) | **đã viết, đã làm cứng, chưa từng chạy** |
| Tiến trình Zalo nào bị khởi chạy bởi PoC | **không có** |
| Hội thoại nào bị mở | **không có** |
| `COMPANION_PASS` / `COMPANION_POC_PASS` | **không tuyên bố** (`NOT_RUN`) |
| Launcher / deep-link adapter / UI điều khiển Zalo gốc | **không xây thêm** |

Nhánh Companion đóng ở `NOT_RUN`. Kết quả R11A về `zalo://` (L1 một chiều) vẫn giữ nguyên giá trị làm
bằng chứng, không cần chạy lại.

---

## 7. Bảo toàn — "Giữ nguyên" (plan §2.4)

| Hạng mục | Trạng thái | Bằng chứng |
|---|---|---|
| Cài đặt Zalo gốc không bị sửa | **Có** | asar `d83256230e5d1d4483c2411f71936c3dc1562fb8a885fd8752cab17d229201e6`, 177,728,582 B, `asar_unchanged=true` |
| REA là công cụ RE duy nhất | **Có** | toàn bộ probe dùng REA |
| Không lấy bundle client bên thứ ba | **Có** | chỉ đọc `app.asar` của bản cài |
| Không đóng gói lại binary/bundle Zalo | **Có** | không tạo artifact nào chứa mã Zalo |
| Không trích xuất credential/token/khoá/tin nhắn | **Có** | đã quét lại toàn bộ `r11a*`/`r11b*`; chỉ có SHA-256 artifact và magic SQLite |
| Không bỏ qua xác thực/authorization | **Có** | không gọi endpoint, không mở DB |
| Không mở A1–A4 bằng bằng chứng REA | **Có** | [`API_AUTHORIZATION_GAP.md`](../docs/API_AUTHORIZATION_GAP.md) vẫn **0/4** |
| Không xoá/sửa lịch sử R6–R10 | **Có** | chỉ thêm tệp mới |
| Không lặp CSS injection / patch asar | **Có** | không có |

Hợp đồng `IZaloClient` nguyên vẹn: `src/adapters/types.ts`, 322 dòng, 9,834 B,
sha256 `d934d702fa09032d678be37d9c96ee9fa3c2f44a4064f250b10cb849b9c85e6c`,
35 interface xuất khẩu, **11 port**: `AuthPort`, `ContactsPort`, `ConversationsPort`, `MessagingPort`,
`MediaPort`, `GroupsPort`, `CallingPort`, `SyncPort`, `NotificationsPort`, `SecureChannelPort`,
`TransportPort`. Lớp gate: `NO_SUPPORTED_RUNTIME_BRIDGE_YET`

**Kiểm thử:** `tests 89 / pass 89 / fail 0` (`r11b-unit.log`). Mốc M0/M1/M2 vẫn `PASS (mock)` /
`PASS (loopback)` — không tụt hạng, không nâng hạng.

**Registry:** `delegateExecute_absent=true`, `registered_args="\"--\" \"%1\""` — không đổi so với preflight.

---

## 8. Index bằng chứng (`reports/executed/`)

| Tệp | Nội dung | Kết quả |
|---|---|---|
| `r11b-preflight-before.json` | trạng thái máy trước khi bắt đầu | baseline |
| `r11a-artifact-identity.json` | định danh artifact | — |
| `r11b-identity.log` | asar sha256/bytes, types.ts, 11 port | khớp |
| `r11b-citation-verify.log` | trích dẫn R11A/R11B | **76 / 0** |
| `r11b-verify-offsets.log` | cơ chế khoá + hosting | **27 / 0** |
| `r11b-export-archive.log` | định dạng kho xuất | **21 / 0** |
| `r11b-export-enabled.log` | cờ `export_import` | 5 site / 4 override |
| `r11b-export-surface.log` | bề mặt export trong 116 file | đầy đủ |
| `r11b-export-{conv,encrypt,format,gate,channels}.log` | chuỗi gọi | — |
| `r11b-hosting-sweep.log` + `-recheck.log` | hosting primitives | **giống hệt** |
| `r11b-scope-check.log` | 116/116, 0 `node_modules` | đầy đủ |
| `r11b-native-contract.log` | 27 artifact native | — |
| `r11b-native-strings.log` | chuỗi export `db-cross-v4` | 1 export |
| `r11b-preload-exposure.log` | 41/42/41/1/8 | đầy đủ |
| `r11b-db-surface.log` | DB `_production` + FTS | đã che tên tài khoản |
| `r11b-db-schema.log` | schema DB plaintext | đã che, `temp_cleaned=true` |
| `r11b-os-surface.log`, `-os-toasts.log` | pipe, toast, socket | 2 pipe / 0 AUMID |
| `r11b-registry-surface.log` | scheme, verb, COM, autostart | chỉ `open` |
| `r11b-backup-channels.log` | kênh `BACK_UP`/`DB_ENCRYPTION` | — |
| `r11b-unit.log` | `npm test` | **89 / 0** |
| `r11b-preservation.log` | asar unchanged, poc absent | **true** |
| `r11b-poc-report-verify.log` | **tái tính mọi con số trong tài liệu này** | **81 / 0** |

Harness tái lập (thoát mã ≠ 0 khi có bất kỳ drift nào):

- `C:\Users\huung\AppData\Local\Temp\r11b-export-archive-log.cjs` — 21 offset của định dạng kho xuất.
- `C:\Users\huung\AppData\Local\Temp\r11b-poc-report-verify.cjs` — đối chiếu **81** con số trích trong tài
  liệu này với artifact và log gốc, gồm băm `types.ts` sống-vs-log và bài kiểm "không có tuyên bố
  `RUNTIME_POC_PASS` khẳng định". Chính harness này đã bắt được một ký tự hex chép sai trong bản nháp
  của tài liệu và một con số interface sai (33 → 35); cả hai đã sửa.

Các probe còn lại cùng thư mục tạm, tiền tố `r11b-`.

---

## 9. Hướng nghiên cứu tiếp theo cho Apple Glass

Theo plan §12, vì không có phương thức phù hợp: **ghi blocker và giữ bản mock hoạt động**. Hướng đi tiếp
không phải là đào thêm bề mặt Zalo — bề mặt đã đóng, và đào thêm chỉ tạo áp lực vượt gate.

**Việc đúng nên làm (được phép ngay, không cần A1–A4):**

1. **Xây UI Apple Glass trên adapter mock + loopback của chính repo.** M0–M2 đã xanh; mở rộng độ phủ UI
   (hội thoại, tin nhắn, gửi optimistic, lịch sử cuộn) trên `MOCK_PASS` để sản phẩm hoàn chỉnh về trải nghiệm.
2. **Chỉ giữ một điểm nối duy nhất là `TransportPort`.** Khi nào A1+A2 mở, chỉ cần thay một implementation;
   UI không phải sửa. ADR-003 đã đặt sẵn ranh giới này.
3. **Không thêm công tắc "enable real adapter".** Plan §9 cấm rõ ràng.

**Việc phải làm trước khi có bất kỳ dữ liệu thật nào (đây là "missing prerequisite"):**

| Cổng | Cần gì | Ai xác nhận |
|---|---|---|
| **A1** | Xác định quyền sử dụng API/giao thức Zalo cho một client bên thứ ba — tài liệu công khai hoặc văn bản cho phép | VNG / điều khoản dịch vụ |
| **A2** | Cơ chế uỷ quyền hợp lệ (đăng ký ứng dụng, OAuth, hoặc thoả thuận) | VNG |
| **A3** | Phạm vi dữ liệu người dùng được phép đọc, và cơ sở pháp lý | chủ tài khoản + VNG |
| **A4** | Mô hình phân phối & yêu cầu ký/duyệt | VNG |

**Một hướng *khác về bản chất* đáng kiểm chứng (nhãn `INFERRED`, chưa xác minh):** Zalo có nền tảng
nhà phát triển công khai (Zalo OA / Mini App). Nếu tồn tại quyền truy cập chính thức cho OA-scoped
messaging thì đó là tích hợp **hợp pháp từ đầu**, không cần RE. **Nhưng** nó chỉ bao phủ hội thoại của
Official Account, **không** bao phủ hội thoại cá nhân — nên nó không thoả yêu cầu "hiển thị tin nhắn Zalo
của tôi". Cần kiểm chứng tài liệu chính thức trước khi coi là đường đi; cho tới lúc đó giữ nguyên nhãn
`INFERRED`, **không** đưa vào gate như một cổng đã mở.

---

## 10. Những gì tài liệu này KHÔNG tuyên bố

- **Không** `RUNTIME_POC_PASS`.
- **Không** `COMPANION_POC_PASS` / `COMPANION_PASS`.
- **Không** `LIVE_PASS`.
- **Không** `AUTHORIZED`.
- **Không** mở A1–A4 (vẫn **0/4**).
- **Không** nâng M3/M4 khỏi trạng thái *chặn*.
- **Không** khẳng định Apple Glass đã từng hiển thị một tin nhắn Zalo thật nào.
- **Không** khẳng định Zalo không thể tích hợp — chỉ khẳng định **chưa tìm thấy đường vừa khả thi vừa
  được phép**, và đã đo đủ để biết vì sao.

**Nhãn cuối cùng: `NO_SUPPORTED_RUNTIME_BRIDGE_YET` (= `BLOCKED`).**
