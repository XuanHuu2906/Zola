import type { LiveConnection } from './ipc-contract.ts';

/**
 * Giữ cảnh báo sử dụng zca-js ở một chỗ duy nhất để không trôi khỏi UI.
 */
export const LIVE_NOTICE = 'Dùng zca-js không chính thức, chạy được hay không phụ thuộc server Zalo, có thể khiến tài khoản bị khóa. Chỉ nên dùng tài khoản phụ.';

/**
 * Nhãn cho bốn trạng thái kết nối Zalo của plan §5.5.
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

/**
 * Phần trăm của lần đồng bộ, hoặc `null` khi chưa biết tổng.
 *
 * `total` chỉ có sau gói `isLast`; trước đó renderer phải hiện **nhịp chạy**,
 * không phải một thanh đứng ở 0% — thanh 0% trông giống hệt một lần treo, và
 * người dùng không phân biệt được hai thứ đó nếu không có con số.
 *
 * Kẹp ở 100: máy chủ có thể đẩy thêm gói sau `isLast` (đo 2026-11-10: `done`
 * ở 46/46 rồi vẫn còn gói 12–21 tới), và "107%" là một câu vô nghĩa.
 */
export function syncPercent(stats: { received: number; total: number }): number | null {
  if (!Number.isFinite(stats.total) || stats.total <= 0) return null;
  const seen = Math.min(Math.max(stats.received, 0), stats.total);
  return Math.min(100, Math.round((seen / stats.total) * 100));
}
