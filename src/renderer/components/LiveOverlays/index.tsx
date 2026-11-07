import { useDemoStore } from '../../store/useDemoStore.ts';
import { LiveLoginScreen } from '../LiveLoginScreen/index.tsx';
import { LiveInfoScreen, LiveProfileScreen } from './screens.tsx';

/**
 * Lớp phủ của chế độ thật: cửa đăng nhập QR và hai hộp thông tin đọc từ dữ liệu
 * thật. Giữ ở tệp riêng để `Overlays` của bản demo không có nhánh live nào.
 */
export function LiveOverlays() {
  const overlay = useDemoStore(s => s.liveOverlay);
  const login = useDemoStore(s => s.login);
  if (login.status !== 'logged-in') return <LiveLoginScreen />;
  // Không có overlay nghĩa là không có hộp nào mở; hồ sơ chỉ hiện khi được gọi.
  if (!overlay) return null;
  if (overlay.kind === 'profile') return <LiveProfileScreen />;
  return <LiveInfoScreen chatId={overlay.chatId} />;
}
