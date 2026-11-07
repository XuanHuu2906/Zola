# R5 — Integration Feasibility (Apple Glass UI trên Zalo PC)

**Trạng thái:** HOÀN THÀNH (evidence-only). **Kết luận: NO-GO cho P3 — không đổi, nhưng lý do đã đổi.**
**Ngày:** 2026-11-05 (cập nhật 2026-11-06) · **Công cụ RE duy nhất:** REA (không dùng ZaDark, không dùng RE tool khác)
**Đối tượng:** Zalo PC `26.10.20.3253` (VNG GROUP JSC) · `app.asar` 177.728.582 B
`SHA-256 d83256230e5d1d4483c2411f71936c3dc1562fb8a885fd8752cab17d229201e6`
Electron nội bộ 22.3.9 · Chromium 108.0.5359.215

> Báo cáo này **không** thực thi Zalo, **không** sửa `Zalo.exe`/`app.asar`, **không** inject, **không**
> đọc dữ liệu tài khoản. Mọi kết luận dưới đây là **đọc tĩnh byte do REA trích xuất**. Không có
> tuyên bố tương thích runtime nào.

---

## 1. Câu hỏi của R5

R4 đã chứng minh **thiết kế** Glass là hoàn chỉnh (297 dòng, test suite 12 block PASS). R5 phải trả lời
đúng một câu: **có tồn tại một phương thức tích hợp ĐƯỢC PHÉP để đưa R4 lên Zalo PC thật hay không?**
Và nếu có, giới hạn của phương thức đó là gì, rủi ro tới login/messaging/file-send/calling/sync ra sao.

Ba ứng viên do đề bài nêu: **CSS-only**, **React-component-change**, **Electron-window-config**.
Ba ứng viên đã bị loại từ ADR-001 vẫn giữ nguyên trạng thái loại: patch/injection (bị cấm), built-in
preferences của Zalo (không mang CSS), Zalo Web (không phải bản desktop, ngoài phạm vi).

---

## 2. Kết luận trước, chứng cứ sau

| Route | Kết luận | Lý do cấp 1 (cấu trúc) | Lý do cấp 2 (cơ chế) |
|---|---|---|---|
| **CSS-only** | **NO-GO** | R3 §11: **0/11 surface** đạt glass bằng CSS; 9 surface cần "vô hiệu hoá fill đục" mà **không token nào retint được sang giá trị bán trong suốt** khi vẫn giữ hợp đồng light/dark | **Có** một sink `<style>` nhưng **đóng & chỉ màu**: `#app-custom-theme`, selector `:root .custom`, sinh bởi `euSg` — trần **198 token**, mọi giá trị qua tinycolor. Không có kênh stylesheet tổng quát (`insertCSS`/`executeJavaScript`/`addStyleSheet`/`adoptedStyleSheets` = **0**). |
| **React-component-change** | **NO-GO (BLOCKED)** | R3 §13.3: tên component **BLOCKED** — mọi module là `FunctionExpression` ẩn danh, `sourcemaps/` rỗng | Không có hook cho bên thứ ba: 41 bridge đóng băng, `$zFileManager.trustPathFromBlob: void 0`, không extension host, `will-attach-webview` = 0 |
| **Electron-window-config** | **NO-GO** | Không có gì để bật: `setBackgroundMaterial`/`backgroundMaterial`/`vibrancy`/`visualEffectState`/`titleBarOverlay`/`nativeTheme`/`themeSource` = **0** ở mọi bundle | Đòn bẩy window duy nhất Zalo tự dùng: `app_theme.color.backgroundPrimary → setBackgroundColor()` — một **màu đơn**, không mang CSS |

**Điểm mấu chốt (mạnh hơn ADR-001):** ADR-001 coi patch/injection là route *kỹ thuật khả thi nhưng bị
cấm*. Census R5 cho thấy mạnh hơn: **CSP không phải rào cản** (`style-src 'self' 'unsafe-inline' …
blob:` sẽ chấp nhận một stylesheet glass), và **có một sink `<style>` thật** — nhưng sink đó **do Zalo
sở hữu, đóng, chỉ ghi token màu, và chỉ được ghi từ bên trong Zalo**.

> **Đính chính so với bản 2026-11-05.** Bản đầu của báo cáo này khẳng định "không có API nào được Zalo
> gọi để tiếp nhận stylesheet" và "Route A không tồn tại, không phải bị cấm". **Cả hai đều SAI.** Census
> 25–27 tìm ra `<style id="app-custom-theme">` với selector `:root .custom`, được ghi bằng `innerHTML`
> từ module `euSg`. Route A **tồn tại về mặt cơ chế**, nhưng bị chặn bởi **kiểu dữ liệu và quyền sở
> hữu**, không phải bởi "không có cửa". Đây vẫn là NO-GO — với lý do chính xác hơn và khó lách hơn.

