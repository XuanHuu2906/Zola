/**
 * Nạp wasm Sync V2 từ đĩa, đúng chỗ dù chạy dev hay đã đóng gói.
 *
 * Module crypto cố ý không biết gì về đường dẫn — nó nhận byte. Chỗ này là nơi
 * duy nhất quyết định wasm nằm ở đâu, vì chỉ ở đây mới có `app` của Electron.
 *
 * Ba trường hợp:
 *
 * - **dev** (`npm start`): `__dirname` là `dist-electron/protocol/`, gốc repo ở
 *   trên hai cấp, wasm ở `assets/zproto/`.
 * - **đã đóng gói, asar**: wasm được khai trong `electron-builder.yml` là
 *   `asarUnpack`, nên nó nằm cạnh asar trong `app.asar.unpacked/`. Đọc từ trong
 *   asar cũng được, nhưng `WebAssembly.compile` cần mảng byte đầy đủ và asar
 *   không mmap được — tách ra ngoài rẻ hơn và không làm chậm lần khởi động đầu.
 * - **đã đóng gói, ngoài asar**: `app.getAppPath()` trỏ thẳng vào thư mục app.
 *
 * Chỉ nạp một lần: instantiate wasm tốn vài chục ms và bộ nhớ của nó chỉ dùng
 * chung được khi cùng một instance. Nơi gọi nhận cùng một promise.
 */

import { app } from 'electron';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { SyncV2Crypto } from './sync-v2-crypto.js';

/**
 * Tên file wasm — băm trong tên chính là băm nội dung, do bản dựng Zalo đặt.
 * Coi tên này là một phần của giao kèo ABI: đổi nó nghĩa là đổi wasm, và mọi
 * binding viết tay phải được soát lại.
 */
export const SYNC_V2_WASM_FILE = 'libzproto_wasm_bg.5ea0fb2c9af4a45bc7882b71307b6f83.wasm';

/** Đường dẫn tới wasm, theo thứ tự ưu tiên: bản đã tách asar, rồi bản trong app. */
export function syncV2WasmPath(): string {
  const appPath = app.getAppPath();
  const unpacked = path.join(appPath, '..', 'app.asar.unpacked', 'assets', 'zproto', SYNC_V2_WASM_FILE);
  if (appPath.endsWith('app.asar')) return unpacked;
  if (!app.isPackaged) return path.join(__dirname, '..', '..', 'assets', 'zproto', SYNC_V2_WASM_FILE);
  return path.join(appPath, 'assets', 'zproto', SYNC_V2_WASM_FILE);
}

let pending: Promise<SyncV2Crypto> | null = null;

/**
 * Nạp wasm của Sync V2, dùng chung một instance cho cả tiến trình.
 *
 * Ném nguyên lỗi của `fs`/`WebAssembly` khi nạp hỏng: bản cài thiếu file là lỗi
 * đóng gói, và thông báo `ENOENT` kèm đường dẫn nói đúng thứ cần sửa — bọc nó
 * thành câu chung chung sẽ giấu mất chi tiết đó. Promise hỏng được xoá để lần
 * gọi sau thử lại, phòng trường hợp file xuất hiện muộn (cập nhật tại chỗ).
 */
export function loadSyncV2Crypto(): Promise<SyncV2Crypto> {
  if (!pending) {
    pending = readFile(syncV2WasmPath())
      .then((bytes) => SyncV2Crypto.load(new Uint8Array(bytes)))
      .catch((error: unknown) => {
        pending = null;
        throw error;
      });
  }
  return pending;
}
