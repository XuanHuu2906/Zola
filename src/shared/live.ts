import type { LiveConnection } from './ipc-contract.ts';

/**
 * ADR-004 bắt buộc câu cảnh báo này xuất hiện nguyên văn ở lối vào chế độ thật.
 * Giữ nó ở một chỗ duy nhất để không trôi khỏi UI khi câu chữ được sửa.
 */
export const LIVE_NOTICE = 'Dùng zca-js không chính thức, chạy được hay không phụ thuộc server Zalo, có thể khiến tài khoản bị khóa. Chỉ nên dùng tài khoản phụ.';

/**
 * Nhãn cho bốn trạng thái của plan §5.5. Tách khỏi `connectionLabel` của bản
 * demo (`src/shared/network.ts`) vì hai bảng trạng thái khác nhau hoàn toàn.
 */
export function liveConnectionLabel(state: LiveConnection): string {
  if (state === 'connecting') return 'Đang kết nối Zalo…';
  if (state === 'disconnected') return 'Mất kết nối. Đang thử lại.';
  if (state === 'replaced') return 'Đã dừng vì Zalo đang mở ở nơi khác';
  return '';
}

/**
 * `replaced` là lần duy nhất server chủ động cắt phiên, nên banner phải đỏ và
 * phải có nút bấm. Loss of network tự thử lại ở main nên chỉ cần banner vàng.
 */
export function liveConnectionTone(state: LiveConnection): 'danger' | 'wait' {
  return state === 'replaced' ? 'danger' : 'wait';
}

/** `replaced` không bao giờ tự kết nối lại (plan §5.5); nút bấm là đường duy nhất. */
export function liveConnectionReconnectable(state: LiveConnection): boolean {
  return state === 'replaced' || state === 'disconnected';
}
