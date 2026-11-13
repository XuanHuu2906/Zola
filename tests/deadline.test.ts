import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && specifier.endsWith('.js')) {
      try {
        return nextResolve(specifier.replace(/\.js$/, '.ts'), context);
      } catch {
        // Không có bản `.ts`: giữ nguyên đường dẫn gốc.
      }
    }
    return nextResolve(specifier, context);
  },
});

const { withDeadline } = await import('../electron/protocol/deadline.ts');

/**
 * Hạn thời gian cho đường đăng nhập.
 *
 * Vì sao có test này: `fetch` của Node không có hạn thời gian, và zca-js gọi
 * thẳng nó qua `ctx.options.polyfill`. Một kết nối treo giữa handshake giữ
 * `login()` mãi mãi — không ngoại lệ, không log. Người dùng chỉ thấy nút "Đang
 * mở phiên…" đứng im và không có cách nào bấm lại. Test khoá đúng ba tính chất
 * cần cho trường hợp đó.
 */

test('hết hạn thì từ chối, không chờ promise treo', async () => {
  const never = new Promise<string>(() => undefined);
  const started = Date.now();
  await assert.rejects(withDeadline(never, 50, 'quá lâu'), /quá lâu/);
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 40, `phải chờ ít nhất gần 50 ms, thực tế ${elapsed}`);
  assert.ok(elapsed < 2000, `không được chờ lâu hơn hạn, thực tế ${elapsed}`);
});

test('xong trước hạn thì trả giá trị, hạn không chen vào', async () => {
  const value = await withDeadline(Promise.resolve('xong'), 5000, 'không được xảy ra');
  assert.equal(value, 'xong');
});

test('lỗi thật đi qua nguyên vẹn, không bị đổi thành lỗi hết hạn', async () => {
  const boom = new Error('máy chủ từ chối');
  await assert.rejects(withDeadline(Promise.reject(boom), 5000, 'không được xảy ra'), error => {
    assert.equal((error as Error).message, 'máy chủ từ chối',
      'lỗi thật phải đọc được là lỗi thật — `isRetryable` phân nhánh theo nó');
    return true;
  });
});

test('promise từ chối **sau** khi đã hết hạn không thành unhandledRejection', async () => {
  // Vì sao quan trọng: `installCrashGuard` của tiến trình chính bắt
  // `unhandledRejection` và hiện nó thành toast "Lỗi nội bộ". Nếu bộ xử lý lỗi
  // không được gắn lên promise gốc, một kết nối chết **muộn** (sau khi người dùng
  // đã thấy lỗi hết hạn) sẽ dựng lên một lỗi không có thật ngay trước mắt họ.
  //
  // Lưu ý về sức mạnh của test này: nó chỉ chứng minh được "không có gì nổi lên",
  // và một promise đã có `.then(onOk, onErr)` thì **luôn** qua được vế đó — kể cả
  // khi bộ xử lý bị gỡ. Test ngay dưới đây mới là cái khoá sự tồn tại của bộ xử
  // lý; hai test bổ sung cho nhau chứ không thay nhau.
  const seen: unknown[] = [];
  const onUnhandled = (reason: unknown): void => { seen.push(reason); };
  process.on('unhandledRejection', onUnhandled);
  try {
    let rejectLate: (error: Error) => void = () => undefined;
    const late = new Promise<string>((_resolve, reject) => { rejectLate = reject; });
    await assert.rejects(withDeadline(late, 30, 'hết hạn'), /hết hạn/);
    rejectLate(new Error('mạng chết sau đó'));
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(seen, [], 'withDeadline tự nó không để lọt unhandledRejection');
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('promise gốc phải có **handler lỗi**, không chỉ có `.then`', async () => {
  // Đếm `.then` là chưa đủ: `then(onOk)` một tham số vẫn làm bộ đếm tăng, mà lại
  // không bắt được lỗi nào. Đã kiểm: một bản `deadline.ts` chỉ có
  // `promise.then(value => ...)` vẫn qua được phép đếm đó. Nên phải kiểm chính
  // tham số thứ hai là một hàm.
  const original = Promise.prototype.then;
  let errorHandlers = 0;
  Promise.prototype.then = function patched<T, R1, R2>(
    this: Promise<T>, onFulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    if (typeof onRejected === 'function') errorHandlers += 1;
    return original.call(this, onFulfilled, onRejected) as Promise<R1 | R2>;
  } as typeof Promise.prototype.then;
  try {
    const pending = new Promise<string>(() => undefined);
    // Chờ hạn **ngay trong test** thay vì để nó treo 60 s: một bộ hẹn giờ còn
    // sống sau khi test xong chạy `reject` khi không còn ai bắt, và node kể nó
    // là "asynchronous activity after the test ended" — đủ để `npm test` trả
    // mã 1 dù mọi test đều qua.
    const deadline = withDeadline(pending, 20, 'không xảy ra trong test này');
    assert.ok(errorHandlers >= 1,
      `promise gốc phải có handler lỗi gắn ngay, đếm được ${errorHandlers}`);
    await assert.rejects(deadline, /không xảy ra trong test này/);
  } finally {
    Promise.prototype.then = original;
  }
});