---

## 3. Nền chứng cứ

Toàn bộ đến từ extraction root do REA tạo (`containment_verified: true`):

| File | Nội dung |
|---|---|
| `reports/_r5_census.cjs` / `.txt` | Kích thước 13 bundle; bảng đếm 6 nhóm surface; CSP verbatim của `pc-dist/index.html`; 41 tên `exposeInMainWorld`; `trustPathFromBlob` verbatim |
| `reports/_r5_census2.cjs` / `.txt` | `loadExtension` verbatim (→ vendored `electron-devtools-installer@3.1.1`); 5 site `titleBarStyle`; 7 site `webPreferences`; bảng đếm delivery-surface; từ vựng customization |
| `reports/_r5_census3.cjs` / `.txt` | `setupCSPMonitor` verbatim; header-cache `webRequest` verbatim; đếm từ vựng preload; `index.html` style/script |
| `reports/_r5_census4.cjs` / `.txt` | Chứng minh `insertRule`/`deleteRule`/`setProperty` ở preload là **Sentry rrweb recorder** (`new Proxy(r,{apply:…})`) — chỉ quan sát |
| `reports/_r5_census5.cjs` / `.txt` | Toàn bộ **0** cho chrome/material/theme-source/devtools-switch; `transparent:!0`=1; `setOpacity`=14 (đều là fade animation) |
| `reports/_r5_census6.cjs` / `.txt` | `--inspect=9230` định nghĩa đúng 1 lần, **không bao giờ append**; `bootstrap.js` verbatim; `package.json` gốc; compact-app.js toàn 0 |
| `reports/_r5_census7.cjs` / `.txt` | Inventory `native/`; đếm surface main.js vs preload; `setupCSPMonitor` + module `yyar` (LRU 50) verbatim |
| `reports/_r5_census8–14.cjs` / `.txt` | Các lượt census trung gian: inventory `lazy/` (72 js), đếm từ vựng IPC, xác định `render.*.js` là bootstrap |
| `reports/_r5_census15.cjs` / `.txt` | Đồ thị script `index.html`; bootstrap `render.*.js`; chuỗi eager-load chunk 0,4,11,16,41,1,3,9,7,14,15,30 → chunk 1 = `lazy/default-login-main-startup-shared-worker-znotification.*.js` (17.220.737 B) |
| `reports/_r5_census19.cjs` / `.txt` | Bản đồ export của `euSg` trên **4 bundle**: `{b→l, e→d, d→A, c→h, i→m, a→sink, g→scrubber, j→metaTheme, h→historyRing, f→historyRead}`; trong chunk 1 `a→g`, `g→p` |
| `reports/_r5_census20.cjs` / `.txt` | `dt.g` (scrubber) có **0** use trong module tĩnh `iKSP` — *không* chứng minh dead code (xem census 21) |
| `reports/_r5_census21.cjs` / `.txt` | Quét 72 file js: consumer thứ **5** của `euSg` = `lazy/64.5b054957a1310ace92d2.js` — nạp động qua `n.e(64)`, **không** phải static import |
| `reports/_r5_census22.cjs` / `.txt` | `TmDO` (56.459 B): 19 export; `TOKEN_MAP`, `MAIN_COLOR_TOKEN`, `CORE_TOKEN_COLORS`; **376** literal `token_name` |
| `reports/_r5_census23.cjs` / `.txt` | `TOKEN_MAP` = **353 record** (chỉ `light:`, **không** có mảng `dark:`); `MAIN_COLOR_TOKEN = ["N","NG","DN","B","R"]`; generator `A()` phát được **198** token |
| `reports/_r5_census24.cjs` / `.txt` | Shape của setting CUSTOM đã lưu: **11 key có kiểu**, **không có trường CSS** |
| `reports/_r5_census25.cjs` / `.txt` | Storage key `za_theme` (`themeConfStorageKey`) và hook `themeSettingOpt`; đường đọc setting lúc boot |
| `reports/_r5_census26.cjs` / `.txt` | `_saveSetting` verbatim; `applyTheme` = **0** site; `get-theme-conf` = **0** site trong renderer |
| `reports/_r5_census27.cjs` / `.txt` | `contentCss` = 5 site, **persist=false ở cả 5**; `.custom` trong CSS tĩnh = **48 rule**, **0** custom-property declaration |
| `reports/_r5_census28.cjs` / `.txt` | Quét **116** file js: `readFile*` với tham số CSS = **0**; chỉ **2** literal `.css` = webpack chunk-CSS loader trỏ `f.p` (thư mục package) |
| `reports/_r5_census29.cjs` / `.txt` | Đếm lại inventory CSS ship: 8 file, **876** custom property; 266 khớp `--UPPER##`, 610 còn lại |
| `reports/_r5_census30.cjs` / `.txt` | Đối chiếu trần với CSS ship: **198** emittable, **197** có trong CSS, **1** thiếu (`--white-quote-selected-alpha`); **48** rule `.custom` chứa **31** tham chiếu `var()` |
| `reports/lazy/64.5b054957a1310ace92d2.js` (678 B) | **Anti-ZaDark scrubber** — verbatim §4.4 |
| `reports/lazy/63.7f0a6ae57e25540d0908.js` (427 B) | Component CUSTOM-only: `body.classList.add(THEME.CUSTOM)` |

