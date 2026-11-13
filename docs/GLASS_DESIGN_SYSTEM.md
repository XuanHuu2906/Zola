# Apple Liquid Glass Design System

> Archived (2026-11-12): the demo-only screens and architecture notes below are historical. The live-only app reuses the glass primitives and tokens; see [README.md](../README.md) for current behavior.

Tài liệu này mô tả **hệ thống giao diện đang có trong repo**, không mô tả hệ thống giao diện của Zalo.
Mọi con số dưới đây đọc trực tiếp từ mã nguồn; không có giá trị nào được suy ra từ bundle của Zalo.

Trạng thái theo Ma trận 10 của Master Plan:

| Chiều | Giá trị | Ghi chú |
|---|---|---|
| Evidence | `OBSERVED` | Đọc từ `src/design-system/`, `src/components/glass/`, `src/renderer/components/` |
| Authorization | `UNKNOWN` | Không liên quan — không có lời gọi backend nào |
| Testing | `MOCK_PASS` | Chỉ kiểm thử offline: 89 unit test, 26 E2E |

`MOCK_PASS ≠ LIVE_PASS`. Tài liệu này không phải bằng chứng về bất kỳ năng lực backend nào.

---

## 1. Ranh giới phụ thuộc

```
src/design-system/        ← không import từ src/renderer/ hay src/adapters/
src/components/glass/     ← không import từ src/renderer/ hay src/adapters/
src/renderer/components/  ← tiêu thụ cả hai tầng trên
src/renderer/**           ← không import src/adapters/ hay src/services/; đi qua src/composition/ui-bridge.ts
src/composition/          ← nơi duy nhất import cả adapter lẫn service
```

Hai lý do cụ thể:

- **`src/design-system/` không được phụ thuộc mô hình người tiêu thụ.** `wallpaper.ts` từng import `Chat` của renderer; hiện nó khai báo `WallpaperKey { isWork; isGroup; verified? }` tại chỗ. Đây là kiểu cấu trúc: renderer truyền `Chat` vào vẫn hợp lệ mà không ràng buộc ngược.
- **`src/components/glass/` là tầng nguyên thuỷ, không biết nghiệp vụ.** `GlassDialog`/`GlassPopover`/`GlassIconButton`/`GlassCard` không đọc store, không biết hội thoại là gì.

Ranh giới này được **kiểm bằng máy** trong `tests/design-system.test.ts` (`layer boundaries hold against resolved import paths`): test đọc mọi tệp `.ts`/`.tsx` dưới `src/`, giải mọi import tương đối thành đường dẫn thật rồi báo vi phạm.

Từ 2026-11-06 có thêm hai luật: `src/renderer/**` không được import `src/adapters/**` hoặc `src/services/**` (UI chỉ gặp nghiệp vụ sau seam `src/composition/ui-bridge.ts`), và test thứ hai `the composition root is the only place that imports both an adapter and a service` khẳng định đúng một tệp `src/composition/ui-bridge.ts` là nơi viết tắt của hai tầng gặp nhau. Luật mới đã được chứng minh **không rỗng** bằng cách tạo tạm `src/renderer/store/__violation.ts` và thấy đúng vi phạm `src/renderer/store/__violation.ts:1 -> src/services/messaging.ts`, rồi xoá tệp thử.

Vì sao không dùng ESLint `no-restricted-imports`: luật đó so **chuỗi specifier**, không so đường dẫn đã giải. Trong repo này `src/renderer/components/ChatPane/ChatWallpaper.tsx` import `'../../adapters/types.ts'` — chuỗi đó khớp mẫu cấm, nhưng đích thật là `src/renderer/adapters/types.ts`, tức adapter demo, hoàn toàn hợp lệ. Đã thử luật ESLint và nó báo 4 vi phạm giả; một luật báo sai sẽ bị tắt, nên test giải đường dẫn là lựa chọn đúng.

---

## 2. Bậc thang token

`src/design-system/tokens.css` — 182 dòng, 104 token ở `:root`, **24 token ghi đè** trong `:root[data-theme="light"]`, và **không có token chỉ tồn tại ở theme sáng** (đã kiểm: tập token light là tập con của dark). Nghĩa là theme sáng không thể "bật" một khái niệm mà theme tối không có.

