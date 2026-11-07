# R11V3 — Runtime Boundary Audit (R11A)

**Trạng thái:** hoàn tất phần khảo sát tĩnh + quan sát OS. **Không có thao tác thật nào được chạy.**
**Ngày:** 2026-11-06 (Asia/Saigon) · **Phạm vi:** Zalo PC 26.10.20.3253 trên máy này · **Công cụ RE:** REA (duy nhất)

> Tài liệu này chỉ ghi **ranh giới**. Quyết định chọn hướng nằm ở
> [`R11V3_INTEGRATION_OPTIONS.md`](R11V3_INTEGRATION_OPTIONS.md); quyết định kiến trúc nằm ở
> [`docs/ADR_RUNTIME_FIRST.md`](../docs/ADR_RUNTIME_FIRST.md). Lịch sử R6–R11 **không bị sửa**;
> đây là tài liệu bổ sung theo Master Plan V3 §2.4 #8.

---

## 0. Kết luận trong một khung

| Câu hỏi của R11A | Trả lời | Mức bằng chứng |
|---|---|---|
| Có bề mặt nào để **UI riêng chạy bên trong runtime Zalo** không? | **Không tìm thấy.** 0 `BrowserView`, 0 `WebContentsView`, 0 `webview`, 0 `protocol.handle`/`registerHttpProtocol`; nhánh dev-server `127.0.0.1:3000` bị hằng số `isDev=false` vô hiệu hoá | `OBSERVED` (quét 116/116 JS) |
| Main window có tắt bảo vệ web không? | **Không.** `webSecurity: true`, `allowRunningInsecureContent: false`, `nodeIntegration: false`, `contextIsolation: true` | `OBSERVED` (hằng số fold được) |
| Có kênh nào **do OS công khai** để điều khiển Zalo? | **Có một:** scheme `zalo://` đã đăng ký toàn hệ thống, có đường xử lý đầu-cuối tới "mở hội thoại" | `OBSERVED` (static + registry + process) |
| Đường đó có đọc được trạng thái trả về không? | **Không.** Chỉ một chiều vào (fire-and-forget) | `OBSERVED` |
| Kênh native `ZaloCall` có dùng được không? | **Không.** Named pipe nội bộ, payload mã hoá AES bằng secret của app | `OBSERVED` → `BLOCKED` bởi plan §2.3 |
| Media/call có nằm trong JS không? | **Không.** Nằm ở `plugins\capture\{ZaloCall,ZaloCap}.exe` (Qt5) | `OBSERVED` (khớp F7) |

**Một câu:** *Runtime Zalo đóng hoàn toàn với UI ngoài ở tầng hosting, nhưng để ngỏ một API hệ điều hành công khai là URI scheme `zalo://` — đủ cho một Companion PoC, không đủ cho một client thay thế.*

---

## 1. Artifact & process inventory

### 1.1 Artifact (đã băm, chỉ đọc)

| Vai trò | Đường dẫn | Bytes | SHA-256 |
|---|---|---|---|
| Launcher stub (`StubExecutableZalo`, VNG-signed) | `…\Programs\Zalo\Zalo.exe` | 790,568 | `7295232C…4195A2` |
| **Binary Electron thật** | `…\Programs\Zalo\Zalo-26.10.20\Zalo.exe` | 136,638,504 | `75DC8555…9CAC3E` |
| Bundle ứng dụng | `…\Zalo-26.10.20\resources\app.asar` | 177,728,582 | `D8325623…9201E6` |
| Main process | `main-dist/main.js` | 4,342,755 | `A0150EBC…A2F6A9` |
| Compact app main | `main-dist/compact-app.js` | 4,180,222 | `F43C00F9…FBF913` |
| Preload renderer | `main-dist/preload-render.js` | 1,990,534 | `24C5ECB8…F61602` |
| Media utility | `main-dist/utility-process-media.js` | 1,191,831 | `0D2B503C…A9A0139` |
| Compact renderer bundle | `pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js` | 20,927,993 | `6EC04117…AAF415` |
| Renderer HTML | `pc-dist/index.html` | 6,267 | `18BA422F…357369` |

Nguồn: `reports/executed/r11a-artifact-identity.json`. `package.json` → `{"name":"Zalo","version":"26.10.20","main":"bootstrap.js"}`.

**Phạm vi đọc:** toàn bộ `app.asar` đã giải nén, **116 tệp `.js`**. **Không** đọc binary native (`.node`, `ZaloCall.exe`, `ZaloCap.exe`) — xem §9.3.

### 1.2 Process tree (một lần quan sát, chỉ đọc)

```
15152  (không xác định — xem ghi chú dưới)
└─ 18220  Zalo-26.10.20\Zalo.exe                                        ← main
   ├─ 10836  --type=gpu-process --user-data-dir="…\Roaming\ZaloData"
   ├─ 3976   --type=utility --utility-sub-type=network.mojom.NetworkService
   ├─ 11348  --type=utility --utility-sub-type=node.mojom.NodeService
   ├─ 22316  --type=utility --utility-sub-type=node.mojom.NodeService
   ├─ 6472   --type=utility --utility-sub-type=audio.mojom.AudioService --service-sandbox-type=audio
   ├─ 4668   --type=renderer … --no-sandbox --no-zygote --first-renderer-process
   ├─ 18292  --type=renderer … --enable-experimental-web-platform-features --no-sandbox
   ├─ 19968  --type=renderer … --no-sandbox
   ├─ 23444  plugins\capture\ZaloCall.exe \\.\pipe\PipeZCallRecv \\.\pipe\PipeZCallSend
   └─ 34072  plugins\capture\ZaloCap.exe zalo2017 C:\…\Roaming\ZaloData\cal…
```

Nguồn: `Win32_Process` tại thời điểm khảo sát; log `reports/executed/r11a-os-surface.log`.

> **Parent của PID 18220 là 15152 và hiện không còn tồn tại** — log gốc chỉ ghi Name/Id của các process
> `Zalo*`, không ghi parent. Vì vậy cây trên **không** chứng minh được 15152 là `explorer.exe`; đừng suy
> ra điều đó. Điều cần cho R11A là: main process do một tiến trình khác khởi chạy, và cơ chế được đo ở
> §7.6 là stub → binary versioned chứ không phải explorer → Zalo.

Ghi nhận: mọi process con đều **cùng `--user-data-dir`** `…\Roaming\ZaloData`; renderer chạy `--no-sandbox` (đây là cờ Chromium của app, không phải `sandbox` trong `webPreferences` — hai thứ khác nhau).

