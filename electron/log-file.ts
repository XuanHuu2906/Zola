import { appendFileSync, renameSync, rmSync, statSync } from 'node:fs';

/**
 * Nhật ký chẩn đoán dạng append có xoay vòng.
 *
 * Tách khỏi `main.ts` và không import `electron` để `tests/log-file.test.ts` chạy
 * được bằng node thật: xoay vòng là logic thuần trên đĩa, không cần Electron.
 *
 * Bản đóng gói không có DevTools (`devTools` chỉ bật khi `GLASS_DEV=1`), nên file
 * này là cách duy nhất xem listener có nhận được khung tin nào. Nó chỉ ghi
 * metadata: không nội dung tin, không cookie/IMEI/token.
 */

/** Trần dung lượng mỗi file. Một phiên tải lịch sử ghi vài dòng mỗi trang. */
export const LOG_MAX_BYTES = 1_000_000;

export interface LogFile {
  /** Ghi một dòng `timestamp event json`. Không bao giờ ném ra ngoài. */
  write(event: string, data: unknown, now?: Date): void;
  /** Đường dẫn hiện tại, để test và chẩn đoán đọc lại. */
  readonly path: string;
}

/**
 * @param file đường dẫn file nhật ký
 * @param maxBytes trần dung lượng; vượt là xoay
 */
export function createLogFile(file: string, maxBytes = LOG_MAX_BYTES): LogFile {
  // `-1` = chưa đọc kích thước từ đĩa. Lần ghi đầu đọc một lần, sau đó cộng dồn:
  // `statSync` mỗi dòng sẽ chậm dần theo phiên dài, nhất là trên đĩa mạng.
  let bytes = -1;

  const size = (): number => {
    try { return statSync(file).size; } catch { return 0; } // chưa có file = 0 byte
  };

  const rotate = (): void => {
    try {
      // Windows không cho `rename` ghi đè: xoá bản cũ trước. Chỉ giữ đúng một bản
      // (`<file>.1`), vì mục đích là chặn tăng vô hạn, không phải lưu lịch sử.
      rmSync(`${file}.1`, { force: true });
      renameSync(file, `${file}.1`);
    } catch { /* thiếu file hoặc FS chỉ đọc: lần ghi sau tự tạo lại */ }
    bytes = 0;
  };

  return {
    path: file,
    write(event, data, now = new Date()) {
      try {
        if (bytes < 0) bytes = size();
        // Xoay **trước** khi ghi: kiểm tra sau khi ghi thì một dòng dài có thể đẩy
        // file vượt trần, còn cách này giữ file luôn ≤ trần cộng một dòng.
        if (bytes >= maxBytes) rotate();
        const line = `${now.toISOString()} ${event} ${JSON.stringify(data)}\n`;
        appendFileSync(file, line);
        bytes += Buffer.byteLength(line);
      } catch { /* chẩn đoán không được làm hỏng luồng tin */ }
    },
  };
}