| Nhóm | Số lượng | Ví dụ |
|---|---|---|
| `--glass-fill-*` | 13 | `shell`, `pane`, `raised`, `control`, `input`, `selected`, `active`, `pill`, `chip`, `floating`, `dialog`, `toast`, `scrim` |
| `--blur-*` | 6 | `shell 44px`, `dialog 35px`, `floating 24px`, `toast 20px`, `scrim 12px`, `pill 10px` |
| `--shadow-*` | 6 | `shell`, `dialog`, `floating`, `bubble`, `bubble-out`, `control` |
| `--radius-*` | 9 | `shell 29px`, `panel 27px`, `card 20px`, `control 14px`, `bubble 22px`, `floating 16px`, `dialog 26px`, `pill 15px`, `shell-compact 19px` |
| `--type-*` | 19 | `display 30px`, `heading 24px`, `body 14px`, `meta 12px`, `nano 9px` — vai trò, không phải cỡ (§2.2) |
| `--leading-*` | 6 | `none 1`, `solid 1.1`, `tight 1.3`, `body 1.55`, `relaxed 1.6`, `loose 1.65` |
| `--space-*` | 8 | thang 4px: `1→4px` … `8→32px` (§2.3) |
| `--duration-*` `--ease-*` | 3 | `fast .2s`, `base .25s`, `ease-standard` (§2.4) |
| viền | 11 | 10 `--border-*` + `--divider` |
| bão hoà | 2 | `--saturate-shell 150%`, `--saturate-dialog 160%` |
| màu hành động | 3 | `--danger #b23c48` (kết thúc cuộc gọi; trắng trên nền đạt 5.78:1), `--danger-window #c42b35`, `--switch-on #298cff` |

### 2.1 Sáu fill co giãn theo `--glass-opacity`

`--glass-opacity` là biến duy nhất do người dùng điều khiển (slider 15–95%). Sáu fill dùng `calc()` để co giãn, bảy fill còn lại cố định vì chúng là bề mặt nổi phải đủ đặc để đọc được:

```css
--glass-fill-pane:     rgba(182,211,255, calc(var(--glass-opacity)*.08));
--glass-fill-raised:   rgba(218,235,255, calc(var(--glass-opacity)*.12));
--glass-fill-control:  rgba(222,238,255, calc(var(--glass-opacity)*.20));
--glass-fill-input:    rgba(221,237,255, calc(var(--glass-opacity)*.23));
--glass-fill-selected: rgba(237,247,255, min(.23, calc(var(--glass-opacity)*.31)));
--glass-fill-active:   rgba(220,236,255, calc(var(--glass-opacity)*.31));
```

Mỗi bậc dùng một RGB riêng chứ không chỉ khác alpha: bậc càng cao càng sáng, để hai bề mặt lồng nhau vẫn tách được ngay cả khi opacity trùng nhau.

`selected` có `min()` vì ở mức opacity cao nó sẽ chồng lên `active` và hai trạng thái mất khả năng phân biệt.

### 2.2 Kiểu chữ — 19 vai trò, không phải 19 cỡ

Thang chữ được đặt tên theo **vai trò**, không theo số đo:

```css
--type-display: 30px;   /* brand wordmark */
--type-title:   29px;   /* feature page heading */
--type-heading: 24px;   /* dialog heading */
--type-body:    14px;   /* base, bubble copy */
--type-meta:    12px;   /* timestamps, captions */
--type-nano:     9px;   /* prototype tag */
/* … 13 vai trò còn lại */
```

Mỗi cỡ đã có sẵn trong giao diện đều có tên riêng; **không có cỡ nào bị gộp**. Lý do: bộ kiểm tương phản `contrast.ts` chọn ngưỡng 3:1 hay 4.5:1 dựa trên chính `fontSize` (3:1 khi `≥24px`, hoặc `≥18.66px` kèm `fontWeight ≥700`). Chỉ cần nhích một cỡ qua ngưỡng 24px là điều kiện kiểm tra đổi theo — nên tokenise phải giữ **nguyên byte** giá trị.

Việc gộp các cỡ gần nhau (29/30, 11/11.5, 12/12.5) là một quyết định thị giác cần ảnh chuẩn để đánh giá, nên nó nằm ở §8 dưới dạng nợ, không phải làm ngầm trong lúc tokenise.

`--leading-*` có 6 bậc (`none 1`, `solid 1.1`, `tight 1.3`, `body 1.55`, `relaxed 1.6`, `loose 1.65`) — đúng 6 giá trị stylesheet đang dùng, không thêm bậc nào.

### 2.3 Khoảng cách — thang 4px thật, nhưng chỉ thay khi khớp chính xác