> Hai điều không mâu thuẫn, dễ đọc nhầm:
> (a) chuỗi `--user-data-dir` **không** xuất hiện trong 116 tệp `.js` (§4). Nó có trong argv process con vì
> Electron tự thêm cờ này khi đường `userData` khác mặc định — không phải do mã Zalo gõ ra.
> (b) `--no-sandbox` là cờ **Chromium** do app truyền; `sandbox: false` trong `webPreferences` (§3.3) là
> thuộc tính **Electron** riêng. Cả hai đều đúng và độc lập.

---

## 2. Vòng đời khởi động (đọc trực tiếp `bootstrap.js`, 756 B)

```js
function bootstrap() {
  require('./libs/perf-tracing/runtime'); perf.record(perf.STARTUP);
  require('./main-dist/migration');       perf.record(perf.MIGRATION_DONE);
  const isCompactApp = process.argv.some(e => e.startsWith('--launch-compact-app'));
  if (isCompactApp) {
    if (app.requestSingleInstanceLock()) return handleEntryCompactApp();
    else return require('./main-dist/second-instance');
  }
  if (app.requestSingleInstanceLock()) { perf.record(perf.MAIN_SCRIPT); require('./main-dist/main'); }
  else { require('./main-dist/second-instance'); }
}
```

- `main-dist/second-instance.js` (1,516 B) **không** tự chuyển tiếp argv: nó append timestamp vào
  `…\ZaloData\startup.log` rồi `app.quit()`. Việc chuyển argv nằm ở **instance đang chạy** (§7.2).
- Điều này sửa một false negative cũ: `requestSingleInstanceLock` = 0 trong `main-dist/*` vì lời gọi
  nằm ở `bootstrap.js` ngoài thư mục đó.

**Hai cửa sổ, hai bundle, đều first-party:**

| Tham số | HTML được nạp | Bundle renderer |
|---|---|---|
| *(mặc định)* | `pc-dist/index.html` | `pc-dist/render.f32c58b63b6f4273a8a4.js` + 6 script khác (vendors, `libsignal`, `default-login-render…js`) |
| `--launch-compact-app` | `pc-dist/compact-app.html` | `pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js` (**khác** bundle mặc định) |

`--launch-compact-app` chỉ **chọn một bundle sẵn có của Zalo** — không phải điểm móc UI ngoài. Bản đồ
`html → script` đo được (mỗi `.html` trong `pc-dist/` liệt kê đủ thẻ `<script src>`):

| HTML | Số `<script src>` | Script (rút gọn) |
|---|---|---|
| `index.html` | 7 | `libs/libsignal-protocol.static.js` + 4 chunk vendor/default + `lazy/default-login-render.dc51d7e4…js` + **`render.f32c58b63b6f4273a8a4.js`** |
| `compact-app.html` | **1** | **`compact-app-pc.f32c58b63b6f4273a8a4.js`** (không có chunk nào khác) |
| `login.html` | 10 | `lazy/0.1068…js`, vendor/login chunk, **`…aa2b4a7e…js`**, `login.f32c58b63b6f4273a8a4.js` |
| `shared-worker.html` | 15 | vendor chunk, **`…aa2b4a7e…js`**, `shared-worker.f32c58b63b6f4273a8a4.js` |
| `znotification.html` | 7 | vendor chunk, **`…aa2b4a7e…js`**, `znotification.f32c58b63b6f4273a8a4.js` |
| `sqlite.html` | 1 | `sqlite.f32c58b63b6f4273a8a4.js` |
| `child.html`, `popup-viewer.html` | 0 | không có script |

Chunk `aa2b4a7e…` (40,206 B) — thứ đăng ký `globalThis.$zsub` và gọi `Ke("$zuri", …)` — được nạp ở **3** entry
(`login`, `shared-worker`, `znotification`) và **không** được `compact-app.html` nạp. Đây là căn cứ cứng
cho §7.5 L3. Log: `reports/executed/r11a-all-html.log`.

> **Phân biệt hai chunk dễ lẫn:** `…aa2b4a7e…js` là **chunk wiring 40 KB** (đăng ký `$zsub`);
> `…aafd0814…js` là **bundle chính 17.2 MB** cùng họ tên (chứa component chat-shell). Cùng tiền tố
> `default-login-main-startup-shared-worker-znotification.` nhưng khác tệp — offset của tệp này **không**
> dùng được cho tệp kia.

---

## 3. Bản đồ ranh giới theo tầng

### 3.1 Renderer ↔ Preload

| Mục | Quan sát |
|---|---|
| Cơ chế | `contextBridge.exposeInMainWorld` — 137 lần, trên 7 preload |
| Main window preload | `main-dist/preload-render.js` → expose 41 namespace, gồm `$zuri`, `$zscreencap`, `$zlogin`, `$zelectron`, `$znode`, … |
| Compact preload | `compact-app-preload.js` → **8 tên literal**: `__SENTRY_IPC__`, `$zelectron`, `$znode`, `$zFileManager`, `$app`, `$zfileRes`, `$zlogger`, `$zconfig` — **cộng 2 namespace có điều kiện** qua helper generic `POOw.a(name, table)`: `$inaccessibleDrive` (tác vụ `InaccessibleDrive`) và `$migration` (tác vụ `UserDataMigration`). Có tên hay không phụ thuộc `loadTokens()`: đọc `--appVersion=<hash>` → file trạng thái phiên bản → chỉ giữ token nằm trong `Object.values(oPp/)`. Đếm literal-only ra 8 và **bỏ sót** hai tên này — đó là lý do dùng helper gián tiếp |
| `executeJavaScript` | **0** toàn bộ 116 tệp |
| `insertCSS` | **0** toàn bộ 116 tệp |

Đây là allowlist đóng. Không có khe để renderer ngoài chen vào.

### 3.2 Preload ↔ Main (IPC)

| Kênh | Số đếm lexical |
|---|---|
| `ipcMain.handle` | 2 |
| `ipcMain.on` | 13 |
| `ipcMain.once` | 0 |
| `webContents.send` | 232 |

Các kênh liên quan deep link (§7), `zfile` (§3.6), call (`call-update`, `call-request`, `call-send-signal`, `call-response-*`).

### 3.3 Main window `webPreferences` (9 khối, đọc hết)

Khối chính @2696852 (`main-dist/main.js`):

```js
webPreferences: {
  webSecurity: !oe(), allowRunningInsecureContent: oe(), devTools: !0,
  partition: "persist:zalo", webgl: !0, experimentalFeatures: !0,
  experimentalCanvasFeatures: !0, backgroundThrottling: !1,
  nodeIntegration: !1, contextIsolation: !0, sandbox: !1,
  preload: path.join(__dirname, "preload-render.js")
}
```

