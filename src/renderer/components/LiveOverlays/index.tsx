import { useZaloStore } from '../../store/useZaloStore.ts';
import { LiveLoginScreen } from '../LiveLoginScreen/index.tsx';
import { LiveMediaScreen } from './MediaScreen.tsx';
import { LiveInfoScreen, LiveProfileScreen } from './screens.tsx';
import { ForwardDialog } from '../ForwardDialog/index.tsx';
import { SettingsDialog } from '../SettingsDialog/index.tsx';

/** Cửa đăng nhập QR và các hộp thoại đọc từ dữ liệu Zalo thật. */
export function LiveOverlays() {
  const overlay = useZaloStore(s => s.liveOverlay);
  const login = useZaloStore(s => s.login);
  const close = useZaloStore(s => s.closeLiveOverlay);
  if (login.status !== 'logged-in') return <LiveLoginScreen />;
  // Không có overlay nghĩa là không có hộp nào mở; hồ sơ chỉ hiện khi được gọi.
  if (!overlay) return null;
  if (overlay.kind === 'profile') return <LiveProfileScreen />;
  if (overlay.kind === 'settings') return <SettingsDialog close={close} />;
  if (overlay.kind === 'media') return <LiveMediaScreen chatId={overlay.chatId} />;
  if (overlay.kind === 'forward') return <ForwardDialog message={overlay.message} />;
  return <LiveInfoScreen chatId={overlay.chatId} />;
}