```css
--space-1: 4px;  --space-2: 8px;   --space-3: 12px;  --space-4: 16px;
--space-5: 20px; --space-6: 24px;  --space-7: 28px;  --space-8: 32px;
```

Bố cục hiện tại dùng **35 giá trị độ dài khác nhau**, phần lớn không nằm trên lưới 4px: đó là những chỉnh quang học nhắm vào một glyph hoặc một đường viền cụ thể (`padding:10px 12px`, `gap:7px`, `padding-top:19px`…). Chỉ những giá trị **khớp đúng** bậc thang mới được thay bằng `var(--space-*)` — 35 giá trị trong toàn bộ stylesheet.

Ép các giá trị lẻ lên lưới sẽ **dịch pixel**, mà repo chưa có ảnh chuẩn để phát hiện hậu quả. Vì vậy chúng ở lại dạng literal và được ghi nhận là nợ (§8), với một test chặn giá trị "đã có bậc" dùng lại dạng literal.

### 2.4 Chuyển động — hai thời lượng, một đường cong

```css
--duration-fast: .2s;
--duration-base: .25s;
--ease-standard: ease;
```

Chỉ có hai `transition` thực trong stylesheet. Đường suy giảm `reduced-motion` xoá cả hai **nguyên khối** (§3) chứ không sửa từng khai báo, nên số lượng token nhỏ là cố ý: thêm một duration mới là thêm một thứ phải nhớ xoá.

Tên dùng `--ease-standard` chứ **không** `--ease-out`, vì Tailwind v4 đã sở hữu namespace `--ease-*` (`--ease-out`, `--ease-in-out`) trong bundle biên dịch; đặt trùng tên sẽ âm thầm ghi đè hoặc bị ghi đè. Tương tự, `--space-*` chứ không `--spacing` (Tailwind dùng `--spacing` làm scalar gốc). Đã kiểm `--text-sm`, `--blur-sm`, `--radius-lg`, `--shadow-md` không có trong bundle trước khi chiếm các tên đó.

### 2.5 Bằng chứng "không đổi một pixel"

Token hoá làm đổi hình thức tệp CSS, nên cần chứng minh nó không đổi **kết xuất**. Hai lớp bằng chứng:

1. **Đại số:** mở rộng ngược mọi token mới thành literal rồi so với bản CSS trước thay đổi — trùng khít từng ký tự (28 307 == 28 307). Chỉ mở rộng đúng 5 họ mới (`type|leading|space|duration|ease`), không đụng `--text` hay token cũ, để phép so không bị nhiễu.
2. **Pixel:** dựng bản cũ và bản mới, chụp cùng viewport 1600×900 ở cả hai theme với `prefers-reduced-motion: reduce` và chờ 1.5 s cho ổn định, rồi so từng pixel bằng Chromium giải mã ảnh. Kết quả: **0 / 1 440 000 pixel khác nhau ở cả hai theme**. Đối chứng: hai lần chụp cùng một bản CSS cũng cho 0 pixel khác — tức phép so là tất định, khác biệt (nếu có) sẽ không phải nhiễu.

Lần chụp đầu tiên (không tắt chuyển động) báo 9.7 % pixel khác — đó là **animation vào màn hình** bị bắt ở thời điểm khác nhau, không phải thay đổi CSS. Đây là lý do ghi lại ở đây thay vì chỉ báo "PASS": một phép so không ổn định sẽ báo sai theo cả hai chiều.

---

## 3. Ba đường suy giảm độc lập

Cùng 5 selector (`.window-shell`, `.settings-modal`, `.context-menu`, `#toast`, `.day-label`) nhưng **ba nguyên nhân khác nhau, ba cơ chế khác nhau**:

| Nguyên nhân | Kích hoạt | Tác động |
|---|---|---|
| Người dùng chọn "Giảm độ mờ" | `html.low-blur` | `backdrop-filter: blur(4px)`; `dialog::backdrop` về `none` |
| Hệ điều hành giảm chuyển động | `html.reduced-motion` (từ `prefers-reduced-motion` **hoặc** toggle trong Settings) | Chỉ tắt `transition`/`animation`; **không** đụng tới blur |
| Máy không hỗ trợ blur | `@supports not ((backdrop-filter…) or (-webkit-backdrop-filter…))` | Thay bằng fill đặc mô phỏng, theo từng theme |

Điểm quan trọng: đường thứ hai **không** được đụng vào blur. Người dùng giảm chuyển động vì tiền đình vẫn cần độ tương phản của kính; gộp hai thứ thành một công tắc là sai. Điều này được kiểm bằng test `degradation covers every blurred tier in one switch` và `glass is never nested in a containing block or transform layer`.