**`oe()` đã giải được tới hằng số** — không còn là suy luận:

```js
// module ZQzv, main.js @2218293
const d = !1, u = !d, …
function I(){ return d }          // export: isDev: I
```

`d` không được gán lại ở bất kỳ đâu trong module (đã quét toàn bộ 16,951 ký tự của module). Suy ra:

| Thuộc tính | Giá trị hiệu dụng | Mức |
|---|---|---|
| `webSecurity` | **`true`** | `OBSERVED` (fold hằng số) |
| `allowRunningInsecureContent` | **`false`** | `OBSERVED` |
| `nodeIntegration` | `false` | `OBSERVED` |
| `contextIsolation` | `true` | `OBSERVED` |
| `sandbox` | `false` | `OBSERVED` |
| `devTools` | `true` | `OBSERVED` |

Các khối còn lại: Kiki Assistant @1077098 và @3110359 → `sandbox: true, devTools: false`; Shared Worker @1194719 và
SQLite @4154303 → `webSecurity: true, sandbox: false` + preload riêng; Notification window @2726412.

> `devTools: true` là **bề mặt debug của Electron cho người dùng cuối**, không phải integration surface:
> mở nó đòi thao tác UI thủ công, không lập trình được, và dùng nó để gọi IPC nội bộ là **private IPC
> access** — bị plan §2.3 chặn.

### 3.4 Main ↔ native

| Native | Cách gọi | Trạng thái |
|---|---|---|
| `ZaloCall.exe` | `net.createServer()` 2 pipe trong main, đường dẫn truyền bằng argv | `BLOCKED` — xem §8 |
| `ZaloCap.exe` | `child_process.spawn`, argv `zalo2017 <dir>` | `BLOCKED` — screencap nội bộ |
| media utility | `utilityProcess.fork` trên `utility-process-media.js` | `OBSERVED`, message-port nội bộ |

Lexical: `spawn`=3, `execFile`=2, `fork`=4, `utilityProcess`=2, `ZaloCall`=6, `ZaloCap`=4, `ZaviMeet`=0.

### 3.5 Main ↔ network

Login / sync / media-signalling **không** nằm trong bundle JS dưới dạng endpoint cố định: chúng đi qua
`session.fromPartition("persist:zalo")` (35 lần `fromPartition`) và các lớp `zsecure`/`zuri`. Không có
`remote-debugging-port` (0), không có `--inspect-brk` (0), không có `--user-data-dir` (0).

`--inspect=9230` chỉ xuất hiện dưới dạng **hằng số export** và trong blob `package.json` →
`"debug-main": "… electron . --inspect=9230"`, tức script dev đóng gói kèm. **Không có spawn production.**

### 3.6 Custom scheme của Zalo

| Scheme | Đăng ký | Điều kiện |
|---|---|---|
| `zfile` | `protocol.registerFileProtocol("zfile", …)` @main.js | chỉ trong nhánh `isDev()` → **dead code ở bản production** |
| `registerSchemesAsPrivileged` | 2 lần | **cả hai là nội bộ SDK Sentry** (`s.PROTOCOL_SCHEME` với `bypassCSP/corsEnabled/supportFetchAPI/secure`), không phải scheme của Zalo |

`protocol.handle`, `registerHttpProtocol`, `registerStreamProtocol`, `registerBufferProtocol` = **0**.

---

## 4. Bề mặt hosting — phủ định dứt điểm

Quét **116/116 tệp `.js`** (`reports/executed/r11a-hosting-surface.log`):

```
BrowserView                    0
WebContentsView                0
webviewTag                     0
<webview                       0
addBrowserView                 0
setBrowserView                 0
protocol.handle                0
registerHttpProtocol           0
registerStreamProtocol         0
registerBufferProtocol         0
registerFileProtocol           2   (đều trong nhánh isDev → chết ở production)
registerSchemesAsPrivileged    2   (đều là Sentry SDK)
setAccessibilitySupportEnabled 0
remote-debugging-port          0
enableRemoteModule             0
will-attach-webview            0
USER_DATA_DIR                  0
--user-data-dir                0
executeJavaScript              0
insertCSS                      0
```

Quét bổ sung cho mọi bề mặt server nội bộ (`reports/executed/r11a-host-surface-sweep.log`):

```
http.createServer       0      express(            0      WebSocketServer     0
https.createServer      0      app.listen(         0      socket.io           0
net.connect             0      server.listen(      0      ws.Server           0
net.createConnection    0
```

25 hit `createServer` đã mở **từng chỗ trên cả 8 tệp** (`reports/executed/r11a-create-server-context.log`)
và phân loại:

| Nguồn | Số | Phân loại |
|---|---|---|
| `net.createServer` cho `PipeZCallRecv`/`PipeZCallSend` | 4 (2 mỗi main bundle) | **Private IPC** — §8 |
| Dummy update server cổng 3001 (`electron-updater` dev-mode) | 4 | Chỉ tồn tại khi có `app-update.yml` dev; không expose API ứng dụng |
| Proxy `Squirrel.Mac` của `electron-updater` | 2 | **macOS-only** (`http://127.0.0.1:${port}` cho file `.zip/.dmg`) — vô nghĩa trên Windows |
| `createServerMessageToNormalizedMessage`, `createServerUpdate` | **15** — 3 mỗi tệp × `shared-worker`, `search-worker`, `sync-v2-sub-worker`, `compact-app-pc`, `…-znotification` | Trùng tên method, **không phải server** |

Độ phủ: `main.js` 5/5, `compact-app.js` 5/5, 5 worker bundle 15/15, `preload-render.js` 0.
Không còn hit nào chưa mở.

**Kết luận §4:** không có bề mặt hosting, không có local API bridge, không có HTTP loopback, không có
webview. Giả thuyết "một runtime chính thức có thể chạy cùng giao diện ngoài" **không có vật chứng**.

---

## 5. F7 đối chiếu: media nằm ở đâu

| Lớp | Nội dung | Nguồn |
|---|---|---|
| JS (116/116 tệp) | 0 lời gọi capture thật; `getUserMedia` không xuất hiện như lời gọi trong bundle main | F7 cũ, tái khẳng định |
| Utility process | `utility-process-media.js` — worker message-port, không mở thiết bị | 1,191,831 B |
| **Native** | `plugins\capture\ZaloCall.exe`, `ZaloCap.exe` (Qt5) — process đang chạy có argv chứng minh | §1.2 |

