import { CloudDownload, Wifi, WifiOff } from 'lucide-react';
import { useZaloStore } from '../../store/useZaloStore.ts';
import {
  liveConnectionLabel, liveConnectionReconnectable, liveConnectionTone, syncPercent,
} from '../../../shared/live.ts';

/**
 * Account connection and phone-sync status banner.
 *
 * Mất kết nối được ưu tiên trước, rồi đến tiến trình đồng bộ hoặc catch-up,
 * lời mời đồng bộ, rồi không gì.
 */
export function LiveBanner() {
  const state = useZaloStore(s => s.liveConnection);
  const loggedIn = useZaloStore(s => s.login.status === 'logged-in');
  const reconnect = useZaloStore(s => s.requestReconnect);
  const sync = useZaloStore(s => s.liveSync);
  const catchUp = useZaloStore(s => s.liveCatchUp);
  const canSync = useZaloStore(s => s.liveCanSync && s.livePhoneSyncSetupRequired && !s.livePhoneSyncComplete);
  const syncFromPhone = useZaloStore(s => s.syncFromPhone);
  // Chưa có phiên thì "mất kết nối" chỉ là trạng thái khởi tạo, không phải lỗi
  // người dùng cần thấy chồng lên màn hình QR.
  if (!loggedIn) return null;

  if (state !== 'connected') {
    const label = liveConnectionLabel(state);
    return <div className="live-banner" data-connection={state} data-tone={liveConnectionTone(state)}
      role="status" aria-live="polite">
      {state === 'connecting' ? <Wifi size={16} /> : <WifiOff size={16} />}
      <span>{label}</span>
      {liveConnectionReconnectable(state) && <button className="subtle-btn live-reconnect" onClick={reconnect}>Kết nối lại</button>}
    </div>;
  }

  const running = sync?.phase === 'requested' || sync?.phase === 'receiving';

  if (!running && catchUp?.phase === 'checking') {
    return <div className="live-banner" data-tone="wait" data-catch-up="checking" role="status" aria-live="polite">
      <CloudDownload size={16} aria-hidden="true" />
      <span>Đang kiểm tra tin nhắn mới từ lần kết nối trước…</span>
    </div>;
  }

  // Lời mời đồng bộ. Zalo PC đặt đúng thứ này ở `suggest_sync_banner` của nó
  // — một dải có nút "Đồng bộ ngay" — thay vì để người dùng tự đi tìm nút
  // trong menu tài khoản. Dấu hoàn tất được lưu theo tài khoản trên máy;
  // không mời lại khi mở app hoặc cập nhật. Lỗi vẫn cho phép thử lại.
  if (!running && (sync === null || sync?.phase === 'failed') && canSync) {
    return <div className="live-banner" data-tone="suggest" data-sync="suggest" role="status">
      <CloudDownload size={16} aria-hidden="true" />
      <span>Tin nhắn chưa được đồng bộ · lấy lịch sử cũ từ điện thoại</span>
      <button className="subtle-btn live-reconnect" onClick={syncFromPhone}>Đồng bộ ngay</button>
    </div>;
  }

  // Chỉ hiện khi đang chạy: `done` là tin đã nằm trong danh sách, không cần một
  // dòng chúc mừng; `failed` đã được thông báo bằng toast kèm lý do.
  if (!running) return null;
  const { received, total, written } = sync.stats;
  // `total` chỉ biết sau khi gói đầu tới (`-1`/`0` = chưa biết), nên câu chữ phải
  // đọc được ở cả hai lúc thay vì hiện "0/0". Phần trăm tính trên **số gói** vì
  // đó là thứ duy nhất máy chủ cho biết trước; số tin chỉ biết khi xong.
  const known = total > 0;
  const percent = syncPercent(sync.stats);
  const counts = known
    ? `${written} tin · gói ${Math.min(received, total)}/${total}`
    : `${received} gói đã nhận`;
  return <div className="live-banner" data-tone="wait" data-sync={sync.phase} role="status" aria-live="polite">
    <CloudDownload size={16} className="live-sync-icon" aria-hidden="true" />
    <span>
      {sync.phase === 'requested'
        ? 'Đang kết nối điện thoại — hãy mở Zalo trên điện thoại và xác nhận nếu được yêu cầu'
        : 'Đang đồng bộ lịch sử'}
      {percent !== null && <b className="live-sync-percent"> · {percent}%</b>} · {counts}
    </span>
    {/* Thanh tiến trình chỉ có nghĩa khi biết tổng; trước đó hiện nhịp chạy
        (icon ở trên) thay vì một thanh đứng ở 0% trông như treo. */}
    {known && <span className="live-sync-bar" role="progressbar" aria-label="Tiến độ đồng bộ"
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? 0}>
      <i style={{ width: `${percent ?? 0}%` }} />
    </span>}
  </div>;
}
