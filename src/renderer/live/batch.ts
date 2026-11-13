/**
 * Gộp nhiều cập nhật UI vào một lần ghi (plan §8.1: "Gom (debounce) các cập nhật
 * UI khi nhiều tin đến cùng lúc").
 *
 * Mỗi `evMessageUpsert` hiện là một `setState`, và mỗi `setState` renderer lại
 * render toàn bộ danh sách hội thoại + danh sách tin. Mở app sau một đêm hay một
 * nhóm sôi nổi thì đó là hàng chục lần render cho những tin mà mắt người không
 * phân biệt được là đã hiện lúc nào.
 *
 * ## Vì sao có trễ, không phải "gom trong cùng một tick"
 *
 * Mỗi tin từ main tới đây bằng một tác vụ IPC riêng, nên `queueMicrotask` hay
 * `setTimeout(0)` **không** gom được gì: lần xả đầu chạy trước khi tin thứ hai
 * được giao. Phải có một cửa sổ thời gian thật. 50 ms là mức nhỏ nhất mà tiếng
 * gõ/hiển thị không cảm nhận được, trong khi vẫn đủ để gom một đợt tin dồn.
 *
 * Tin được xử lý **đúng thứ tự đến**: hàm `apply` nhận cả lô và store áp tuần tự,
 * nên echo → thu hồi → tin mới vẫn ra đúng kết quả như khi từng tin đến riêng.
 *
 * Đồng hồ và bộ hẹn giờ đều bơm được, nên `tests/batch.test.ts` kiểm được cửa sổ
 * gộp mà không phải `sleep`.
 */

/** Cửa sổ gộp mặc định. */
export const BATCH_DELAY_MS = 50;
/**
 * Trần số tin giữ lại chờ xả. Một trận mưa tin không được phép phình bộ nhớ chỉ
 * vì đồng hồ chưa điểm; chạm trần là xả ngay.
 */
export const BATCH_MAX_ITEMS = 200;

export type BatchScheduler = (flush: () => void, delayMs: number) => unknown;
export type BatchCanceller = (handle: unknown) => void;

export interface BatchOptions<T> {
  /** Nhận cả lô, đúng thứ tự `push`. Gọi đúng một lần cho mỗi lần xả. */
  apply(items: T[]): void;
  delayMs?: number;
  maxItems?: number;
  schedule?: BatchScheduler;
  cancelScheduled?: BatchCanceller;
  now?: () => number;
}

export interface Batcher<T> {
  push(item: T): void;
  /** Xả ngay, bỏ hẹn giờ đang chờ. Không có gì trong lô thì không gọi `apply`. */
  flush(): void;
  /**
   * Bỏ lô đang chờ **mà không** gọi `apply`. Vẫn nhận `push` tiếp — lô thuộc về
   * phiên đang chạy, không phải thuộc về cả vòng đời app, nên rời rồi vào lại chế
   * độ thật vẫn phải gom được.
   */
  discard(): void;
  /** Số tin đang chờ xả. */
  readonly size: number;
}

export function createBatcher<T>(options: BatchOptions<T>): Batcher<T> {
  const delayMs = Math.max(0, options.delayMs ?? BATCH_DELAY_MS);
  const maxItems = Math.max(1, Math.floor(options.maxItems ?? BATCH_MAX_ITEMS));
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? ((flush, ms) => setTimeout(flush, ms));
  const cancelScheduled = options.cancelScheduled
    ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let buffer: T[] = [];
  let timer: unknown = null;
  /** Lúc tin đầu của lô hiện tại được đẩy vào; 0 khi lô rỗng. */
  let openedAt = 0;

  const stopTimer = (): void => {
    if (timer === null) return;
    cancelScheduled(timer);
    timer = null;
  };

  const flush = (): void => {
    stopTimer();
    if (!buffer.length) return;
    const items = buffer;
    // Dọn trạng thái **trước** khi gọi `apply`: `apply` ném lỗi cũng không được
    // để lại một cái hẹn giờ trỏ vào lô đã xả, hay một lô ma sẽ xả lần nữa.
    buffer = [];
    openedAt = 0;
    options.apply(items);
  };

  return {
    push(item) {
      if (!buffer.length) openedAt = now();
      buffer.push(item);
      // Đồng hồ đã đi quá cửa sổ (bộ hẹn giờ bị chặn, hoặc máy vừa ngủ dậy) thì
      // chờ thêm là vô nghĩa — xả luôn.
      if (buffer.length >= maxItems || now() - openedAt >= delayMs) {
        flush();
        return;
      }
      if (timer === null) timer = schedule(flush, delayMs);
    },
    flush,
    discard() {
      stopTimer();
      buffer = [];
      openedAt = 0;
    },
    get size() {
      return buffer.length;
    },
  };
}