Bổ sung (probe `node -e` trong phiên): `isDev()` = `const d=!1` (ZQzv @2218751); `LocalConfigs` (tG6E)
là key/value store chỉ đăng ký `lastBounds.photoViewer`; `RbSv` (theme IPC contract ở preload) có đúng
**1** site require (@765046); `backgroundPrimary` = **0** hit trong `preload-render.js`.

---

## 4. Route A — CSS-only

### 4.1 Rào cấu trúc (từ R3)

R3 §11 kết luận **"0 of 11 surfaces are CSS-only for a glass appearance."** Tóm tắt 11 dòng:

| Surface | CSS-only? | Chặn bởi |
|---|---|---|
| Page shell | **NO** | Không có nền để sample; stack `position:fixed`; z 2/5/6 |
| Sidebar | PARTIAL | Icon active là **JS prop swap** `_Filled`↔`_Line` (MEDIUM) |
| Conversation list | PARTIAL | `contain:size style` mỗi row; **2 impl row song song** (HIGH) |
| Chat header | YES (geometry) / **NO (glass)** | `#header` có **0 CSS rule** (LOW–MED) |
| Message row | **NO** | — |
| Bubble | **NO** | Fill đục `--white-message`/`--blue-message` + `--shadow-bubble` + **4** `contain` (HIGH) |
| Date divider | **đã là glass** | 2/7 `backdrop-filter` áp vào date pill (R3 §10 correction) |
| Composer | PARTIAL | 3 lớp `--layer-background` xếp chồng; `contain:style size`; cao cố định 177.75px |
| Context menu | PARTIAL | Fill đôi; base `opacity:0`; `z-index:9999` |
| Modal | PARTIAL | `will-change:transform` + `contain:layout` (HIGH) |
| Settings | PARTIAL | `height:515px` cố định; `--divider-bold` bị loại |

### 4.2 Trần retint (từ R2)

R2 §5: `magic` = **197/420 = 46.9 %**; `excluded-by-filter` = **61 = 14.5 %** — toàn bộ `--border*` (22)
+ `--divider*` (4) + `--accent-*-border*` (33) + `--input-field-bg*`. R2 §4.6: không phần CSS nào của
Zalo có thể "bật lên" thành glass — `backdrop-filter` trên surface lõi **0**, fill bán trong suốt **0**
trên cả 9 surface, noise/grain **0**, `color-mix`/`oklch` chưa quan sát.

→ Hai lần chặn độc lập: **cấu trúc** (kính cần một layer composited, Zalo xếp 3 lớp đục — R3 §12.1)
và **ngân sách token** (61 token không thể chạm từ ngoài qua generator).

### 4.3 Rào cơ chế (census R5)

| Hàm | main.js | compact-app.js | preload-render.js | compact-app-preload.js | preload-noti.js | preload-shared-worker.js |
|---|---|---|---|---|---|---|
| `insertCSS` | 0 | 0 | 0 | 0 | 0 | 0 |
| `executeJavaScript` | 0 | 0 | 0 | 0 | 0 | 0 |
| `addStyleSheet` | 0 | 0 | 0 | 0 | 0 | 0 |
| `adoptedStyleSheets` | — | — | 0 | — | — | — |

Từ vựng customization: `custom.css` = `customCss` = `userstyles` = `userscript` = `userChrome` =
`theme.json` = `customTheme` = **0**. (`style.css` = 1, là tham chiếu nội bộ không phải hook.)