**Phạm vi:** kết luận F7 đúng nghĩa là *"không có capture trong tập JS đã quét"*, **không** phải *"Zalo
không gọi được"*. Ngược lại: call/media **có** chạy, nhưng ở binary native ngoài phạm vi đọc của R11A.
Bất kỳ báo cáo nào nói "Zalo không có calling" đều **sai** và phải bị bác bỏ bằng §1.2.

---

## 6. Bảng trạng thái từng ranh giới

Theo đúng 6 tiêu chí plan §5.6.

| Ranh giới | Công khai / được hỗ trợ? | Private / unstable? | Cần bí mật phiên? | Cần sửa binary? | Quyền phân phối? | Kiểm thử được? | Trạng thái |
|---|---|---|---|---|---|---|---|
| **URI scheme `zalo://conversation/?…`** | Có — đăng ký OS, chính app ghi, người dùng bấm được | Thấp (grammar có `RegExp` kiểm) | Không (đi qua instance đang chạy) | Không | Không (chỉ điều khiển app đã cài) | Có — quan sát cửa sổ | **CANDIDATE** |
| Windows UIA / accessibility | Có (API Windows) | Không | Không | Không | Không | Có nhưng hiện **rỗng** (§7.4) | `BLOCKED` tạm thời |
| Taskbar (`setOverlayIcon`, `setBadgeCount`, `flashFrame`) | Có — nhưng là Zalo **ghi ra**, không phải ta đọc vào | — | — | Cần | Không | — | `OBSERVED` (một chiều) |
| Renderer ↔ Preload (contextBridge) | Không | Có (allowlist nội bộ) | Có | Không | — | — | `BLOCKED` |
| IPC `ipcMain`/`webContents.send` | Không | Có | Có | Không | — | — | `BLOCKED` |
| `zfile://` custom protocol | Không (chết ở production) | Có | Không | Không | — | — | `BLOCKED` |
| Named pipe `PipeZCallRecv/Send` | Không | Có, AES | Có (key từ `zsecure`) | Không | — | — | `BLOCKED` |
| `ZaloCap.exe` | Không | Có | Có | Không | — | — | `BLOCKED` |
| `--launch-compact-app` | Có, nhưng chỉ chọn bundle first-party | — | — | Không | Không | Có | **Không phải integration surface** |
| DevTools (`devTools: true`) | Không (thủ công, không lập trình) | Có | Có | Không | — | — | `BLOCKED` (private IPC) |
| `app.asar` patching | — | — | — | **Có** | Có | — | `NO-GO` (ADR-001 giữ nguyên) |

---

## 7. Đường vào duy nhất còn mở: `zalo://`

### 7.1 Đăng ký (OS, `OBSERVED`)

```
HKCU:\Software\Classes\zalo                                    EXISTS
  (default)                = "URL:zalo"
  "URL Protocol"           = ""
  shell\open\command       = "C:\Users\huung\AppData\Local\Programs\Zalo\Zalo.exe" "--" "%1"
  DelegateExecute          = (không tồn tại)
```

Không có `DelegateExecute` → Windows sẽ **spawn tiến trình** thay vì gọi COM activator. Tiến trình thứ
hai không làm gì ngoài ghi `startup.log` (§2) → chính instance đang chạy nhận qua `second-instance`.

Ngoài ra: AUMID `com.vng.zalo` được set (`setAppUserModelId` ×3), shortcut Start Menu do app tự tạo
(`Zalo.lnk`, `Arguments` rỗng).

### 7.2 Đường vào trong main (`OBSERVED`)

```js
// main.js @3565789
let Pn = null;
app.on("second-instance", (e, t, n) => {
  if (!Pn) return;
  const r = Pn.getMainWindow();
  if (r) {
    if (process.platform === "win32")
      if (r.isVisible()) { /* setAlwaysOnTop(true/false) + focus */ }
      else { r.setOpacity(0); r.show(); /* khôi phục size/pos */ setTimeout(() => r.setOpacity(1), 100); }
    else r.show();
    Pn.receiveArguments(t);            // ← argv của instance thứ hai
  } else Pn.receiveArguments(t);
});
// …và export: Pn = module "j6F3"
e.exports = { getMainWindow: () => Ce, receiveArguments: e => { Hn(e) }, getCurrentPage: () => Fe, … }
```

→ **Cơ chế tự khôi phục cửa sổ có sẵn**: nếu Zalo đang minimized-to-tray (đúng trạng thái đo được ở
`r11a-os-surface.log`), một deep link sẽ `show()` + focus nó. Đây là hành vi **của chính Zalo**, không
phải ta điều khiển cửa sổ.

**Cold start cũng đi cùng một hàm** — `main.js` @2714883:

```js
process.argv[1] && Hn(process.argv);          // ngay đầu đường khởi động của main process
```

⇒ Kênh URI **không** phụ thuộc việc app đã chạy sẵn. Nó có hai đường vào (`second-instance` khi đã chạy,
`process.argv` khi chưa), và cả hai hội tụ tại `Hn`. Điều này làm PoC đơn giản hơn: không cần ép Zalo
đang chạy trước khi thử.

### 7.3 Parser và hai nhánh (`OBSERVED`)

```js
// main.js @2710764, function Hn(e)
const t = e.findIndex(e => "--" === e);
let n = -1 === t ? null : e[t + 1];            // lấy phần tử ngay sau "--"
if (typeof n === "string" && n.includes("zalo://")) {
  const m = n.match(/^zalo:?\/\/conversation\/?\?(phone|username|id)=\+?(.+)/);
  if (m && m.length === 3) {
    const data = m[1] === "phone" ? m[2].replace(/[^0-9]/g, "") : m[2];
    Fe === be && Ce
      ? Ce.webContents.send("z-uri-open-conv", { term: m[1], data })   // app đã login & đã load
      : (Qe = data, Ze = m[1]);                                          // xếp hàng
  }
}
const domains = [getCurrentApiDomain(), "zalo.me", "zaloapp.com"];
if (n && domains.some(d => n.startsWith(`zalo://${d}`)))
  return void (Fe === be && Ce ? Ce.webContents.send("z-uri-request", n) : (Ae = n));
```

Hai nhánh độc lập:
1. `zalo://conversation/?…` → **mở hội thoại** (dùng được ngay nếu đã login).
2. `zalo://zalo.me/…`, `zalo://zaloapp.com/…` → **đưa URL cho renderer xử lý như link thường** (rộng hơn, ít kiểm soát hơn).

**Có HAI hàng đợi tách biệt, không phải một** — tên biến **khác nhau giữa hai main bundle**:

