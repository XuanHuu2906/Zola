import { AlertTriangle, LogIn, QrCode, RefreshCw } from 'lucide-react';
import { useZaloStore } from '../../store/useZaloStore.ts';
import { LIVE_NOTICE } from '../../../shared/live.ts';

/**
 * Màn hình chờ khôi phục phiên thật hoặc quét QR khi chưa có phiên.
 */
export function LiveLoginScreen() {
  const login = useZaloStore(s => s.login);
  const pending = useZaloStore(s => s.loginPending);
  const requestLogout = useZaloStore(s => s.requestLogout);
  const requestLogin = useZaloStore(s => s.requestLogin);

  return <div className="login-shell">
    <div className="login-card glass-card live-login" aria-labelledby="live-login-title">
      <span className="login-emblem" aria-hidden="true"><QrCode size={26} /></span>
      <span className="eyebrow">ZALO</span>
      <h1 id="live-login-title">{login.status === 'qr' ? 'Quét mã QR bằng Zalo' : 'Đang kết nối Zalo'}</h1>
      <p className="live-notice" role="note"><AlertTriangle size={16} />{LIVE_NOTICE}</p>

      {login.status === 'qr' && <div className="live-qr" role="group" aria-label="Mã QR đăng nhập Zalo">
        {login.qrImage
          ? <img src={login.qrImage} alt="Mã QR đăng nhập Zalo" width={220} height={220} />
          : <span className="live-qr-empty"><QrCode size={44} />Đang chờ điện thoại xác nhận…</span>}
        {login.note && <p className="login-copy">{login.note}</p>}
      </div>}

      {login.status === 'error' && <div className="live-error" role="alert">
        <p>{login.message}</p>
        {login.retryable
          ? <button className="primary-btn" onClick={requestLogin} disabled={pending}><RefreshCw size={16} />Thử lại</button>
          : <p className="login-copy">Hãy kiểm tra kết nối và thử khởi động lại ứng dụng.</p>}
        {login.sessionRetained && <button className="subtle-btn" disabled={pending} onClick={requestLogout}>
          Đăng nhập lại bằng QR
        </button>}
      </div>}

      {login.status === 'logged-out' && <p className="login-copy" role="status">
        <LogIn size={16} />{pending ? 'Đang khôi phục phiên Zalo…' : 'Đang chuẩn bị đăng nhập…'}
      </p>}
      {!window.chat && <p className="login-copy" role="alert">Đăng nhập Zalo cần chạy ứng dụng desktop.</p>}
    </div>
  </div>;
}
