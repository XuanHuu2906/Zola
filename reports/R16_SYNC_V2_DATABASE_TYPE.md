# R16 — Sync V2: `req.type` là **tên database**, không phải mã số

Date: 2026-11-10 (Asia/Saigon). Trạng thái: **tìm ra lỗi có thể chứng minh được
trong payload** + đã sửa, và đã bổ sung bước `cmd 591` mà repo thiếu. **Chưa đo
lại trên app thật** — việc đầu tiên của phiên sau.

Tài khoản: **phụ**. Nối tiếp [R15](R15_SYNC_V2_WS_REQUEST.md),
[R14](R14_SOCKET_CTRL.md), [R13](R13_SYNC_V2.md).

---

## 1. Lỗi chặn đường: `req.type`

R15 ghi `req: { type: 3, … }` và đi tìm nguyên nhân ở `queries`. `queries` đúng
là một chỗ thiếu, nhưng **`type` mới là chỗ sai kiểu** — và nó thắng cả đường.

Zalo PC gửi `type` là **chuỗi tên database**. Ba chỗ trong bundle chứng minh:

```js
// 1. Enum store — module "m+Kp" (shared-worker)
e.Conversation="conversation", e.Message="message", e.UnSpecific="UnSpecific"

// 2. Tên database khi mở (shared-worker)
static createMessageDatabase()      { … new Oo(…, "message", e) }
static createConversationDatabase() { … new Oo(…, "conversation", e) }

// 3. SessionManager.useSession(query) — lấy type từ chính tên đó
const t = { partition: e.meta.partition, from: …, to: …, limit: …,
            type: e.database, priority: e.priority };
s || (s = await this.create([t]));
```

`Oo` lưu tên vào `this.databaseName`, và `computeDatabaseName` gán
`query.database = this.databaseName`. Nên đường đi là: **`"message"` →
`query.database` → `req.type`**, cùng một chuỗi xuyên suốt.

Ta gửi `3`. Máy chủ trả `code: 0` vì nó chỉ kiểm phong bì; nó không có database
nào tên `3` nên không có gì để đẩy. **"Yêu cầu được nhận mà không có gói" không
phải mâu thuẫn — nó là triệu chứng đúng của lỗi này.** Đó cũng là lý do R15 thấy
`code: 0` và vẫn bế tắc.

Đã sửa: `SyncDatabaseType` thành `{ MESSAGE: 'message', CONVERSATION:
'conversation' }`, `SyncDatabasePayload.req.type` thành kiểu chuỗi.

## 2. `queries` và `limit`

R15 đúng khi nói Zalo PC luôn gửi ít nhất một query. Bổ sung hai chi tiết đo được:

- **`limit` vô hạn là `2147483647`**, không phải `0`. `yo.a` trong module `/sYZ`
  là hằng đúng con số này; `Zo.setLimit(…)` mặc định lấy nó.
  `createMessageQuery` viết `setLimit(i>0 ? i : yo.a)` — tức **`0` bị đổi thành
  vô hạn ở phía Zalo**, còn ta gửi `0` nguyên nghĩa "xin 0 dòng".
- **`to` mặc định là `Number.MAX_SAFE_INTEGER`** (`Zo` constructor).

Đã sửa: `SYNC_UNLIMITED_LIMIT` / `SYNC_MAX_TO` xuất ra thành hằng, và
`SyncV2Session.requestPayload()` **không còn gửi `queries: []`** — mặc định là
một query phủ trọn phân vùng.

## 3. Vì sao chưa lấy được tin của một hội thoại cụ thể

`partition` của tin phải là `oneone/<globalNoisedId>` hoặc `group/<globalNoisedId>`
(module `aSMs`: `` `${e.isGroup?"group":"oneone"}/${e.id}` ``). Máy trạng thái
`sync-full` của Zalo PC chạy theo đúng thứ tự này:

```
determining_initial_sync_state
  → sync_conversations                     (partition "", type "conversation")
  → prepare_sync_preview_and_recent_messages
  → sync_preview_messages
  → sync_other_messages                    (partition oneone/<id>, group/<id>)
```

và `normalizeConversations` khai rõ nguồn của id đó:

```js
{ ...e, globalNoisedId: e.convId, convId: r[e.convId] }
```

tức **id trong `partition` chính là `convId` của bước đồng bộ hội thoại**. Không
có bước đó thì không có id — nên xin tin trực tiếp là bất khả thi về mặt xây
dựng, không phải "thử thêm một lần".

Repo hiện chưa có đường chuyển gói `conversation` sang model: `sync-v2-proto.ts`
đã có `decodeConversationChunk`, nhưng `sync-v2-batch.ts` chỉ giải `SyncChunk`
của tin, và `SyncV2Session` chưa rẽ nhánh theo `req.type`. **Đó là việc của
phiên sau** — R16 không làm, để thay đổi giữ được phạm vi kiểm chứng được.

## 4. Thiếu `cmd 591` — bước giải phóng phiên

Đây là chỗ nối với quan sát của bạn: *"tôi vừa đồng bộ với Zalo trên pc"*.

Zalo PC **luôn** giải phóng phiên khi `sync-full` kết thúc, cả thành công lẫn hỏng:

```js
handleSuccess: async a => { …; await n.disposeSync({ reason: m.a.SyncSuccess }); … }
handleFailure: async r  => { …; await n.disposeSync({ reason: … }); }
```