### 4.4 Nhưng CÓ một sink `<style>` — và nó đóng (census 25–27)

Census đầu chỉ đếm tên hàm. Census sau đi theo **đường dữ liệu** và tìm ra một sink thật:

```js
// euSg — generator, chỉ phát cặp "--token: value"
A = (e) => { let o = "", r = ""; … r += "--layer-background-navbar-hover: rgba(0,0,0,0.15);\n" …
            return { tokenUpdate: o, contentCss: r } }
// writer (export a)
… document.getElementById("app-custom-theme") || (t = document.createElement("style"),
   t.id = "app-custom-theme", t.innerHTML = `:root .custom { ${css} }`,
   document.head.appendChild(t))
```

Sink này **thật**, ở **4 bundle**, và **reachable** từ `index.html` (chunk 1 nằm trên đường boot; `HuPi`
nạp lazy chunk 63/64). Nó chứng minh **CSP không chặn** — nhưng nó không mở ra route nào, vì **năm lớp
khoá độc lập**:

**(1) Payload là token, không phải CSS tự do.** Mọi thứ đi vào `innerHTML` đều có dạng
`--tên-token: giá-trị;`. Không có selector do người dùng, không có `@media`, không có `backdrop-filter`,
không có `border-radius` — generator chỉ nối chuỗi thuộc tính tuỳ biến.

**(2) Mọi giá trị đi qua tinycolor.** Màu vào → `isDark()` → `toRgb()` → `setAlpha(n)` → `triad()` →
`toRgbString()`. Đầu ra luôn là một màu hợp lệ. Kích thước đi qua bảng rem cố định
`[12,13,14,15,16,18,24,32]`. Không có đường nào để một chuỗi tuỳ ý tới CSS.

**(3) Setting đã lưu không có trường văn bản nào.** `_saveSetting` verbatim:

```js
_saveSetting(e,t){e&&(t&&g.b.emit(r.THEME_LISTENER_EVENTS.SETTING_UPDATED,e),
  window.localStorage.setItem(r.themeConfStorageKey,JSON.stringify(e)),
  o.default.isWeb()||$zconfig.updateThemeConfig(e).then())}
```

Setting CUSTOM có **11 key có kiểu** — `isGradient, isMaskSidebar, isOnlyMainBar, isSingleColor,
isFollowDarkSystemToken, isDark, fontSize, background, navigation, highlight, color` — tất cả là boolean /
number / **màu**, không có `contentCss`. Census 27 xác nhận `contentCss` xuất hiện **5** lần và
**không lần nào được persist** (`localStorage.setItem` / `_saveSetting` / `$zconfig` = 0). `applyTheme`
= **0** site. `get-theme-conf` = **0** site trong renderer. Không có đường ghi lại CSS khi khởi động.

**(4) Trần token và trần selector.** Generator phát được **198** token (`alias ∈ MAIN_COLOR_TOKEN ∧
token_name ∉ {input-field-bg, border, divider}`); **197** trong số đó có thật trong CSS ship
(chỉ `--white-quote-selected-alpha` thiếu) — tái lập độc lập con số **197/420 = 46,9 %** của R2.
Trên tổng **876** custom property đã ship (census 29: 8 file CSS; **266** khớp mẫu palette thô
`--UPPER##`, **610** còn lại), trần là **197/876 = 22,5 %**. Lưu ý R2 dùng mẫu số khác (**420** semantic,
đã lọc) — nên **46,9 %** và **22,5 %** đúng cho hai mẫu số riêng, không thay thế nhau (R2 line 344 đã ghi
cùng một lưu ý).
Và **quan trọng nhất**: CSS tĩnh chỉ có **48 rule `.custom`** với **0 custom-property declaration** —
census 30 đếm được đúng **31 tham chiếu `var()`** bên trong 48 rule đó. Nghĩa là selector `.custom`
**không tự định nghĩa** biến nào; nó chỉ *tiêu thụ* biến. Bất kỳ token nào nằm ngoài tập đã có rule
tiêu thụ thì ghi vào cũng **không có tác dụng**. (Đồng thời: **198** token phát được, **197** có trong CSS
ship, đúng **1** thiếu là `--white-quote-selected-alpha` — census 30, khớp với ước lượng ở trên.)

**(5) Zalo chủ động chống theme bên thứ ba.** `lazy/64` (678 B) là component React **mount mỗi lần
theme DARK**, verbatim:

```js
u=(n("9Tg7"),n("euSg")),o=n("TmDO"),r=n("xPHB");const i=5e3;
function a({_window:t=window}){const e=Object(r.b)();
  return s.a.useEffect((()=>{const e=t.document.body;
    return e&&(e.classList.add(o.THEME.DARK),Object(u.g)()),
    ()=>{e&&(e.classList.remove(o.THEME.DARK),setTimeout((()=>{Object(u.g)()}),i))}}),[]),
  s.a.useEffect((()=>{const n=t.document.head;return n&&e&&Object(u.j)(o.THEME.DARK),
    ()=>{n&&e&&Object(u.j)(o.THEME.LIGHT)}}),[e]),null}}
```

`u.g` (scrubber) **xoá** `link[href^="zadark"]` và `script[src^="zadark"]` khỏi `head[0]`/`body[0]`.
Nó chạy **mỗi lần vào DARK** và **5 giây sau khi rời DARK**. `HuPi` chỉ mount chunk 64 khi
`theme === THEME.DARK` ⇒ scrubber **đang sống**, không phải dead code.

> **Bẫy suy luận đã bị loại.** Census 20 thấy `dt.g` có 0 use trong `iKSP` và suýt kết luận "dead code".
> Census 21 tìm ra consumer **động** (`n.e(64)`), và đọc trực tiếp `lazy/64` xác nhận nó chạy. **Một import
> tĩnh vắng mặt không chứng minh vắng mặt** khi bundle còn `require.ensure`/dynamic import.

**Kết luận Route A (đã sửa):** Route A **tồn tại** — nhưng là một sink **do Zalo sở hữu, đóng về kiểu,
chỉ màu, trần 198 token (197 có trong CSS ship), và bị cảnh sát chủ động**. Nó không thể mang glass (`backdrop-filter` không phải
token), không thể mang radius/shadow/blur/spacing/weight, và không thể nhận input từ bên ngoài. Ngay cả
khi CSP cho phép (`style-src 'unsafe-inline' … blob:`), **không có kênh nào để bên ngoài ghi vào sink
này** — `insertCSS`/`executeJavaScript`/`addStyleSheet`/`adoptedStyleSheets` = **0**, **0/54** kênh
`webContents.send` mang tên style/theme, và **0** lần đọc file CSS từ đĩa (116 file js: `readFile*` với
tham số CSS = 0; 2 literal `.css` duy nhất là webpack chunk-CSS loader trỏ vào thư mục package `f.p=""`).

---

## 5. Route B — React-component-change

### 5.1 Không thể định danh (R3 §13.3)

> "Component names beyond bundle-supplied identifiers | **BLOCKED** | Every module is an anonymous
> `FunctionExpression`; `sourcemaps/` ships empty"

Không có tên component ⇒ không có điểm sửa có bằng chứng. Sửa React của Zalo = sửa `app.asar` = **bị cấm
tường minh** ("Không sửa ứng dụng Zalo gốc").

### 5.2 Không có hook bên thứ ba

| Kiểm tra | Kết quả |
|---|---|
| `contextBridge.exposeInMainWorld` | **41** tên, đóng băng (danh sách §8) |
| `webSecurity` production | `!isDev()` với `isDev = const d=!1` ⇒ **true** |
| `will-attach-webview` | **0** |
| `BrowserView` / `WebContentsView` | **0** |
| extension host | Chỉ code vendored `electron-devtools-installer@3.1.1` (xem §9) |
| `$zFileManager.trustPathFromBlob` | bị **vô hiệu hoá** tường minh (`= void 0`) |
| `--inspect=9230` | định nghĩa **1** lần, **không bao giờ append** |
| `appendSwitch` | đúng **3** literal cố định: `ignore-connections-limit files-wpa.zaloapp.com`, `disable-pinch`, `enable-features JXL` |
| `--remote-debugging-port` | **0** |

**Kết luận Route B:** không có đường vào. BLOCKED ở mức định danh, đóng ở mức cơ chế.

---

## 6. Route C — Electron-window-config

Đây là route hấp dẫn nhất về lý thuyết: trên Electron **có** `BrowserWindow.setBackgroundMaterial()`
(Windows 11 Mica/Acrylic) và `vibrancy`. Nếu Zalo phơi cấu hình này, một thay đổi window-config sẽ đủ
cho hiệu ứng "glass shell" mà R4 cần.

Census: **Zalo không phơi gì cả.**