### 3.1 Luật lồng ghép

`backdrop-filter` không hoạt động qua lớp `contain:` hoặc `transform:`. Vì vậy `.window-shell` và `.chat-wallpaper` không được đặt hai thuộc tính này. Test #10 quét đúng hai rule đó.

---

## 4. Biến thể có kiểu, không nối chuỗi boolean

`src/design-system/variants.ts` — 10 map `Record<State, string>`, mỗi map phủ **đúng hai trạng thái** và hai giá trị **khác nhau**:

```ts
export const messageRowVariant = { incoming: 'message-row incoming', outgoing: 'message-row outgoing' };
export const toggleVariant      = { on: 'toggle on', off: 'toggle' };
export const railButtonVariant  = { selected: 'rail-button is-active', idle: 'rail-button' };
// … filterChip, conversation, pressed, reaction, match, bubble
```

Lý do: nối chuỗi kiểu `` `toggle ${on ? 'on' : ''}` `` sinh ra `"toggle "` có khoảng trắng thừa ở một nhánh và không có cách nào kiểm tra bằng máy rằng cả hai nhánh đều đúng. Map có kiểu thì test được.

Hai ngoại lệ có chủ đích: `pressedVariant.idle = ''` (không có class nào là trạng thái đúng) và `matchVariant.plain = 'bubble-copy'` (vẫn cần class nền).

---

## 5. Tầng nguyên thuỷ `src/components/glass/`

| Component | Hợp đồng | Hành vi sở hữu |
|---|---|---|
| `GlassDialog` | `labelledBy`, `onClose`, `className?`, `children` | `showModal()` khi mount; focus `[data-autofocus]`; bẫy Tab thủ công (lọc theo `getClientRects().length > 0` để bỏ phần tử ẩn); trả focus về phần tử đã mở nó khi unmount; `Escape` → `onCancel` → `preventDefault()` + `onClose()`; click ra ngoài theo `getBoundingClientRect()` |
| `GlassPopover` | `open`, `onClose`, `className?`, `label?`, `children` | Dùng tầng `floating` có sẵn qua class `.context-menu`; khi mở thì nghe `pointerdown` ngoài vùng và `keydown` `Escape` ở document; trả `null` khi đóng |
| `GlassIconButton` | `label` → `aria-label`, `expanded` → `aria-expanded` | Chỉ nút icon; **không forward ref** |
| `GlassCard` | `HTMLAttributes<HTMLDivElement>` | `.glass-card` = fill `raised` + radius `card` + shadow `control` |

### 5.1 Vì sao bẫy Tab là thủ công

Bẫy Tab của `<dialog>` không nhất quán giữa các engine nhúng, và Electron/Chromium không đảm bảo nó bỏ qua phần tử `display:none` theo cách các trình duyệt khác làm. Danh sách tiêu điểm được tính lại mỗi lần nhấn Tab thay vì cache, vì nội dung dialog thay đổi (bật/tắt toggle, chuyển theme) trong lúc mở.

### 5.2 Giới hạn đã biết

`GlassIconButton` không forward ref. `ChatPane` cần `ref` trên nút mở popover để trả focus sau khi chọn mục; hiện hai nút đó vẫn là `<button>` thô. Chưa sửa vì `forwardRef` ở React 19 trở thành prop thường, và việc chuyển đổi sẽ là một thay đổi API riêng — ghi lại ở đây thay vì làm ngầm.

---

## 6. Hợp đồng bàn phím và tiêu điểm

- `Escape` đóng theo **thứ tự ưu tiên**: context menu trước, rồi ô tìm kiếm trong hội thoại. Lý do: menu là lớp nông nhất đang mở.
- Mọi lần đóng đều **trả focus về phần tử đã mở**. E2E kiểm điều này cho dialog Settings, popover tùy chọn, ô tìm kiếm, và cả dialog cuộc gọi (`.toBeFocused()` sau khi đóng).
- `:focus-visible` dùng `outline: 2px solid`, không dùng `box-shadow`, để không bị `.window-shell` che.
- Theme sáng đổi màu outline sang `var(--border-focus)` (`#164ac5`) vì `rgba(153,210,255,.95)` trên nền sáng không đạt tương phản.

---

## 7. Màn hình

### 7.1 Đã chạy trong Electron