| Hàng đợi | Biến trong `main.js` | `webContents.send` | Chỗ xả | Biến trong `compact-app.js` |
|---|---|---|---|---|
| hội thoại | `Qe` = data, `Ze` = term | `z-uri-open-conv` | IPC `checkStartupOpenConvReq` @2724854 | `Je` = data, `Ze` = term @2703739 |
| URL thường | `Ae` = URL | `z-uri-request` | IPC `.on("check-arg-link")` @2703712 | `Ce` |

Người gọi là **phía renderer**, và gọi **trần** (không qua `$zsub`):

```js
$zuri.checkOpenConvReq()   // descriptor type REQUEST  → invoke
$zuri.checkArgvLink()      // descriptor type RAW_SEND → send
```

Đo được 4 call site cho mỗi tên, **tất cả nằm trong ĐÚNG MỘT component chat-shell React**, lặp lại y hệt
trong 4 bundle (`reports/executed/r11a-find-zuri-callsites.log`, quét đủ 116 tệp `.js`):

| Bundle | `$zuri.checkOpenConvReq` | `$zuri.checkArgvLink` |
|---|---|---|
| `pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js` | @15499634 | @15501983 |
| `pc-dist/search-worker.f32c58b63b6f4273a8a4.js` | @15729390 | @15731739 |
| `pc-dist/sync-v2-sub-worker.f32c58b63b6f4273a8a4.js` | @15754446 | @15756795 |
| `pc-dist/lazy/default-login-main-startup-shared-worker-znotification.aafd08147de6e983b76f.js` | @13086649 | @13088998 |

> Chunk `…shared-worker-znotification.aafd0814…js` (17.2 MB) **không phải** chunk wiring
> `…aa2b4a7e…js` (40 KB) mà §3 và §7.6 nói tới — hai tệp khác nhau; đừng lẫn offset giữa chúng.

Nhận biết qua ngữ cảnh kế cận: `$zsub.$zscreencap.onSend2Me(…)` và cờ `this._isAlreadyCheckOpenConvRequest`.

> `$zuri.onCheckStartupOpenConvRequest` **không tồn tại** trong bất kỳ tệp nào của 116 tệp đã quét (`= 0`).
> Tài liệu này từng ghi tên đó; đã sửa.

Vì sao gọi trần thay vì qua `$zsub`: bảng descriptor của `$zuri` có **sáu** mục với **bốn** loại
(`SUBSCRIBE`, `UNSUBSCRIBE`, `REQUEST`, `RAW_SEND`) — nhưng registrar dựng `$zsub` chỉ hiện thực
`SUBSCRIBE`/`UNSUBSCRIBE`/`SUBSCRIBE_V2`. Xem §7.5 L1.

⇒ Link đến khi app còn ở màn login **không mất**: nó nằm trong `Qe`/`Ze` tới khi renderer gọi
`checkOpenConvReq()` sau khi đã login.

### 7.4 Renderer tiêu thụ (`OBSERVED`)

`pc-dist/lazy/default-login-startup-main-startup.ec73261654e4ce9540ac.js` — hai handler @18350 / @18423
(`n=(t,r)=>…`, `s=(t,{term,data})=>…`), đăng ký qua `$zsub.$zuri` @18922 / @18950:

```js
const onNewRequest = (t, r) => { const i = getFriendsSync(); doActionWithUri(r, e, i); };
const onOpenConv   = (t, { term: r, data: i }) => {
  switch (r) {
    case "id":       autoOpenConversationById(i, e);       /* + logAction 2220801/2/3 */ break;
    case "phone":    autoOpenConversationByPhone(i, e);    /* logAction 2220804 */ break;
    case "username": autoOpenConversationByUsername(i, e); /* logAction 2220805 */ break;
    default:         createError(str("STR_GROUP_NO_EXIST"));
  }
};
useEffect(() => { $zuri.onNewRequest(onNewRequest); $zuri.onRequestOpenConv(onOpenConv); /* cleanup */ }, [e]);
```

→ **Đích đến là một observable rõ ràng**: cửa sổ Zalo hiển thị đúng hội thoại đó.

### 7.5 Giới hạn của đường này (đo được, không phỏng đoán)

| # | Giới hạn | Bằng chứng | Hệ quả cho Companion |
|---|---|---|---|
| L1 | **Chỉ một chiều** — không có kênh đọc trạng thái trả về | Bảng descriptor của `$zuri` có 6 mục / 4 loại (`SUBSCRIBE`, `UNSUBSCRIBE`, `REQUEST`, `RAW_SEND`); registrar `Ke(name, target, table)` dựng `$zsub` chỉ hiện thực `SUBSCRIBE`/`UNSUBSCRIBE`/`SUBSCRIBE_V2` → `checkOpenConvReq` (REQUEST) và `checkArgvLink` (RAW_SEND) bị **bỏ im lặng**, đó là lý do renderer gọi chúng **trần**. Không mục nào trả về trạng thái | UI Apple Glass **không biết** Zalo đang mở hội thoại nào |
| L2 | Cần **đã login** (`Fe === be`, tức đang ở page MAIN) mới mở ngay, nếu không thì xếp hàng | @2711202 (nhánh `Fe===be&&Ce?…send:…Qe=e,Ze=t[1]`) | Không dùng để lái màn login |
| L3 | **Compact app không TIÊU THỤ kênh này**, dù có GỌI nó | (a) `z-uri-open-conv`, `z-uri-request`, `check-arg-link`, `onRequestOpenConv`, `onNewRequest` = **0** trong `compact-app-pc…js`; (b) `aa2b4a7e` = **0** — chunk đăng ký `globalThis.$zsub`/`Ke("$zuri",…)` **không được nạp**; (c) `"globalThis.$zsub"` = **0**; (d) `compact-app.js` `second-instance` = **0**. Trong khi đó `chatController` = **290**, `$zsub.` = **137** — chat shell **có trong bundle nhưng không được mount** (§7.7) | Companion **không** lái được chế độ compact qua URI: bundle compact gọi `$zuri.checkOpenConvReq()` nhưng không có `$zuri` được dựng và không có listener nào |
| L4 | **Không có toast activator** cho Zalo PC | Không có `com.vng.zalo` dưới `AppUserModelId` (HKCU lẫn HKLM); chỉ có `Microsoft.YourPhone_…!YourPhoneNotifications_vn.com.vng.zingalo` — đó là Phone Link phản chiếu app **mobile**, không phải Zalo PC | Không đọc được notification qua Windows toast platform |
| L5 | **UIA hiện rỗng** — mọi cửa sổ `VIS=False`, `DESCENDANTS=0`, `MainWindowHandle=0` | `r11a-os-surface.log`; app minimized to tray | PoC **phải khôi phục cửa sổ trước**; muốn UIA phải đo lại sau khi show |
| L6 | `setAccessibilitySupportEnabled` = 0 và không có `--force-renderer-accessibility` | hosting sweep | Cây accessibility do heuristic của OS quyết định — có thể không đầy đủ |
| L7 | Stub `Zalo.exe` (790 KB) là thứ OS spawn và **chuyển argv xuống binary versioned**. *Cơ chế* đã `OBSERVED` (§7.6); *việc argv có tới renderer đúng hay không* vẫn phải PoC kiểm chứng | §1.1, §7.6 | Việc chuyển launch: **`OBSERVED`**. Việc chuyển **argv**: **`INFERRED`** |
| L8 | Grammar chỉ nhận `phone|username|id`, `phone` bị lọc còn chữ số | @2710764 | Không mở được group/file/call qua đường này |

