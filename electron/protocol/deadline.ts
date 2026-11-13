/**
 * Tiện ích hạn thời gian cho những lời gọi mà `fetch` của Node không chặn được.
 *
 * `ctx.options.polyfill` của zca-js mặc định là `fetch` toàn cục, mà `fetch`
 * không có hạn thời gian: một kết nối treo giữa handshake TLS giữ promise mãi
 * mãi. `AbortSignal` không đi qua được đường của zca-js, nên cách duy nhất còn
 * lại là **bỏ chờ** promise đó và tự trả về một lỗi.
 *
 * Đây là hàm thuần, không phụ thuộc Electron hay mạng — nên test được, và đó là
 * lý do nó nằm ở file riêng chứ không trong `zalo-client.ts` (file đó import
 * `zca-js` và chỉ chạy được trong tiến trình chính).
 */

/**
 * Trả về một promise hoàn thành theo `promise`, hoặc từ chối sau `ms`.
 *
 * Promise gốc **không** bị huỷ — không có cách nào huỷ nó. Nhưng người gọi lấy
 * lại được quyền điều khiển, thay vì một nút bấm không có phản hồi.
 *
 * Promise gốc luôn có bộ xử lý lỗi gắn sẵn (nhánh thứ hai của `.then` bên dưới),
 * nên một lần từ chối **muộn** — sau khi ta đã trả lỗi hết hạn — không thành
 * `unhandledRejection`. Đó không phải chi tiết phụ: `installCrashGuard` của tiến
 * trình chính bắt `unhandledRejection` và hiện nó thành toast "Lỗi nội bộ", nên
 * thiếu bộ xử lý đó thì một kết nối chết muộn sẽ dựng lên một lỗi không có thật
 * ngay trước mắt người dùng.
 */
export function withDeadline<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      // Nhánh này chạy cả khi đã hết hạn: nó vẫn nuốt lỗi muộn và không làm gì
      // thêm, vì promise ngoài đã settle nên `reject` là no-op.
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}