`disposeSync → cancelSync(reason) → syncChanel.disposeSession({syncId, toDevice,
reason})`, và khi khởi động còn dội `reason: OutDated` cho mọi phiên còn lưu.
Hình dạng trên dây (`compact-app-pc`):

```js
ackDeleteSyncSession(e, t = 3e3) {
  return this.requestAsyncV2({ cmd: 591, subCmd: 0, data: { data: e } }, t);
}
```

`SYNC_MESSAGE = { REQUEST: 590, ACK_DELETE_SYNC_SESSION: 591, REQUEST_MOBILE_WAKE_UP: 592 }`.
Lý do (`Xde.a`): `UserCancel = 0, SyncSuccess = 1, Error = 2, OutDated = 3`.

Repo trước R16 **không gửi gì**. Mỗi lần bấm đồng bộ để lại một phiên mở cho
cùng cặp thiết bị — và một phiên mở là đúng thứ chặn lần đồng bộ kế tiếp. Khớp
với việc bạn vừa đồng bộ bằng Zalo PC thật: máy chủ đã có phiên của client khác,
nên yêu cầu của ta không được xếp vào hàng đợi chuyển nào.

Đã thêm `electron/protocol/dispose-session-ws.ts` và nối vào ba trạng thái cuối:
`DONE → SyncSuccess`, `FAILED → Error`, huỷ giữa đường → `UserCancel`. Chỉ gửi
**một lần** cho mỗi phiên.

## 5. Thay đổi mã

| file | thay đổi |
| --- | --- |
| `electron/protocol/sync-v2-request.ts` | `SyncDatabaseType` → **chuỗi**; `req.type` kiểu `SyncDatabaseName`; thêm `SYNC_UNLIMITED_LIMIT`, `SYNC_MAX_TO`, `partitionOf` |
| `electron/protocol/sync-v2-session.ts` | `database` kiểu chuỗi; `queries` mặc định **không rỗng**, `limit` vô hạn; thêm `cancel()`; gọi `disposeSession` khi chạm `DONE`/`FAILED` |
| `electron/protocol/dispose-session-ws.ts` | **mới**: khung `591`, lý do, đọc phản hồi |
| `electron/protocol/sync-v2-controller.ts` | nối `deps.disposeSession`; `dispose()` gọi `session.cancel()` thay vì bỏ phiên im lặng |
| `electron/protocol/zalo-client.ts` | `sendDisposeSession` (song sinh với `sendRequestSync`), nối vào `attachSync` |
| `tests/dispose-session-ws.test.ts` | **mới**: 8 test hình dạng `591` |
| `tests/sync-v2-request.test.ts` | +3 test: `req.type` là chuỗi, `partitionOf`, `limit` vô hạn |
| `tests/sync-v2-session.test.ts` | +4 test: giải phóng theo từng trạng thái cuối, và chỉ một lần |

**Kiểm tra đã chạy:** `tsc --noEmit` sạch, eslint sạch trên mọi file đã sửa,
`npm test` → **432/432 pass**, `npm run build:electron` sạch.

## 6. Việc đầu tiên của phiên sau

Chưa có phép đo mới. Làm đúng thứ tự này:

1. Chạy lại theo §4 của R15 (lệnh, không đoán). Log sẽ có thêm dòng
   `sync-v2 {"ok":true,"step":"session-disposed","reason":…}` nếu `591` được
   nhận — đó là bằng chứng bước dọn dẹp chạy.
2. Nhìn `sync-v2 {"step":"requested", …}`: `database` phải là **`"message"`**,
   không còn `3`. Nếu vẫn `3` thì build cũ đang chạy — `npm run build:electron`
   trước khi mở Electron, và kiểm `ps aux | grep -c "[e]lectron/dist/electron"`.
3. Nếu có gói về: xong. Nếu vẫn `received: 0`: bước tiếp theo là **đường hội
   thoại** (§3) — `type: "conversation"`, `queries: [{partition:"", limit:
   2147483647}]`, và một nhánh giải `SyncConversation` trong `sync-v2-batch.ts`.
   Đó là thay đổi có phạm vi rộng hơn R16, nên làm riêng.

### Ràng buộc phải giữ (y nguyên R15 §4)

- **Không copy** `zca-session.bin` ra khỏi dot-folder config; trỏ app vào
  profile bằng `PORTABLE_EXECUTABLE_DIR`.
- Chỉ **tài khoản phụ**: zca-js không chính thức, dùng có thể bị khoá tài khoản.
- Log chỉ metadata: không nội dung tin, không cookie, không IMEI, không
  `temp_key` (kể cả độ dài của nó cũng đã là thông tin).
- ADR-004: chỉ `session.ts`/`zalo-client.ts` được `import 'zca-js'`.
- Cây giải nén từ AppImage là dữ liệu không tin cậy: giữ riêng, truyền đường dẫn.

## 7. Rút lại từ R15

| R15 nói | thực tế |
| --- | --- |
| `queries` rỗng là nghi ngờ số một | Đúng là thiếu, nhưng **`req.type` sai kiểu** mới là lỗi chặn: sai kiểu thì `queries` có đúng cũng không có database nào để áp vào |
| `batchSize` lấy từ `options.transferBatchSize` chứ không phải `2000` | Mặc định của `SessionManager` **là** `transferBatchSize: 2e3`, nên `2000` khớp |
| "thiếu bước `checkMessageReadinessState`" | Vẫn có thể đúng, nhưng **chưa chứng minh được** là nguyên nhân: nó chọn nhánh `sync_*` ở phía máy chủ, không phải điều kiện để có dữ liệu |