### 7.6 Stub `Zalo.exe` — danh tính và việc chuyển launch (`OBSERVED`)

Trước đây tài liệu này gọi stub là "Squirrel". **Sai.** Kiểm lại byte và log thì ra một launcher
do VNG tự viết:

| Bằng chứng | Giá trị |
|---|---|
| Chuỗi PDB | `D:\workspace\StubExecutableZalo\bin\Release\Zalo.pdb` |
| Chuỗi tiếng Anh trong stub | `found app directory `, `directory is empty`, `Zalo.exe not found`, `app.asar not found`, `\\ZaloData\\log.log`, `[native] ` |
| Import (REA `inspect_pe_imports`) | `CreateProcessW`, `CommandLineToArgvW`, `GetCommandLineW`, `FindFirstFileW`/`FindNextFileW`, `ShellExecuteW`, `CreateMutexW`/`OpenMutexW`, `WaitForInputIdle`, `AllowSetForegroundWindow` |
| Chữ ký Authenticode (REA `inspect_pe_certificates`) | `CN=VNG GROUP JSC`, `OID.2.5.4.5=0303490096`, DigiCert Trusted G4 Code Signing RSA4096 SHA384 2021 CA1, hiệu lực `260304000000Z`–`261209235959Z` |
| Chuỗi `Squirrel`, `Update.exe`, `--processStart` | **0** trên cả ASCII lẫn UTF-16LE (1,851 + 1,469 chuỗi) |

⇒ Stub là **launcher của VNG**, không phải Squirrel/electron-updater.

**Việc chuyển launch — đo được từ log thay vì suy đoán.** Stub ghi mỗi lần chạy một dòng vào
`%APPDATA%\ZaloData\log.log`; app ghi mỗi lần khởi động vào `%APPDATA%\ZaloData\startup.log`, với
**hai dạng phân biệt được**:

```
main.js  @2715144   appendFileSync(…, `${(new Date).toLocaleString()} start up\n`)   → main process mới
second-instance.js  appendFileSync(…, `${new Date().toLocaleString()}\n`)            → instance thứ hai, thoát ngay
```

Đối chiếu hai log (`tools/r11a-stub-correlate.cjs`, chỉ đọc timestamp + số hiệu phiên bản):

| Cửa sổ khớp | `second-instance` (bare) | `main` (`start up`) |
|---|---|---|
| ±1 giây | **262 / 276** | 41 / 380 |
| ±3 giây | **274 / 276** | 238 / 380 |
| ±10 giây | **276 / 276** | 336 / 380 |

- **276/276** lần "instance thứ hai" đều có một lần stub chạy trong ±10 giây, và **không lần nào** lẻ loi.
- Stub ghi **cả ba** thư mục phiên bản có mặt (26.10.11, 26.10.20, 26.9.10) rồi mới chọn; danh sách
  qua 29 phiên bản từ 25.4.2 → 26.10.20, tức đây là cơ chế cập nhật/khởi động chạy đều đặn hơn một năm.

⇒ **`OBSERVED`**: stub khởi chạy binary versioned. Cơ chế `GetCommandLineW` + `CommandLineToArgvW` +
`CreateProcessW` trong import table là đường nó dùng để chuyển chuỗi lệnh. Nhưng **argv có thực sự
tới renderer hay không** thì chưa đo — đó chính là điều AC1–AC2 của PoC kiểm.

### 7.7 Chế độ compact là gì, và vì sao nó không tiêu thụ kênh URI

Chế độ compact **không phải một tính năng UI**, mà là **đường thoát khi thư mục dữ liệu không truy cập được**:

```js
// main.js @3566533 — ngay đầu khối khởi động main
if (PermissionServiceFactory.getInstance().isDriveBlockedAndStartCompactApp()) return;

// @1503927 — PermissionService#isDriveBlockedAndStartCompactApp
isDriveBlockedAndStartCompactApp() {
  try {
    return this.canAccessToMediaAndMessageDir()
      ? (this.logger.zsymb(0, "xtmGMy", "Drive has full permission, can start app"), false)
      : (n("DmL7").default.launchCompactApp({ InaccessibleDrive: {} },
          { window: { width: 458, height: 284, resizable: !1, frame: !1 }, title: "Zalo" }), true);
  } catch (t) { return false; }
}
canAccessToMediaAndMessageDir() {
  const e = WindowsDrivePathManager.getResourceDrive().path;
  return !!e.startsWith(WindowsDrivePathManager.getDefaultDrive().path);
}
```

`launchCompactApp` → `appQuitFlow.relaunch` với `--launch-compact-app` + `--app-version=<hash>`. Nhận diện
ở lần chạy sau **chỉ bằng argv** — `main.js` @904015:
`isCompactApp(){return process.argv.some(e=>e.startsWith(i.LAUNCH_COMPACT_APP_ARG))}`.
Đo được:

| Sự kiện | `compact-app.js` |
|---|---|
| `isDriveBlockedAndStartCompactApp` | **0** — compact không tự kích hoạt lại |
| `second-instance` | **0** — launch `zalo://` lần hai lúc compact đang chạy **không** được chuyển tiếp |
| `launchCompactApp(` | 2 (định nghĩa @941546 + wrapper @2020730), **0 call site production** |

**Component gốc của compact renderer chỉ render đúng BA trạng thái** (`compact-app-pc…js` @1309090, `wt`):

```js
wt = () => { const [e, t] = useState([]);
  useEffect(() => { /* window.$app.loadModules() → setState(Object.keys(...)) */ }, []);
  return createElement("div", { className: "compact-app-container" },
    e.includes(dt.a.InaccessibleDrive) ? createElement(St, null)     // màn ổ đĩa không truy cập được
  : e.includes(dt.a.UserDataMigration) ? createElement(ct, null)     // màn migration
  : createElement("div", null, createElement("h1", null, "Zalo Compact Application"),
                               createElement("p", null, "Task is starting..."))); };
```

