/**
 * Ghi nhận lỗi render (plan §9.1: "ghi nhận kiểu lỗi và hiển thị thông báo … thay
 * vì crash").
 *
 * Hàm thuần để `tests/live.test.ts` kiểm được mà không cần React: nó nhận hai
 * chuỗi và trả về đúng payload sẽ đi qua IPC.
 *
 * ## Vì sao **không** gửi `error.message`
 *
 * Nhật ký chẩn đoán của app hứa "không nội dung tin" (`electron/log-file.ts`).
 * Một lỗi render có thể bị ném từ bất cứ đâu, kể cả chỗ đang cầm nội dung tin —
 * `throw new Error(tinNhắn)` là chuyện có thật. Gửi nguyên `message` vào log sẽ
 * phá đúng lời hứa đó ở chỗ khó thấy nhất. Nên log nhận **tên lỗi**, **component
 * stack** (chỉ tên component của chính repo này) và **độ dài** thông điệp; còn
 * nguyên văn thì hiện trong khung lỗi trên màn hình người dùng.
 */

/** Trần cho trường đi vào log: component stack của React rất dài. */
export const COMPONENT_STACK_MAX = 1200;

export interface RenderErrorReport {
  name: string;
  componentStack: string;
  messageLength: number;
}

export function renderErrorReport(error: unknown, componentStack: string): RenderErrorReport {
  const record = (error ?? {}) as { name?: unknown; message?: unknown };
  const name = typeof record.name === 'string' && record.name ? record.name : 'Error';
  const message = typeof record.message === 'string' ? record.message : '';
  return {
    name: name.slice(0, 80),
    // React chèn tên component và đường dẫn file nguồn — không có nội dung tin.
    componentStack: (componentStack || '').trim().slice(0, COMPONENT_STACK_MAX),
    messageLength: message.length,
  };
}

/**
 * Gửi báo cáo lên main. Không bao giờ ném và không bao giờ trả Promise: đây là
 * đường chạy khi app vừa hỏng, và thêm một lời hứa bị từ chối ở đây sẽ chỉ tạo
 * thêm lỗi thứ hai.
 */
export function reportRenderError(error: unknown, componentStack: string): void {
  try {
    window.chat?.reportRenderError?.(renderErrorReport(error, componentStack));
  } catch { /* cầu nối đã bị gỡ (cửa sổ đang đóng): bỏ qua */ }
}
