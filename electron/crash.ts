/**
 * Bắt lỗi toàn cục của **main process** (plan §9.1: "hiển thị thông báo … thay vì
 * crash").
 *
 * Mọi lỗi không có `catch` trong main đều dừng ở đây. Không có module này, Node
 * in stack ra stderr rồi thoát: bản đóng gói không có DevTools và không ai đọc
 * stderr, nên người dùng chỉ thấy cửa sổ biến mất.
 *
 * Module không import `electron`: nó nhận một emitter và một hàm báo cáo, nên
 * `tests/crash.test.ts` kiểm được bằng `EventEmitter` thật của node.
 *
 * ## Vì sao vẫn có ngưỡng thoát
 *
 * Nuốt **mọi** `uncaughtException` là đánh cược rằng tiến trình vẫn dùng được sau
 * một lỗi ta không hiểu. Với một app chat thì chết cứng ở lỗi đầu tiên là quá
 * tay, nhưng chạy tiếp một tiến trình đã hỏng cũng tệ. Lối giữa: lỗi đầu được ghi
 * lại và báo lên UI; tới lỗi thứ `MAX_FATAL` trong `FATAL_WINDOW_MS` thì thoát,
 * vì lúc đó gần như chắc chắn là hỏng vòng lặp chứ không phải một lần xui.
 */

/** Số lỗi nghiêm trọng tối đa trong một cửa sổ thời gian trước khi bỏ cuộc. */
export const MAX_FATAL = 3;
/** Cửa sổ để đếm lỗi nghiêm trọng. Đủ rộng cho một loạt lỗi dồn dập. */
export const FATAL_WINDOW_MS = 60_000;

export type CrashKind = 'uncaught' | 'rejection';

export interface CrashReport {
  kind: CrashKind;
  /** Mô tả ngắn, đã cắt — vào nhật ký và lên UI, nên không được dài. */
  message: string;
  /** `true` khi lỗi lặp lại quá nhanh và tiến trình nên dừng. */
  fatal: boolean;
}

/** Chỉ phần `on`/`off` của `process`: đủ để test mà không cần side effect. */
export interface CrashTarget {
  on(event: 'uncaughtException', listener: (error: unknown) => void): unknown;
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
  off?(event: string, listener: (reason: unknown) => void): unknown;
  removeListener?(event: string, listener: (reason: unknown) => void): unknown;
}

export interface CrashOptions {
  /** Đồng hồ, để test điều khiển được cửa sổ đếm lỗi. */
  now?: () => number;
}

/**
 * Mô tả một lỗi thành một dòng ngắn. Không bao giờ ném: đây là chính chỗ xử lý
 * lỗi, và một `toString` ném lỗi ở đây sẽ làm `uncaughtException` đệ quy.
 */
export function describeError(error: unknown): string {
  try {
    if (error instanceof Error) {
      const name = typeof error.name === 'string' && error.name ? error.name : 'Error';
      return `${name}: ${error.message || '(không có thông điệp)'}`.slice(0, 200);
    }
    if (typeof error === 'string') return error.slice(0, 200);
    // `rejection` có thể là bất cứ thứ gì: object, number, undefined.
    return `Unknown: ${typeof error}`.slice(0, 200);
  } catch {
    return 'Unknown: không đọc được lỗi';
  }
}

/**
 * Đăng ký bắt lỗi. Trả về hàm gỡ đăng ký (dùng cho test; app thật giữ tới khi
 * thoát).
 *
 * `report` được gọi **một lần cho mỗi lỗi** và bản thân nó cũng được bọc: nếu
 * chính chỗ báo cáo hỏng (ví dụ ghi log ném lỗi), lỗi đó không được tạo ra
 * `uncaughtException` mới — vòng lặp vô hạn và app chết cứng.
 */
export function installCrashGuard(
  target: CrashTarget,
  report: (report: CrashReport) => void,
  options: CrashOptions = {},
): () => void {
  const now = options.now ?? Date.now;
  const stamps: number[] = [];
  let active = true;
  const guarded = (kind: CrashKind) => (error: unknown): void => {
    if (!active) return;
    const at = now();
    stamps.push(at);
    // Chỉ giữ lỗi trong cửa sổ hiện tại: ba lỗi trong một năm không phải là hỏng
    // vòng lặp, và cộng dồn mãi thì sớm muộn app cũng tự thoát mà không ai hiểu vì sao.
    while (stamps.length && at - stamps[0] > FATAL_WINDOW_MS) stamps.shift();
    const fatal = stamps.length >= MAX_FATAL;
    try {
      report({ kind, message: describeError(error), fatal });
    } catch { /* báo cáo hỏng không được thành lỗi mới */ }
  };

  const onUncaught = guarded('uncaught');
  const onRejection = guarded('rejection');
  target.on('uncaughtException', onUncaught);
  target.on('unhandledRejection', onRejection);

  return () => {
    active = false;
    const remove = target.off ?? target.removeListener;
    if (!remove) return;
    remove.call(target, 'uncaughtException', onUncaught);
    remove.call(target, 'unhandledRejection', onRejection);
  };
}