`St` = `inaccessible-drive-app-container` @1308061 (`STR_INACCESSIBLE_DRIVE_CREATE_NEW_DATA` /
`_RESTART`, `handleOnAppShow()`); `ct` @1304243 = `migrate-compact-app-container`. Mount:
`class extends <App> { constructor(){ super("compact-app", e, t, { component: wt, container: document.getElementById("app") }) } }`
(`createRoot` = 0, `ReactDOM.render` = 0 — dùng `getElementById("app")` ×4).

⇒ Bộ khung chat **nằm trong bundle** (`chatController` = 290, `$zsub.` = 137) nhưng **không bao giờ mount**;
`$zuri` cũng không tồn tại vì chunk `aa2b4a7e` không được nạp. Vì thế 137 lần đọc `$zsub` là **code chết
trong tình huống đo** — kết luận **`INFERRED`** (suy ra từ biên render, không từ chạy thật).

---

## 8. Named pipe `ZaloCall` — vì sao `BLOCKED`

```js
// main.js @311443 (module "3Zc2", logger "call-v2")
const g = "win32" === process.platform;
const y = g ? "\\\\.\\pipe\\PipeZCallSend" : "/tmp/socketzalosend2021";   // main → native
const v = g ? "\\\\.\\pipe\\PipeZCallRecv" : "/tmp/socketzalorecv2021";   // native → main
const R = zsecureSecrets().getCallV2TransportAesKey();
…
I = r.createServer(e => { e.on("data", e => Y(e)); … }); I.listen(v, …);   // nhận
A = r.createServer(e => { e.on("data", t => W(e)); … }); A.listen(y, …);   // gửi
const Y = e => { for (const r of e.toString().split(/\$/gm)) {
  if (!r) continue; try { z(JSON.parse(m(r, R).replace(/[\0]/g, ""))) } catch { /* cannot parse */ } } };
```

Chuỗi bí mật đến từ `bhjE` → `handleSource: "zsecure"` → `getCallV2TransportAesKey: () => o.callV2TransportAesKey`
với `o` lấy từ module `5NUA` (`ZPC_SECRET_VALUES`).

**Đánh giá:**

| Tiêu chí | Kết quả |
|---|---|
| Công khai/được hỗ trợ | **Không** — tên pipe không tài liệu hoá, protocol là JSON nội bộ |
| Private/unstable | **Private**, đổi theo phiên bản, không versioned |
| Cần bí mật phiên | **Có** — AES key nhúng trong app |
| Cần sửa binary | Không, nhưng cần **trích secret** khỏi bundle |
| Quyền phân phối | Chồng lấn Terms 4.4/4.5 |

→ Dùng nó là **trích xuất khoá mã hoá** + **gọi endpoint nội bộ chưa được cấp quyền** — vi phạm trực tiếp
plan §2.4 #5 và #6 và §2.3. **`BLOCKED`, không phải "khó".**

Điều này **bổ sung** (không sửa) R11 §8.3, vốn kết luận "không có local socket nào để đi nhờ". Kết luận
đó đúng *cho mục đích đi nhờ*; nhưng **pipe có tồn tại** — xem annotation ở
[`R11_AUTHORIZED_BACKEND_INTEGRATION.md`](R11_AUTHORIZED_BACKEND_INTEGRATION.md) §8.3.

---

## 9. Điều R11A **không** chứng minh

### 9.1 Không chạy gì
Không launch, không attach, không inject, không đọc profile/DB/credential. Mọi kết luận hành vi là
**static code path**, chưa phải hành vi runtime đã quan sát.

**Ngoại lệ đã dùng:** R11A *đọc* hai tệp log do chính Zalo ghi (`ZaloData\log.log`,
`ZaloData\startup.log`) và chỉ trích **timestamp + số hiệu phiên bản**. Đây là chứng cứ runtime do app
tự sinh ra, không phải ta chạy thử — nên nó nâng bước 5 của §7.6 lên `OBSERVED` mà **không** vi phạm
ràng buộc "không chạy gì". Không dòng nội dung tin nhắn, tài khoản hay dữ liệu cá nhân nào được đọc
hoặc ghi vào báo cáo.

### 9.2 Đọc code ≠ quan sát hành vi
Đường `zalo://` được dựng từ code + registry. Chưa có lần chạy nào chứng minh cửa sổ Zalo thật sự mở
đúng hội thoại. Đó **chính xác** là việc của R11B và **không được** ghi `PASS` trước khi chạy.

### 9.3 Phạm vi quét
- Đã: 116/116 `.js` trong `app.asar`.
- **Chưa:** binary native (`ZaloCall.exe`, `ZaloCap.exe`, `.node`), resource không phải JS, và mọi thứ
  Zalo tải về sau khi chạy.
- Vì vậy mọi câu "không có X" ở đây chỉ đúng trong phạm vi "JavaScript đóng gói trong app.asar".

### 9.4 Đa màn hình / DPI
Renderer chạy `--device-scale-factor=2`. Các hạng mục multi-monitor/IME/DPI của R12 **vẫn `NOT_RUN`**.

### 9.5 Phiên bản
Toàn bộ kết luận gắn với **26.10.20.3253**. Zalo tự update; mọi offset ở đây sẽ trôi.

---

## 10. Danh mục bằng chứng đã tạo trong R11A

