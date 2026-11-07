import { AlertTriangle, LogIn, QrCode, RefreshCw, ArrowLeft } from 'lucide-react';
import { useDemoStore } from '../../store/useDemoStore.ts';
import { LIVE_NOTICE } from '../../../shared/live.ts';

/**
 * Cửa vào chế độ thật. Chỉ render khi `window.chat` tồn tại (app Electron);
 * trong trình duyệt thường `App` không bao giờ tới đây.
 *
 * Bản demo vẫn là lối mặc định: nút "Quay lại bản demo" đi trước, và QR chỉ xuất
 * hiện sau khi người dùng chủ động bấm "Đăng nhập Zalo thật".
 */
export function LiveLoginScreen() {
  const login = useDemoStore(s => s.login);
  const pending = useDemoStore(s => s.loginPending);
  const requestLogin = useDemoStore(s => s.requestLogin);
  const exitLive = useDemoStore(s => s.exitLive);

  return <div className="login-shell">
    <div className="login-card glass-card live-login" aria-labelledby="live-login-title">
      <span className="login-emblem" aria-hidden="true"><QrCode size={26} /></span>
      <span className="eyebrow">CHẾ ĐỘ ZALO THẬT</span>
      <h1 id="live-login-title">{login.status === 'qr' ? 'Quét mã QR bằng Zalo' : 'Đăng nhập Zalo thật'}</h1>
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
          : <p className="login-copy">Lỗi xác thực: hãy quay lại bản demo rồi thử đăng nhập lại.</p>}
      </div>}

      {login.status === 'logged-out' && <button className="primary-btn login-submit" onClick={requestLogin} disabled={pending}>
        <LogIn size={17} />{pending ? 'Đang mở phiên…' : 'Đăng nhập Zalo thật'}
      </button>}

      <button className="subtle-btn live-back" onClick={exitLive}><ArrowLeft size={16} />Quay lại bản demo</button>
    </div>
  </div>;
}