| Option | main.js | compact-app.js |
|---|---|---|
| `setBackgroundMaterial` | **0** | **0** |
| `backgroundMaterial` | **0** | **0** |
| `vibrancy` / `Vibrancy` | **0** | **0** |
| `acrylic` | **0** | **0** |
| `visualEffectState` | **0** | **0** |
| `titleBarOverlay` | **0** | **0** |
| `trafficLightPosition` | **0** | **0** |
| `roundedCorners` / `hasShadow` / `thickFrame` | **0** | **0** |
| `nativeTheme` / `shouldUseDarkColors` / `themeSource` | **0** | **0** |

Những gì Zalo **thực sự** đặt cho window:

```js
// main/login window (Rn @2696696)
frame:!1, titleBarStyle:"hidden",
backgroundColor: app_theme.color.backgroundPrimary || "#ffffff",
webPreferences:{ webSecurity:!0, ..., nodeIntegration:!1, contextIsolation:!0, sandbox:!1,
                 partition:"persist:zalo", preload: ".../preload-render.js" }
```

Và **đường ghi theme duy nhất** (main.js @1031389):

```js
updateThemeConfig:(e,t)=>{ const {appConfig:r}=n("ZQzv"); r.set("app_theme",t);
  const {updateBgColorByAppConfig:i}=n("j6F3"); i(t) },
getThemeConfig:e=>{ const {appConfig:t}=n("ZQzv"); return t.get("app_theme") },
```

```js
// updateBgColorByAppConfig @2725171
updateBgColorByAppConfig:function(e){ … const r = (e?.color?.backgroundPrimary) || null;
  r && Ce.setBackgroundColor(r) }
```

Kênh IPC duy nhất: `update-theme-conf` / `get-theme-conf`. Nội dung truyền là **một object màu**,
và tác dụng của nó là **một** `setBackgroundColor`. Nó **không thể** mang CSS, không thể bật material,
không thể đổi `backgroundColor` thành `rgba(0,0,0,0)` để lộ DWM blur, vì `transparent` phải đặt lúc
tạo window và Zalo chỉ có **1** site `transparent:!0` (không thuộc window chính).

**Kết luận Route C:** không có công tắc nào để gạt. Không phải "gạt bị cấm" — mà là **không có công tắc**.

---

## 7. Ma trận rủi ro chức năng

Vì **không có route nào được chấp nhận**, ma trận dưới đây không phải "rủi ro nếu triển khai" mà là
**"rủi ro không thể đánh giá"**. Tất cả ô là **UNKNOWN / NOT TESTED** — theo đúng lệnh cấm
"Không báo PASS khi chưa kiểm chứng" và "không tuyên bố tương thích 100 %".

| Chức năng | Surface liên quan | Trạng thái | Ghi chú |
|---|---|---|---|
| **Login / session** | `preload-render.js`, `zpw_sek` (13 hit main.js), `refreshToken` (4) | **UNKNOWN / NOT TESTED** | Không route ⇒ không có biến số |
| **Messaging** | `messageChannel` (19), `sendMessage` (3), bubble/message-row | **UNKNOWN / NOT TESTED** | Bubble là surface HIGH-risk nếu có route |
| **File-send** | `zFileManager` (14 ở preload), `new-download-file` (16), `zcloud` (11) | **UNKNOWN / NOT TESTED** | `trustPathFromBlob` đã bị Zalo vô hiệu |
| **Calling** | `zcall` (5 ở preload), `zcall_ia32.node` 4.675.584 B, `vcmac.js` | **UNKNOWN / NOT TESTED** | `videoCall`/`webrtc`/`WebRTC` = 0 ở main.js — feature nằm trong native module, ngoài phạm vi đọc tĩnh |
| **Sync / DB** | `sqlite` (57 main / 18 preload), `SQLite` (110/25), `zdb` (4) | **UNKNOWN / NOT TESTED** | Không đụng DB — ngoài phạm vi |
| **Updater** | `checkForUpdates` (15), `quitAndInstall` (28) | **UNKNOWN / NOT TESTED** | Feed `http://localhost:3001`, `updateMode: FULL` — không route |

Cột "Ghi chú" chỉ ghi ** fact đọc được**, không phải kết luận tương thích.

---

## 8. Danh sách 41 bridge (đóng băng, nguyên văn, đúng thứ tự)

`__SENTRY_IPC__ MetriczGlobal $zenv $zcommon $znode $zwindow $zresource $zlogger $zupdater $zapp
$zdownload $zdb $zsessionManager $zmulti $zcall $zsharedWorker $zelectron $zelectronNative $zuri
$zscreencap $zlogin $zperf $zconfig $zMetric $zFileManager $zpc $zFeatures $zcloud $zMsgChannel
$zscript $zInAppPayment $capp $zbackup $zpreload $zsqlitebw $zsafeStorage $zMigrateDrive $zTFModels
$znetwork $zprotocol $znoti`