| Tệp | Nội dung |
|---|---|
| `reports/executed/r11a-artifact-identity.json` | 9 artifact + SHA-256 |
| `reports/executed/r11a-os-surface.log` | pipe, registry `zalo://`, process tree, UIA, shortcut |
| `reports/executed/r11a-boundary-probe.log` | đếm lexical theo 6 nhóm symbol |
| `reports/executed/r11a-hosting-surface.log` | quét hosting surface, 116 tệp |
| `reports/executed/r11a-host-surface-sweep.log` | quét server/pipe/socket, 116 tệp |
| `reports/executed/r11a-create-server-context.log` | mở từng hit `createServer` và phân loại |
| `tools/r11a-runtime-probe.cjs` | probe lexical theo nhóm |
| `tools/r11a-load-targets.cjs` | `loadURL`/`loadFile`/`index.html` |
| `tools/r11a-host-surface-sweep.cjs` | sweep server/pipe (mới) |
| `reports/executed/r11a-exec-js-probe.log` | `executeJavaScript`/`insertCSS`, 116 tệp, đều 0 |
| `reports/executed/r11a-verify-pass.log` | kiểm lại registry, AUMID, named pipe, kênh URI trong bundle |
| `tools/r11a-create-server-context.cjs` | bối cảnh từng `createServer` trên 8 bundle (25/25 hit) |
| `tools/r11a-exec-js-probe.cjs` | probe code-execution / style-injection |
| `reports/executed/r11a-stub-ascii.log` | toàn bộ chuỗi ASCII ≥ 8 ký tự trong stub (1,851 → 707 dòng) |
| `reports/executed/r11a-stub-strings.log` | đối chiếu `Squirrel`/`Update.exe`/`--processStart` → **0** |
| `reports/executed/r11a-stub-correlate.log` | đối chiếu `log.log` (stub) ↔ `startup.log` (app) → **276/276** |
| `reports/executed/r11a-sl-ascii.log` | chuỗi `sl.exe` — shim `singleinstance`, không thuộc đường URI |
| `tools/r11a-stub-dump.cjs` | dump chuỗi ASCII có lọc |
| `tools/r11a-stub-strings.cjs` | đếm chuỗi UTF-16LE/ASCII theo từ khoá |
| `tools/r11a-stub-correlate.cjs` | tương quan timestamp hai log (chỉ đọc thời điểm + số phiên bản) |
| `tools/r11a-context.cjs` | dump bối cảnh quanh một literal trong tệp bất kỳ |
| `reports/executed/r11a-verify-citations.log` | **76/76 PASS** — mỗi offset/định danh được trích trong báo cáo này, gồm cả khối exact-offset (cùng tên `Hn`/`launchCompactApp` bị lodash/moment dùng lại nên phải so khớp đúng vị trí) |
| `reports/executed/r11a-audit-report-offsets.log` | quét **mọi** `@<số>` trong hai báo cáo, in 64 byte thật tại offset đó ở từng bundle — lưới an toàn cho offset không được assert |
| `reports/executed/r11a-check-extra-offsets.log` | soi 17 offset còn lại (webPreferences, `launchCompactApp` ×2, `$inaccessibleDrive`/`$migration`, …): ngữ cảnh trước/sau + so sánh chéo bundle |
| `reports/executed/r11a-find-zuri-callsites.log` | `$zuri.checkOpenConvReq` / `$zuri.checkArgvLink`: **4 + 4** call site trên 116 tệp, kèm offset từng bản |
| `reports/executed/r11a-counts.log` | đếm + liệt kê **mọi** offset của `Hn`, `launchCompactApp(`, … trong `main.js` và `compact-app.js` (để không trích nhầm biến trùng tên của lodash/moment) |
| `reports/executed/r11a-zuri-types.log` | `$zsub`/`Ke(...)`/kiểu descriptor trong chunk `aa2b4a7e`; mọi lời gọi `$zuri.<member>` trên 71 tệp |
| `reports/executed/r11a-zuri-sites.log` | bản đồ `html → script` của `pc-dist`; 8 call site `$zuri.check*` và component chứa chúng |
| `reports/executed/r11a-compact-boot.log` | bootstrap của renderer compact; `InaccessibleDrive`/`Migration`/`createRoot` |
| `reports/executed/r11a-compact-components.cjs` / `.log` | định nghĩa `St`/`ct`/`wt`; đếm `chatController`, `$zscreencap`, … trong bundle compact |
| `reports/executed/r11a-compact-mount.log` | cơ chế mount `wt` (`getElementById("app")`, `getElementById("root")` = 0, `createRoot` = 0) |
| `reports/executed/r11a-preload-globals-compact.log` | 9 lời gọi `exposeInMainWorld` trong `compact-app-preload.js` (8 literal + 1 helper generic) |
| `reports/executed/r11a-preload-entrypoints.log` | `$inaccessibleDrive` @72851, `$migration` @1164302 qua `POOw.a(name, table)` |
| `reports/executed/r11a-ctx-registerentrypoint.log` | 5 chỗ `registerEntryPoint()` trong compact preload |
| `reports/executed/r11a-ctx-preload-loadmodules.log` | `$app.loadModules` = `resolve(BootManager).getExtraArguments()` — đọc `--appVersion`, không phải IPC |
| `reports/executed/r11a-ctx-preload-bootmanager.log` | preload tự dựng `BootManager` từ `--appVersion` + file trạng thái phiên bản |
| `reports/executed/r11a-ctx-f4op.log` | module `f4Op`: parser `--key[=value]` có allowlist `["appVersion"]` |
| `reports/executed/r11a-ctx-compact-tasks.log` | `InaccessibleDrive`/`UserDataMigration`/`MoveDb` trong `compact-app.js` |
| `reports/executed/r11a-ctx-compact-l3.log` | 0 kênh URI + 0 `$zsub` trong bundle compact; `chatController` 290, `$zsub.` 137 |
| `reports/executed/r11a-ctx-compact-webprefs.log` | `webPreferences` của cửa sổ compact + `additionalArguments` |
| `reports/executed/r11a-ctx-drivegate-compact.log` | `isDriveBlockedAndStartCompactApp` = 0 trong `compact-app.js` |
| `reports/executed/r11a-all-html.log` | `<script src>` của **mọi** `.html` trong `pc-dist` (9 tệp) |
| `reports/executed/r11a-html-scripts.log` | script của hai entry chính (`index.html`, `compact-app.html`) |
| `tools/r11a-all-html.cjs`, `r11a-html-scripts.cjs` | hai mức quét html→script |
| `tools/r11a-verify-citations.cjs` | kiểm từng offset/định danh sắp trích (PASS/FAIL) |
| `tools/r11a-counts.cjs`, `r11a-count.cjs`, `r11a-count2.cjs`, `r11a-find.cjs` | đếm/liệt kê offset; `r11a-find` thêm `--ctx <off> <pad>` |
| `tools/r11a-zuri-types.cjs`, `r11a-zuri-sites.cjs` | bề mặt `$zuri`/`$zsub` và bản đồ html→script |
| `tools/r11a-compact-boot.cjs`, `r11a-compact-components.cjs`, `r11a-compact-mount.cjs` | bootstrap/render component/mount của chế độ compact |
| `tools/r11a-preload-globals.cjs` | liệt kê mọi `exposeInMainWorld` kể cả tên biến |

`executeJavaScript` / `insertCSS` có log riêng (`reports/executed/r11a-exec-js-probe.log`, 116 tệp):

```
executeJavaScript                 0     insertCSS                    0
executeJavaScriptInIsolatedWorld  0     removeInsertedCSS            0
webContents.executeJavaScript     0     injectCSS                    0
```

Cả hai bộ đếm nằm trên cùng một lần quét 116/116 tệp; mọi số 0 trong §4 đều có log trỏ tới.
