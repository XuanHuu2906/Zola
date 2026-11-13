/**
 * Khoảng nghỉ giữa các lần xin lịch sử (plan §6.7).
 *
 * Zalo không công bố giới hạn, nên phải bảo thủ: một yêu cầu tại một thời điểm,
 * và một khoảng nghỉ có jitter trước mỗi lượt. Jitter là phần quan trọng — nghỉ
 * đúng một con số cố định vẫn tạo ra nhịp máy đều đặn, đúng thứ dễ bị nhận là bot.
 *
 * Module này không import `electron` và không giữ trạng thái toàn cục nào, nên
 * `tests/throttle.test.ts` kiểm được bằng đồng hồ giả.
 */

/** Thời gian nghỉ tối thiểu giữa hai yêu cầu lịch sử. */
export const THROTTLE_MIN_MS = 400;
/** Phần ngẫu nhiên cộng thêm, để nhịp không đều. */
export const THROTTLE_JITTER_MS = 600;

/** Một lần nghỉ luôn nằm trong `[min, min + jitter]`. */
export function throttleDelay(random: () => number = Math.random): number {
  // `random()` được kẹp lại: một hàm sinh số hỏng trả `NaN` hay `>1` sẽ biến
  // khoảng nghỉ thành `NaN` hoặc âm, và `setTimeout` coi cả hai là "chạy ngay".
  const unit = Math.min(1, Math.max(0, Number(random()) || 0));
  return THROTTLE_MIN_MS + Math.round(unit * THROTTLE_JITTER_MS);
}

export interface Throttle {
  /** Chờ hết khoảng nghỉ rồi mới chạy `task`; các lần gọi xếp hàng sau nhau. */
  run<T>(task: () => Promise<T>): Promise<T>;
  /** Thời điểm (ms, theo `now`) được phép chạy lần kế tiếp. Chỉ để test/đo. */
  readonly nextAt: number;
}

export interface ThrottleOptions {
  /** Đồng hồ, để test không phải chờ thật. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

/**
 * Hàng đợi tuần tự: mỗi lần `run` xếp sau lần trước, và nhiệm vụ kế tiếp không
 * bắt đầu trước `THROTTLE_MIN_MS` sau khi nhiệm vụ trước **kết thúc** (không phải
 * sau khi nó bắt đầu — một yêu cầu chậm 5 s vẫn phải có khoảng nghỉ sau nó).
 *
 * Một nhiệm vụ lỗi không làm hỏng hàng đợi: lỗi được trả về cho đúng người gọi,
 * còn các nhiệm vụ sau vẫn chạy.
 */
export function createThrottle(options: ThrottleOptions = {}): Throttle {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); }));
  const random = options.random ?? Math.random;
  let tail: Promise<unknown> = Promise.resolve();
  let nextAt = 0;

  return {
    get nextAt() { return nextAt; },
    run<T>(task: () => Promise<T>): Promise<T> {
      // Kẹp vào `tail` để nhiệm vụ tiếp theo không chạy song song, kể cả khi
      // nhiệm vụ trước hỏng — `tail` luôn là một Promise đã "xong hoặc lỗi".
      const run = tail.then(async () => {
        const wait = nextAt - now();
        if (wait > 0) await sleep(wait);
        try {
          return await task();
        } finally {
          // Đặt trong `finally`: một yêu cầu lỗi vẫn phải tính là "vừa gọi".
          nextAt = now() + throttleDelay(random);
        }
      });
      tail = run.catch(() => undefined);
      return run;
    },
  };
}