Không tên nào mang CSS, theme-sheet, style hay presentation. Tập này là **allowlist đóng**: preload
render dùng `exposeInMainWorld` 41 lần, compact-app-preload 9 lần, preload-render 41 lần — không có
điểm mở rộng.

---

## 9. Công bố false-positive (bắt buộc — để đếm substring không bị hiểu nhầm là hook)

**Bốn** khu vực dễ bị đọc sai — ba theo hướng "tưởng có đường inject", một theo hướng ngược lại
("tưởng không có sink nào"). R5 chủ động bác bỏ cả bốn:

1. **`loadExtension` (2 hit: main.js @3416463, compact-app.js @3390916)** → toàn bộ thân hàm resolve
   sang **`electron-devtools-installer@3.1.1`** (khai báo trong devDependencies @2853941), có guard
   `if("browser"!==process.type) return Promise.reject(...)`, ghi vào `userData/extensions`, và **không
   được bất kỳ feature path nào tham chiếu**. Không phải extension host.
2. **`insertRule`/`deleteRule`/`setProperty` ở preload (10 hit)** → **Sentry rrweb recorder**, dạng
   `n.CSSStyleSheet.prototype.insertRule = new Proxy(r,{apply: me(((n,r,a)=>{ …n.apply(r,a)}))})`.
   Nó **quan sát** mutation để gửi telemetry; không chèn rule của mình.
3. **`webRequest.onHeadersReceived` (3 hit main, 2 hit compact-app)** → hai handler đều **read-only**:
   - `yyar` @3569936: `headerController.addNewHeader(e.url, e.responseHeaders)` — LRU cache 50 entry,
     `addNewHeader(e,t){this.cached.set(e,t)}`; không sửa header.
   - `setupCSPMonitor` @1079647: chỉ chạy khi `"subFrame"===t.resourceType`, chỉ **đọc**
     `frame-ancestors`, rồi `n({responseHeaders:t.responseHeaders})` — **trả nguyên bản**.

4. **`<style id="app-custom-theme">` (4 bundle)** → **là sink thật**, không phải false-positive. Nhưng
   nó **chỉ nhận token màu do Zalo sinh** (§4.4). Việc nó tồn tại **không** mở ra route cho bên thứ ba:
   không có nơi nào trong app đọc CSS từ ngoài để đưa vào `innerHTML`. Ghi nhận ở đây để tránh cả hai
   lỗi đọc sai — vừa không được nói "không có sink", vừa không được nói "có sink ⇒ có route".

Ngoài ra: `titleBarStyle` = 5 hit nhưng chỉ thuộc 3 lớp window (login/main, Photo, child) và **không**
kèm material/vibrancy. `setOpacity` = 14 hit nhưng đều là fade-in animation (0 → 1 sau 100/300 ms),
không phải translucency.

---

## 10. Tại sao đây là NO-GO vững, không phải NO-GO yếu

Một NO-GO yếu nói: "kỹ thuật làm được nhưng đạo đức/pháp lý không cho". Một NO-GO vững nói:
"kỹ thuật **không có đường** ngay cả khi được phép". R5 rơi vào loại thứ hai — và bản 2026-11-06
còn vững hơn bản đầu, vì đã **tìm thấy sink rồi mới chứng minh sink không dùng được**:

- CSP **không** chặn (`style-src 'unsafe-inline' … blob:`).
- Fuses **không** chặn phần này (`EnableEmbeddedAsarIntegrityValidation` disabled).
- `isDev()` là `false` hard-code ⇒ **không** có dev-server backdoor.
- `--inspect` **không** được append ⇒ **không** có argv injection.
- **Có** `<style>` sink — nhưng payload **chỉ là cặp `--token: màu`**, sinh bởi generator nội bộ.
- Không `insertCSS`, không `executeJavaScript`, không extension host, không webview, không BrowserView.
- Không option window nào (`material`, `vibrancy`, `titleBarOverlay`, `nativeTheme`) được dùng.
- Đường theme duy nhất mang **một màu**, không mang CSS.

Nói cách khác: **cửa có thật, nhưng khoá nằm bên trong**. Để dùng được nó phải sửa `app.asar`
(đổi generator / thêm trường vào setting) hoặc inject — **đều bị cấm tường minh** bởi đề bài.
Zalo còn chủ động xoá theme bên thứ ba (§4.4 điểm 5). Do đó kết luận đúng theo R4 §11.3:
*"If R5 cannot find an authorized route with the same properties, the correct outcome remains **NO-GO**."*