| Màn hình | Thành phần | Nguồn dữ liệu |
|---|---|---|
| Danh sách hội thoại | `ConversationList` | `demoAdapter.list()` |
| Chi tiết hội thoại | `ChatPane` | adapter demo |
| Danh bạ / Nhóm | `FeaturePage` | lọc từ danh sách mẫu |
| Nhật ký / Cloud / Công cụ | `FeaturePage` | placeholder "chưa kết nối" |
| Cài đặt | `SettingsDialog` → `GlassDialog` | `localStorage` chỉ chứa 4 khoá tùy chỉnh |
| Hồ sơ | `Overlays` → `ProfileScreen` | tĩnh |
| Thông tin hội thoại / nhóm | `Overlays` → `InfoScreen` | adapter demo |
| Trình xem phương tiện | `Overlays` → `MediaScreen` | **chỉ metadata tệp**, không đọc nội dung |
| Cuộc gọi | `Overlays` → `CallScreen` | tĩnh, không truy cập micro/camera |
| Thông báo | `Overlays` → `NotificationsScreen` | `unread` trong store, mất khi tải lại |

### 7.2 Quy tắc nội dung

Mỗi màn hình phụ đều **tự khai báo** bản chất demo bằng chữ hiển thị ("Bố cục demo · Không kết nối Zalo"), không chỉ dựa vào nhãn của nút mở. Test `secondary screens exist and declare no backend capability` kiểm chuỗi này và cấm `fetch`/`XMLHttpRequest`/`WebSocket` trong tệp.

Cử chỉ không được hứa điều không làm:
- Nút mic/camera/loa trong cuộc gọi phát thông báo "chỉ là điều khiển demo", không đổi trạng thái.
- Trình xem phương tiện hiển thị "Không có ảnh — trình xem dựng bằng CSS" thay vì khung ảnh giả.

### 7.3 Màn hình chưa có

Không có trong repo: xem trước ảnh thật, trình phát tệp/thoại, chỉnh sửa hồ sơ, quản lý thành viên nhóm, chuyển/gộp cuộc gọi, trung tâm thông báo xuyên phiên. Các mục này cần backend hoặc dữ liệu thật nên chưa dựng — dựng khung rỗng chỉ để đánh dấu "đã có" là ngược với §1 của Master Plan.

---

## 8. Nợ kỹ thuật đã ghi nhận

| Mục | Trạng thái | Ảnh hưởng |
|---|---|---|
| Ranh giới renderer↛adapters | Đã đóng: test giải đường dẫn thật (§1) | ESLint không dùng được vì so specifier, báo 4 vi phạm giả |
| `GlassIconButton` không forward ref | Đã ghi ở §5.2 | Hai nút trong `ChatPane` vẫn thô |
| Không có `.glass-dialog` selector riêng | Dùng chung rule với `.settings-modal` | Muốn đổi style dialog riêng phải tách rule |
| Chưa có snapshot visual | E2E chụp ảnh nhưng không so sánh pixel | Thay đổi CSS lệch pixel không bị bắt |
| 35 khoảng cách lệch lưới vẫn là literal | Cố ý: ép lên lưới sẽ dịch pixel (§2.3) | Chưa có ảnh chuẩn để chứng minh chỉnh lên lưới là an toàn |
| Thang chữ chưa gộp cỡ gần nhau (29/30, 11/11.5, 12/12.5) | Tokenise giữ nguyên byte (§2.2) | Gộp là quyết định thị giác, cần ảnh chuẩn |
| Màu hành động | Đã đóng cho 3 nút đã biết: `--danger` (kết thúc cuộc gọi), `--danger-window` (đóng cửa sổ), `--switch-on` (toggle) | `--switch-on` **cố ý không** alias `--accent`: theme sáng định nghĩa lại `--accent` thành `#207bf6`, alias sẽ đổi màu toggle ở theme sáng |
| Màu gradient, avatar, badge vẫn là literal | Chưa gom | Đây là màu trang trí, không mang nghĩa hành động; gom chúng cần đặt tên theo ngữ nghĩa trước |

---

## 9. Cách kiểm chứng

```bash
npm test          # 50 test: logic, core, design-system, adapters
npm run test:e2e  # 15 test Playwright trên bản build production
npm run check     # typecheck + lint + test
```

`npm test` hiện báo **50/50 pass**. `npm run test:e2e` báo **15 passed** (suite gồm accessibility, demo, extended-qa). Đây là kết quả của lần chạy gần nhất trong môi trường này, không phải cam kết cho mọi máy.
