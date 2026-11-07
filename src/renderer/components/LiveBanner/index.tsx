import { Wifi, WifiOff } from 'lucide-react';
import { useDemoStore } from '../../store/useDemoStore.ts';
import { liveConnectionLabel, liveConnectionReconnectable, liveConnectionTone } from '../../../shared/live.ts';

/**
 * Banner của chế độ thật. Tách khỏi `.connection-banner` của bản demo vì hai bảng
 * trạng thái khác nhau; chỉ hiện khi đang ở chế độ thật (`liveMode`).
 */
export function LiveBanner() {
  const state = useDemoStore(s => s.liveConnection);
  const loggedIn = useDemoStore(s => s.login.status === 'logged-in');
  const reconnect = useDemoStore(s => s.requestReconnect);
  // Chưa có phiên thì "mất kết nối" chỉ là trạng thái khởi tạo, không phải lỗi
  // người dùng cần thấy chồng lên màn hình QR.
  if (!loggedIn || state === 'connected') return null;
  const label = liveConnectionLabel(state);
  return <div className="live-banner" data-connection={state} data-tone={liveConnectionTone(state)}
    role="status" aria-live="polite">
    {state === 'connecting' ? <Wifi size={16} /> : <WifiOff size={16} />}
    <span>{label}</span>
    {liveConnectionReconnectable(state) && <button className="subtle-btn live-reconnect" onClick={reconnect}>Kết nối lại</button>}
  </div>;
}