---

## 11. Cổng mở lại P3 (không đổi so với ADR-001)

P3 chỉ mở lại khi hội đủ **cả ba**:

1. Một **route tích hợp được tài liệu hoá & được hỗ trợ** (ví dụ Zalo công bố theme API/plugin API,
   hoặc người dùng cung cấp văn bản cho phép chính thức) — không phải suy đoán từ byte.
2. **Thẩm quyền cho thay đổi chính xác đó** (scope hẹp, có thể rollback).
3. **Tài khoản test cô lập** + định nghĩa regression/rollback cho login, messaging, file, group, call,
   notification, reconnect, updater.

Nếu ba điều kiện trên xuất hiện, R5 phải được mở lại và chạy lại census trên build tương ứng — **không**
tái sử dụng kết quả của build `26.10.20.3253`.

---

## 12. Tồn đọng & BLOCKED (giữ nguyên, không suy đoán)

| Mục | Trạng thái | Lý do |
|---|---|---|
| Tên component React của Zalo | **BLOCKED** | Module ẩn danh `FunctionExpression`; `sourcemaps/` rỗng (R3 §13.3) |
| Hành vi runtime của CUSTOM sheet trên các surface | **BLOCKED** | Chỉ đọc tĩnh; không thực thi. **Fact đọc được:** sink ghi `innerHTML` `:root .custom { … }`; **chưa đo được** phần render thật trên từng surface ⇒ giữ BLOCKED, không suy diễn thành "đã chạy đúng" |
| Ảnh hưởng của scrubber lên theme ngoài | **BLOCKED (một phần)** | Đọc tĩnh chứng minh scrubber chạy khi DARK; **không** đo được nó có xoá nhầm selector khác trong thực tế hay không |
| Cấu trúc nội bộ RTF editor (`Ze.a`) | **BLOCKED** | Không định danh được từ bundle |
| Tương thích thực tế login/messaging/file/call/sync | **UNKNOWN / NOT TESTED** | Không route ⇒ không thể test; cấm PASS |
| Feature calling (`zcall`, WebRTC) | **UNKNOWN** | `videoCall`/`webrtc`/`WebRTC` = 0 ở main.js; nằm trong native `zcall_ia32.node`, ngoài phạm vi đọc tĩnh |

---

## 13. Kết luận R5

1. **Ba route đề bài nêu đều NO-GO**, mỗi route bị chặn bởi một lý do độc lập: CSS-only có nền cấu trúc
   yếu (0/11 surface) **và** sink của nó đóng về kiểu + chỉ màu + trần 198 token (197 dùng được);
   React-component-change
   bị BLOCKED ở định danh và bị đóng ở hook; Electron-window-config không có option material/vibrancy
   nào được dùng.
2. **CSP không phải rào cản** — và điều này **vẫn đúng** sau khi tìm ra sink: CSP cho phép thẻ `style`
   inline, nhưng **không có kênh nào để nội dung do bên ngoài kiểm soát chạm tới thẻ đó**.
3. **Cơ chế thật đã được xác định:** một sink `<style id="app-custom-theme">` (`:root .custom`) do
   Zalo sở hữu, ghi bởi generator chỉ phát token màu; setting lưu chỉ có 11 key có kiểu; trần 198 token
   (197 có trong CSS ship = **46,9 %** theo R2, **22,5 %** trên toàn bộ 876 property); `.custom` tĩnh có
   48 rule và **0** custom-property declaration; Zalo có **scrubber sống** xoá theme ZaDark mỗi lần vào
   DARK. Dùng sink này đòi hỏi sửa `app.asar`/inject — bị cấm tường minh. Do đó P3 giữ **NO-GO**.
4. **R4 vẫn có giá trị**: là prototype độc lập, chứng minh thiết kế Glass đúng. Nó **không** chứng minh
   Zalo sẽ tôn trọng dù chỉ một rule — trạng thái đó vẫn **UNVERIFIED**, đúng như R4 §11.4 yêu cầu.

**Trạng thái chuyển giao:** R1 → R2 → R3 → R4 đã PASS có bằng chứng. R5 **HOÀN THÀNH với kết luận
NO-GO**; đây là kết quả hợp lệ của một feasibility study, không phải thất bại. Baseline v0.3.0 không đổi.
Không file legacy `src/app.js`, `src/logic.js`, `src/icons.js`, `src/styles.css` nào bị đụng.
