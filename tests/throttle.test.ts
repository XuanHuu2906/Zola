import test from 'node:test';
import assert from 'node:assert/strict';
import { createThrottle, THROTTLE_JITTER_MS, THROTTLE_MIN_MS, throttleDelay } from '../electron/protocol/throttle.ts';

/**
 * §6.7 yêu cầu hàng đợi tuần tự và khoảng nghỉ có jitter. Test dùng đồng hồ giả
 * để không phải chờ thật: `sleep` chỉ cộng vào một biến, nên cả bộ chạy dưới 1 ms.
 */

/** Đồng hồ giả: `sleep` nhảy thời gian ngay, ghi lại từng lần nghỉ. */
function fakeClock() {
  let time = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => time,
    sleep: async (ms: number) => { sleeps.push(ms); time += ms; },
    advance: (ms: number) => { time += ms; },
    get time() { return time; },
  };
}

test('khoảng nghỉ luôn nằm trong [min, min + jitter]', () => {
  assert.equal(throttleDelay(() => 0), THROTTLE_MIN_MS);
  assert.equal(throttleDelay(() => 1), THROTTLE_MIN_MS + THROTTLE_JITTER_MS);
  assert.equal(throttleDelay(() => 0.5), THROTTLE_MIN_MS + Math.round(THROTTLE_JITTER_MS / 2));
});

test('hàm ngẫu nhiên hỏng không làm khoảng nghỉ thành NaN hay âm', () => {
  // `setTimeout(NaN)` và `setTimeout(-1)` đều chạy ngay: mất hẳn throttle.
  for (const bad of [Number.NaN, -5, 2, Number.POSITIVE_INFINITY]) {
    const delay = throttleDelay(() => bad);
    assert.ok(Number.isFinite(delay), `delay phải hữu hạn với random()=${bad}`);
    assert.ok(delay >= THROTTLE_MIN_MS, `delay không được dưới mức tối thiểu với random()=${bad}`);
    assert.ok(delay <= THROTTLE_MIN_MS + THROTTLE_JITTER_MS);
  }
});

test('nhiệm vụ chạy tuần tự, không chồng nhau dù gọi cùng lúc', async () => {
  const clock = fakeClock();
  const throttle = createThrottle({ now: clock.now, sleep: clock.sleep, random: () => 0 });
  const running: string[] = [];
  const order: string[] = [];
  const task = (name: string, ms: number) => throttle.run(async () => {
    running.push(name);
    assert.equal(running.length, 1, `${name} bắt đầu khi ${running[0]} còn chạy`);
    clock.advance(ms);
    running.pop();
    order.push(name);
    return name;
  });

  const results = await Promise.all([task('a', 10), task('b', 10), task('c', 10)]);
  assert.deepEqual(order, ['a', 'b', 'c']);
  assert.deepEqual(results, ['a', 'b', 'c'], 'kết quả về đúng người gọi');
});

test('nhiệm vụ sau phải chờ khoảng nghỉ tính từ lúc nhiệm vụ trước KẾT THÚC', async () => {
  const clock = fakeClock();
  const throttle = createThrottle({ now: clock.now, sleep: clock.sleep, random: () => 0 });
  let firstEndedAt = 0;

  await throttle.run(async () => { clock.advance(5000); firstEndedAt = clock.time; });
  // Yêu cầu đầu chậm 5 s: khoảng nghỉ phải tính sau nó, không phải sau lúc nó bắt đầu.
  const secondStartedAt = await throttle.run(async () => clock.time);

  assert.equal(secondStartedAt, firstEndedAt + THROTTLE_MIN_MS);
  assert.deepEqual(clock.sleeps, [THROTTLE_MIN_MS], 'chỉ nghỉ đúng một lần, giữa hai nhiệm vụ');
});

test('một nhiệm vụ lỗi không làm kẹt hàng đợi', async () => {
  const clock = fakeClock();
  const throttle = createThrottle({ now: clock.now, sleep: clock.sleep, random: () => 0 });

  await assert.rejects(throttle.run(async () => { throw new Error('máy chủ im lặng'); }), /im lặng/);
  // Nhiệm vụ sau vẫn chạy, và vẫn có khoảng nghỉ: yêu cầu hỏng cũng là một lần gọi.
  const value = await throttle.run(async () => 'ổn');
  assert.equal(value, 'ổn');
  assert.deepEqual(clock.sleeps, [THROTTLE_MIN_MS]);
});

test('lỗi của người gọi trước không biến thành lỗi của người gọi sau', async () => {
  const clock = fakeClock();
  const throttle = createThrottle({ now: clock.now, sleep: clock.sleep, random: () => 0 });
  const failing = throttle.run(async () => { throw new Error('hỏng'); });
  const fine = throttle.run(async () => 'ok');
  await assert.rejects(failing, /hỏng/);
  assert.equal(await fine, 'ok');
});

test('jitter thật sự tạo ra khoảng nghỉ khác nhau giữa các lần', async () => {
  const clock = fakeClock();
  // `random` tăng dần qua các lần gọi, như một bộ sinh thật sẽ làm.
  let n = 0;
  const throttle = createThrottle({ now: clock.now, sleep: clock.sleep, random: () => (n += 0.25) % 1.25 / 1.25 });
  for (let i = 0; i < 4; i += 1) await throttle.run(async () => undefined);
  const distinct = new Set(clock.sleeps);
  assert.ok(distinct.size > 1, `khoảng nghỉ phải khác nhau, nhận được ${JSON.stringify(clock.sleeps)}`);
});

test('lần đầu chạy ngay, không nghỉ vô ích', async () => {
  const clock = fakeClock();
  const throttle = createThrottle({ now: clock.now, sleep: clock.sleep, random: () => 0 });
  const at = await throttle.run(async () => clock.time);
  assert.equal(at, 0);
  assert.deepEqual(clock.sleeps, [], 'chưa có yêu cầu nào trước đó thì không phải chờ');
});
